/**
 * A small OBS Studio client for the WebSocket server (protocol v5). It connects, answers the password challenge,
 * and sends requests. Runs in the operator window, which is the only place that holds the password.
 *
 * Only what the Lower 3rd panel needs is here: the version (for a test), the current scene, and adding a browser
 * source. Nothing is sent to OBS unless the operator asks for it.
 */

export interface ObsSettings {
  address: string;
  port: number;
}

export type ObsStatus = 'disconnected' | 'connecting' | 'connected';

/** OBS closes the socket with this code when the password is wrong. */
const CLOSE_AUTH_FAILED = 4009;
/** OBS's request result code for "that already exists". */
const CODE_RESOURCE_EXISTS = 601;

const SETTINGS_KEY = 'apccmma.obs';

/** Address and port are remembered on this computer. The password is never stored. */
export function loadObsSettings(): ObsSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    return {
      address: typeof raw?.address === 'string' && raw.address.trim() ? raw.address.trim() : '127.0.0.1',
      port: Number.isInteger(raw?.port) && raw.port > 0 && raw.port < 65536 ? raw.port : 4455,
    };
  } catch {
    return { address: '127.0.0.1', port: 4455 };
  }
}

export function saveObsSettings(settings: ObsSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable: the settings last for this session */
  }
}

/** The authentication string OBS expects: base64(sha256(base64(sha256(password + salt)) + challenge)). */
async function authenticationString(password: string, salt: string, challenge: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = async (text: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
  const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
  const secret = toBase64(await digest(password + salt));
  return toBase64(await digest(secret + challenge));
}

interface Pending {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
}

class ObsClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<string, Pending>();
  private listeners = new Set<(status: ObsStatus) => void>();
  private status: ObsStatus = 'disconnected';
  private key = '';

  get current(): ObsStatus {
    return this.status;
  }

  onStatus(listener: (status: ObsStatus) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setStatus(status: ObsStatus) {
    this.status = status;
    this.listeners.forEach((listener) => listener(status));
  }

  /** Opens the socket and identifies to OBS. Resolves once OBS accepts the connection. */
  connect(settings: ObsSettings, password: string): Promise<void> {
    const key = `${settings.address}:${settings.port}`;
    if (this.ws && this.status === 'connected' && this.key === key) return Promise.resolve();
    this.close();
    this.key = key;
    this.setStatus('connecting');

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        this.setStatus('disconnected');
        reject(err);
      };

      let ws: WebSocket;
      try {
        ws = new WebSocket(`ws://${settings.address}:${settings.port}`);
      } catch {
        fail(new Error('That address is not valid.'));
        return;
      }
      this.ws = ws;

      ws.onmessage = async (event) => {
        const message = JSON.parse(String(event.data)) as { op: number; d: any };
        if (message.op === 0) {
          // Hello: OBS sends a challenge when a password is set.
          const auth = message.d.authentication as { challenge: string; salt: string } | undefined;
          if (auth && !password) {
            fail(new Error('OBS needs a password. Enter it below.'));
            ws.close();
            return;
          }
          const authentication = auth ? await authenticationString(password, auth.salt, auth.challenge) : undefined;
          ws.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, authentication, eventSubscriptions: 0 } }));
        } else if (message.op === 2) {
          // Identified: the connection is ready for requests.
          settled = true;
          this.setStatus('connected');
          resolve();
        } else if (message.op === 7) {
          this.answer(message.d);
        }
      };

      ws.onerror = () => fail(new Error(`Could not reach OBS at ${settings.address}:${settings.port}. Is the WebSocket server enabled in OBS?`));

      ws.onclose = (event) => {
        this.rejectAll(new Error('The connection to OBS closed.'));
        if (!settled) {
          fail(new Error(event.code === CLOSE_AUTH_FAILED ? 'The OBS password is wrong.' : `OBS closed the connection (code ${event.code}).`));
        } else {
          this.setStatus('disconnected');
        }
        if (this.ws === ws) this.ws = null;
      };
    });
  }

  /** Sends one request and resolves with its response data. Rejects with OBS's own reason when it fails. */
  request(requestType: string, requestData?: Record<string, unknown>): Promise<any> {
    const ws = this.ws;
    if (!ws || this.status !== 'connected') return Promise.reject(new Error('Not connected to OBS.'));
    const requestId = String(this.nextId++);
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
    });
  }

  private answer(response: { requestId: string; requestStatus: { result: boolean; code: number; comment?: string }; responseData?: unknown }) {
    const waiting = this.pending.get(response.requestId);
    if (!waiting) return;
    this.pending.delete(response.requestId);
    if (response.requestStatus.result) {
      waiting.resolve(response.responseData ?? {});
    } else {
      const err = new Error(response.requestStatus.comment ?? `OBS refused the request (code ${response.requestStatus.code}).`) as Error & { code?: number };
      err.code = response.requestStatus.code;
      waiting.reject(err);
    }
  }

  private rejectAll(err: Error) {
    for (const waiting of this.pending.values()) waiting.reject(err);
    this.pending.clear();
  }

  close() {
    const ws = this.ws;
    this.ws = null;
    this.rejectAll(new Error('Disconnected.'));
    if (ws) ws.close();
    this.setStatus('disconnected');
  }
}

/** The one connection the operator window uses. */
export const obs = new ObsClient();

/** Connects with a test, reads OBS's version, and disconnects. Resolves to a short description of what answered. */
export async function testObsConnection(settings: ObsSettings, password: string): Promise<string> {
  const wasConnected = obs.current === 'connected';
  await obs.connect(settings, password);
  try {
    const version = await obs.request('GetVersion');
    return `OBS ${version.obsVersion} (WebSocket ${version.obsWebSocketVersion}).`;
  } finally {
    if (!wasConnected) obs.close();
  }
}

/**
 * Adds the lower third as a browser source in the scene OBS is showing. OBS keeps the source, so it stays in the
 * scene after the connection closes. If a source of that name already exists, the existing one is kept and reported.
 */
export async function addLowerThirdBrowserSource(settings: ObsSettings, password: string, url: string): Promise<string> {
  await obs.connect(settings, password);
  const { currentProgramSceneName } = await obs.request('GetCurrentProgramScene');
  try {
    await obs.request('CreateInput', {
      sceneName: currentProgramSceneName,
      inputName: 'APCCMMA Lower Third',
      inputKind: 'browser_source',
      inputSettings: { url, width: 1920, height: 1080, fps: 30, shutdown: false, restart_when_active: false },
      sceneItemEnabled: true,
    });
    return `Added "APCCMMA Lower Third" to the scene "${currentProgramSceneName}".`;
  } catch (err) {
    if ((err as { code?: number }).code === CODE_RESOURCE_EXISTS) {
      return `"APCCMMA Lower Third" is already in OBS. Its address is unchanged.`;
    }
    throw err;
  }
}

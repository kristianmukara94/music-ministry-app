import { useEffect, useMemo, useState, type ReactNode } from 'react';
import qrcode from 'qrcode-generator';
import { Copy, KeyRound, Smartphone, WifiOff } from 'lucide-react';
import { bridge, type RemoteViewPatch, type RemoteViewStatus } from '../live/bridge';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

// Must match electron/remote-view-server.js and shared/remote-view.js.
const DEFAULT_PORT = 3003;
const PORT_MIN = 1024;
const PORT_MAX = 65535;
const PIN_PATTERN = /^\d{4,8}$/;

const button =
  'flex h-10 items-center gap-2 rounded-md border border-line-strong px-4 text-xs font-bold uppercase hover:bg-panel-2 disabled:opacity-40';
const field = 'h-10 rounded-md border border-line-strong bg-canvas px-3 font-mono text-sm outline-none focus:border-accent';

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-5 backdrop-blur-md">
      <h2 className="mb-4 border-b border-line pb-2 text-xl font-black uppercase condensed">{title}</h2>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}

function Switch({ label, on, disabled, onChange }: { label: string; on: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="flex shrink-0 items-center disabled:opacity-40"
    >
      <span className={`relative h-6 w-11 rounded-full border transition ${on ? 'border-accent bg-accent' : 'border-line-strong bg-panel-2'}`}>
        <span className={`absolute top-0.5 size-4 rounded-full bg-fg transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} aria-hidden />
      </span>
    </button>
  );
}

/** The address as a QR code. It is drawn here in the app, so it needs no internet. */
function qrDataUrl(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(6, 4);
}

/**
 * Remote view: the read-only live screen that singers and players open on their phones over the local WiFi. The switch
 * starts and stops the page. The address and a QR code show where it is, and the port and PIN are set here too.
 */
export function RemoteViewSettings() {
  const [status, setStatus] = useState<RemoteViewStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [portDraft, setPortDraft] = useState('');
  const [pinDraft, setPinDraft] = useState('');
  const [copied, setCopied] = useState(false);

  // The status is read every 2 seconds, so the device count and a network that comes back are shown without a reload.
  useEffect(() => {
    let alive = true;
    const load = () =>
      bridge.remoteView
        .get()
        .then((next) => alive && setStatus(next))
        .catch((err) => alive && setError(errorText(err)));
    void load();
    const timer = window.setInterval(load, 2000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (status) setPortDraft(String(status.port));
  }, [status?.port]);

  const qr = useMemo(() => (status?.url ? qrDataUrl(status.url) : null), [status?.url]);

  const save = (patch: RemoteViewPatch, done?: () => void) => {
    setBusy(true);
    setError(null);
    bridge.remoteView
      .save(patch)
      .then((next) => {
        setStatus(next);
        done?.();
      })
      .catch((err) => setError(errorText(err)))
      .finally(() => setBusy(false));
  };

  const copy = () => {
    if (!status?.url) return;
    navigator.clipboard
      ?.writeText(status.url)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => setError('Could not copy. Select the address and copy it by hand.'));
  };

  if (!status) return <div className="p-6 text-sm text-muted">{error ?? 'Loading Remote view…'}</div>;

  const portNumber = Number(portDraft);
  const portValid = Number.isInteger(portNumber) && portNumber >= PORT_MIN && portNumber <= PORT_MAX;
  const pinValid = PIN_PATTERN.test(pinDraft);
  const devicesText = status.devices === 1 ? '1 device connected' : `${status.devices} devices connected`;

  return (
    <div className="flex flex-col gap-6">
      <Card title="Share on local WiFi">
        <p className="text-sm text-muted">
          Singers and players follow the live slide on their phones. It works over this WiFi with no internet. The page is read-only:
          it cannot change the screen, the fonts, or any setting.
        </p>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold">Share on local WiFi</div>
            <div className="text-xs text-muted">{status.enabled ? 'On' : 'Off'}</div>
          </div>
          <Switch label="Share on local WiFi" on={status.enabled} disabled={busy} onChange={(on) => save({ enabled: on })} />
        </div>
        {status.error && (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-danger/40 bg-canvas p-3 text-sm text-danger">
            <WifiOff size={16} className="mt-0.5 shrink-0" aria-hidden />
            {status.error}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </Card>

      {status.running && status.url && qr && (
        <Card title="Address for phones">
          <div className="flex flex-wrap items-center gap-6">
            <img src={qr} alt={`QR code for ${status.url}`} className="size-44 rounded-md bg-white p-2" />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <p className="text-xs text-muted">Open this address in a phone's browser on the same WiFi, or scan the code with the camera.</p>
              <code aria-label="Remote view address" className="block break-all rounded-md border border-line-strong bg-canvas px-3 py-2 font-mono text-lg font-bold">
                {status.url}
              </code>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={copy} className={button}>
                  <Copy size={14} aria-hidden /> {copied ? 'Copied' : 'Copy address'}
                </button>
                <span className="flex items-center gap-2 text-sm">
                  <Smartphone size={15} aria-hidden /> {devicesText}
                </span>
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card title="Port">
        <p className="text-sm text-muted">
          The port the page starts on. The default is {DEFAULT_PORT}. If it is taken, the next free ports are tried, and the address above
          shows the one in use.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="number"
            inputMode="numeric"
            min={PORT_MIN}
            max={PORT_MAX}
            value={portDraft}
            onChange={(e) => setPortDraft(e.target.value)}
            aria-label="Port"
            className={`${field} w-32`}
          />
          <button type="button" onClick={() => save({ port: portNumber })} disabled={busy || !portValid || portNumber === status.port} className={button}>
            Save port
          </button>
        </div>
      </Card>

      <Card title="PIN">
        <p className="text-sm text-muted">
          Off by default. When a PIN is set, the page asks for it before it shows anything. Setting or changing the PIN restarts the page,
          so phones must enter it again.
        </p>
        <div className="flex items-center gap-2 text-sm">
          <KeyRound size={15} aria-hidden />
          {status.pinSet ? 'A PIN is set.' : 'No PIN. Anyone on this WiFi who has the address can open the page.'}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            inputMode="numeric"
            maxLength={8}
            autoComplete="off"
            value={pinDraft}
            onChange={(e) => setPinDraft(e.target.value.replace(/\D/g, ''))}
            aria-label="New PIN"
            placeholder="4 to 8 digits"
            className={`${field} w-40`}
          />
          <button type="button" onClick={() => save({ pin: pinDraft }, () => setPinDraft(''))} disabled={busy || !pinValid} className={button}>
            {status.pinSet ? 'Change PIN' : 'Set PIN'}
          </button>
          {status.pinSet && (
            <button type="button" onClick={() => save({ pin: null })} disabled={busy} className={button}>
              Remove PIN
            </button>
          )}
        </div>
      </Card>

      <Card title="Who can see it">
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-muted">
          <li>Anyone on this WiFi who has the address can open the page, unless a PIN is set.</li>
          <li>The page is served only on this laptop's local network address. Nothing is sent to the internet.</li>
          <li>Only the live text, the item titles, and the next item are shared. The rest of the app is not.</li>
          <li>The PIN is saved on this laptop in plain text. It stops casual viewing, not someone who can open the laptop's files.</li>
        </ul>
      </Card>
    </div>
  );
}

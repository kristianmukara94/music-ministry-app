// Nearby TV casting: many TVs at once, each on its own feed. This module owns the frame store (a 1920x1080 JPEG per feed, with a sequence number
// that only moves when the picture really changed), the small HTTP server a TV fetches those frames from, and one session per TV. No Electron
// import: the frame renderer (`captureFrame(feed)`), the sockets and the clock are passed in, so `node --test` drives it all.
import crypto from 'node:crypto';
import http from 'node:http';
import { isPrivateAddress } from './lan-guard.js';
import { createCastClient, createDlnaClient } from './tv-cast-clients.js';

export const FEEDS = ['projector', 'stage'];
export const DEBOUNCE_MS = 120;
export const STOP_ALL_CAP_MS = 1500;
const MJPEG_BOUNDARY = 'apccmmaframe';
const DLNA_FEATURES = 'DLNA.ORG_PN=JPEG_LRG;DLNA.ORG_OP=01;DLNA.ORG_FLAGS=00f00000000000000000000000000000';

export const isFeed = (value) => FEEDS.includes(value);

/**
 * @param {object} deps
 * @param {{ devices(): object[], get(id: string): object | null, scan(): Promise<object[]>, addByIp(input: string): Promise<object> }} deps.discovery
 * @param {(feed: string) => Promise<Buffer | null>} deps.captureFrame  Renders one feed as a 1920x1080 JPEG.
 * @param {() => string | null} deps.address  The laptop's address on the local network.
 */
export function createTvCastManager({
  discovery,
  captureFrame,
  address,
  isExpired = () => false,
  debounceMs = DEBOUNCE_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  makeDlna = (device) => createDlnaClient({ device }),
  makeCast = (device, hooks) => createCastClient({ device, ...hooks }),
  onChange = () => {},
  log = console,
}) {
  const token = crypto.randomBytes(16).toString('hex');
  const frames = new Map(FEEDS.map((feed) => [feed, { seq: 0, jpeg: null, hash: null, stale: true }]));
  const streams = new Map(FEEDS.map((feed) => [feed, new Set()]));
  const sessions = new Map();
  const feedChoice = new Map();
  let server = null;
  let port = null;
  let boundAddress = null;
  let debounce = null;

  // ------------------------------------------------------------------------------------------------------------------ frames

  const feedsInUse = () => FEEDS.filter((feed) => [...sessions.values()].some((s) => s.feed === feed) || streams.get(feed).size > 0);

  const frameUrl = (feed) => `http://${boundAddress}:${port}/cast/frame/${feed}.jpg?v=${frames.get(feed).seq}&k=${token}`;

  /** Renders one feed now. The sequence moves only when the bytes differ, so an unchanged picture never re-sends to a TV. */
  async function refresh(feed) {
    let jpeg;
    try {
      jpeg = await captureFrame(feed);
    } catch (err) {
      log.warn?.(`[tv cast] could not render ${feed}: ${err.message}`);
      return false;
    }
    if (!jpeg?.length) return false;
    frames.get(feed).stale = false;
    const hash = crypto.createHash('sha1').update(jpeg).digest('hex');
    const frame = frames.get(feed);
    if (frame.hash === hash) return false;
    frame.jpeg = jpeg;
    frame.hash = hash;
    frame.seq += 1;
    const part = Buffer.concat([
      Buffer.from(`--${MJPEG_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`),
      jpeg,
      Buffer.from('\r\n'),
    ]);
    for (const res of streams.get(feed)) res.write(part);
    for (const session of sessions.values()) if (session.feed === feed) void push(session);
    return true;
  }

  /** Renders a feed only when its last picture is older than the last change, so TVs joining one feed share one render. */
  const renderIfStale = (feed) => (frames.get(feed).stale || !frames.get(feed).jpeg ? refresh(feed) : Promise.resolve(false));

  /** The live screen changed (slide, blackout, lower third, text). Renders once after a short quiet spell, so quick clicks do not flood the TVs. */
  function frameChanged() {
    // A feed nobody is watching is not rendered, so it is marked old: the next TV to join it gets a fresh picture.
    for (const frame of frames.values()) frame.stale = true;
    if (sessions.size === 0 && !FEEDS.some((feed) => streams.get(feed).size > 0)) return;
    clearTimer(debounce);
    debounce = setTimer(() => {
      debounce = null;
      void Promise.all(feedsInUse().map(refresh));
    }, debounceMs);
  }

  // ------------------------------------------------------------------------------------------------------------------ sessions

  function setStatus(session, status, error = null) {
    if (session.status === status && session.error === error) return;
    session.status = status;
    session.error = error;
    onChange();
  }

  /** One push in flight per TV. A newer frame replaces the one waiting; frames are never queued, and one slow TV never holds another. */
  async function push(session) {
    if (session.closed) return;
    if (session.busy) {
      session.dirty = true;
      return;
    }
    session.busy = true;
    try {
      do {
        session.dirty = false;
        if (session.closed) break;
        try {
          await session.client.show(frameUrl(session.feed));
          if (session.client.protocol === 'dlna' && !session.closed) setStatus(session, 'casting');
        } catch (err) {
          if (!session.closed) setStatus(session, 'error', err.message);
        }
      } while (session.dirty);
    } finally {
      session.busy = false;
    }
  }

  // One start at a time: "Cast to All" asks for the server from several TVs at once, and they must share one.
  let starting = null;
  function ensureServer() {
    if (server) return Promise.resolve({ ok: true });
    starting ??= startServer().finally(() => {
      starting = null;
    });
    return starting;
  }

  async function startServer() {
    const host = address();
    if (!host) return { ok: false, error: 'No WiFi or local network was found. Connect this laptop to the same WiFi as the TVs.' };
    const candidate = http.createServer(handle);
    const result = await new Promise((resolve) => {
      candidate.once('error', (err) => resolve({ ok: false, error: `The picture server could not start: ${err.message}` }));
      candidate.listen(0, host, () => resolve({ ok: true }));
    });
    if (!result.ok) return result;
    candidate.removeAllListeners('error');
    candidate.on('error', (err) => log.warn?.(`[tv cast] ${err.message}`));
    server = candidate;
    port = candidate.address().port;
    boundAddress = host;
    return { ok: true };
  }

  async function castTo(id, { feed } = {}) {
    const device = discovery.get(id);
    if (!device) return { ok: false, error: 'That TV is not in the list. Scan again.' };
    if (isExpired()) return { ok: false, error: 'Church License Expired' };
    const chosen = isFeed(feed) ? feed : (feedChoice.get(id) ?? 'projector');
    feedChoice.set(id, chosen);
    const existing = sessions.get(id);
    if (existing) {
      existing.feed = chosen;
      // A frame that changed is pushed by `refresh` itself. An unchanged one is sent here, so a switched feed reaches the TV.
      if (!(await renderIfStale(chosen))) void push(existing);
      onChange();
      return { ok: true };
    }
    const started = await ensureServer();
    if (!started.ok) return started;
    const session = { id, device, feed: chosen, status: 'connecting', error: null, busy: false, dirty: false, closed: false, client: null };
    session.client =
      device.protocol === 'chromecast'
        ? makeCast(device, { onStatus: (status, detail) => !session.closed && setStatus(session, status, status === 'error' || status === 'reconnecting' ? (detail ?? null) : null) })
        : makeDlna(device);
    sessions.set(id, session);
    onChange();
    // The first picture is rendered at once, not after the debounce, so the TV does not wait on a slide change.
    const fresh = await renderIfStale(chosen);
    if (!frames.get(chosen).jpeg) {
      sessions.delete(id);
      session.client.close?.();
      onChange();
      return { ok: false, error: 'The live picture could not be rendered.' };
    }
    if (!fresh) void push(session);
    return { ok: true };
  }

  /** Stops one session. `stop` ends what the TV shows (bounded by the timeout), then the connection is dropped and never retried. */
  async function endSession(session, timeoutMs) {
    session.closed = true;
    sessions.delete(session.id);
    let timer;
    await Promise.race([
      Promise.resolve(session.client.stop?.()).catch(() => {}),
      new Promise((resolve) => {
        timer = setTimer(resolve, timeoutMs);
      }),
    ]);
    clearTimer(timer);
    session.client.close?.();
  }

  async function disconnect(id) {
    const session = sessions.get(id);
    if (!session) return { ok: true };
    await endSession(session, STOP_ALL_CAP_MS);
    onChange();
    return { ok: true };
  }

  /** Stops every cast. All TVs are told in parallel and the whole call is capped, so an unreachable TV cannot hold up closing the app. */
  async function stopAll({ timeoutMs = STOP_ALL_CAP_MS } = {}) {
    clearTimer(debounce);
    debounce = null;
    await Promise.all([...sessions.values()].map((session) => endSession(session, timeoutMs)));
    onChange();
    return { ok: true };
  }

  async function castAll() {
    const results = await Promise.all(discovery.devices().map((device) => castTo(device.id)));
    const failed = results.filter((r) => !r.ok);
    return failed.length === 0 ? { ok: true } : { ok: false, error: failed[0].error };
  }

  async function setFeed(id, feed) {
    if (!isFeed(feed)) return { ok: false, error: 'Choose Projector or Stage Mirror.' };
    feedChoice.set(id, feed);
    const session = sessions.get(id);
    if (session) return castTo(id, { feed });
    onChange();
    return { ok: true };
  }

  // ------------------------------------------------------------------------------------------------------------------ frame server

  function handle(req, res) {
    try {
      route(req, res);
    } catch (err) {
      log.warn?.(`[tv cast] request failed: ${err.message}`);
      if (res.headersSent) res.destroy();
      else res.writeHead(500).end();
    }
  }

  function route(req, res) {
    if (!isPrivateAddress(req.socket.remoteAddress)) return void res.writeHead(403).end();
    if (isExpired()) return void res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Church License Expired');
    if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      return void res.writeHead(400).end();
    }
    // A random key per run: only a TV this laptop handed the address to can fetch a picture.
    const given = Buffer.from(url.searchParams.get('k') ?? '');
    const wanted = Buffer.from(token);
    if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) return void res.writeHead(404).end();
    const match = /^\/cast\/(frame|stream)\/(projector|stage)\.(jpg|mjpeg)$/.exec(url.pathname);
    if (!match) return void res.writeHead(404).end();
    const [, kind, feed, ext] = match;
    const frame = frames.get(feed);
    if (kind === 'frame' && ext === 'jpg') {
      if (!frame.jpeg) return void res.writeHead(503, { 'Retry-After': '1' }).end();
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': frame.jpeg.length,
        'Cache-Control': 'no-store',
        'Accept-Ranges': 'none',
        'transferMode.dlna.org': 'Interactive',
        'contentFeatures.dlna.org': DLNA_FEATURES,
        'X-Content-Type-Options': 'nosniff',
      });
      return void (req.method === 'HEAD' ? res.end() : res.end(frame.jpeg));
    }
    if (kind === 'stream' && ext === 'mjpeg') {
      res.writeHead(200, {
        'Content-Type': `multipart/x-mixed-replace; boundary=${MJPEG_BOUNDARY}`,
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') return void res.end();
      streams.get(feed).add(res);
      req.on('close', () => streams.get(feed).delete(res));
      if (frame.jpeg) {
        res.write(Buffer.concat([Buffer.from(`--${MJPEG_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.jpeg.length}\r\n\r\n`), frame.jpeg, Buffer.from('\r\n')]));
      } else {
        void refresh(feed);
      }
      return;
    }
    res.writeHead(404).end();
  }

  async function shutdown() {
    await stopAll();
    for (const feed of FEEDS) {
      for (const res of streams.get(feed)) res.end();
      streams.get(feed).clear();
    }
    const closing = server;
    server = null;
    port = null;
    boundAddress = null;
    if (closing) {
      await new Promise((resolve) => {
        closing.close(() => resolve());
        closing.closeAllConnections?.();
      });
    }
  }

  // ------------------------------------------------------------------------------------------------------------------ status

  /** What the settings and the top bar show: every known TV, its feed and its state, and the picture server's address. */
  function status() {
    const tvs = discovery.devices().map((device) => {
      const session = sessions.get(device.id);
      return {
        id: device.id,
        name: device.name,
        manufacturer: device.manufacturer ?? '',
        model: device.model ?? '',
        ip: device.ip,
        protocol: device.protocol,
        feed: session?.feed ?? feedChoice.get(device.id) ?? 'projector',
        state: session ? session.status : 'ready',
        error: session?.error ?? null,
      };
    });
    return {
      tvs,
      casting: [...sessions.values()].length,
      scanning: discovery.isScanning?.() ?? false,
      hostname: discovery.hostnameStatus?.() ?? { running: false, note: null },
      server: server ? { address: boundAddress, port } : null,
    };
  }

  return {
    status,
    castTo,
    castAll,
    disconnect,
    stopAll,
    setFeed,
    frameChanged,
    refresh,
    shutdown,
    activeCount: () => sessions.size,
    /** Test and diagnostics: the latest frame of a feed. */
    frame: (feed) => ({ seq: frames.get(feed).seq, bytes: frames.get(feed).jpeg?.length ?? 0 }),
    serverPort: () => port,
    key: () => token,
  };
}

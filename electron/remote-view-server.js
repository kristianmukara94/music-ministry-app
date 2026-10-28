import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REMOTE_VIEW_PORTS, snapshotForRole } from '../shared/remote-view.js';
import { MIME_BY_EXT, rangeResponse } from './media-range.js';

/** Wrong PIN entries allowed before the unlock pauses. A PIN has few digits, so this stops guessing. */
const PIN_TRIES = 5;
const PIN_PAUSE_MS = 60_000;
/** Keeps idle connections alive and drops the ones phones left without closing. */
const HEARTBEAT_MS = 15_000;
/** A PIN or a control request is a few bytes. Anything bigger is dropped without reading the rest. */
const MAX_BODY = 1024;

// Private network ranges only. A public address must never be served, so the page cannot leave the local network.
const PRIVATE_IPV4 = [/^192\.168\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./];
// Adapters that are not the WiFi or wired network a phone can reach: virtual switches, VPNs, and containers.
const VIRTUAL_ADAPTER = /virtual|vethernet|vmware|virtualbox|hyper-v|docker|wsl|loopback|bluetooth/i;

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  // Everything comes from this laptop. No outside scripts, styles, fonts, or connections.
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'",
};

/** The file types the built TV page and its assets are served as. */
const TV_TYPE_BY_EXT = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
};

/**
 * The helper page for a TV address typed on the control port. Plain HTML, styled from the laptop's own stylesheet, with no outside assets, so
 * it loads with no internet. The address and port are escaped as they are written in.
 */
export function guidancePage(url, port) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TV Display</title>
<link rel="stylesheet" href="/remote/guide.css">
</head>
<body>
<main>
<h1>Looking for the TV Display?</h1>
<p>Please open the TV View on Port ${esc(port)}:</p>
<p class="address"><code>${esc(url)}</code></p>
<a class="button" href="${esc(url)}">Open the TV View</a>
</main>
</body>
</html>
`;
}

/** The page each viewer opens at its address, and the only files each viewer's folder may serve. */
const ROLE_PAGE = { primary: 'index.html', secondary: 'viewer.html' };
const ROLE_FILES = {
  primary: ['index.html', 'common.js', 'remote.js', 'remote.css', 'guide.css'],
  secondary: ['viewer.html', 'common.js', 'viewer.js', 'remote.css'],
};

/**
 * The address phones on this network use. `entries` are the interfaces as Node lists them. Prefers a 192.168 address,
 * then any other private one. Null when there is no private address, which means no WiFi or local network.
 */
export function pickLocalAddress(entries) {
  const found = entries
    .filter((e) => e.family === 'IPv4' && !e.internal && !VIRTUAL_ADAPTER.test(e.name ?? ''))
    .map((e) => e.address)
    .filter((ip) => PRIVATE_IPV4.some((range) => range.test(ip)));
  return found.find((ip) => ip.startsWith('192.168.')) ?? found[0] ?? null;
}

export function localNetworkAddress() {
  const entries = Object.entries(os.networkInterfaces()).flatMap(([name, list]) => (list ?? []).map((info) => ({ name, ...info })));
  return pickLocalAddress(entries);
}

/** A short name for the phone, from its browser's user agent. It is shown in the activity list only. */
export function deviceLabel(userAgent = '') {
  if (/iPad/.test(userAgent)) return 'iPad';
  if (/iPhone/.test(userAgent)) return 'iPhone';
  if (/Android/.test(userAgent)) return 'Android';
  if (/Windows/.test(userAgent)) return 'Windows';
  if (/Macintosh/.test(userAgent)) return 'Mac';
  if (/Linux/.test(userAgent)) return 'Linux';
  return 'Browser';
}

/**
 * Serves one phone page for Remote view, on one port. `role` is fixed when the server is made: `primary` also accepts
 * control requests, and `secondary` never does. The role is checked here on the server, so a crafted request to the
 * Secondary port is refused whatever the page sends. `/api/remote/stream` sends the live screen as the laptop changes it.
 * When a PIN is set, every route needs an unlocked session, and each viewer has its own session cookie.
 */
export function createRemoteViewServer({ distDir, role = 'primary', canConnect = () => true, onControl = () => ({ ok: false, status: 409, error: 'Control is not set up.' }), mediaFile = () => null, tvPort = () => REMOTE_VIEW_PORTS.secondary }) {
  let server = null;
  let bound = null;
  let starting = null;
  let pin = null;
  let latest = null;
  let lastScreen = null;
  let heartbeat = null;
  const streams = new Set();
  const sessions = new Set();
  const cookieName = `apccmma_remote_${role}`;
  let misses = 0;
  let pausedUntil = 0;

  const pinRequired = () => pin !== null;

  function sessionToken(req) {
    const match = new RegExp(`(?:^|;\\s*)${cookieName}=([0-9a-f]{48})`).exec(req.headers.cookie ?? '');
    return match ? match[1] : null;
  }

  const unlocked = (req) => !pinRequired() || sessions.has(sessionToken(req));

  function pinMatches(given) {
    const a = Buffer.from(given);
    const b = Buffer.from(pin);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  function sendJson(res, status, body, headers = {}) {
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  }

  /** Reads a small JSON body. Calls `done` with the parsed value, or with null when it is not valid JSON. */
  function readJson(req, res, done) {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) req.destroy();
    });
    req.on('end', () => {
      try {
        done(JSON.parse(body));
      } catch {
        done(null);
      }
    });
  }

  function unlock(req, res) {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false }, { Allow: 'POST' });
    readJson(req, res, (parsed) => {
      if (parsed === null) return sendJson(res, 400, { ok: false, error: 'The request was not understood.' });
      if (!pinRequired()) return sendJson(res, 200, { ok: true });
      if (Date.now() < pausedUntil) {
        const seconds = Math.ceil((pausedUntil - Date.now()) / 1000);
        return sendJson(res, 429, { ok: false, error: `Too many wrong PINs. Wait ${seconds} seconds and try again.` });
      }
      if (typeof parsed.pin === 'string' && pinMatches(parsed.pin)) {
        misses = 0;
        const token = crypto.randomBytes(24).toString('hex');
        sessions.add(token);
        return sendJson(res, 200, { ok: true }, { 'Set-Cookie': `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict` });
      }
      misses += 1;
      if (misses >= PIN_TRIES) {
        misses = 0;
        pausedUntil = Date.now() + PIN_PAUSE_MS;
      }
      return sendJson(res, 401, { ok: false, error: 'That PIN is not right.' });
    });
  }

  function stream(req, res) {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false }, { Allow: 'GET' });
    if (!unlocked(req)) return sendJson(res, 401, { ok: false, error: 'Enter the PIN first.' });
    if (!canConnect()) return sendJson(res, 503, { ok: false, error: 'This page is full. Close some phones and try again.' });
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    // The headers go out now, so the phone is connected at once even while the screen has nothing new to send.
    res.flushHeaders();
    const entry = { res, ip: (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '') };
    streams.add(entry);
    if (latest) res.write(`data: ${JSON.stringify(snapshotForRole(latest, role))}\n\n`);
    req.on('close', () => streams.delete(entry));
  }

  /** A control request from the Primary viewer. The Secondary viewer's port never reaches the handler. */
  function control(req, res) {
    if (role !== 'primary') return sendJson(res, 403, { ok: false, error: 'This page is read-only.' });
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false }, { Allow: 'POST' });
    if (!unlocked(req)) return sendJson(res, 401, { ok: false, error: 'Enter the PIN first.' });
    // Only a JSON body is accepted. A plain web form from another site cannot send one, so it cannot reach this.
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
      return sendJson(res, 415, { ok: false, error: 'The request was not understood.' });
    }
    readJson(req, res, async (parsed) => {
      if (parsed === null) return sendJson(res, 400, { ok: false, error: 'The request was not understood.' });
      const device = { ip: (req.socket.remoteAddress ?? '').replace(/^::ffff:/, ''), label: deviceLabel(req.headers['user-agent']) };
      let result;
      try {
        result = await onControl(parsed, device);
      } catch (err) {
        console.warn(`[remote view] control failed: ${err.message}`);
        return sendJson(res, 500, { ok: false, error: 'The change could not be made.' });
      }
      if (!result.ok) return sendJson(res, result.status ?? 409, { ok: false, error: result.error });
      return sendJson(res, 200, { ok: true });
    });
  }

  /**
   * A library picture or video for the TV screen, on the Secondary port only, behind the PIN. Only a library id is accepted, never a path, so
   * the request cannot reach any file except the ones in the Media Library. Byte ranges are answered, so a video can seek and loop.
   */
  function media(req, res, pathname) {
    if (role !== 'secondary') return sendJson(res, 404, { ok: false, error: 'Not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { ok: false }, { Allow: 'GET, HEAD' });
    if (!unlocked(req)) return sendJson(res, 401, { ok: false, error: 'Enter the PIN first.' });
    let id;
    try {
      id = decodeURIComponent(pathname.slice('/api/remote/media/'.length));
    } catch {
      return sendJson(res, 400, { ok: false, error: 'The request was not understood.' });
    }
    if (!/^\d{1,12}$/.test(id)) return sendJson(res, 404, { ok: false, error: 'Not found' });
    const file = mediaFile(id);
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return sendJson(res, 404, { ok: false, error: 'Not found' });
    const type = MIME_BY_EXT[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    const headers = { ...SECURITY_HEADERS, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
    if (req.headers.range) {
      const part = rangeResponse(file, req.headers.range);
      part.headers.delete('Access-Control-Allow-Origin');
      res.writeHead(part.status, { ...headers, ...Object.fromEntries(part.headers) });
      if (!part.body || req.method === 'HEAD') return res.end();
      return Readable.fromWeb(part.body).pipe(res);
    }
    const size = fs.statSync(file).size;
    res.writeHead(200, { ...headers, 'Content-Length': String(size) });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  /**
   * The TV page and its built files: `/tv`, and `/assets/<file>` from the app's build. Served on the Secondary port only, read-only. A request
   * is answered only for a file inside the build folder, so no other file can be reached.
   */
  function serveTv(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { ok: false }, { Allow: 'GET, HEAD' });
    let file;
    if (pathname === '/tv') {
      file = path.join(distDir, 'tv.html');
    } else {
      let name;
      try {
        name = decodeURIComponent(pathname.slice('/assets/'.length));
      } catch {
        return res.writeHead(400).end();
      }
      if (!/^[\w.-]+$/.test(name)) return res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      file = path.join(distDir, 'assets', name);
    }
    const root = path.resolve(distDir);
    const resolved = path.resolve(file);
    if (!resolved.startsWith(root + path.sep) || !fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
      return res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
    const type = TV_TYPE_BY_EXT[path.extname(resolved).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(resolved).pipe(res);
  }

  function servePage(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { ok: false }, { Allow: 'GET, HEAD' });
    if (!fs.existsSync(distDir)) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }).end('The app has not been built. Run npm run build first.');
      return;
    }
    let relative;
    if (pathname === '/' || pathname === '/remote' || pathname === '/remote/') {
      relative = ROLE_PAGE[role];
    } else if (pathname.startsWith('/remote/')) {
      try {
        relative = decodeURIComponent(pathname.slice('/remote/'.length));
      } catch {
        return res.writeHead(400).end();
      }
    } else {
      return res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
    // Only this viewer's own files are served. The other viewer's page and scripts are not reachable from this port.
    if (!ROLE_FILES[role].includes(relative)) {
      return res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
    const root = path.resolve(distDir, 'remote');
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
    const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }[path.extname(file)];
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': type ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file).pipe(res);
  }

  /**
   * The guidance page for the TV address typed on the control port. It is plain HTML with no outside assets, and its only link is to the TV
   * page on the Secondary port, on the same laptop address the phone used. The host is checked before it is written into the page.
   */
  function tvGuidance(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { ok: false }, { Allow: 'GET, HEAD' });
    const rawHost = String(req.headers.host ?? '').replace(/:\d+$/, '');
    const host = /^[A-Za-z0-9.\-[\]:]+$/.test(rawHost) && rawHost ? rawHost : '127.0.0.1';
    const port = Number(tvPort());
    const url = `http://${host}:${Number.isInteger(port) ? port : REMOTE_VIEW_PORTS.secondary}/tv`;
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : guidancePage(url, port));
  }

  function handle(req, res) {
    let pathname;
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (pathname.startsWith('/api/remote/media/')) return media(req, res, pathname);
    // The TV screen is read-only, so its page and files are served only on the Secondary port.
    if (role === 'secondary' && (pathname === '/tv' || pathname.startsWith('/assets/'))) return serveTv(req, res, pathname);
    // The TV screen's address on the control port: a helper page points to the Secondary port, so a wrong address is not a blank 404.
    if (role === 'primary' && (pathname === '/tv' || pathname === '/remote-view')) return tvGuidance(req, res);
    if (pathname === '/api/remote/status') {
      if (req.method !== 'GET') return sendJson(res, 405, { ok: false }, { Allow: 'GET' });
      return sendJson(res, 200, { role, pinRequired: pinRequired(), unlocked: unlocked(req) });
    }
    if (pathname === '/api/remote/unlock') return unlock(req, res);
    if (pathname === '/api/remote/stream') return stream(req, res);
    if (pathname === '/api/remote/control') return control(req, res);
    return servePage(req, res, pathname);
  }

  /** Binds to the one port. Resolves with the port, or with the error code when it cannot. */
  function listenOn(host, port) {
    return new Promise((resolve) => {
      const candidate = http.createServer(handle);
      candidate.once('error', (err) => resolve({ ok: false, code: err.code, message: err.message }));
      candidate.listen(port, host, () => {
        candidate.removeAllListeners('error');
        candidate.on('error', (err) => console.warn(`[remote view] ${err.message}`));
        server = candidate;
        resolve({ ok: true, port: candidate.address().port });
      });
    });
  }

  return {
    role,
    running: () => bound !== null,
    address: () => bound?.address ?? null,
    port: () => bound?.port ?? null,

    /** Phones with the page open, counted once per address. Two tabs on one phone count as one device. */
    devices: () => new Set([...streams].map((s) => s.ip)).size,

    /**
     * Starts the page on `host` (the laptop's network address) and the chosen port. A port that is taken is not moved
     * to another one: the result says so, and the page does not start. Resolves with `{ ok, port }` or
     * `{ ok: false, error }`. Starting again while it runs does nothing.
     */
    start({ host, port, pin: nextPin }) {
      if (bound) return Promise.resolve({ ok: true, port: bound.port });
      if (starting) return starting;
      pin = nextPin ?? null;
      starting = (async () => {
        try {
          const result = await listenOn(host, port);
          if (!result.ok) {
            pin = null;
            if (result.code === 'EADDRINUSE') return { ok: false, error: 'Port in use, pick another' };
            return { ok: false, error: `The Remote view page could not start: ${result.message}` };
          }
          bound = { address: host, port: result.port };
          heartbeat = setInterval(() => {
            for (const s of streams) s.res.write(': ping\n\n');
          }, HEARTBEAT_MS);
          heartbeat.unref();
          return { ok: true, port: result.port };
        } finally {
          starting = null;
        }
      })();
      return starting;
    },

    /** Stops the page: phones lose the connection, the sessions end, and the port is free again. */
    async stop() {
      if (starting) await starting;
      if (!server) return;
      clearInterval(heartbeat);
      heartbeat = null;
      for (const s of streams) s.res.end();
      streams.clear();
      sessions.clear();
      const closing = server;
      server = null;
      bound = null;
      pin = null;
      await new Promise((resolve) => {
        closing.close(() => resolve());
        closing.closeAllConnections?.();
      });
    },

    /**
     * Sends the live screen to every connected phone, shaped for this viewer. The latest is sent to a phone that connects later.
     * A state change that leaves this screen as it was sends nothing. The timestamp is left out of the comparison, since it changes on every change.
     */
    push(payload) {
      latest = payload;
      const { updatedAt, ...screen } = payload;
      const key = JSON.stringify(screen);
      if (key === lastScreen) return;
      lastScreen = key;
      const data = `data: ${JSON.stringify(snapshotForRole(payload, role))}\n\n`;
      for (const s of streams) s.res.write(data);
    },
  };
}

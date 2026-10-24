import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The port the browser source uses. OBS, or any other stream software, points at http://127.0.0.1:3002/lower-third. */
export const LOWER_THIRD_PORT = 3002;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

/** The first IPv4 address that is not loopback, for the network URL. Null when the computer has none. */
export function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return null;
}

/**
 * Serves the lower third to a browser source. `/lower-third` is the page. `/api/lower-third/stream` sends the lower
 * third and its style each time they change. Only the built app folder is readable, and the only state sent out is
 * the lower third and its look, so nothing else in the app is exposed.
 */
export function createLowerThirdServer({ distDir, port = LOWER_THIRD_PORT, host = '0.0.0.0' }) {
  const clients = new Set();
  let latest = { lowerThird: null, lowerStyle: null };

  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    let pathname;
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      res.writeHead(400).end();
      return;
    }

    if (pathname === '/api/lower-third/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(latest)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (!fs.existsSync(distDir)) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }).end('The app has not been built. Run npm run build first.');
      return;
    }

    // The page is served at /lower-third. Its scripts and styles are files in the build folder.
    const asset = pathname.startsWith('/lower-third/') ? pathname.slice('/lower-third'.length) : pathname;
    let decoded;
    try {
      decoded = decodeURIComponent(asset);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const relative = pathname === '/lower-third' || pathname === '/lower-third/' ? 'index.html' : decoded.replace(/^\/+/, '');
    const root = path.resolve(distDir);
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file).pipe(res);
  });

  return {
    /** Resolves true when the server is listening. A port already in use is logged, not fatal. */
    start() {
      return new Promise((resolve) => {
        server.once('error', (err) => {
          console.warn(`[lower third] The browser source server did not start: ${err.message}`);
          resolve(false);
        });
        server.listen(port, host, () => resolve(true));
      });
    },

    /** Sends the new lower third and look to every connected browser source. The latest is sent to new connections. */
    push(payload) {
      latest = payload;
      const data = `data: ${JSON.stringify(payload)}\n\n`;
      for (const client of clients) client.write(data);
    },

    stop() {
      for (const client of clients) client.end();
      clients.clear();
      server.close();
    },
  };
}

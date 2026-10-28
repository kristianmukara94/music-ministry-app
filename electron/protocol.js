import { net, protocol, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { getAssetRoot, resolveAsset } from './assets.js';

export const MEDIA_SCHEME = 'apcc-media';

const VIDEO_TYPE_BY_EXT = { '.mkv': 'video/x-matroska', '.mov': 'video/quicktime' };

/** The type a served file has, by its extension. Video and audio are read by the browser from these, and it seeks with byte ranges. */
export const MIME_BY_EXT = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
};

/**
 * The answer to a byte-range request for a file: the requested part, with 206 Partial Content, or 416 when the range cannot be met. A video's
 * index can sit at the end of the file, so the browser asks for the last bytes first; the part is read from disk, not loaded whole.
 */
export function rangeResponse(file, rangeHeader) {
  const size = fs.statSync(file).size;
  const unmet = () => new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' } });
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());
  if (!match || (match[1] === '' && match[2] === '')) return unmet();
  let start;
  let end;
  if (match[1] === '') {
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start > end || start >= size) return unmet();
  const type = MIME_BY_EXT[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
    status: 206,
    headers: {
      'Content-Type': type,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// Must run before the app is ready. Lets <img> and <video> load these URLs, and lets the
// thumbnailer read video pixels cross-origin (see installMediaProtocol).
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
]);

/** host -> resolver. A resolver returns a relative asset path (e.g. `media/<uuid>.mp4`), or null to refuse. */
const routes = new Map();

/** Maps `apcc-media://<host>/<name>` to a stored relative path. Each module registers only the hosts it owns. */
export function registerMediaRoute(host, resolveRelative) {
  routes.set(host, resolveRelative);
}

/**
 * The Operator Mirror runs in its own session (a partition). A protocol handler belongs to one session, so the
 * handler is installed on the mirror's session too. Without it, slide images fail to load in the mirror only.
 */
export const MIRROR_PARTITION = 'mirror';

let installed = false;

/** Installs the one handler for the scheme on every session that shows slides. Call once, after the app is ready. */
export function installMediaProtocol() {
  if (installed) return;
  installed = true;

  const handler = async (request) => {
    const url = new URL(request.url);
    const resolveRelative = routes.get(url.hostname);
    let name;
    try {
      name = decodeURIComponent(url.pathname.slice(1));
    } catch {
      console.warn(`[media] Malformed URL, so it cannot be served: ${request.url}`);
      return new Response('Bad request', { status: 400 });
    }
    // Relative path → absolute file, resolved against the folder of the database that is open right now.
    // The resolver accepts only the known folders and generated file names, so a crafted path cannot leave the asset folder.
    const rel = resolveRelative ? resolveRelative(name) : null;
    const file = rel ? resolveAsset(getAssetRoot(), rel) : null;
    if (!file || !fs.existsSync(file)) {
      console.warn(`[media] Not found: ${request.url} (${rel ? `file ${rel} is missing` : 'no record for this id or host'})`);
      return new Response('Not found', { status: 404 });
    }

    // A byte-range request (what <video> sends to seek, and to find the index at the end of a file) is answered from the file itself.
    const range = request.headers.get('range');
    if (range) return rangeResponse(file, range);
    // Otherwise, the whole file, then allow reads from the app's own pages.
    const upstream = await net.fetch(pathToFileURL(file).toString(), { headers: request.headers });
    const headers = new Headers(upstream.headers);
    // Containers Chromium does not label on its own get their type here, so the browser will read them.
    const type = VIDEO_TYPE_BY_EXT[path.extname(file).toLowerCase()];
    if (type) headers.set('Content-Type', type);
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(upstream.body, { status: upstream.status, headers });
  };

  for (const target of [session.defaultSession, session.fromPartition(MIRROR_PARTITION)]) {
    target.protocol.handle(MEDIA_SCHEME, handler);
  }
}

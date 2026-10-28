import { net, protocol, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getAssetRoot, resolveAsset } from './assets.js';

export const MEDIA_SCHEME = 'apcc-media';

const VIDEO_TYPE_BY_EXT = { '.mkv': 'video/x-matroska', '.mov': 'video/quicktime' };

export { MIME_BY_EXT, rangeResponse } from './media-range.js';
import { rangeResponse } from './media-range.js';

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
/** The file of a media library item, by its id, or null. The same resolution the apcc-media route uses, so both agree. */
export function mediaFileFor(id) {
  const resolve = routes.get('media');
  const rel = resolve ? resolve(String(id)) : null;
  return rel ? resolveAsset(getAssetRoot(), rel) : null;
}

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

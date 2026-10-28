import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

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

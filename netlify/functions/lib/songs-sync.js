// The church's song list, sent from a linked laptop. The laptop sends the full list each time, with metadata only: title, category,
// language, key, and its own song id. Lyrics, slides, media and Bible text never come here. A batch that carries any of those
// fields is refused as a whole, so a bad sync is noticed rather than trimmed. A song the laptop no longer has is marked removed,
// not deleted, so the plans that use it keep their reference. The church comes from the laptop's token, never from the request.
import { ApiError } from './admin.js';
import { bearerToken, deviceFrom } from './device.js';
import { hashToken } from './auth.js';
import { hit } from './rate-limit.js';
import { EDITING_ROLES } from './rules.js';

export const SONGS_PUSH_LIMIT = { requests: 10, windowMs: 10 * 60 * 1000 };
export const LANGUAGES = ['English', 'Tagalog', 'Cebuano'];
const MAX_SONGS = 5000;
const ALLOWED = ['id', 'title', 'category', 'language', 'key'];
// Field names that would carry lyrics, slides, media or Bible text. Refused by name, so nothing is silently dropped.
const FORBIDDEN = /lyric|stanza|slide|media|bible|verse|scripture|audio|video|image|file|text|hymn/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (statusCode, body, extraHeaders = {}) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  body: JSON.stringify(body),
});

function parseJson(event) {
  try {
    const parsed = JSON.parse(event.body ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The log line for an unexpected failure: the step it happened in, the error's name, and for a database error its code and the
 * constraint or column. Never the message, the request body, a song title, a token or a connection string.
 */
export function failureLine(step, err) {
  const parts = [`[songs] step=${step}`, `name=${err?.name ?? 'Error'}`];
  if (err?.code) parts.push(`code=${err.code}`);
  if (err?.constraint) parts.push(`constraint=${err.constraint}`);
  // A missing column carries its name only in the message. Only a plain identifier is taken from it, never the rest of the message.
  const column = err?.column ?? /column "([a-z_]+)" does not exist/.exec(String(err?.message ?? ''))?.[1];
  if (column) parts.push(`column=${column}`);
  return parts.join(' ');
}

/** One song from the laptop, checked. Returns the clean fields, or throws a plain refusal. */
export function checkSong(song) {
  if (!song || typeof song !== 'object' || Array.isArray(song)) throw new ApiError(400, 'A song in the list could not be read. Nothing was sent.');
  for (const key of Object.keys(song)) {
    if (ALLOWED.includes(key)) continue;
    if (FORBIDDEN.test(key)) throw new ApiError(400, 'Lyrics, slides, media and Bible text never leave the laptop. The song list was not sent.');
    throw new ApiError(400, 'A song has a field the planner does not accept. Nothing was sent.');
  }
  const id = typeof song.id === 'string' ? song.id.toLowerCase() : '';
  if (!UUID.test(id)) throw new ApiError(400, 'A song has no valid id. Nothing was sent.');
  const title = typeof song.title === 'string' ? song.title.trim() : '';
  if (title === '' || title.length > 200) throw new ApiError(400, 'A song title must be 1 to 200 characters. Nothing was sent.');
  const category = typeof song.category === 'string' ? song.category.trim() : '';
  if (category.length > 40) throw new ApiError(400, 'A song category can be up to 40 characters. Nothing was sent.');
  if (!LANGUAGES.includes(song.language)) throw new ApiError(400, 'A song language must be English, Tagalog or Cebuano. Nothing was sent.');
  const musicalKey = typeof song.key === 'string' ? song.key.trim() : '';
  if (musicalKey.length > 10) throw new ApiError(400, 'A song key can be up to 10 characters. Nothing was sent.');
  return { id, title, category, language: song.language, musicalKey };
}

export function createSongsSyncApi({ sql, transaction, secret, now = () => new Date() }) {
  /**
   * Runs a handler: refusals go back with their message; anything else is a plain 500 that names no cause to the laptop, but logs
   * the step and the error's code (see failureLine) so the cause can be found in the function logs.
   */
  const safely = (handler) => async (event) => {
    const step = { name: 'start' };
    try {
      return await handler(event, step);
    } catch (err) {
      if (err instanceof ApiError) return json(err.status, { error: err.message });
      console.error(failureLine(step.name, err));
      return json(500, { error: 'Something went wrong. Try again.' });
    }
  };

  /** Applies the laptop's full song list for its church and returns the counts. */
  const pushSongs = safely(async (event, step) => {
    step.name = 'method';
    if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' }, { Allow: 'POST' });
    step.name = 'auth';
    const token = bearerToken(event.headers);
    if (!token) return json(401, { error: 'This laptop is not linked to a church.' });
    // Limited per laptop, by a keyed hash of its token, before anything is written.
    const gate = await hit(sql, `songs:${hashToken(token, secret)}`, SONGS_PUSH_LIMIT.requests, SONGS_PUSH_LIMIT.windowMs / 1000, now());
    if (!gate.allowed) {
      return json(429, { error: 'Too many song syncs from this laptop. Wait ten minutes and try again.' }, { 'Retry-After': String(gate.retryAfterSeconds) });
    }
    const device = await deviceFrom({ sql, secret }, token);
    if (!device) return json(401, { error: 'This laptop is not linked to a church.' });

    step.name = 'validate';
    const body = parseJson(event);
    if (!body || !Array.isArray(body.songs)) throw new ApiError(400, 'The song list could not be read. Nothing was sent.');
    if (body.songs.length > MAX_SONGS) throw new ApiError(400, 'The song list is too long to send at once. Nothing was sent.');
    const songs = body.songs.map(checkSong);
    if (new Set(songs.map((s) => s.id)).size !== songs.length) throw new ApiError(400, 'Two songs share an id. Nothing was sent.');

    const churchId = device.church_id;
    const at = now().toISOString();
    step.name = 'transaction';
    const counts = await transaction(async (tx) => {
      step.name = 'role';
      const linked = await tx`SELECT role, disabled FROM users WHERE id = ${device.user_id} AND church_id = ${churchId}`;
      if (!linked.length || linked[0].disabled || !EDITING_ROLES.includes(linked[0].role)) {
        throw new ApiError(403, 'Only a planner or admin can send the song list from this laptop.');
      }
      step.name = 'read';
      // Only this church's rows are read and written, so another church's songs are never touched.
      const existing = await tx`SELECT id, title, category, language, musical_key, removed_at FROM songs WHERE church_id = ${churchId}`;
      if (songs.length === 0 && existing.some((r) => !r.removed_at)) {
        throw new ApiError(409, 'The song list is empty, so nothing was changed. Check the song list on the laptop and try again.');
      }
      const byId = new Map(existing.map((r) => [r.id, r]));
      const incoming = new Set(songs.map((s) => s.id));
      const counts = { created: 0, updated: 0, unchanged: 0, removed: 0 };
      step.name = 'write';
      for (const s of songs) {
        const old = byId.get(s.id);
        const same = old && !old.removed_at && old.title === s.title && old.category === s.category && old.language === s.language && old.musical_key === s.musicalKey;
        if (same) {
          counts.unchanged += 1;
          continue;
        }
        // A new song, a changed one, or one that was removed and is back. The same id is the same row, so a rename updates it.
        await tx`
          INSERT INTO songs (id, church_id, title, category, language, musical_key, removed_at, updated_at)
          VALUES (${s.id}, ${churchId}, ${s.title}, ${s.category}, ${s.language}, ${s.musicalKey}, NULL, ${at})
          ON CONFLICT (church_id, id) DO UPDATE SET title = EXCLUDED.title, category = EXCLUDED.category,
            language = EXCLUDED.language, musical_key = EXCLUDED.musical_key, removed_at = NULL, updated_at = EXCLUDED.updated_at`;
        if (old) counts.updated += 1;
        else counts.created += 1;
      }
      for (const row of existing) {
        if (incoming.has(row.id) || row.removed_at) continue;
        await tx`UPDATE songs SET removed_at = ${at}, updated_at = ${at} WHERE church_id = ${churchId} AND id = ${row.id}`;
        counts.removed += 1;
      }
      // One audit row per sync: the counts and the actor. No song titles.
      step.name = 'audit';
      await tx`INSERT INTO audit_log (church_id, actor_user_id, action, detail) VALUES (${churchId}, ${device.user_id}, 'songs.synced', ${JSON.stringify(counts)}::jsonb)`;
      return counts;
    });
    step.name = 'respond';
    return json(200, counts);
  });

  return { pushSongs };
}

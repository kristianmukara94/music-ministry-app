// The web plan editor's server side: read one plan, list the church's songs, and save a plan's structure. The church always comes
// from the signed-in session, never from the request. Only the structure is stored: segments, minutes, chosen song ids, typed
// text, notes. No lyrics, slides or song files. Viewers can read a plan; only planners and admins can save one.
import { ApiError } from './admin.js';
import { sessionFrom } from './session.js';
import { EDITING_ROLES } from './rules.js';

export const MIN_MINUTES = 1;
export const MAX_MINUTES = 60;
const MAX_SEGMENTS = 60;
const TEXT_MAX = 500;
const NOTE_MAX = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEGMENT_ID = /^\d{1,2}$/;
const SEGMENT_KEYS = ['songId', 'text', 'minutes'];

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

/** A plan's date as YYYY-MM-DD, whether the driver returns a Date or text. */
export function dateText(value) {
  if (value instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value).slice(0, 10);
}

/**
 * Checks a saved plan's segments and notes. Returns clean copies with only the allowed fields, or throws a plain ApiError.
 * `churchSongIds` is the set of song ids this church has; a chosen song must be one of them.
 */
export function checkPlanBody(segmentsIn, notesIn, churchSongIds) {
  if (!segmentsIn || typeof segmentsIn !== 'object' || Array.isArray(segmentsIn)) throw new ApiError(400, 'The plan could not be read. Reload it and try again.');
  if (!notesIn || typeof notesIn !== 'object' || Array.isArray(notesIn)) throw new ApiError(400, 'The plan could not be read. Reload it and try again.');
  const segmentIds = Object.keys(segmentsIn);
  if (segmentIds.length > MAX_SEGMENTS) throw new ApiError(400, 'This plan has too many segments.');

  const segments = {};
  for (const id of segmentIds) {
    if (!SEGMENT_ID.test(id)) throw new ApiError(400, 'A segment in this plan is not recognised. Reload the plan and try again.');
    const seg = segmentsIn[id];
    if (!seg || typeof seg !== 'object' || Array.isArray(seg)) throw new ApiError(400, 'A segment in this plan is not recognised. Reload the plan and try again.');
    if (Object.keys(seg).some((k) => !SEGMENT_KEYS.includes(k))) throw new ApiError(400, 'A segment in this plan is not recognised. Reload the plan and try again.');
    const clean = {};
    if (seg.songId !== undefined && seg.songId !== null) {
      if (typeof seg.songId !== 'string' || !UUID.test(seg.songId) || !churchSongIds.has(seg.songId)) {
        throw new ApiError(400, "That song is not in your church's song list. Reload the song list and try again.");
      }
      clean.songId = seg.songId;
    }
    if (seg.text !== undefined && seg.text !== null && seg.text !== '') {
      if (typeof seg.text !== 'string' || seg.text.length > TEXT_MAX) throw new ApiError(400, `Text for a segment can be up to ${TEXT_MAX} characters.`);
      clean.text = seg.text;
    }
    if (clean.songId && clean.text) throw new ApiError(400, 'A segment holds a song or typed text, not both.');
    if (seg.minutes !== undefined) {
      if (!Number.isInteger(seg.minutes) || seg.minutes < MIN_MINUTES || seg.minutes > MAX_MINUTES) {
        throw new ApiError(400, `Each segment needs between ${MIN_MINUTES} and ${MAX_MINUTES} minutes.`);
      }
      clean.minutes = seg.minutes;
    }
    if (Object.keys(clean).length) segments[id] = clean;
  }

  const notes = {};
  for (const id of Object.keys(notesIn)) {
    if (!SEGMENT_ID.test(id)) throw new ApiError(400, 'A segment in this plan is not recognised. Reload the plan and try again.');
    const note = notesIn[id];
    if (typeof note !== 'string' || note.length > NOTE_MAX) throw new ApiError(400, `A note can be up to ${NOTE_MAX} characters.`);
    if (note.trim() !== '') notes[id] = note.trim();
  }
  return { segments, notes };
}

export function createPlanEditingApi({ sql, transaction, secret, now = () => new Date() }) {
  const session = (event) => sessionFrom({ sql, secret, now }, event);

  /** The same gate for every route here: a signed-in user who has set their own password. */
  async function signedIn(event, method) {
    if (event.httpMethod !== method) return { response: json(405, { error: `Use ${method}.` }, { Allow: method }) };
    const who = await session(event);
    if (!who) return { response: json(401, { error: 'Sign in first.' }) };
    if (who.mustChangePassword) return { response: json(403, { error: 'Change your password before using the planner.' }) };
    return { who };
  }

  /** Runs a handler: refusals go back with their message; anything else is a plain 500 that names no cause. */
  const safely = (handler) => async (event) => {
    try {
      return await handler(event);
    } catch (err) {
      if (err instanceof ApiError) return json(err.status, { error: err.message });
      console.error(`[plans] ${err.name}`);
      return json(500, { error: 'Something went wrong. Try again.' });
    }
  };

  /** One plan of the signed-in church, with its structure. Every signed-in role can read it. */
  const getPlan = safely(async (event) => {
    const gate = await signedIn(event, 'GET');
    if (gate.response) return gate.response;
    const id = event.queryStringParameters?.id;
    if (typeof id !== 'string' || !UUID.test(id)) throw new ApiError(400, 'Choose a plan.');
    const rows = await sql`
      SELECT id, name, liturgical_date, body, updated_at FROM plans WHERE id = ${id} AND church_id = ${gate.who.churchId}`;
    if (!rows.length) throw new ApiError(404, 'That plan is not in your church.');
    const row = rows[0];
    const body = row.body ?? {};
    return json(200, {
      plan: {
        id: row.id,
        name: row.name,
        date: dateText(row.liturgical_date),
        kind: body.kind ?? null,
        segments: body.segments ?? {},
        notes: body.notes ?? {},
        updatedAt: new Date(row.updated_at).toISOString(),
      },
      canEdit: EDITING_ROLES.includes(gate.who.role),
    });
  });

  /** The church's songs, as the Change picker lists them. Songs come from the laptop; this only reads them. */
  const listSongs = safely(async (event) => {
    const gate = await signedIn(event, 'GET');
    if (gate.response) return gate.response;
    const rows = await sql`
      SELECT id, title, category, language, musical_key FROM songs
      WHERE church_id = ${gate.who.churchId} ORDER BY lower(title), id`;
    return json(200, {
      songs: rows.map((r) => ({ id: r.id, title: r.title, category: r.category, language: r.language, key: r.musical_key })),
    });
  });

  /**
   * Saves the whole plan's structure in one transaction. The plan row is locked, so two saves queue behind each other. Only
   * planners and admins can save. The audit line names the plan and the actor, and nothing of the content.
   */
  const savePlan = safely(async (event) => {
    const gate = await signedIn(event, 'POST');
    if (gate.response) return gate.response;
    const { who } = gate;
    if (!EDITING_ROLES.includes(who.role)) return json(403, { error: 'Your account can view plans but not change them.' });
    const body = parseJson(event);
    if (!body) throw new ApiError(400, 'The plan could not be read. Reload it and try again.');
    const planId = body.id;
    if (typeof planId !== 'string' || !UUID.test(planId)) throw new ApiError(400, 'Choose a plan.');

    const at = now().toISOString();
    const savedAt = await transaction(async (tx) => {
      const rows = await tx`SELECT body FROM plans WHERE id = ${planId} AND church_id = ${who.churchId} FOR UPDATE`;
      if (!rows.length) throw new ApiError(404, 'That plan is not in your church.');
      const songs = await tx`SELECT id FROM songs WHERE church_id = ${who.churchId}`;
      const { segments, notes } = checkPlanBody(body.segments, body.notes, new Set(songs.map((s) => s.id)));
      const stored = { kind: rows[0].body?.kind ?? null, segments, notes };
      await tx`UPDATE plans SET body = ${JSON.stringify(stored)}::jsonb, updated_at = ${at} WHERE id = ${planId}`;
      await tx`INSERT INTO audit_log (church_id, actor_user_id, action, target_plan_id) VALUES (${who.churchId}, ${who.userId}, 'plan.saved', ${planId})`;
      return at;
    });
    return json(200, { ok: true, savedAt });
  });

  return { getPlan, listSongs, savePlan };
}

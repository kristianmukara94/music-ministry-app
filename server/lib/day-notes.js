// The web Planner's day memos: one short note per church per calendar day ("Choir practice at 3:00 PM"), shown in the Liturgical and the
// Praise & Worship calendars. Every signed-in role reads them; planners and admins write them. A blank note removes the day's memo.
//
//   day-notes  GET  ?from=YYYY-MM-DD&to=YYYY-MM-DD (both optional)  → { notes: { "2026-12-06": "…" }, available }
//              POST { date: "YYYY-MM-DD", note: "…" }              → { ok, date, note }   (note '' when it was removed)
//
// Stored in calendar_day_notes (server/db/migrations/2026-11-22-calendar-day-notes.sql). Until that runs on a database, reads answer no
// memos with `available: false` and writes answer 503, so the calendars keep working without them.
import { sessionFrom } from './session.js';
import { EDITING_ROLES } from './rules.js';

export const MAX_DAY_NOTE = 200;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UNDEFINED_TABLE = '42P01';

export const DAY_NOTE_MESSAGES = {
  badDate: 'Choose a day for the memo.',
  badNote: 'The memo could not be read.',
  tooLong: `Keep the memo to ${MAX_DAY_NOTE} characters.`,
  readOnly: 'Your account can view plans but not change them.',
  notMigrated: 'Day memos cannot be saved yet. Ask your admin to update the planner database.',
};

const json = (statusCode, body, extraHeaders = {}) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  body: JSON.stringify(body),
});

const isMissingTable = (err) => err?.code === UNDEFINED_TABLE;

/** A real calendar day as "YYYY-MM-DD", or null. "2026-02-30" is not one. */
export function dayOf(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? value : null;
}

/** A memo as stored: one line of plain text, spaces collapsed, control characters dropped. '' removes the memo. */
export function cleanDayNote(value) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const dateText = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));

export function createDayNotesApi({ sql, secret, now = () => new Date() }) {
  const session = (event) => sessionFrom({ sql, secret, now }, event);

  const safely = (handler) => async (event) => {
    try {
      return await handler(event);
    } catch (err) {
      console.error(`[day-notes] ${err.name}`);
      return json(500, { error: 'Something went wrong. Try again.' });
    }
  };

  async function read(who, query) {
    const from = dayOf(query?.from);
    const to = dayOf(query?.to);
    try {
      const rows = await sql`
        SELECT liturgical_date, note FROM calendar_day_notes
        WHERE church_id = ${who.churchId}
          AND (${from}::date IS NULL OR liturgical_date >= ${from}::date)
          AND (${to}::date IS NULL OR liturgical_date <= ${to}::date)
        ORDER BY liturgical_date`;
      return json(200, { notes: Object.fromEntries(rows.map((r) => [dateText(r.liturgical_date), r.note])), available: true });
    } catch (err) {
      if (isMissingTable(err)) return json(200, { notes: {}, available: false });
      throw err;
    }
  }

  async function write(who, event) {
    if (!EDITING_ROLES.includes(who.role)) return json(403, { error: DAY_NOTE_MESSAGES.readOnly });
    let body;
    try {
      body = JSON.parse(event.body ?? '{}');
    } catch {
      return json(400, { error: DAY_NOTE_MESSAGES.badNote });
    }
    const date = dayOf(body?.date);
    if (!date) return json(400, { error: DAY_NOTE_MESSAGES.badDate });
    if (typeof body.note !== 'string') return json(400, { error: DAY_NOTE_MESSAGES.badNote });
    const note = cleanDayNote(body.note);
    if (note.length > MAX_DAY_NOTE) return json(400, { error: DAY_NOTE_MESSAGES.tooLong });
    try {
      if (note) {
        await sql`
          INSERT INTO calendar_day_notes (church_id, liturgical_date, note, updated_at, updated_by)
          VALUES (${who.churchId}, ${date}, ${note}, ${now().toISOString()}, ${who.userId})
          ON CONFLICT (church_id, liturgical_date) DO UPDATE SET note = EXCLUDED.note, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`;
      } else {
        await sql`DELETE FROM calendar_day_notes WHERE church_id = ${who.churchId} AND liturgical_date = ${date}`;
      }
    } catch (err) {
      if (isMissingTable(err)) return json(503, { error: DAY_NOTE_MESSAGES.notMigrated });
      throw err;
    }
    return json(200, { ok: true, date, note });
  }

  /** day-notes: GET lists the church's memos; POST sets or removes one day's memo. The church is always the signed-in user's own. */
  const dayNotes = safely(async (event) => {
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return json(405, { error: 'Use GET or POST.' }, { Allow: 'GET, POST' });
    const who = await session(event);
    if (!who) return json(401, { error: 'Sign in first.' });
    if (who.mustChangePassword) return json(403, { error: 'Change your password before using the planner.' });
    return event.httpMethod === 'GET' ? read(who, event.queryStringParameters) : write(who, event);
  });

  return { dayNotes };
}

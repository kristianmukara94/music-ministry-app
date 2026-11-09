// Plans as one ordered list of items, shared by the web editors and the laptop. A plan has a UUID made once, on whichever side made
// it. The web creates plans through plan-create. A laptop pulls changes after a cursor, and pushes its plans with the updated_at it
// last saw (baseUpdatedAt). If the server has moved on, a push is not applied: the server's version comes back and nothing is
// written. Each plan in a push is its own transaction, with its own result. Lyrics, Bible text, announcements and media on a laptop never
// reach here. A web planner can type its own Content Hub entries into a plan (contentHubItems): those start on the website, stay in that
// plan's body, and come down to the church's linked laptops with the plan, so they can be projected. The church always comes from the signed-in session or the laptop's token, never from the request body.
import { ApiError } from './admin.js';
import { sessionFrom } from './session.js';
import { bearerToken, deviceFrom } from './device.js';
import { hashToken } from './auth.js';
import { hit } from './rate-limit.js';
import { EDITING_ROLES } from './rules.js';

export const MAX_ITEMS = 200;
export const MAX_PLANS_PER_PUSH = 50;
export const PUSH_LIMIT = { requests: 20, windowMs: 10 * 60 * 1000 };
export const CREATE_LIMIT = { requests: 20, windowMs: 10 * 60 * 1000 };
export const DELETE_LIMIT = { requests: 20, windowMs: 10 * 60 * 1000 };
const KINDS = ['song', 'reading', 'rite'];
const PLAN_KINDS = ['mass', 'pw'];
const ITEM_FIELDS = ['key', 'group', 'order', 'kind', 'songId', 'text', 'minutes', 'note', 'keyTransposed', 'contentType', 'slot', 'slotId', 'title', 'contentHubId', 'durationMinutes'];
// The Holy Mass slot an item fills on the laptop, by number. The website keeps it as it is, so a plan edited here goes back with its slots.
export const MASS_SLOT_COUNT = 28;
// The key a song is sung in for this plan. The song's own key in the church's list is not changed.
const MUSICAL_KEY = /^[A-G][#b]?m?$/;
// What a reading item's short title stands for. The item holds the title only; the words stay in the Content Hub on the laptop.
export const CONTENT_TYPES = ['scripture', 'prayer', 'announcement'];
// What fills a step, as the web planners record it. Any kind of item can carry one of these.
export const ITEM_CONTENT_TYPES = ['song', 'hub_item', 'text_note'];
// A plan's own Content Hub: entries typed on the web and reused across its slots.
export const HUB_TYPES = ['prayer', 'scripture', 'announcement', 'note'];
export const MAX_HUB_ITEMS = 50;
// The laptop keeps an entry as a note, and a note's body is at most this long (shared/notes.js).
export const MAX_HUB_TEXT = 4000;
// A serverless response has a size limit. A page of plans stops here and `more` says the rest is waiting.
export const MAX_PULL_BYTES = 3_500_000;
const HUB_FIELDS = ['id', 'type', 'title', 'category', 'text', 'speakerNote'];
const HUB_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SLOT_ID = /^[A-Za-z0-9_.-]{1,20}$/;
const MAX_ITEM_TITLE = 200;
// Field names that would carry lyrics, slides, media, Bible text or announcements. Refused by name, so nothing is silently dropped.
const FORBIDDEN = /lyric|stanza|slide|media|bible|verse|announce|audio|video|image|file|hymn|scripture/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

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

/** The languages a Holy Mass plan can be celebrated in (shared/mass-language.js): English, Tagalog, Cebuano. */
export const PLAN_LANGUAGES = ['EN', 'TL', 'CEB'];
const MASS_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * A plan's details beyond its items, from the stored body: the language (EN, TL or CEB) and the parish Mass time it is for ("HH:MM" on
 * the plan's date). Each is left out when it is not set, so a plan saved before them reads as it did.
 */
export function planDetails(body) {
  const out = {};
  if (PLAN_LANGUAGES.includes(body?.language)) out.language = body.language;
  if (typeof body?.massTime === 'string' && MASS_TIME.test(body.massTime)) out.massTime = body.massTime;
  return out;
}

/**
 * The details a web save sets, on top of the ones the plan has. A field the request leaves out keeps its stored value; `massTime: null`
 * clears the time. Throws a plain ApiError for a value that is not allowed.
 */
export function checkPlanDetails(input, current = {}) {
  const out = planDetails(current);
  if (input.language !== undefined) {
    if (!PLAN_LANGUAGES.includes(input.language)) throw refuse('The Holy Mass language must be English, Tagalog or Cebuano. Nothing was saved.');
    out.language = input.language;
  }
  if (input.massTime !== undefined) {
    if (input.massTime === null) delete out.massTime;
    else if (typeof input.massTime === 'string' && MASS_TIME.test(input.massTime)) out.massTime = input.massTime;
    else throw refuse('Choose a Mass time from the schedule, or a time such as 08:00. Nothing was saved.');
  }
  return out;
}

/** A plan as the API returns it: its fields, its language and Mass time when set, its Content Hub when it has one, and its ordered items. */
export function planOut(row) {
  const body = row.body ?? {};
  // A deleted plan keeps its row, marked deleted and with no items, so every laptop learns of the delete on its next pull.
  return {
    id: row.id,
    name: row.name,
    date: dateText(row.liturgical_date),
    kind: body.kind ?? null,
    ...(body.deleted ? {} : { ...planDetails(body), ...hubOf(body) }),
    items: body.deleted ? [] : Array.isArray(body.items) ? body.items : [],
    updatedAt: new Date(row.updated_at).toISOString(),
    ...(body.deleted ? { deleted: true } : {}),
  };
}

const refuse = (message) => new ApiError(400, message);

/** The one message for a push that cannot be applied to a plan id. It is the same whichever reason applies. */
export const NOT_SAVED = 'This plan could not be saved. Try again, or ask your admin.';

/**
 * Checks one plan's items. Returns clean items sorted by order, or throws a plain ApiError. `songIds` is every song id the church
 * has, removed ones included: a plan keeps a reference to a song that has since been removed.
 */
export function checkItems(items, songIds) {
  if (!Array.isArray(items)) throw refuse('The plan items could not be read. Nothing was saved.');
  if (items.length > MAX_ITEMS) throw refuse(`A plan can have up to ${MAX_ITEMS} items. Nothing was saved.`);
  const keys = new Set();
  const orders = new Set();
  const out = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw refuse('An item in the plan could not be read. Nothing was saved.');
    for (const field of Object.keys(item)) {
      if (ITEM_FIELDS.includes(field)) continue;
      if (FORBIDDEN.test(field)) throw refuse('Lyrics, slides, media, Bible text and announcements never leave the laptop. Nothing was saved.');
      throw refuse('An item in the plan has a field the planner does not accept. Nothing was saved.');
    }
    if (typeof item.key !== 'string' || item.key === '' || item.key.length > 20) throw refuse('An item in the plan has no valid key. Nothing was saved.');
    if (keys.has(item.key)) throw refuse('Two items in the plan share a key. Nothing was saved.');
    keys.add(item.key);
    if (!Number.isInteger(item.order) || item.order < 1 || item.order > MAX_ITEMS || orders.has(item.order)) {
      throw refuse('Items need a unique order from 1 to 200. Nothing was saved.');
    }
    orders.add(item.order);
    if (!KINDS.includes(item.kind)) throw refuse('An item must be a song, a reading or a rite. Nothing was saved.');
    const group = item.group === undefined ? '' : item.group;
    if (typeof group !== 'string' || group.length > 40) throw refuse('An item group can be up to 40 characters. Nothing was saved.');
    const clean = { key: item.key, group, order: item.order, kind: item.kind };
    if (item.songId !== undefined && item.songId !== null) {
      if (item.kind !== 'song') throw refuse('Only a song item can name a song. Nothing was saved.');
      if (typeof item.songId !== 'string' || !UUID.test(item.songId) || !songIds.has(item.songId)) {
        throw refuse("That song is not in your church's song list. Reload the song list and try again. Nothing was saved.");
      }
      clean.songId = item.songId;
    }
    if (item.text !== undefined && item.text !== null && item.text !== '') {
      if (typeof item.text !== 'string' || item.text.length > 500) throw refuse('Text in an item can be up to 500 characters. Nothing was saved.');
      clean.text = item.text;
    }
    if (clean.songId && clean.text) throw refuse('A song item holds a song or typed text, not both. Nothing was saved.');
    if (item.minutes !== undefined) {
      if (!Number.isInteger(item.minutes) || item.minutes < 1 || item.minutes > 60) throw refuse('Each item needs between 1 and 60 minutes. Nothing was saved.');
      clean.minutes = item.minutes;
    }
    if (item.slot !== undefined && item.slot !== null) {
      if (!Number.isInteger(item.slot) || item.slot < 1 || item.slot > MASS_SLOT_COUNT) throw refuse(`A Holy Mass slot must be a number from 1 to ${MASS_SLOT_COUNT}. Nothing was saved.`);
      clean.slot = item.slot;
    }
    if (item.note !== undefined && item.note !== null && item.note !== '') {
      if (typeof item.note !== 'string' || item.note.length > 1000) throw refuse('A note can be up to 1000 characters. Nothing was saved.');
      if (item.note.trim() !== '') clean.note = item.note.trim();
    }
    if (item.slotId !== undefined && item.slotId !== null) {
      if (typeof item.slotId !== 'string' || !SLOT_ID.test(item.slotId)) throw refuse('An item in the plan names a step that could not be read. Nothing was saved.');
      clean.slotId = item.slotId;
    }
    if (item.title !== undefined && item.title !== null && item.title !== '') {
      if (typeof item.title !== 'string' || item.title.length > MAX_ITEM_TITLE) throw refuse(`An item title can be up to ${MAX_ITEM_TITLE} characters. Nothing was saved.`);
      clean.title = item.title;
    }
    if (item.durationMinutes !== undefined && item.durationMinutes !== null) {
      if (!Number.isInteger(item.durationMinutes) || item.durationMinutes < 0 || item.durationMinutes > 60) throw refuse('An item can run for up to 60 minutes. Nothing was saved.');
      clean.durationMinutes = item.durationMinutes;
    }
    if (item.contentHubId !== undefined && item.contentHubId !== null) {
      if (typeof item.contentHubId !== 'string' || !HUB_ID.test(item.contentHubId)) throw refuse('An item names a Content Hub entry that could not be read. Nothing was saved.');
      if (clean.songId) throw refuse('A step holds a song or a Content Hub entry, not both. Nothing was saved.');
      clean.contentHubId = item.contentHubId;
    }
    if (item.keyTransposed !== undefined && item.keyTransposed !== null) {
      if (typeof item.keyTransposed !== 'string' || !MUSICAL_KEY.test(item.keyTransposed)) throw refuse('A song key must be written like G, Bb or F#m. Nothing was saved.');
      if (!clean.songId) throw refuse('Only a chosen song can have a key for the plan. Nothing was saved.');
      clean.keyTransposed = item.keyTransposed;
    }
    if (item.contentType !== undefined && item.contentType !== null) {
      if (ITEM_CONTENT_TYPES.includes(item.contentType)) {
        if (item.contentType === 'hub_item' && !clean.contentHubId) throw refuse('A Content Hub item must name its entry. Nothing was saved.');
      } else {
        if (!CONTENT_TYPES.includes(item.contentType)) throw refuse('A reading must be a scripture reading, a prayer or an announcement. Nothing was saved.');
        if (item.kind !== 'reading' || !clean.text) throw refuse('Only a reading with a title can have a reading type. Nothing was saved.');
      }
      clean.contentType = item.contentType;
    }
    out.push(clean);
  }
  return out.sort((a, b) => a.order - b.order);
}

/** The plan's Content Hub as it is stored, for spreading into a plan body. Left out when empty, so a plan without one is stored as before. */
export function hubOf(body) {
  return Array.isArray(body?.contentHubItems) && body.contentHubItems.length ? { contentHubItems: body.contentHubItems } : {};
}

/** Checks a plan's Content Hub entries. Returns clean entries, or throws a plain ApiError. Unknown field names are refused, as they are on an item. */
export function checkContentHubItems(list) {
  if (!Array.isArray(list)) throw refuse('The Content Hub entries could not be read. Nothing was saved.');
  if (list.length > MAX_HUB_ITEMS) throw refuse(`A plan can have up to ${MAX_HUB_ITEMS} Content Hub entries. Nothing was saved.`);
  const ids = new Set();
  const textOf = (value, max, label) => {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string' || value.length > max) throw refuse(`${label} can be up to ${max} characters. Nothing was saved.`);
    return value.trim();
  };
  return list.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw refuse('A Content Hub entry could not be read. Nothing was saved.');
    if (Object.keys(entry).some((field) => !HUB_FIELDS.includes(field))) throw refuse('A Content Hub entry has a field the planner does not accept. Nothing was saved.');
    if (typeof entry.id !== 'string' || !HUB_ID.test(entry.id) || ids.has(entry.id)) throw refuse('A Content Hub entry has no valid id. Nothing was saved.');
    ids.add(entry.id);
    if (!HUB_TYPES.includes(entry.type)) throw refuse('A Content Hub entry must be a prayer, a reading, an announcement or a note. Nothing was saved.');
    const title = typeof entry.title === 'string' ? entry.title.trim() : '';
    if (title === '' || title.length > 120) throw refuse('A Content Hub title must be 1 to 120 characters. Nothing was saved.');
    return {
      id: entry.id,
      type: entry.type,
      title,
      category: textOf(entry.category, 60, 'A Content Hub category'),
      text: textOf(entry.text, MAX_HUB_TEXT, 'Content Hub text'),
      speakerNote: textOf(entry.speakerNote, 500, 'A speaker note'),
    };
  });
}

/** Every Content Hub entry an item names must be in the plan. Throws a plain ApiError otherwise. */
export function checkHubReferences(items, hubItems) {
  const ids = new Set(hubItems.map((entry) => entry.id));
  if (items.some((item) => item.contentHubId && !ids.has(item.contentHubId))) throw refuse('A step names a Content Hub entry this plan does not have. Nothing was saved.');
}

const labelOf = (item) => item.text ?? item.note ?? '';
const isWebEntry = (item) => Boolean(item.contentHubId) || item.contentType === 'text_note';
const sameSource = (a, b) => (a.songId ? a.songId === b.songId : Boolean(a.contentHubId) && a.contentHubId === b.contentHubId) && a.group === b.group;

/**
 * What a laptop push cannot carry, put back from the stored plan. A laptop knows nothing of a song's key for the plan, a Content Hub link or a step's
 * web id; it makes new keys for Holy Mass songs, sends a web note back as a note, and sends a prayer segment with no words at all. So an item is matched
 * by its key, or else by its song or Content Hub entry and its group, each stored item once. A laptop slot holds one item, so the second song of a slot comes back with no slot
 * while another item holds that slot, and it gets its slot back. Anything the laptop really changed (another song, other words) keeps the laptop's version.
 */
export function restoreWebFields(items, stored) {
  const byKey = new Map(stored.map((item) => [item.key, item]));
  const pushed = new Set(items.map((item) => item.key));
  const spare = stored.filter((item) => (item.songId || item.contentHubId) && !pushed.has(item.key));
  const heldSlots = new Set(items.map((item) => item.slot).filter(Boolean));
  return items.map((item) => {
    let was = byKey.get(item.key);
    if (!was && (item.songId || item.contentHubId)) {
      const at = spare.findIndex((s) => sameSource(item, s));
      if (at >= 0) [was] = spare.splice(at, 1);
    }
    if (!was) return item;
    const out = { ...item };
    if (item.note === undefined && was.note) out.note = was.note;
    if (item.slot === undefined && was.slot && heldSlots.has(was.slot)) out.slot = was.slot;
    if (isWebEntry(was) && !item.songId && !item.text && (item.note === undefined || item.note === was.text)) {
      // The words came back as a note, or not at all: this is still the web's entry.
      out.text = was.text;
      delete out.note;
      if (was.note) out.note = was.note;
    }
    // A title slot on the laptop sends no words, so a reference typed on the web would otherwise be wiped by the next push.
    if (item.kind === 'reading' && was.kind === 'reading' && !item.text && was.text) out.text = was.text;
    const same = item.songId || was.songId ? item.songId === was.songId : labelOf(out) === labelOf(was);
    if (item.keyTransposed === undefined && was.keyTransposed && was.songId === item.songId) out.keyTransposed = was.keyTransposed;
    if (item.contentType === undefined && was.contentType && (ITEM_CONTENT_TYPES.includes(was.contentType) ? same : was.text === out.text)) out.contentType = was.contentType;
    if (same) {
      for (const field of ['slotId', 'title', 'contentHubId', 'durationMinutes']) {
        if (item[field] === undefined && was[field] !== undefined) out[field] = was[field];
      }
    }
    return out;
  });
}

/** A plan's name, date and kind. Returns the clean values or throws a plain ApiError. */
export function checkPlanFields({ name, date, kind }) {
  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (cleanName === '' || cleanName.length > 120) throw refuse('A plan name must be 1 to 120 characters. Nothing was saved.');
  // Compared back to the text, because JavaScript rolls 2026-02-31 over to March where the database refuses it.
  const parsedDate = typeof date === 'string' && DATE.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    throw refuse('A plan date must be a date, such as 2026-11-01. Nothing was saved.');
  }
  if (!PLAN_KINDS.includes(kind)) throw refuse('A plan must be a Mass plan or a Praise & Worship plan. Nothing was saved.');
  return { name: cleanName, date, kind };
}

const cursorOf = (row) => `${new Date(row.updated_at).toISOString()}|${row.id}`;

function parseCursor(cursor) {
  const match = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\|([0-9a-f-]{36})$/i.exec(cursor);
  if (!match || !UUID.test(match[2]) || Number.isNaN(Date.parse(match[1]))) throw refuse('The sync position could not be read. Start the sync again.');
  return [match[1], match[2]];
}

/** Every song id the church has, removed ones included, for checking references. */
async function songIdsOf(sql, churchId) {
  return new Set((await sql`SELECT id FROM songs WHERE church_id = ${churchId}`).map((r) => r.id));
}

/**
 * The plans changed after a cursor, oldest first, up to 200 at a time. `more` says whether another page is waiting. The cursor is
 * the last plan's updated time and id, so a page can be picked up exactly where it stopped.
 */
export async function pullPlans(sql, churchId, cursor, maxBytes = MAX_PULL_BYTES) {
  const rows = cursor
    ? await (async () => {
        const [at, id] = parseCursor(cursor);
        return sql`
          SELECT id, name, liturgical_date, body, updated_at FROM plans
          WHERE church_id = ${churchId} AND (updated_at, id) > (${at}::timestamptz, ${id}::uuid)
          ORDER BY updated_at, id LIMIT 201`;
      })()
    : await sql`
        SELECT id, name, liturgical_date, body, updated_at FROM plans
        WHERE church_id = ${churchId} ORDER BY updated_at, id LIMIT 201`;
  const plans = [];
  let bytes = 0;
  for (const row of rows.slice(0, 200)) {
    const plan = planOut(row);
    bytes += Buffer.byteLength(JSON.stringify(plan));
    // A page always holds at least one plan, so a large plan can never stop the sync.
    if (plans.length > 0 && bytes > maxBytes) break;
    plans.push(plan);
  }
  return { plans, cursor: plans.length ? cursorOf(rows[plans.length - 1]) : cursor ?? null, more: rows.length > plans.length };
}

/**
 * Records that a laptop has received a page of pulled plans. A plan saved on the web after the page was read is newer than the page, so it
 * stays unsynced. `plans` is the page, oldest first.
 */
export async function markPulled(sql, churchId, plans, at) {
  if (!plans.length) return;
  await sql`
    UPDATE plans SET synced_at = ${at}
    WHERE church_id = ${churchId} AND id = ANY(${plans.map((p) => p.id)}::uuid[]) AND updated_at <= ${plans[plans.length - 1].updatedAt}::timestamptz`;
}

/** Pushes one plan in its own transaction. Returns accepted, conflict (with the server's version) or error (a plain message). */
export async function pushOnePlan({ sql, transaction, churchId, userId, input, songIds, now }) {
  const id = typeof input?.id === 'string' ? input.id.toLowerCase() : '';
  if (!UUID.test(id)) return { id: null, status: 'error', message: 'A plan has no valid id. Nothing was saved.' };
  const base = input.baseUpdatedAt;
  if (base !== null && (typeof base !== 'string' || !ISO.test(base) || Number.isNaN(Date.parse(base)))) {
    return { id, status: 'error', message: 'The plan\'s last saved time could not be read. Nothing was saved.' };
  }
  let fields;
  let items;
  try {
    fields = checkPlanFields(input);
    items = checkItems(input.items, songIds);
  } catch (err) {
    if (err instanceof ApiError) return { id, status: 'error', message: err.message };
    throw err;
  }
  const at = now().toISOString();
  try {
    return await transaction(async (tx) => {
      const rows = await tx`SELECT id, church_id, name, liturgical_date, body, updated_at FROM plans WHERE id = ${id} FOR UPDATE`;
      // A push only updates a plan that already exists in this church. An unknown id and a plan in another church get the same
      // refusal, and nothing is written for either. Plans are created through plan-create, never by a push.
      // A deleted plan is refused the same way: a laptop cannot bring a deleted plan back by editing it.
      if (!rows.length || rows[0].church_id !== churchId || rows[0].body?.deleted) return { id, status: 'error', message: NOT_SAVED };
      const row = rows[0];
      // A plan's type is fixed once it exists. Its name and date can change.
      if ((row.body?.kind ?? null) !== fields.kind) return { id, status: 'error', message: 'A plan cannot change its type. Nothing was saved.' };
      // The laptop must have seen the latest save. Otherwise the server's version comes back and nothing is written.
      if (base === null || new Date(base).getTime() !== new Date(row.updated_at).getTime()) {
        return { id, status: 'conflict', serverVersion: planOut(row) };
      }
      // A laptop does not send what is set on the web: notes, keys, reading types, Content Hub links. Each is kept while the item still holds the same thing.
      const kept = restoreWebFields(items, Array.isArray(row.body?.items) ? row.body.items : []);
      // The language, Mass time and the plan's Content Hub are set on the web; a laptop push keeps them.
      await tx`
        UPDATE plans SET name = ${fields.name}, liturgical_date = ${fields.date},
          body = ${JSON.stringify({ kind: fields.kind, ...planDetails(row.body), ...hubOf(row.body), items: kept })}::jsonb, updated_at = ${at}, synced_at = ${at}
        WHERE id = ${id} AND church_id = ${churchId}`;
      return { id, status: 'accepted', updatedAt: at };
    });
  } catch (err) {
    if (err instanceof ApiError) return { id, status: 'error', message: err.message };
    console.error(`[plan-sync] ${err.name}`);
    return { id, status: 'error', message: 'Something went wrong. Try again.' };
  }
}

export function createPlanSyncApi({ sql, transaction, secret, now = () => new Date() }) {
  const session = (event) => sessionFrom({ sql, secret, now }, event);

  const safely = (handler) => async (event) => {
    try {
      return await handler(event);
    } catch (err) {
      if (err instanceof ApiError) return json(err.status, { error: err.message });
      console.error(`[plan-sync] ${err.name}`);
      return json(500, { error: 'Something went wrong. Try again.' });
    }
  };

  /** A signed-in planner or admin who has set their password. Used by plan-create. */
  async function webEditor(event, method) {
    if (event.httpMethod !== method) return { response: json(405, { error: `Use ${method}.` }, { Allow: method }) };
    const who = await session(event);
    if (!who) return { response: json(401, { error: 'Sign in first.' }) };
    if (who.mustChangePassword) return { response: json(403, { error: 'Change your password before using the planner.' }) };
    if (!EDITING_ROLES.includes(who.role)) return { response: json(403, { error: 'Your account can view plans but not create them.' }) };
    return { who };
  }

  /** Any linked laptop or signed-in user may read. Returns the church and who is asking. */
  async function reader(event) {
    const token = bearerToken(event.headers ?? {});
    if (token) {
      const device = await deviceFrom({ sql, secret }, token);
      if (device) return { churchId: device.church_id, userId: device.user_id, source: 'device' };
    }
    const who = await session(event);
    if (who && !who.mustChangePassword) return { churchId: who.churchId, userId: who.userId, source: 'web' };
    return null;
  }

  /**
   * Who may create a plan: a planner or admin signed in on the web, or a linked laptop whose planner or admin is still active. Viewers
   * are refused on both. The church comes from the session or the token, never from the request.
   */
  async function creator(event) {
    const token = bearerToken(event.headers ?? {});
    if (token) {
      const device = await deviceFrom({ sql, secret }, token);
      if (!device) return { response: json(401, { error: 'This laptop is not linked to a church.' }) };
      const linked = await sql`SELECT role, disabled FROM users WHERE id = ${device.user_id} AND church_id = ${device.church_id}`;
      if (!linked.length || linked[0].disabled || !EDITING_ROLES.includes(linked[0].role)) {
        return { response: json(403, { error: 'Only a planner or admin can create plans from this laptop.' }) };
      }
      return { churchId: device.church_id, userId: device.user_id, key: `device:${hashToken(token, secret)}`, fromLaptop: true };
    }
    const gate = await webEditor(event, 'POST');
    if (gate.response) return { response: gate.response };
    return { churchId: gate.who.churchId, userId: gate.who.userId, key: `user:${gate.who.userId}`, fromLaptop: false };
  }

  /**
   * Creates a plan with a UUID its maker chose: from the web, or from a linked laptop. One row and one plan.created audit row, with no
   * content. An id that already exists, in any church, gets the same refusal as any other, so nobody can tell whether it exists.
   */
  const createRoute = safely(async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' }, { Allow: 'POST' });
    const maker = await creator(event);
    if (maker.response) return maker.response;
    const { churchId, userId, key } = maker;
    const limit = await hit(sql, `plan-create:${key}`, CREATE_LIMIT.requests, CREATE_LIMIT.windowMs / 1000, now());
    if (!limit.allowed) {
      return json(429, { error: 'Too many plans created in a short time. Wait ten minutes and try again.' }, { 'Retry-After': String(limit.retryAfterSeconds) });
    }
    const body = parseJson(event);
    if (!body) throw refuse('The plan could not be read. Nothing was saved.');
    const id = typeof body.id === 'string' ? body.id.toLowerCase() : '';
    if (!UUID.test(id)) throw refuse('A plan needs a valid id. Nothing was saved.');
    const fields = checkPlanFields(body);
    const items = checkItems(body.items, await songIdsOf(sql, churchId));
    const contentHubItems = checkContentHubItems(body.contentHubItems ?? []);
    checkHubReferences(items, contentHubItems);
    const at = now().toISOString();
    try {
      await transaction(async (tx) => {
        const existing = await tx`SELECT id FROM plans WHERE id = ${id}`;
        if (existing.length) throw new ApiError(409, NOT_SAVED);
        await tx`
          INSERT INTO plans (id, church_id, name, liturgical_date, body, updated_at, synced_at)
          VALUES (${id}, ${churchId}, ${fields.name}, ${fields.date}, ${JSON.stringify({ kind: fields.kind, ...hubOf({ contentHubItems }), items })}::jsonb, ${at}, ${maker.fromLaptop ? at : null})`;
        await tx`INSERT INTO audit_log (church_id, actor_user_id, action, target_plan_id) VALUES (${churchId}, ${userId}, 'plan.created', ${id})`;
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) return json(409, { error: NOT_SAVED });
      throw err;
    }
    return json(201, { plan: { id, name: fields.name, date: fields.date, kind: fields.kind, items, updatedAt: at } });
  });

  /**
   * Deletes a plan for everyone. The row stays, marked deleted, so a pull tells every laptop. A planner or admin may delete, from the
   * web or from a linked laptop. Deleting a plan that is already deleted succeeds with the same answer, so a retry is safe. A plan in
   * another church is not found. A real delete is recorded in the audit log as plan.deleted, in the same transaction.
   */
  const deleteRoute = safely(async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' }, { Allow: 'POST' });
    const maker = await creator(event);
    if (maker.response) return maker.response;
    const { churchId, userId, key } = maker;
    const limit = await hit(sql, `plan-delete:${key}`, DELETE_LIMIT.requests, DELETE_LIMIT.windowMs / 1000, now());
    if (!limit.allowed) {
      return json(429, { error: 'Too many plans deleted in a short time. Wait ten minutes and try again.' }, { 'Retry-After': String(limit.retryAfterSeconds) });
    }
    const body = parseJson(event);
    const id = typeof body?.id === 'string' ? body.id.toLowerCase() : '';
    if (!UUID.test(id)) throw refuse('A plan needs a valid id. Nothing was deleted.');
    const at = now().toISOString();
    const result = await transaction(async (tx) => {
      const rows = await tx`SELECT id, body, updated_at FROM plans WHERE id = ${id} AND church_id = ${churchId} FOR UPDATE`;
      if (!rows.length) return null;
      if (rows[0].body?.deleted) return { updatedAt: new Date(rows[0].updated_at).toISOString() };
      await tx`
        UPDATE plans SET body = ${JSON.stringify({ kind: rows[0].body?.kind ?? null, items: [], deleted: true })}::jsonb, updated_at = ${at}
        WHERE id = ${id} AND church_id = ${churchId}`;
      await tx`INSERT INTO audit_log (church_id, actor_user_id, action, target_plan_id) VALUES (${churchId}, ${userId}, 'plan.deleted', ${id})`;
      return { updatedAt: at };
    });
    if (!result) return json(404, { error: 'That plan is not in your church.' });
    return json(200, { id, deleted: true, updatedAt: result.updatedAt });
  });

  /**
   * One plan, for a linked laptop whose planner or admin is still active. Used when a create comes back 409: the laptop compares the
   * website's version before it sends anything. A plan in another church, and a plan that does not exist, get the same not-found.
   */
  const getRoute = safely(async (event) => {
    if (event.httpMethod !== 'GET') return json(405, { error: 'Use GET.' }, { Allow: 'GET' });
    const token = bearerToken(event.headers ?? {});
    if (!token) return json(401, { error: 'This laptop is not linked to a church.' });
    const device = await deviceFrom({ sql, secret }, token);
    if (!device) return json(401, { error: 'This laptop is not linked to a church.' });
    const linked = await sql`SELECT role, disabled FROM users WHERE id = ${device.user_id} AND church_id = ${device.church_id}`;
    if (!linked.length || linked[0].disabled || !EDITING_ROLES.includes(linked[0].role)) {
      return json(403, { error: 'Only a planner or admin can read plans from this laptop.' });
    }
    const id = typeof event.queryStringParameters?.id === 'string' ? event.queryStringParameters.id.toLowerCase() : '';
    if (!UUID.test(id)) throw refuse('A plan needs a valid id.');
    const rows = await sql`SELECT id, name, liturgical_date, body, updated_at FROM plans WHERE id = ${id} AND church_id = ${device.church_id}`;
    if (!rows.length || rows[0].body?.deleted) return json(404, { error: 'That plan is not in your church.' });
    return json(200, { plan: planOut(rows[0]) });
  });

  /** The changes since a cursor. A laptop or a signed-in user may call it. */
  const pullRoute = safely(async (event) => {
    if (event.httpMethod !== 'GET') return json(405, { error: 'Use GET.' }, { Allow: 'GET' });
    const who = await reader(event);
    if (!who) return json(401, { error: 'Sign in first.' });
    const cursor = event.queryStringParameters?.cursor || null;
    const page = await pullPlans(sql, who.churchId, cursor);
    if (who.source === 'device') await markPulled(sql, who.churchId, page.plans, now().toISOString());
    return json(200, page);
  });

  /**
   * The laptop's plans, each with its own result. Only a linked planner's or admin's laptop may push. The rate limit is per laptop.
   * One audit row per batch carries the counts only.
   */
  const pushRoute = safely(async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' }, { Allow: 'POST' });
    const token = bearerToken(event.headers ?? {});
    if (!token) return json(401, { error: 'This laptop is not linked to a church.' });
    const gate = await hit(sql, `plans-push:${hashToken(token, secret)}`, PUSH_LIMIT.requests, PUSH_LIMIT.windowMs / 1000, now());
    if (!gate.allowed) {
      return json(429, { error: 'Too many plan syncs from this laptop. Wait ten minutes and try again.' }, { 'Retry-After': String(gate.retryAfterSeconds) });
    }
    const device = await deviceFrom({ sql, secret }, token);
    if (!device) return json(401, { error: 'This laptop is not linked to a church.' });
    const linked = await sql`SELECT role, disabled FROM users WHERE id = ${device.user_id} AND church_id = ${device.church_id}`;
    if (!linked.length || linked[0].disabled || !EDITING_ROLES.includes(linked[0].role)) {
      return json(403, { error: 'Only a planner or admin can send plans from this laptop.' });
    }
    const body = parseJson(event);
    if (!body || !Array.isArray(body.plans)) throw refuse('The plans could not be read. Nothing was sent.');
    if (body.plans.length > MAX_PLANS_PER_PUSH) throw refuse(`Send up to ${MAX_PLANS_PER_PUSH} plans at a time.`);
    const churchId = device.church_id;
    const songIds = await songIdsOf(sql, churchId);
    const results = [];
    for (const input of body.plans) {
      results.push(await pushOnePlan({ sql, transaction, churchId, userId: device.user_id, input, songIds, now }));
    }
    const counts = { accepted: 0, conflict: 0, error: 0 };
    for (const r of results) counts[r.status] += 1;
    await sql`INSERT INTO audit_log (church_id, actor_user_id, action, detail) VALUES (${churchId}, ${device.user_id}, 'plan.synced', ${JSON.stringify(counts)}::jsonb)`;
    return json(200, { results, counts });
  });

  return { createPlan: createRoute, pullPlans: pullRoute, pushPlans: pushRoute, deletePlan: deleteRoute, getPlan: getRoute };
}

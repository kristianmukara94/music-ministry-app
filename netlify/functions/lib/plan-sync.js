// Plans as one ordered list of items, shared by the web editors and the laptop. A plan has a UUID made once, on whichever side made
// it. The web creates plans through plan-create. A laptop pulls changes after a cursor, and pushes its plans with the updated_at it
// last saw (baseUpdatedAt). If the server has moved on, a push is not applied: the server's version comes back and nothing is
// written. Each plan in a push is its own transaction, with its own result. Lyrics, Bible text, announcements and media never
// reach here. The church always comes from the signed-in session or the laptop's token, never from the request body.
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
const ITEM_FIELDS = ['key', 'group', 'order', 'kind', 'songId', 'text', 'minutes', 'note'];
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

/** A plan as the API returns it: its fields and its ordered items. The stored body holds the kind and the items. */
export function planOut(row) {
  const body = row.body ?? {};
  // A deleted plan keeps its row, marked deleted and with no items, so every laptop learns of the delete on its next pull.
  return {
    id: row.id,
    name: row.name,
    date: dateText(row.liturgical_date),
    kind: body.kind ?? null,
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
    if (item.note !== undefined && item.note !== null && item.note !== '') {
      if (typeof item.note !== 'string' || item.note.length > 1000) throw refuse('A note can be up to 1000 characters. Nothing was saved.');
      if (item.note.trim() !== '') clean.note = item.note.trim();
    }
    out.push(clean);
  }
  return out.sort((a, b) => a.order - b.order);
}

/** A plan's name, date and kind. Returns the clean values or throws a plain ApiError. */
export function checkPlanFields({ name, date, kind }) {
  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (cleanName === '' || cleanName.length > 120) throw refuse('A plan name must be 1 to 120 characters. Nothing was saved.');
  if (typeof date !== 'string' || !DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
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
export async function pullPlans(sql, churchId, cursor) {
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
  const more = rows.length > 200;
  const page = rows.slice(0, 200);
  return { plans: page.map(planOut), cursor: page.length ? cursorOf(page[page.length - 1]) : cursor ?? null, more };
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
      // A laptop keeps its own segment notes and does not send them, so a push that carries no note for an item keeps the note
      // the server already has for that item. Otherwise a note typed on the web would be lost on the next laptop push.
      const notes = new Map((Array.isArray(row.body?.items) ? row.body.items : []).filter((i) => i.note).map((i) => [i.key, i.note]));
      const kept = items.map((i) => (i.note === undefined && notes.has(i.key) ? { ...i, note: notes.get(i.key) } : i));
      await tx`
        UPDATE plans SET name = ${fields.name}, liturgical_date = ${fields.date},
          body = ${JSON.stringify({ kind: fields.kind, items: kept })}::jsonb, updated_at = ${at}
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
      return { churchId: device.church_id, userId: device.user_id, key: `device:${hashToken(token, secret)}` };
    }
    const gate = await webEditor(event, 'POST');
    if (gate.response) return { response: gate.response };
    return { churchId: gate.who.churchId, userId: gate.who.userId, key: `user:${gate.who.userId}` };
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
    const at = now().toISOString();
    try {
      await transaction(async (tx) => {
        const existing = await tx`SELECT id FROM plans WHERE id = ${id}`;
        if (existing.length) throw new ApiError(409, NOT_SAVED);
        await tx`
          INSERT INTO plans (id, church_id, name, liturgical_date, body, updated_at)
          VALUES (${id}, ${churchId}, ${fields.name}, ${fields.date}, ${JSON.stringify({ kind: fields.kind, items })}::jsonb, ${at})`;
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
    return json(200, await pullPlans(sql, who.churchId, cursor));
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

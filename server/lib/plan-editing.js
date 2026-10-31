// The web plan editor's server side: read one plan, list the church's songs, and save a plan. The plan is one ordered list of items
// (see plan-sync.js). The church always comes from the signed-in session, never from the request. Viewers can read a plan; only
// planners and admins can save one. A save names the version the editor loaded, and a save over a newer version is refused with
// the server's version, so nothing is overwritten silently.
import { ApiError } from './admin.js';
import { sessionFrom } from './session.js';
import { EDITING_ROLES } from './rules.js';
import { checkItems, dateText, planOut } from './plan-sync.js';

export { dateText };
export const MIN_MINUTES = 1;
export const MAX_MINUTES = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

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

  /**
   * One plan of the signed-in church, with its items. Every signed-in role can read it. `songs` lists the songs the plan refers to,
   * removed ones included, so the editor can show a song that has since been removed as removed.
   */
  const getPlan = safely(async (event) => {
    const gate = await signedIn(event, 'GET');
    if (gate.response) return gate.response;
    const id = event.queryStringParameters?.id;
    if (typeof id !== 'string' || !UUID.test(id)) throw new ApiError(400, 'Choose a plan.');
    const rows = await sql`
      SELECT id, name, liturgical_date, body, updated_at FROM plans WHERE id = ${id} AND church_id = ${gate.who.churchId}`;
    if (!rows.length || rows[0].body?.deleted) throw new ApiError(404, 'That plan is not in your church.');
    const plan = planOut(rows[0]);
    const referenced = new Set(plan.items.map((item) => item.songId).filter(Boolean));
    const songRows = referenced.size
      ? await sql`SELECT id, title, category, language, musical_key, removed_at FROM songs WHERE church_id = ${gate.who.churchId}`
      : [];
    const songs = songRows
      .filter((s) => referenced.has(s.id))
      .map((s) => ({ id: s.id, title: s.title, category: s.category, language: s.language, key: s.musical_key, removed: s.removed_at !== null }));
    return json(200, { plan, songs, canEdit: EDITING_ROLES.includes(gate.who.role) });
  });

  /** The church's songs for the picker. Removed songs are left out. Songs come from the laptop; this only reads them. */
  const listSongs = safely(async (event) => {
    const gate = await signedIn(event, 'GET');
    if (gate.response) return gate.response;
    // Only this church's songs, and only those not removed. The last update counts removals too, since a removal is a change to the list.
    const rows = await sql`
      SELECT id, title, category, language, musical_key FROM songs
      WHERE church_id = ${gate.who.churchId} AND removed_at IS NULL ORDER BY lower(title), id`;
    const [last] = await sql`SELECT MAX(updated_at) AS last FROM songs WHERE church_id = ${gate.who.churchId}`;
    return json(200, {
      songs: rows.map((r) => ({ id: r.id, title: r.title, category: r.category, language: r.language, key: r.musical_key })),
      lastUpdatedAt: last?.last ? new Date(last.last).toISOString() : null,
    });
  });

  /**
   * Saves the whole plan in one transaction. The editor names the version it loaded (baseUpdatedAt). If the plan has changed since,
   * nothing is written and the server's version comes back with a 409. Only planners and admins can save.
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
    const base = body.baseUpdatedAt;
    if (typeof base !== 'string' || !ISO.test(base)) throw new ApiError(400, 'The plan\'s last saved time is missing. Reload the plan and try again.');

    const at = now().toISOString();
    const result = await transaction(async (tx) => {
      const rows = await tx`SELECT id, name, liturgical_date, body, updated_at FROM plans WHERE id = ${planId} AND church_id = ${who.churchId} FOR UPDATE`;
      if (!rows.length || rows[0].body?.deleted) throw new ApiError(404, 'That plan is not in your church.');
      const row = rows[0];
      if (new Date(base).getTime() !== new Date(row.updated_at).getTime()) return { conflict: planOut(row) };
      const songs = await tx`SELECT id FROM songs WHERE church_id = ${who.churchId}`;
      const items = checkItems(body.items, new Set(songs.map((s) => s.id)));
      const kind = row.body?.kind ?? null;
      await tx`UPDATE plans SET body = ${JSON.stringify({ kind, items })}::jsonb, updated_at = ${at} WHERE id = ${planId}`;
      await tx`INSERT INTO audit_log (church_id, actor_user_id, action, target_plan_id) VALUES (${who.churchId}, ${who.userId}, 'plan.saved', ${planId})`;
      return { savedAt: at };
    });
    if (result.conflict) {
      return json(409, {
        error: 'This plan was changed on another device since you opened it. Reload it to see the latest version. Nothing was saved.',
        serverVersion: result.conflict,
      });
    }
    return json(200, { ok: true, savedAt: result.savedAt });
  });

  return { getPlan, listSongs, savePlan };
}

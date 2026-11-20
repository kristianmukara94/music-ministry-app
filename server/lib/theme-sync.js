// The church's colour theme, as last chosen on one of its laptops, so the website paints the same theme. The laptop sends the theme it is
// painted with (never `season-auto`) and when it was chosen (themeUpdatedAt). A newer choice replaces an older one; an older one, such as a
// change made offline that is only now being sent, is not applied, and the stored theme comes back instead.
//
//   theme-sync  GET or POST, with a linked laptop's token. POST { theme, themeUpdatedAt }.
//   theme       GET, with a web session. The website polls this while a tab is visible.
//   plan-sync-push also takes an optional { theme, themeUpdatedAt } beside its plans (applyPushedTheme).
//
// Stored in churches.theme / churches.theme_updated_at (server/db/migrations/2026-11-20-church-theme.sql). Until that runs on a
// database, reads answer "no theme yet" and writes answer 503, so the laptop keeps the change and sends it again later.
import { sessionFrom } from './session.js';
import { bearerToken, deviceFrom } from './device.js';
import { hashToken } from './auth.js';
import { hit } from './rate-limit.js';
import { isPaintedTheme } from '../../shared/theme-catalog.js';

// The laptop sends at most one theme per 300 ms of clicking. This is far above that, and still stops a runaway loop.
export const THEME_PUSH_LIMIT = { requests: 120, windowMs: 10 * 60 * 1000 };
// A laptop clock that runs ahead cannot claim a time far in the future, which would lock out every later change from other laptops.
export const MAX_CLOCK_LEAD_MS = 5 * 60 * 1000;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const UNDEFINED_COLUMN = '42703';

export const THEME_MESSAGES = {
  badTheme: 'That theme is not one the planner knows. Nothing was saved.',
  badTime: 'The time the theme was chosen could not be read. Nothing was saved.',
  notMigrated: 'The planner cannot store themes yet. The laptop will send it again later.',
};

const json = (statusCode, body, extraHeaders = {}) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  body: JSON.stringify(body),
});

const stampText = (value) => (value instanceof Date ? value.toISOString() : value ? new Date(value).toISOString() : null);
const isMissingColumn = (err) => err?.code === UNDEFINED_COLUMN;

/** The church's stored theme: { theme, themeUpdatedAt }, both null when no laptop has sent one (or the column is not there yet). */
export async function readChurchTheme(sql, churchId) {
  try {
    const rows = await sql`SELECT theme, theme_updated_at FROM churches WHERE id = ${churchId}`;
    const row = rows[0];
    if (!row || !isPaintedTheme(row.theme)) return { theme: null, themeUpdatedAt: null };
    return { theme: row.theme, themeUpdatedAt: stampText(row.theme_updated_at) };
  } catch (err) {
    if (isMissingColumn(err)) return { theme: null, themeUpdatedAt: null };
    throw err;
  }
}

/**
 * Checks a theme sent by a laptop. Returns { theme, at } with the time clamped to no later than the server's clock allows, or
 * { error } with the message to send back.
 */
export function checkThemeInput(input, now) {
  if (!isPaintedTheme(input?.theme)) return { error: THEME_MESSAGES.badTheme };
  const stamp = input.themeUpdatedAt;
  if (typeof stamp !== 'string' || !ISO.test(stamp) || Number.isNaN(Date.parse(stamp))) return { error: THEME_MESSAGES.badTime };
  const latest = now().getTime() + MAX_CLOCK_LEAD_MS;
  const at = new Date(Math.min(Date.parse(stamp), latest)).toISOString();
  return { theme: input.theme, at };
}

/**
 * Stores a checked theme when it is newer than the stored one. Returns { applied, theme, themeUpdatedAt } with what is stored after.
 * Throws { notMigrated: true } when the database has no theme columns yet.
 */
export async function storeChurchTheme(sql, churchId, { theme, at }) {
  try {
    const updated = await sql`
      UPDATE churches SET theme = ${theme}, theme_updated_at = ${at}
      WHERE id = ${churchId} AND (theme_updated_at IS NULL OR theme_updated_at < ${at})
      RETURNING theme, theme_updated_at`;
    if (updated.length) return { applied: true, theme: updated[0].theme, themeUpdatedAt: stampText(updated[0].theme_updated_at) };
    return { applied: false, ...(await readChurchTheme(sql, churchId)) };
  } catch (err) {
    if (isMissingColumn(err)) throw Object.assign(new Error(THEME_MESSAGES.notMigrated), { notMigrated: true });
    throw err;
  }
}

/**
 * The theme part of a plan-sync-push body, for a laptop already checked by that route. Returns undefined when the body has no theme
 * (laptops from before themes synced), otherwise the outcome, which never fails the plans beside it.
 */
export async function applyPushedTheme({ sql, churchId, body, now }) {
  if (body?.theme === undefined) return undefined;
  const checked = checkThemeInput(body, now);
  if (checked.error) return { applied: false, error: checked.error };
  try {
    return await storeChurchTheme(sql, churchId, checked);
  } catch (err) {
    if (err.notMigrated) return { applied: false, error: err.message };
    throw err;
  }
}

export function createThemeSyncApi({ sql, secret, now = () => new Date() }) {
  const safely = (handler) => async (event) => {
    try {
      return await handler(event);
    } catch (err) {
      console.error(`[theme-sync] ${err.name}`);
      return json(500, { error: 'Something went wrong. Try again.' });
    }
  };

  /** theme-sync: a linked laptop reads (GET) or sends (POST) the church's theme. Any linked laptop may: it changes colours only. */
  const laptopRoute = safely(async (event) => {
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return json(405, { error: 'Use GET or POST.' }, { Allow: 'GET, POST' });
    const token = bearerToken(event.headers ?? {});
    if (!token) return json(401, { error: 'This laptop is not linked to a church.' });
    if (event.httpMethod === 'POST') {
      const gate = await hit(sql, `theme-push:${hashToken(token, secret)}`, THEME_PUSH_LIMIT.requests, THEME_PUSH_LIMIT.windowMs / 1000, now());
      if (!gate.allowed) {
        return json(429, { error: 'Too many theme changes from this laptop. Wait a few minutes.' }, { 'Retry-After': String(gate.retryAfterSeconds) });
      }
    }
    const device = await deviceFrom({ sql, secret }, token);
    if (!device) return json(401, { error: 'This laptop is not linked to a church.' });
    if (event.httpMethod === 'GET') return json(200, await readChurchTheme(sql, device.church_id));

    let input;
    try {
      input = JSON.parse(event.body ?? '{}');
    } catch {
      input = null;
    }
    const checked = checkThemeInput(input, now);
    if (checked.error) return json(400, { error: checked.error });
    try {
      return json(200, await storeChurchTheme(sql, device.church_id, checked));
    } catch (err) {
      if (err.notMigrated) return json(503, { error: err.message }, { 'Retry-After': '300' });
      throw err;
    }
  });

  /** theme: the signed-in user's church theme, for the website's live theme watcher. Every role may read it. */
  const webRoute = safely(async (event) => {
    if (event.httpMethod !== 'GET') return json(405, { error: 'Use GET.' }, { Allow: 'GET' });
    const who = await sessionFrom({ sql, secret, now }, event);
    if (!who) return json(401, { error: 'Sign in first.' });
    return json(200, await readChurchTheme(sql, who.churchId));
  });

  return { laptopTheme: laptopRoute, webTheme: webRoute };
}

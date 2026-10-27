// Linking a laptop to a church. An admin creates a one-time link code on the website. The laptop redeems it once, and gets a
// device token that is shown to it once. The server stores only keyed hashes of the code and the token. The church always
// comes from the code or the device token, never from a request.
import { deviceToken, hashToken, linkCode, normaliseLinkCode } from './auth.js';
import { deviceFrom, bearerToken } from './device.js';
import { ApiError } from './admin.js';
import { sessionFrom } from './session.js';
import { ADMIN_ROLES } from './rules.js';
import { clientAddress } from './client-address.js';
import { hit } from './rate-limit.js';

export const LINK_CODE_MINUTES = 10;
export const REDEEM_LIMIT = { requests: 10, windowMs: 60 * 1000 };
const LABEL_MAX = 80;

/** A laptop's name: 1 to 80 characters. The plain message, or null when it is fine. */
export const checkDeviceLabel = (label) => (!label || label.length > LABEL_MAX ? `Name this laptop, in up to ${LABEL_MAX} characters.` : null);

/**
 * Links a laptop inside the caller's transaction: writes the device row and its audit line, and returns the raw token, which
 * is shown to the laptop once. Only its keyed hash is stored. Used by code redemption and by church setup.
 */
export async function issueDeviceToken(tx, { churchId, userId, label, secret, now }) {
  const token = deviceToken();
  await tx`
    INSERT INTO device_tokens (token_hash, church_id, user_id, device_name, created_at)
    VALUES (${hashToken(token, secret)}, ${churchId}, ${userId}, ${label}, ${now().toISOString()})`;
  await tx`INSERT INTO audit_log (church_id, actor_user_id, action) VALUES (${churchId}, ${userId}, 'device.linked')`;
  return token;
}

const json = (statusCode, body, extraHeaders = {}) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  body: JSON.stringify(body),
});


function parseJson(event) {
  try {
    const parsed = JSON.parse(event.body ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Runs a handler: refusals go back with their message; anything else is a plain 500 that names no cause. */
const safely = (handler) => async (event) => {
  try {
    return await handler(event);
  } catch (err) {
    if (err instanceof ApiError) return json(err.status, { error: err.message });
    console.error(`[linking] ${err.name}`);
    return json(500, { error: 'Something went wrong. Try again.' });
  }
};

export function createLinkingApi({ sql, transaction, secret, now = () => new Date() }) {
  const session = (event) => sessionFrom({ sql, secret, now }, event);

  /** An admin's one-time link code. Shown once; only its hash is kept. */
  const createCode = safely(async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' }, { Allow: 'POST' });
    const who = await session(event);
    if (!who) return json(401, { error: 'Sign in first.' });
    if (who.mustChangePassword) return json(403, { error: 'Change your password before linking a laptop.' });
    if (!ADMIN_ROLES.includes(who.role)) return json(403, { error: 'Only a church admin can link a laptop.' });

    const code = linkCode();
    const expires = new Date(now().getTime() + LINK_CODE_MINUTES * 60 * 1000);
    await transaction(async (tx) => {
      await tx`
        INSERT INTO link_codes (code_hash, church_id, created_by, expires_at)
        VALUES (${hashToken(code, secret)}, ${who.churchId}, ${who.userId}, ${expires.toISOString()})`;
      await tx`
        INSERT INTO audit_log (church_id, actor_user_id, action) VALUES (${who.churchId}, ${who.userId}, 'device.link_code_created')`;
    });
    return json(201, { code, expiresAt: expires.toISOString() });
  });

  /** A laptop redeems a link code once. The code, the device row and the audit row are written in one transaction. */
  const redeem = safely(async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' }, { Allow: 'POST' });
    const gate = await hit(sql, `redeem:${clientAddress(event)}`, REDEEM_LIMIT.requests, REDEEM_LIMIT.windowMs / 1000, now());
    if (!gate.allowed) {
      return json(429, { error: 'Too many attempts. Wait a minute and try again.' }, { 'Retry-After': String(gate.retryAfterSeconds) });
    }
    const body = parseJson(event);
    const code = normaliseLinkCode(body?.code);
    const label = typeof body?.deviceLabel === 'string' ? body.deviceLabel.trim() : '';
    if (!code) return json(400, { error: 'That code is not valid. Check it and try again.' });
    const labelProblem = checkDeviceLabel(label);
    if (labelProblem) return json(400, { error: labelProblem });

    const result = await transaction(async (tx) => {
      const rows = await tx`
        SELECT church_id, created_by, expires_at, used_at FROM link_codes WHERE code_hash = ${hashToken(code, secret)} FOR UPDATE`;
      const row = rows[0];
      if (!row) throw new ApiError(400, 'That code is not valid. Check it and try again.');
      if (row.used_at) throw new ApiError(409, 'This code has already been used. Ask your admin for a new one.');
      if (new Date(row.expires_at) <= now()) throw new ApiError(400, 'That code has expired. Ask your admin for a new one.');

      const admin = await tx`
        SELECT display_name, role, disabled FROM users WHERE id = ${row.created_by} AND church_id = ${row.church_id}`;
      if (!admin.length || admin[0].role !== 'admin' || admin[0].disabled) {
        throw new ApiError(403, 'The admin who made this code is no longer active. Ask an active admin for a new code.');
      }
      const church = (await tx`SELECT name FROM churches WHERE id = ${row.church_id}`)[0];

      await tx`UPDATE link_codes SET used_at = ${now().toISOString()} WHERE code_hash = ${hashToken(code, secret)}`;
      const token = await issueDeviceToken(tx, { churchId: row.church_id, userId: row.created_by, label, secret, now });
      return { token, churchName: church.name, adminName: admin[0].display_name, deviceLabel: label };
    });
    // The raw token leaves the server in this one response only.
    return json(201, result);
  });

  /** What the laptop shows: its church, its linked admin, its name, and when it last reached the server. Refuses revoked tokens. */
  const status = safely(async (event) => {
    if (event.httpMethod !== 'GET') return json(405, { error: 'Use GET.' }, { Allow: 'GET' });
    const device = await deviceFrom({ sql, secret }, bearerToken(event.headers));
    if (!device) return json(401, { error: 'This laptop is not linked to a church. Link it again.' });
    const at = now().toISOString();
    await sql`UPDATE device_tokens SET last_seen_at = ${at} WHERE device_id = ${device.device_id}`;
    const rows = await sql`
      SELECT c.name AS church_name, u.display_name AS admin_name
      FROM churches c LEFT JOIN users u ON u.id = ${device.user_id}
      WHERE c.id = ${device.church_id}`;
    return json(200, {
      churchName: rows[0]?.church_name ?? '',
      adminName: rows[0]?.admin_name ?? null,
      deviceLabel: device.device_name,
      lastSeenAt: at,
    });
  });

  /**
   * Unlinks a laptop. The laptop revokes its own token (Bearer). An admin on the website can revoke a laptop of their church
   * by its device id. Either way the revocation is audited.
   */
  const unlink = safely(async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' }, { Allow: 'POST' });
    const token = bearerToken(event.headers);
    if (token) {
      const device = await deviceFrom({ sql, secret }, token);
      if (!device) return json(401, { error: 'This laptop is not linked to a church.' });
      await transaction(async (tx) => {
        await tx`UPDATE device_tokens SET revoked_at = ${now().toISOString()} WHERE device_id = ${device.device_id}`;
        await tx`INSERT INTO audit_log (church_id, actor_user_id, action) VALUES (${device.church_id}, ${device.user_id}, 'device.unlinked')`;
      });
      return json(200, { ok: true });
    }
    const who = await session(event);
    if (!who) return json(401, { error: 'Sign in first.' });
    if (who.mustChangePassword) return json(403, { error: 'Change your password first.' });
    if (!ADMIN_ROLES.includes(who.role)) return json(403, { error: 'Only a church admin can unlink a laptop.' });
    const body = parseJson(event);
    const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : '';
    if (!/^[0-9a-f-]{36}$/i.test(deviceId)) return json(400, { error: 'Choose a laptop to unlink.' });
    await transaction(async (tx) => {
      const revoked = await tx`
        UPDATE device_tokens SET revoked_at = ${now().toISOString()}
        WHERE device_id = ${deviceId} AND church_id = ${who.churchId} AND revoked_at IS NULL
        RETURNING device_id`;
      if (!revoked.length) throw new ApiError(404, 'That laptop is not linked to your church.');
      await tx`INSERT INTO audit_log (church_id, actor_user_id, action) VALUES (${who.churchId}, ${who.userId}, 'device.unlinked')`;
    });
    return json(200, { ok: true });
  });

  return { createCode, redeem, status, unlink };
}

// Creates a church, its first admin, and this laptop's link in one step, using a one-time setup key the developer issued. The
// request carries no session and no token: the setup key is the only proof, so the whole step is one transaction. Any failure
// rolls back the church, the admin, the link and the key together, so the key stays usable.
import { randomUUID } from 'node:crypto';
import { displayCode, hashToken, normaliseSetupKey, temporaryPassword } from './auth.js';
import { ApiError, insertUser } from './admin.js';
import { bearerToken, deviceFrom } from './device.js';
import { checkDeviceLabel, issueDeviceToken } from './linking.js';
import { checkChurchName, checkDisplayName, checkUsername } from './rules.js';
import { clientAddress } from './client-address.js';
import { hit } from './rate-limit.js';

export const SETUP_LIMIT = { requests: 5, windowMs: 10 * 60 * 1000 };
// One message for every key that cannot be used: malformed, unknown, already used, or expired. So a caller cannot tell them apart.
export const KEY_MESSAGE = 'That setup key is not valid or has already been used.';
export const PERPETUAL_MESSAGE = 'This church already has a perpetual license. Timed keys cannot be applied to perpetual accounts.';
const NOT_LINKED = 'This laptop is not linked to a church. Link it again.';

const DAY_MS = 24 * 60 * 60 * 1000;

/** When the licence ends, as an ISO string, or null when it is perpetual (license_days is null or 0). */
const licenseExpiry = (days, from) => (days > 0 ? new Date(from.getTime() + days * DAY_MS).toISOString() : null);

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

/** A display code that no church has yet. Tried a few times; a clash is very unlikely. */
async function freeDisplayCode(tx) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = displayCode();
    const taken = await tx`SELECT 1 FROM churches WHERE display_code = ${code}`;
    if (!taken.length) return code;
  }
  throw new Error('no free display code');
}

/**
 * The end date after a renewal of a timed license. A perpetual key (no days, or 0) makes it perpetual. Time on a license still running is added
 * to its end, so renewing early loses nothing. An expired license starts from now.
 */
function renewedExpiry(days, current, at) {
  if (!(days > 0)) return null;
  return licenseExpiry(days, new Date(current) > at ? new Date(current) : at);
}

/**
 * Renews a church's license from a linked laptop, using a one-time setup key. The church comes from the device token, never from the request.
 * The linking admin must still be active. Any failure rolls back, so the key stays usable.
 */
export function createChurchRenewApi({ sql, transaction, secret, now = () => new Date() }) {
  return async function renewChurch(event) {
    try {
      if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' }, { Allow: 'POST' });
      const token = bearerToken(event.headers);
      if (!token) return json(401, { error: NOT_LINKED });
      // Limited per laptop, by a keyed hash of its token, so a linked laptop cannot be used to guess keys quickly.
      const gate = await hit(sql, `renew:${hashToken(token, secret)}`, SETUP_LIMIT.requests, SETUP_LIMIT.windowMs / 1000, now());
      if (!gate.allowed) {
        return json(429, { error: 'Too many attempts. Wait ten minutes and try again.' }, { 'Retry-After': String(gate.retryAfterSeconds) });
      }
      const device = await deviceFrom({ sql, secret }, token);
      if (!device) return json(401, { error: NOT_LINKED });
      const key = normaliseSetupKey(parseJson(event)?.setupKey);
      if (!key) throw new ApiError(400, KEY_MESSAGE);

      const licenseExpiresAt = await transaction(async (tx) => {
        const linked = device.user_id ? await tx`SELECT role, disabled FROM users WHERE id = ${device.user_id} AND church_id = ${device.church_id} FOR UPDATE` : [];
        if (!linked.length || linked[0].role !== 'admin' || linked[0].disabled) throw new ApiError(403, 'Only an active admin can renew the license from this laptop.');

        const keyHash = hashToken(key, secret);
        const rows = await tx`SELECT expires_at, used_at, license_days FROM setup_keys WHERE key_hash = ${keyHash} FOR UPDATE`;
        const row = rows[0];
        if (!row || row.used_at || new Date(row.expires_at) <= now()) throw new ApiError(400, KEY_MESSAGE);

        // Locked, so two renewals at once both count.
        const church = await tx`SELECT license_expires_at FROM churches WHERE id = ${device.church_id} FOR UPDATE`;
        const current = church[0]?.license_expires_at ?? null;
        // Thrown inside the transaction, so the key stays unused and can go to another church.
        if (current === null && row.license_days > 0) throw new ApiError(400, PERPETUAL_MESSAGE);
        const next = renewedExpiry(row.license_days, current, now());
        await tx`UPDATE churches SET license_expires_at = ${next} WHERE id = ${device.church_id}`;
        // The key's row is the record of the renewal: when it was used, and by which church.
        await tx`UPDATE setup_keys SET used_at = ${now().toISOString()}, church_id = ${device.church_id} WHERE key_hash = ${keyHash}`;
        return next;
      });
      return json(200, { ok: true, licenseExpiresAt });
    } catch (err) {
      if (err instanceof ApiError) return json(err.status, { error: err.message });
      // Logs the kind of error only: never the key or the token.
      console.error(`[church-renew] ${err.name}`);
      return json(500, { error: 'Something went wrong. Try again.' });
    }
  };
}

export function createChurchSetupApi({ sql, transaction, secret, now = () => new Date() }) {
  return async function setupChurchAdmin(event) {
    try {
      if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' }, { Allow: 'POST' });
      // Limited per address before anything else, so a guessed key cannot be tried quickly. Every attempt counts, good or bad.
      const gate = await hit(sql, `setup:${clientAddress(event)}`, SETUP_LIMIT.requests, SETUP_LIMIT.windowMs / 1000, now());
      if (!gate.allowed) {
        return json(429, { error: 'Too many attempts. Wait ten minutes and try again.' }, { 'Retry-After': String(gate.retryAfterSeconds) });
      }
      const body = parseJson(event);
      if (!body) return json(400, { error: 'Check what you typed and try again.' });

      const key = normaliseSetupKey(body.setupKey);
      if (!key) throw new ApiError(400, KEY_MESSAGE);
      const churchName = typeof body.churchName === 'string' ? body.churchName.trim() : '';
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
      const deviceLabel = typeof body.deviceLabel === 'string' ? body.deviceLabel.trim() : '';
      const problem = checkChurchName(churchName) ?? checkUsername(username) ?? checkDisplayName(displayName) ?? checkDeviceLabel(deviceLabel);
      if (problem) throw new ApiError(400, problem);

      const temporary = temporaryPassword();
      const created = await transaction(async (tx) => {
        const keyHash = hashToken(key, secret);
        const rows = await tx`SELECT expires_at, used_at, license_days FROM setup_keys WHERE key_hash = ${keyHash} FOR UPDATE`;
        const row = rows[0];
        if (!row || row.used_at || new Date(row.expires_at) <= now()) throw new ApiError(400, KEY_MESSAGE);

        const churchId = randomUUID();
        const code = await freeDisplayCode(tx);
        const licenseExpiresAt = licenseExpiry(row.license_days, now());
        await tx`INSERT INTO churches (id, display_code, name, license_expires_at) VALUES (${churchId}, ${code}, ${churchName}, ${licenseExpiresAt})`;
        await tx`INSERT INTO audit_log (church_id, actor_user_id, action) VALUES (${churchId}, NULL, 'church.created')`;
        const admin = await insertUser(tx, {
          churchId,
          actorId: null,
          username,
          displayName,
          role: 'admin',
          password: temporary,
          mustChange: true,
        });
        const token = await issueDeviceToken(tx, { churchId, userId: admin.id, label: deviceLabel, secret, now });
        await tx`UPDATE setup_keys SET used_at = ${now().toISOString()}, church_id = ${churchId} WHERE key_hash = ${keyHash}`;
        return { token, code, licenseExpiresAt };
      });

      // The raw token and the password leave the server in this one response only.
      return json(201, {
        token: created.token,
        churchName,
        displayCode: created.code,
        username,
        displayName,
        deviceLabel,
        temporaryPassword: temporary,
        licenseExpiresAt: created.licenseExpiresAt,
      });
    } catch (err) {
      if (err instanceof ApiError) return json(err.status, { error: err.message });
      // Logs the kind of error only: never the key, the password or the request body.
      console.error(`[church-setup] ${err.name}`);
      return json(500, { error: 'Something went wrong. Try again.' });
    }
  };
}

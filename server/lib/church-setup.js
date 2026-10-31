// Creates a church, its first admin, and this laptop's link in one step, using a one-time setup key the developer issued. The
// request carries no session and no token: the setup key is the only proof, so the whole step is one transaction. Any failure
// rolls back the church, the admin, the link and the key together, so the key stays usable.
import { randomUUID } from 'node:crypto';
import { displayCode, hashToken, normaliseSetupKey, temporaryPassword } from './auth.js';
import { ApiError, insertUser } from './admin.js';
import { checkDeviceLabel, issueDeviceToken } from './linking.js';
import { checkChurchName, checkDisplayName, checkUsername } from './rules.js';
import { clientAddress } from './client-address.js';
import { hit } from './rate-limit.js';

export const SETUP_LIMIT = { requests: 5, windowMs: 10 * 60 * 1000 };
// One message for every key that cannot be used: malformed, unknown, already used, or expired. So a caller cannot tell them apart.
export const KEY_MESSAGE = 'That setup key is not valid or has already been used.';

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
        const rows = await tx`SELECT expires_at, used_at FROM setup_keys WHERE key_hash = ${keyHash} FOR UPDATE`;
        const row = rows[0];
        if (!row || row.used_at || new Date(row.expires_at) <= now()) throw new ApiError(400, KEY_MESSAGE);

        const churchId = randomUUID();
        const code = await freeDisplayCode(tx);
        await tx`INSERT INTO churches (id, display_code, name) VALUES (${churchId}, ${code}, ${churchName})`;
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
        return { token, code };
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
      });
    } catch (err) {
      if (err instanceof ApiError) return json(err.status, { error: err.message });
      // Logs the kind of error only: never the key, the password or the request body.
      console.error(`[church-setup] ${err.name}`);
      return json(500, { error: 'Something went wrong. Try again.' });
    }
  };
}

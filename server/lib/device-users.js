// Adds a web user from a linked laptop. The laptop holds only its device token. The church comes from that token, never from the
// request, and the linking admin must still be an active admin of that church when the account is written. The account rules
// (names, role, duplicate usernames, the audit line) are not repeated here: they live in `addUser` in lib/admin.js, which the
// web Users screen uses too.
import { bearerToken, deviceFrom } from './device.js';
import { ApiError } from './admin.js';
import { DEVICE_LIMIT } from './app-admin.js';
import { hashToken } from './auth.js';
import { hit } from './rate-limit.js';

const NOT_ADMIN = 'Only an active admin can add web users from this laptop.';

const json = (statusCode, body, extraHeaders = {}) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  body: JSON.stringify(body),
});

function parseJson(event) {
  try {
    const parsed = JSON.parse(event.body ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** `addUser` comes from createAdminApi, so the account rules are the same as on the web. */
export function createDeviceUsersApi({ sql, secret, addUser, now = () => new Date() }) {
  return async function createWebUser(event) {
    try {
      if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' }, { Allow: 'POST' });
      const token = bearerToken(event.headers);
      if (!token) return json(401, { error: 'This laptop is not linked to a church.' });
      // Limited per laptop, by a keyed hash of its token, so a stolen or guessed token cannot flood the database.
      const gate = await hit(sql, `device:${hashToken(token, secret)}`, DEVICE_LIMIT.requests, DEVICE_LIMIT.windowMs / 1000, now());
      if (!gate.allowed) {
        return json(429, { error: 'Too many requests from this laptop. Wait a minute and try again.' }, { 'Retry-After': String(gate.retryAfterSeconds) });
      }
      const device = await deviceFrom({ sql, secret }, token);
      if (!device) return json(401, { error: 'This laptop is not linked to a church.' });

      const body = parseJson(event);
      const created = await addUser({
        churchId: device.church_id,
        actorId: device.user_id,
        username: typeof body.username === 'string' ? body.username.trim() : '',
        displayName: typeof body.displayName === 'string' ? body.displayName.trim() : '',
        role: body.role,
        // Runs inside the same transaction as the write, and locks the linking admin's row, so an admin disabled a moment
        // earlier cannot still add a user.
        authorise: async (tx) => {
          if (!device.user_id) throw new ApiError(403, NOT_ADMIN);
          const linked = await tx`SELECT role, disabled FROM users WHERE id = ${device.user_id} AND church_id = ${device.church_id} FOR UPDATE`;
          if (!linked.length || linked[0].role !== 'admin' || linked[0].disabled) throw new ApiError(403, NOT_ADMIN);
        },
      });
      return json(201, created);
    } catch (err) {
      if (err instanceof ApiError) return json(err.status, { error: err.message });
      console.error(`[device-users] ${err.name}`);
      return json(500, { error: 'Something went wrong. Try again.' });
    }
  };
}

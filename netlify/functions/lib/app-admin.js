// Creates a web planner account from the desktop app. The app holds only its device token, never a database string. The
// church comes from the device token and never from the request body.
//
// Two ways to create an account:
//  - Setup (setup: true): only while the device's setup window is open, and only when the church has no active admin yet.
//    The new account is an admin.
//  - Otherwise: the admin who linked this laptop must be an active admin of the church, and the new account gets the role
//    asked for.
// The account is written in one transaction that locks the church's active admins, so two setups cannot both succeed.
import { hashPassword, hashToken, temporaryPassword } from './auth.js';
import { bearerToken, deviceFrom } from './device.js';
import { ApiError } from './admin.js';
import { checkDisplayName, checkNewPassword, checkUsername, ROLES } from './rules.js';
import { hit } from './rate-limit.js';

export const DEVICE_LIMIT = { requests: 10, windowMs: 60 * 1000 };

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

export function createAppAdminApi({ sql, transaction, secret, now = () => new Date() }) {
  /** The linked laptop for this token, from the shared device lookup. */
  const deviceFor = (token) => deviceFrom({ sql, secret }, token);

  /** Runs the request. A refusal is returned as its status and message; anything else is a plain 500. */
  return async function createFromApp(event) {
    try {
      if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' }, { Allow: 'POST' });
      const token = bearerToken(event.headers);
      if (!token) return json(401, { error: 'This laptop is not linked to a church.' });
      // Limited per laptop, by a keyed hash of its token, so a stolen or guessed token cannot flood the database.
      const gate = await hit(sql, `device:${hashToken(token, secret)}`, DEVICE_LIMIT.requests, DEVICE_LIMIT.windowMs / 1000, now());
      if (!gate.allowed) {
        return json(429, { error: 'Too many requests from this laptop. Wait a minute and try again.' }, { 'Retry-After': String(gate.retryAfterSeconds) });
      }
      const device = await deviceFor(token);
      if (!device) return json(401, { error: 'This laptop is not linked to a church.' });

      const body = parseJson(event);
      const username = typeof body?.username === 'string' ? body.username.trim() : '';
      const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : '';
      const supplied = typeof body?.password === 'string' && body.password !== '' ? body.password : null;
      const setup = body?.setup === true;
      const role = setup ? 'admin' : body?.role;
      const problem = checkUsername(username) ?? checkDisplayName(displayName) ?? (supplied ? checkNewPassword(supplied) : null);
      if (problem) return json(400, { error: problem });
      if (!setup && !ROLES.includes(role)) return json(400, { error: 'Choose a role: admin, planner or viewer.' });

      const church = device.church_id;
      const temporary = supplied ? null : temporaryPassword();
      const created = await transaction(async (tx) => {
        // Locks the church's active admins first, so the setup check and the write are one step.
        const admins = await tx`
          SELECT id FROM users WHERE church_id = ${church} AND role = 'admin' AND disabled = false FOR UPDATE`;
        if (setup) {
          if (!device.setup_until || new Date(device.setup_until) <= now()) {
            throw new ApiError(403, 'This laptop was not linked during church setup, so it cannot create the first admin.');
          }
          if (admins.length > 0) throw new ApiError(409, 'This church already has an admin. Ask an existing admin to add this account.');
        } else {
          if (!device.user_id) throw new ApiError(403, 'This laptop is not linked to an admin, so it cannot create web accounts.');
          const linked = await tx`SELECT role, disabled FROM users WHERE id = ${device.user_id} AND church_id = ${church}`;
          if (!linked.length || linked[0].role !== 'admin' || linked[0].disabled) {
            throw new ApiError(403, 'Only an active admin of this church can create web accounts.');
          }
        }
        const taken = await tx`SELECT 1 FROM users WHERE church_id = ${church} AND lower(username) = lower(${username})`;
        if (taken.length) throw new ApiError(409, 'That username is already used in this church.');

        // The first admin can keep the password they chose. Every other account must change its password at first sign-in.
        const mustChange = !(setup && supplied);
        const rows = await tx`
          INSERT INTO users (id, church_id, username, display_name, role, password_hash, must_change_password)
          VALUES (gen_random_uuid(), ${church}, ${username}, ${displayName}, ${role},
                  ${await hashPassword(supplied ?? temporary)}, ${mustChange})
          RETURNING id`;
        await tx`
          INSERT INTO audit_log (church_id, actor_user_id, action, target_user_id)
          VALUES (${church}, ${setup ? null : device.user_id}, 'user.created', ${rows[0].id})`;
        return rows[0];
      });

      return json(201, {
        user: { id: created.id, username, displayName, role, status: 'active', lastSignInAt: null },
        // Shown once, to the person creating the account. Only the create response ever carries it.
        ...(temporary ? { temporaryPassword: temporary } : {}),
      });
    } catch (err) {
      if (err instanceof ApiError) return json(err.status, { error: err.message });
      console.error(`[app-admin] ${err.name}`);
      return json(500, { error: 'Something went wrong. Try again.' });
    }
  };
}

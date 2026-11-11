// The sign-in API: login, logout, me, change-password, and one planner-only route. Each handler takes a handler event
// and returns { statusCode, headers, body }. `sql` is a tagged-template query function (Neon in production, PGlite in tests),
// so every query here is parameterised. Nothing here logs a password, a token or a database string.
import { hashPassword, verifyPassword, newToken, hashToken, readCookie, sessionCookie, clearedCookie, SESSION_HOURS, lowerHeaders } from './auth.js';
import { sessionFrom as loadSession } from './session.js';
import { clientAddress } from './client-address.js';
import { dateText } from './plan-editing.js';
import { hit } from './rate-limit.js';
import {
  CHANGE_PASSWORD_LIMIT,
  LOCK_MINUTES,
  LOGIN_LIMIT,
  MAX_FAILED_ATTEMPTS,
  checkNewPassword,
  isLocked,
  lockMinutesLeft,
  lockMessage,
} from './rules.js';

const GENERIC_LOGIN_ERROR = 'Username or password is incorrect.';
const SESSION_MS = SESSION_HOURS * 60 * 60 * 1000;

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

/**
 * Builds the API. `now` is injectable so the tests can move time. The sign-in rate limit per address and the account lockout
 * are both kept in the database, so they hold across every function instance.
 */
export function createApi({ sql, secret, now = () => new Date() }) {
  // A real hash of a made-up password, so an unknown or locked account takes as long to refuse as a wrong password.
  let dummyHash = null;
  const burnTime = async (password) => {
    dummyHash ??= await hashPassword('timing-only-not-a-real-password');
    await verifyPassword(password, dummyHash);
  };

  /** The signed-in user for this request, from the session cookie. Null when there is no valid session. */
  const sessionFrom = (event) => loadSession({ sql, secret, now }, event);

  const publicUser = (s) => ({ username: s.username, displayName: s.displayName, role: s.role, mustChangePassword: s.mustChangePassword });

  /** Runs a handler, turning any unexpected failure into a plain 500 that reveals nothing about the cause. */
  const safely = (handler) => async (event) => {
    try {
      return await handler(event);
    } catch (err) {
      // Only the error's name is logged. Its message can contain query text, so it is left out.
      console.error(`[auth] ${err.name}`);
      return json(500, { error: 'Something went wrong. Try again.' });
    }
  };

  const login = safely(async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' }, { Allow: 'POST' });
    const gate = await hit(sql, `login:${clientAddress(event)}`, LOGIN_LIMIT.requests, LOGIN_LIMIT.windowMs / 1000, now());
    if (!gate.allowed) {
      return json(429, { error: 'Too many sign-in attempts. Wait a minute and try again.' }, { 'Retry-After': String(gate.retryAfterSeconds) });
    }
    const body = parseJson(event);
    const username = typeof body?.username === 'string' ? body.username.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    const churchCode = typeof body?.churchCode === 'string' && body.churchCode.trim() ? body.churchCode.trim().toUpperCase() : null;
    if (!username || !password) return json(400, { error: 'Enter your username and password.' });

    const rows = await sql`
      SELECT u.id, u.church_id, u.display_name, u.role, u.password_hash, u.must_change_password, u.disabled,
             u.failed_attempts, u.locked_until, c.display_code, c.name AS church_name
      FROM users u JOIN churches c ON c.id = u.church_id
      WHERE lower(u.username) = lower(${username})
        AND (${churchCode}::text IS NULL OR c.display_code = ${churchCode}::text)`;

    // Unknown, or the same username in more than one church with no church code: refused as a wrong password would be.
    if (rows.length !== 1) {
      await burnTime(password);
      return json(401, { error: GENERIC_LOGIN_ERROR });
    }
    const user = rows[0];
    const at = now();

    if (user.disabled) {
      await sql`DELETE FROM sessions WHERE user_id = ${user.id}`;
      await burnTime(password);
      return json(401, { error: GENERIC_LOGIN_ERROR });
    }
    // A locked account is refused without checking the password, so five more guesses cannot be tried during the lock.
    // The lock message is shown only for an account that exists, which the spec accepts; it gives the minutes left.
    if (isLocked(user, at)) {
      await burnTime(password);
      return json(423, { error: lockMessage(lockMinutesLeft(user.locked_until, at)), minutesLeft: lockMinutesLeft(user.locked_until, at) });
    }

    // Each guess is counted before its password is checked, in one statement, so parallel guesses cannot all read the same count and
    // slip past the limit. The guess that reaches the limit sets the lock at once; a guess made after that gets no row back here.
    const lockEnd = new Date(at.getTime() + LOCK_MINUTES * 60 * 1000).toISOString();
    const claimed = await sql`
      UPDATE users SET
        failed_attempts = failed_attempts + 1,
        locked_until = CASE WHEN failed_attempts + 1 >= ${MAX_FAILED_ATTEMPTS} THEN ${lockEnd}::timestamptz ELSE NULL END
      WHERE id = ${user.id} AND (locked_until IS NULL OR locked_until <= ${at.toISOString()}::timestamptz)
      RETURNING failed_attempts`;
    if (!claimed.length) {
      const [current] = await sql`SELECT locked_until FROM users WHERE id = ${user.id}`;
      const minutes = current?.locked_until && new Date(current.locked_until) > at ? lockMinutesLeft(current.locked_until, at) : LOCK_MINUTES;
      await burnTime(password);
      return json(423, { error: lockMessage(minutes), minutesLeft: minutes });
    }

    if (!(await verifyPassword(password, user.password_hash))) {
      // The guess that reached the limit says so, and the count starts again for after the lock. Every other failure gets the wrong-password message.
      if (Number(claimed[0].failed_attempts) >= MAX_FAILED_ATTEMPTS) {
        await sql`UPDATE users SET failed_attempts = 0 WHERE id = ${user.id}`;
        return json(423, { error: lockMessage(LOCK_MINUTES), minutesLeft: LOCK_MINUTES });
      }
      return json(401, { error: GENERIC_LOGIN_ERROR });
    }

    // Success: the failure count resets, and a session starts.
    const token = newToken();
    const expires = new Date(at.getTime() + SESSION_MS);
    await sql`UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ${at.toISOString()} WHERE id = ${user.id}`;
    await sql`
      INSERT INTO sessions (token_hash, user_id, church_id, expires_at, created_at)
      VALUES (${hashToken(token, secret)}, ${user.id}, ${user.church_id}, ${expires.toISOString()}, ${at.toISOString()})`;
    // The church's display code and name are returned so the browser can remember them for next time: the sign-in page then
    // shows "✓ <church name>" when that code is typed again. Neither is a secret, and both are sent only after a correct password,
    // so nobody can use this to find out which codes exist.
    return json(
      200,
      {
        user: { displayName: user.display_name, role: user.role, mustChangePassword: user.must_change_password },
        churchCode: user.display_code,
        churchName: user.church_name,
      },
      { 'Set-Cookie': sessionCookie(token) },
    );
  });

  const logout = safely(async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' }, { Allow: 'POST' });
    const token = readCookie(lowerHeaders(event.headers).cookie);
    if (token) await sql`DELETE FROM sessions WHERE token_hash = ${hashToken(token, secret)}`;
    return json(200, { ok: true }, { 'Set-Cookie': clearedCookie() });
  });

  const me = safely(async (event) => {
    if (event.httpMethod !== 'GET') return json(405, { error: 'Use GET.' }, { Allow: 'GET' });
    const session = await sessionFrom(event);
    if (!session) return json(401, { error: 'Sign in first.' });
    // The signed-in user's church name, so every page names the parish instead of a fixed one. Taken from the session's church only.
    const [church] = await sql`SELECT name FROM churches WHERE id = ${session.churchId}`;
    return json(200, { user: publicUser(session), church: { name: church?.name ?? '' } });
  });

  const changePassword = safely(async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' }, { Allow: 'POST' });
    const session = await sessionFrom(event);
    if (!session) return json(401, { error: 'Sign in first.' });
    // Limited per account, so a browser left signed in cannot be used to guess the password behind it.
    const gate = await hit(sql, `password:${session.userId}`, CHANGE_PASSWORD_LIMIT.requests, CHANGE_PASSWORD_LIMIT.windowMs / 1000, now());
    if (!gate.allowed) {
      return json(429, { error: 'Too many attempts. Wait a few minutes and try again.' }, { 'Retry-After': String(gate.retryAfterSeconds) });
    }
    const body = parseJson(event);
    const current = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
    const next = typeof body?.newPassword === 'string' ? body.newPassword : '';
    const problem = checkNewPassword(next);
    if (problem) return json(400, { error: problem });
    if (!current) return json(400, { error: 'Enter your current password.' });

    const rows = await sql`SELECT password_hash FROM users WHERE id = ${session.userId}`;
    if (!rows[0] || !(await verifyPassword(current, rows[0].password_hash))) {
      return json(401, { error: 'Your current password is not correct.' });
    }
    // A temporary password is known to the admin who made it, so "changing" it to itself would leave the account with a shared password.
    if (next === current) return json(400, { error: 'Choose a new password that is different from your current one.' });
    const token = readCookie(lowerHeaders(event.headers).cookie);
    await sql`UPDATE users SET password_hash = ${await hashPassword(next)}, must_change_password = false WHERE id = ${session.userId}`;
    // The other sessions of this user end, so a password change signs out any other browser. This one stays signed in.
    await sql`DELETE FROM sessions WHERE user_id = ${session.userId} AND token_hash <> ${hashToken(token, secret)}`;
    return json(200, { ok: true });
  });

  /**
   * A planner-only route: the church's plans. The church is the signed-in user's church, never one named in the request.
   * A user who must still change their password is refused until they do.
   */
  const plans = safely(async (event) => {
    if (event.httpMethod !== 'GET') return json(405, { error: 'Use GET.' }, { Allow: 'GET' });
    const session = await sessionFrom(event);
    if (!session) return json(401, { error: 'Sign in first.' });
    if (session.mustChangePassword) return json(403, { error: 'Change your password before using the planner.' });
    // Every signed-in role can list the church's plans. The body is not sent, so the list stays light. `kind` says which editor
    // a plan opens in, and is read from the body without sending it.
    const rows = await sql`
      SELECT id, name, liturgical_date, updated_at, synced_at, body->>'kind' AS kind FROM plans
      WHERE church_id = ${session.churchId} AND COALESCE(body->>'deleted', '') <> 'true'
      ORDER BY liturgical_date, name, id`;
    const plans = rows.map((r) => ({
      id: r.id,
      name: r.name,
      liturgical_date: dateText(r.liturgical_date),
      updated_at: new Date(r.updated_at).toISOString(),
      synced_at: r.synced_at ? new Date(r.synced_at).toISOString() : null,
      kind: r.kind ?? null,
    }));
    return json(200, plans.length ? { plans } : { plans, message: 'No plans yet. Plans are created on the church laptop and appear here after sync.' });
  });

  return { login, logout, me, changePassword, plans, sessionFrom };
}

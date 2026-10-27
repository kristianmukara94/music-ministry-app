// User management for church admins: list, add, change role or disable, reset a password, unlock. Every query is filtered
// by the caller's church, taken from the caller's session. A temporary password is returned only by the create and reset
// responses, and never stored in plain text or written to the audit log.
//
// The last-admin rule lives in one place: `adminChange`. Every change that could remove an admin's active status runs inside
// a transaction that first locks the church's active admin rows, so two changes in the same church queue behind each other.
import { hashPassword, temporaryPassword } from './auth.js';
import { sessionFrom } from './session.js';
import { ADMIN_ROLES, ROLES, checkDisplayName, checkUsername, isLocked } from './rules.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LAST_ADMIN_MESSAGE = 'A church must keep at least one active admin.';

/** A refusal the caller turns into a plain response. Thrown inside a transaction, it rolls the whole change back. */
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
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

/** Active, disabled or locked, as the Users screen shows it. */
export const statusOf = (user, at) => (user.disabled ? 'disabled' : isLocked(user, at) ? 'locked' : 'active');

/**
 * `transaction(work)` runs `work(tx)` in one database transaction, where `tx` is a query tag. It commits when `work`
 * returns, and rolls back when it throws. The production and test databases each provide one.
 */
export function createAdminApi({ sql, transaction, secret, now = () => new Date() }) {
  /**
   * The gate every user-management route passes first. Returns { session } for an active admin, or { response } with the
   * refusal: 401 with no session, 403 for a planner or viewer, and 403 while a temporary password is still in use.
   */
  async function adminOnly(event, method) {
    if (event.httpMethod !== method) return { response: json(405, { error: `Use ${method}.` }, { Allow: method }) };
    const session = await sessionFrom({ sql, secret, now }, event);
    if (!session) return { response: json(401, { error: 'Sign in first.' }) };
    if (session.mustChangePassword) return { response: json(403, { error: 'Change your password before using the planner.' }) };
    if (!ADMIN_ROLES.includes(session.role)) return { response: json(403, { error: 'Only a church admin can manage users.' }) };
    return { session };
  }

  /** Every change writes one row here: what was done, by whom, to whom. It holds no passwords. */
  const audit = (tx, churchId, actorId, action, targetId) =>
    tx`INSERT INTO audit_log (church_id, actor_user_id, action, target_user_id) VALUES (${churchId}, ${actorId}, ${action}, ${targetId})`;

  /** A user id from the request, checked for shape before it reaches a query. Null when it is not one. */
  const userIdFrom = (body) => (typeof body?.userId === 'string' && UUID.test(body.userId) ? body.userId : null);

  /**
   * THE last-admin rule. Locks the church's active admin rows, reads the target, works out its new state with `nextState`,
   * and refuses (rolling back) if the change would leave the church with no active admin. Otherwise `write` makes the change
   * inside the same transaction. Every admin change goes through here.
   */
  async function adminChange(churchId, userId, nextState, write) {
    return transaction(async (tx) => {
      const activeAdmins = await tx`
        SELECT id FROM users WHERE church_id = ${churchId} AND role = 'admin' AND disabled = false FOR UPDATE`;
      const found = await tx`SELECT id, role, disabled FROM users WHERE id = ${userId} AND church_id = ${churchId}`;
      if (!found.length) throw new ApiError(404, 'That user is not in your church.');
      const target = found[0];
      const next = nextState(target);
      const wasActiveAdmin = target.role === 'admin' && !target.disabled;
      const stillActiveAdmin = next.role === 'admin' && !next.disabled;
      const othersActive = activeAdmins.filter((a) => a.id !== userId).length;
      if (wasActiveAdmin && !stillActiveAdmin && othersActive === 0) throw new ApiError(409, LAST_ADMIN_MESSAGE);
      await write(tx, target, next);
      return next;
    });
  }

  /** Runs a handler, mapping a refusal to its status and any other failure to a plain 500 that reveals nothing. */
  const safely = (handler) => async (event) => {
    try {
      return await handler(event);
    } catch (err) {
      if (err instanceof ApiError) return json(err.status, { error: err.message });
      console.error(`[users] ${err.name}`);
      return json(500, { error: 'Something went wrong. Try again.' });
    }
  };

  const list = safely(async (event) => {
    const gate = await adminOnly(event, 'GET');
    if (gate.response) return gate.response;
    const rows = await sql`
      SELECT id, username, display_name, role, disabled, locked_until, last_login_at
      FROM users WHERE church_id = ${gate.session.churchId}
      ORDER BY lower(display_name), id`;
    const at = now();
    return json(200, {
      users: rows.map((r) => ({
        id: r.id,
        username: r.username,
        displayName: r.display_name,
        role: r.role,
        status: statusOf(r, at),
        lastSignInAt: r.last_login_at ? new Date(r.last_login_at).toISOString() : null,
      })),
    });
  });

  /**
   * Adds a user to a church. This is the one place that checks a new user's name, username and role, refuses a username
   * already used in the church, and writes the account and its audit line. The web Users screen and the desktop app both come
   * through here, so the rules are the same. `authorise(tx)`, when given, runs first inside the same transaction and may
   * throw to refuse. Returns the new user and the temporary password, which is shown once and never stored in plain text.
   */
  const addUser = async ({ churchId, actorId, username, displayName, role, authorise }) => {
    const temporary = temporaryPassword();
    const created = await transaction(async (tx) => {
      if (authorise) await authorise(tx);
      const problem = checkUsername(username) ?? checkDisplayName(displayName);
      if (problem) throw new ApiError(400, problem);
      if (!ROLES.includes(role)) throw new ApiError(400, 'Choose a role: admin, planner or viewer.');
      const taken = await tx`SELECT 1 FROM users WHERE church_id = ${churchId} AND lower(username) = lower(${username})`;
      if (taken.length) throw new ApiError(409, 'That username is already used in this church.');
      const rows = await tx`
        INSERT INTO users (id, church_id, username, display_name, role, password_hash, must_change_password)
        VALUES (gen_random_uuid(), ${churchId}, ${username}, ${displayName}, ${role}, ${await hashPassword(temporary)}, true)
        RETURNING id`;
      await audit(tx, churchId, actorId, 'user.created', rows[0].id);
      return rows[0];
    });
    return {
      user: { id: created.id, username, displayName, role, status: 'active', lastSignInAt: null },
      temporaryPassword: temporary,
    };
  };

  /** A new user from a signed-in admin. Creating a user never removes an admin, so it needs no admin lock. */
  const create = safely(async (event) => {
    const gate = await adminOnly(event, 'POST');
    if (gate.response) return gate.response;
    const body = parseJson(event);
    const username = typeof body?.username === 'string' ? body.username.trim() : '';
    const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : '';
    const { churchId, userId } = gate.session;
    return json(201, await addUser({ churchId, actorId: userId, username, displayName, role: body?.role }));
  });

  /**
   * Changes a user's role, or disables or enables them. Goes through `adminChange`, so the last active admin of a church
   * cannot be demoted or disabled, even by two admins acting at the same moment. Disabling deletes that user's sessions.
   */
  const update = safely(async (event) => {
    const gate = await adminOnly(event, 'POST');
    if (gate.response) return gate.response;
    const body = parseJson(event);
    const userId = userIdFrom(body);
    if (!userId) return json(400, { error: 'Choose a user.' });
    if (body.role !== undefined && !ROLES.includes(body.role)) return json(400, { error: 'Choose a role: admin, planner or viewer.' });
    if (body.disabled !== undefined && typeof body.disabled !== 'boolean') return json(400, { error: 'Disabled must be on or off.' });
    if (body.role === undefined && body.disabled === undefined) return json(400, { error: 'Nothing to change.' });

    const { churchId, userId: actorId } = gate.session;
    await adminChange(
      churchId,
      userId,
      (target) => ({ role: body.role ?? target.role, disabled: body.disabled ?? target.disabled }),
      async (tx, target, next) => {
        await tx`UPDATE users SET role = ${next.role}, disabled = ${next.disabled} WHERE id = ${userId} AND church_id = ${churchId}`;
        if (next.role !== target.role) await audit(tx, churchId, actorId, 'user.role_changed', userId);
        if (next.disabled !== target.disabled) {
          if (next.disabled) await tx`DELETE FROM sessions WHERE user_id = ${userId}`;
          await audit(tx, churchId, actorId, next.disabled ? 'user.disabled' : 'user.enabled', userId);
        }
      },
    );
    return json(200, { ok: true });
  });

  /**
   * A new temporary password, shown once. The user must change it at next sign-in, and their sessions end. This does not
   * change anyone's role or active status, so it needs no admin lock.
   */
  const resetPassword = safely(async (event) => {
    const gate = await adminOnly(event, 'POST');
    if (gate.response) return gate.response;
    const userId = userIdFrom(parseJson(event));
    if (!userId) return json(400, { error: 'Choose a user.' });
    const { churchId, userId: actorId } = gate.session;
    const temporary = temporaryPassword();
    await transaction(async (tx) => {
      const updated = await tx`
        UPDATE users SET password_hash = ${await hashPassword(temporary)}, must_change_password = true
        WHERE id = ${userId} AND church_id = ${churchId}
        RETURNING id`;
      if (!updated.length) throw new ApiError(404, 'That user is not in your church.');
      await tx`DELETE FROM sessions WHERE user_id = ${userId}`;
      await audit(tx, churchId, actorId, 'user.password_reset', userId);
    });
    return json(200, { temporaryPassword: temporary });
  });

  /** Clears a lock: the failure count goes to zero and the lock time is removed. It does not change active status. */
  const unlock = safely(async (event) => {
    const gate = await adminOnly(event, 'POST');
    if (gate.response) return gate.response;
    const userId = userIdFrom(parseJson(event));
    if (!userId) return json(400, { error: 'Choose a user.' });
    const { churchId, userId: actorId } = gate.session;
    await transaction(async (tx) => {
      const updated = await tx`
        UPDATE users SET failed_attempts = 0, locked_until = NULL
        WHERE id = ${userId} AND church_id = ${churchId}
        RETURNING id`;
      if (!updated.length) throw new ApiError(404, 'That user is not in your church.');
      await audit(tx, churchId, actorId, 'user.unlocked', userId);
    });
    return json(200, { ok: true });
  });

  return { list, create, update, resetPassword, unlock, addUser };
}

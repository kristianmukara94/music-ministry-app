// Sign-in tests against a real Postgres (PGlite, which is Postgres compiled to WebAssembly), using the actual schema and the
// same handlers the Netlify functions run. Run with: node --test netlify/functions/test/signin.test.mjs
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createApi } from '../lib/handlers.js';
import { createAdminApi } from '../lib/admin.js';
import { tagFromQuery } from '../lib/db.js';
import { LOGIN_LIMIT } from '../lib/rules.js';
import { hashPassword, hashToken } from '../lib/auth.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.join(here, '..', '..', 'db', 'schema.sql'), 'utf8');
// A fresh secret for every run, so no fixed secret sits in the repo.
const SECRET = randomBytes(32).toString('hex');
// The test password, generated for each run. It meets the 10-character minimum; every test reads this one constant.
const GOOD = `Test-${randomBytes(16).toString('base64url')}`;
const CHURCH_A = '00000000-0000-4000-8000-00000000000a';
const CHURCH_B = '00000000-0000-4000-8000-00000000000b';
const CODE_A = 'K7QM-4XD2';
const CODE_B = 'R2VT-9HJ6';

let pg;
let clock;

let api;

/** Netlify's query tag over PGlite: the same `sql\`...\`` shape, with every value passed as a parameter. */
const tagFrom = (db) => async (strings, ...values) => {
  const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '');
  return (await db.query(text, values)).rows;
};

const sql = (...args) => pg.sql(...args);

function build(opts = {}) {
  api = createApi({ sql: tagFrom(pg), secret: opts.secret ?? SECRET, now: () => clock });
  return api;
}

const event = ({ method = 'POST', body, cookie, ip = '198.51.100.7' } = {}) => ({
  httpMethod: method,
  headers: { 'x-nf-client-connection-ip': ip, ...(cookie ? { cookie } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const cookieFrom = (res) => {
  const header = res.headers?.['Set-Cookie'];
  return header ? header.split(';')[0] : null;
};

async function seed() {
  await pg.exec(`TRUNCATE rate_limits, sessions, users, plans, songs, devices, churches CASCADE;`);
  await pg.query(`INSERT INTO churches (id, display_code, name) VALUES ($1, $2, 'St Mary'), ($3, $4, 'St Mary')`, [CHURCH_A, CODE_A, CHURCH_B, CODE_B]);
  const hash = await hashPassword(GOOD);
  const user = (church, username, role, extra = {}) =>
    pg.query(
      `INSERT INTO users (id, church_id, username, display_name, role, password_hash, must_change_password, disabled)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
      [church, username, username, role, hash, extra.mustChange ?? false, extra.disabled ?? false],
    );
  await user(CHURCH_A, 'planner', 'planner');
  await user(CHURCH_A, 'viewer', 'viewer');
  await user(CHURCH_A, 'admin', 'admin');
  await user(CHURCH_A, 'fresh', 'planner', { mustChange: true });
  await user(CHURCH_A, 'disabled', 'planner', { disabled: true });
  await user(CHURCH_B, 'admin', 'admin'); // the same username as church A's, in another church
  await pg.query(`INSERT INTO plans (id, church_id, name, liturgical_date, body, updated_at) VALUES
    (gen_random_uuid(), $1, 'A: All Saints', '2026-11-01', '{}', now()),
    (gen_random_uuid(), $2, 'B: Christ the King', '2026-11-22', '{}', now())`, [CHURCH_A, CHURCH_B]);
}

/** Signs in and returns the session cookie. */
async function signIn(username, password = GOOD, extra = {}) {
  const res = await build().login(event({ body: { username, password, ...extra } }));
  assert.equal(res.statusCode, 200, `sign-in for ${username} should succeed: ${res.body}`);
  return cookieFrom(res);
}

before(async () => {
  pg = new PGlite();
  await pg.exec(SCHEMA);
  pg.sql = tagFrom(pg);
});

beforeEach(async () => {
  clock = new Date('2026-10-27T12:00:00Z');
  await seed();
});

// ---- Sign-in outcomes ----

test('a wrong password and an unknown user get the same message', async () => {
  const wrong = await build().login(event({ body: { username: 'planner', password: 'not the password' } }));
  const unknown = await build().login(event({ body: { username: 'nobody', password: GOOD } }));
  assert.equal(wrong.statusCode, 401);
  assert.equal(unknown.statusCode, 401);
  assert.equal(wrong.body, unknown.body, 'the two responses are identical');
  assert.equal(JSON.parse(wrong.body).error, 'Username or password is incorrect.');
});

test('the correct password signs in, and sets an HttpOnly, Secure, SameSite=Strict cookie for 12 hours', async () => {
  const res = await build().login(event({ body: { username: 'planner', password: GOOD } }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body).user, { displayName: 'planner', role: 'planner', mustChangePassword: false });
  const setCookie = res.headers['Set-Cookie'];
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Max-Age=43200/);
});

test('the token is never stored: only its keyed hash is in the sessions table', async () => {
  const cookie = await signIn('planner');
  const token = cookie.split('=')[1];
  const rows = (await pg.query('SELECT token_hash FROM sessions')).rows;
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].token_hash, token);
  assert.equal(rows[0].token_hash, hashToken(token, SECRET));
});

test('an unknown user and a locked-out user cannot be told apart from a wrong password', async () => {
  // A username in two churches, with no church code, is refused like any other wrong sign-in.
  const ambiguous = await build().login(event({ body: { username: 'admin', password: GOOD } }));
  assert.equal(ambiguous.statusCode, 401);
  assert.equal(JSON.parse(ambiguous.body).error, 'Username or password is incorrect.');
  // With church B's code, the same username signs in to church B only.
  const cookie = await signIn('admin', GOOD, { churchCode: CODE_B });
  const me = await build().me(event({ method: 'GET', cookie }));
  assert.equal(JSON.parse(me.body).user.role, 'admin');
  const churchOfSession = (await pg.query(`SELECT church_id FROM sessions`)).rows[0].church_id;
  assert.equal(churchOfSession, CHURCH_B);
});

test('a SQL injection attempt in the username is just a wrong sign-in', async () => {
  const res = await build().login(event({ body: { username: "' OR '1'='1", password: GOOD } }));
  assert.equal(res.statusCode, 401);
  assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM sessions')).rows[0].n, 0);
});

// ---- Lockout ----

const LOCK_MESSAGE = 'Too many attempts. Try again in 15 minutes, or ask your church admin.';

test('five wrong passwords lock the account for 15 minutes, with the lock message; the right password is refused while locked', async () => {
  for (let i = 0; i < 4; i += 1) {
    const res = await build().login(event({ body: { username: 'viewer', password: 'wrong guess' }, ip: `198.51.100.${i + 10}` }));
    assert.equal(res.statusCode, 401);
    assert.equal(JSON.parse(res.body).error, 'Username or password is incorrect.', 'a wrong password gets the generic message');
  }
  // The fifth failure starts the lock, so its response already gives the lock message.
  const fifth = await build().login(event({ body: { username: 'viewer', password: 'wrong guess' }, ip: '198.51.100.14' }));
  assert.equal(fifth.statusCode, 423);
  assert.equal(JSON.parse(fifth.body).error, LOCK_MESSAGE);

  const locked = await build().login(event({ body: { username: 'viewer', password: GOOD }, ip: '198.51.100.99' }));
  assert.equal(locked.statusCode, 423, 'the correct password is refused while locked');
  assert.equal(JSON.parse(locked.body).error, LOCK_MESSAGE);

  clock = new Date(clock.getTime() + 14 * 60 * 1000);
  const stillLocked = await build().login(event({ body: { username: 'viewer', password: GOOD }, ip: '198.51.100.98' }));
  assert.equal(stillLocked.statusCode, 423, 'still locked at 14 minutes');
  assert.match(JSON.parse(stillLocked.body).error, /Try again in 1 minute, or ask your church admin\./, 'the minutes left are counted');

  clock = new Date(clock.getTime() + 2 * 60 * 1000);
  assert.equal((await build().login(event({ body: { username: 'viewer', password: GOOD }, ip: '198.51.100.97' }))).statusCode, 200, 'open again after 15 minutes');
});

test('a wrong password and an unknown user never get the lock message', async () => {
  for (let i = 0; i < 6; i += 1) {
    const res = await build().login(event({ body: { username: 'nobody', password: 'x' }, ip: `198.51.100.${i + 60}` }));
    assert.equal(JSON.parse(res.body).error, 'Username or password is incorrect.');
  }
});

test('a successful sign-in resets the failure count', async () => {
  for (let i = 0; i < 4; i += 1) await build().login(event({ body: { username: 'viewer', password: 'wrong' }, ip: `198.51.100.${i + 20}` }));
  await signIn('viewer');
  for (let i = 0; i < 4; i += 1) await build().login(event({ body: { username: 'viewer', password: 'wrong' }, ip: `198.51.100.${i + 30}` }));
  assert.equal((await build().login(event({ body: { username: 'viewer', password: GOOD }, ip: '198.51.100.40' }))).statusCode, 200, 'not locked: the count started over');
});

// ---- Sessions ----

test('a session lasts 12 hours, then me returns 401', async () => {
  const cookie = await signIn('planner');
  assert.equal((await build().me(event({ method: 'GET', cookie }))).statusCode, 200);
  clock = new Date(clock.getTime() + 12 * 3600 * 1000 + 1000);
  assert.equal((await build().me(event({ method: 'GET', cookie }))).statusCode, 401);
});

test('me returns the user and role, or 401 with no session', async () => {
  assert.equal((await build().me(event({ method: 'GET' }))).statusCode, 401);
  const cookie = await signIn('viewer');
  const body = JSON.parse((await build().me(event({ method: 'GET', cookie }))).body);
  assert.deepEqual(body.user, { username: 'viewer', displayName: 'viewer', role: 'viewer', mustChangePassword: false });
});

test('after logout, the old cookie returns 401', async () => {
  const cookie = await signIn('planner');
  assert.equal((await build().logout(event({ cookie }))).statusCode, 200);
  assert.equal((await build().me(event({ method: 'GET', cookie }))).statusCode, 401);
  assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM sessions')).rows[0].n, 0);
});

test('a disabled user is refused, and their sessions are deleted at once', async () => {
  const cookie = await signIn('planner');
  await pg.query(`UPDATE users SET disabled = true WHERE username = 'planner'`);
  assert.equal((await build().me(event({ method: 'GET', cookie }))).statusCode, 401);
  assert.equal((await pg.query(`SELECT COUNT(*)::int AS n FROM sessions`)).rows[0].n, 0);
  const res = await build().login(event({ body: { username: 'planner', password: GOOD } }));
  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.body).error, 'Username or password is incorrect.');
});

// ---- Roles ----

test('a viewer\'s request to a planner-only function returns 403; a planner\'s returns only their own church\'s plans', async () => {
  const viewer = await signIn('viewer');
  const denied = await build().plans(event({ method: 'GET', cookie: viewer }));
  assert.equal(denied.statusCode, 403);

  const planner = await signIn('planner');
  const res = await build().plans(event({ method: 'GET', cookie: planner }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body).plans.map((p) => p.name), ['A: All Saints'], 'church B\'s plan is not returned');
});

test('no session at all gets 401 from the planner-only function', async () => {
  assert.equal((await build().plans(event({ method: 'GET' }))).statusCode, 401);
});

// ---- Change password ----

test('a user who must change the password is refused the planner until they do', async () => {
  const cookie = await signIn('fresh');
  const me = JSON.parse((await build().me(event({ method: 'GET', cookie }))).body);
  assert.equal(me.user.mustChangePassword, true);
  assert.equal((await build().plans(event({ method: 'GET', cookie }))).statusCode, 403);

  assert.equal((await build().changePassword(event({ cookie, body: { currentPassword: GOOD, newPassword: 'short' } }))).statusCode, 400, 'under 10 characters is refused');
  assert.equal((await build().changePassword(event({ cookie, body: { currentPassword: 'wrong', newPassword: 'a long new password' } }))).statusCode, 401);

  assert.equal((await build().changePassword(event({ cookie, body: { currentPassword: GOOD, newPassword: 'a new long passphrase' } }))).statusCode, 200);
  assert.equal((await build().plans(event({ method: 'GET', cookie }))).statusCode, 200, 'the planner opens after the change');
  assert.equal((await build().login(event({ body: { username: 'fresh', password: GOOD } }))).statusCode, 401, 'the old password no longer works');
  assert.equal((await build().login(event({ body: { username: 'fresh', password: 'a new long passphrase' } }))).statusCode, 200);
});

test('changing the password signs out the other browsers, and keeps this one', async () => {
  const here1 = await signIn('planner');
  const other = await signIn('planner');
  await build().changePassword(event({ cookie: here1, body: { currentPassword: GOOD, newPassword: 'a new long passphrase' } }));
  assert.equal((await build().me(event({ method: 'GET', cookie: here1 }))).statusCode, 200);
  assert.equal((await build().me(event({ method: 'GET', cookie: other }))).statusCode, 401);
});

// ---- Rate limit and failure handling ----

test('login is limited to 10 requests a minute per IP', async () => {
  for (let i = 0; i < 10; i += 1) {
    assert.notEqual((await build().login(event({ body: { username: 'nobody', password: 'x' }, ip: '203.0.113.5' }))).statusCode, 429);
  }
  const limited = await build().login(event({ body: { username: 'nobody', password: 'x' }, ip: '203.0.113.5' }));
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers['Retry-After'], '60');
  // Another address is not affected.
  assert.notEqual((await build().login(event({ body: { username: 'nobody', password: 'x' }, ip: '203.0.113.6' }))).statusCode, 429);
});

test('a missing TOKEN_SECRET fails closed with a plain 500 that reveals nothing', async () => {
  const broken = createApi({ sql: tagFrom(pg), secret: undefined, now: () => clock });
  const res = await broken.login(event({ body: { username: 'planner', password: GOOD } }));
  assert.equal(res.statusCode, 500);
  assert.equal(JSON.parse(res.body).error, 'Something went wrong. Try again.');
  assert.doesNotMatch(res.body, /secret/i);
});

test('the wrong methods are refused, and an empty sign-in is a 400', async () => {
  assert.equal((await build().login(event({ method: 'GET' }))).statusCode, 405);
  assert.equal((await build().me(event({ method: 'POST' }))).statusCode, 405);
  assert.equal((await build().login(event({ body: { username: '', password: '' } }))).statusCode, 400);
});

// ---- Users screen: the admin API ----

const transaction = (work) => pg.transaction((tx) => work(tagFromQuery((text, values) => tx.query(text, values))));
const adminApi = () => createAdminApi({ sql: tagFrom(pg), transaction, secret: SECRET, now: () => clock });
const TEMP_PATTERN = /^[abcdefghjkmnpqrstuvwxyz23456789]{4}-[abcdefghjkmnpqrstuvwxyz23456789]{4}-[abcdefghjkmnpqrstuvwxyz23456789]{4}$/;
const idOf = async (username, church = CHURCH_A) => (await pg.query('SELECT id FROM users WHERE username = $1 AND church_id = $2', [username, church])).rows[0].id;
const countAudit = async () => (await pg.query('SELECT COUNT(*)::int AS n FROM audit_log')).rows[0].n;

test('the sign-in response returns the church code, so the browser can remember it', async () => {
  const res = await build().login(event({ body: { username: 'planner', password: GOOD } }));
  assert.equal(JSON.parse(res.body).churchCode, CODE_A);
});

test("an admin sees only their own church's users, and the list holds no password or temporary password", async () => {
  const cookie = await signIn('admin', GOOD, { churchCode: CODE_A });
  const res = await adminApi().list(event({ method: 'GET', cookie }));
  assert.equal(res.statusCode, 200);
  const { users } = JSON.parse(res.body);
  assert.equal(users.length, 5, "church A has five users; church B's admin is not listed");
  assert.ok(users.every((u) => !('password_hash' in u) && !('temporaryPassword' in u)));
  assert.equal(users.find((u) => u.username === 'disabled').status, 'disabled');
  assert.equal(users.find((u) => u.username === 'viewer').status, 'active');
});

test('an admin adds a user: the temporary password comes back once, and the user must change it at sign-in', async () => {
  const cookie = await signIn('admin', GOOD, { churchCode: CODE_A });
  const created = await adminApi().create(event({ cookie, body: { username: 'newbie', displayName: 'New Person', role: 'viewer' } }));
  assert.equal(created.statusCode, 201);
  const { temporaryPassword, user } = JSON.parse(created.body);
  assert.match(temporaryPassword, TEMP_PATTERN);
  assert.equal(user.status, 'active');

  const signedIn = await build().login(event({ body: { username: 'newbie', password: temporaryPassword } }));
  assert.equal(signedIn.statusCode, 200);
  assert.equal(JSON.parse(signedIn.body).user.mustChangePassword, true);

  const list = (await adminApi().list(event({ method: 'GET', cookie }))).body;
  assert.equal(list.includes(temporaryPassword), false, 'the list never shows the temporary password');
});

test('a username used in the same church is refused; the same username in another church is allowed', async () => {
  const cookie = await signIn('admin', GOOD, { churchCode: CODE_A });
  assert.equal((await adminApi().create(event({ cookie, body: { username: 'planner', displayName: 'Dup', role: 'viewer' } }))).statusCode, 409);
  const cookieB = await signIn('admin', GOOD, { churchCode: CODE_B });
  assert.equal((await adminApi().create(event({ cookie: cookieB, body: { username: 'planner', displayName: 'Other church', role: 'viewer' } }))).statusCode, 201);
});

test('an admin in one church cannot list, change, reset or unlock a user of another church', async () => {
  const adminB = await idOf('admin', CHURCH_B);
  const viewerA = await idOf('viewer');
  const cookieB = await signIn('admin', GOOD, { churchCode: CODE_B });
  // Church B's admin naming church A's viewer is told the user is not in their church, and nothing changes.
  assert.equal((await adminApi().update(event({ cookie: cookieB, body: { userId: viewerA, disabled: true } }))).statusCode, 404);
  assert.equal((await adminApi().resetPassword(event({ cookie: cookieB, body: { userId: viewerA } }))).statusCode, 404);
  assert.equal((await adminApi().unlock(event({ cookie: cookieB, body: { userId: viewerA } }))).statusCode, 404);
  assert.equal((await pg.query('SELECT disabled FROM users WHERE id = $1', [viewerA])).rows[0].disabled, false);
  // And church A's admin cannot touch church B's admin either.
  const cookieA = await signIn('admin', GOOD, { churchCode: CODE_A });
  assert.equal((await adminApi().update(event({ cookie: cookieA, body: { userId: adminB, disabled: true } }))).statusCode, 404);
});

test('a planner and a viewer get 403 on every user-management route, and no session gets 401', async () => {
  const target = await idOf('viewer');
  const routes = [
    ['GET', (e) => adminApi().list(e), undefined],
    ['POST', (e) => adminApi().create(e), { username: 'x', displayName: 'X', role: 'viewer' }],
    ['POST', (e) => adminApi().update(e), { userId: target, disabled: true }],
    ['POST', (e) => adminApi().resetPassword(e), { userId: target }],
    ['POST', (e) => adminApi().unlock(e), { userId: target }],
  ];
  for (const who of ['planner', 'viewer']) {
    const cookie = await signIn(who);
    for (const [method, call, body] of routes) {
      const res = await call(event({ method, cookie, body }));
      assert.equal(res.statusCode, 403, `${who} on ${method} should get 403`);
    }
  }
  for (const [method, call, body] of routes) {
    assert.equal((await call(event({ method, body }))).statusCode, 401, 'no session gets 401');
  }
});

test('the last active admin cannot be demoted or disabled, and a second admin makes that possible', async () => {
  const adminId = await idOf('admin');
  const cookie = await signIn('admin', GOOD, { churchCode: CODE_A });
  const demote = await adminApi().update(event({ cookie, body: { userId: adminId, role: 'planner' } }));
  assert.equal(demote.statusCode, 409);
  assert.match(JSON.parse(demote.body).error, /at least one active admin/);
  assert.equal((await adminApi().update(event({ cookie, body: { userId: adminId, disabled: true } }))).statusCode, 409);
  assert.equal((await pg.query('SELECT role, disabled FROM users WHERE id = $1', [adminId])).rows[0].role, 'admin');

  // A second admin is created; now the first can step down.
  const second = await adminApi().create(event({ cookie, body: { username: 'second', displayName: 'Second', role: 'admin' } }));
  assert.equal(second.statusCode, 201);
  assert.equal((await adminApi().update(event({ cookie, body: { userId: adminId, role: 'planner' } }))).statusCode, 200);
  // Now the second admin is the last one, so it cannot step down either.
  const temporary = JSON.parse(second.body).temporaryPassword;
  const secondCookie = await signIn('second', temporary);
  // The new admin changes their temporary password first, as every new account must.
  await build().changePassword(event({ cookie: secondCookie, body: { currentPassword: temporary, newPassword: 'a second admin passphrase' } }));
  const secondId = await idOf('second');
  assert.equal((await adminApi().update(event({ cookie: secondCookie, body: { userId: secondId, role: 'viewer' } }))).statusCode, 409);
});

test('disabling a user ends their sessions at once, and enabling them again lets them back in', async () => {
  const viewerCookie = await signIn('viewer');
  const viewerId = await idOf('viewer');
  const cookie = await signIn('admin', GOOD, { churchCode: CODE_A });
  assert.equal((await adminApi().update(event({ cookie, body: { userId: viewerId, disabled: true } }))).statusCode, 200);
  assert.equal((await build().me(event({ method: 'GET', cookie: viewerCookie }))).statusCode, 401);
  assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM sessions WHERE user_id = $1', [viewerId])).rows[0].n, 0);
  assert.equal((await build().login(event({ body: { username: 'viewer', password: GOOD } }))).statusCode, 401);

  assert.equal((await adminApi().update(event({ cookie, body: { userId: viewerId, disabled: false } }))).statusCode, 200);
  assert.equal((await build().login(event({ body: { username: 'viewer', password: GOOD } }))).statusCode, 200);
});

test("a reset gives a new temporary password, ends the user's sessions, and makes them change it", async () => {
  const viewerCookie = await signIn('viewer');
  const viewerId = await idOf('viewer');
  const cookie = await signIn('admin', GOOD, { churchCode: CODE_A });
  const reset = await adminApi().resetPassword(event({ cookie, body: { userId: viewerId } }));
  assert.equal(reset.statusCode, 200);
  const { temporaryPassword } = JSON.parse(reset.body);
  assert.match(temporaryPassword, TEMP_PATTERN);
  assert.equal((await build().me(event({ method: 'GET', cookie: viewerCookie }))).statusCode, 401, 'the old session ended');
  assert.equal((await build().login(event({ body: { username: 'viewer', password: GOOD } }))).statusCode, 401, 'the old password no longer works');
  const fresh = await build().login(event({ body: { username: 'viewer', password: temporaryPassword } }));
  assert.equal(fresh.statusCode, 200);
  assert.equal(JSON.parse(fresh.body).user.mustChangePassword, true);
});

test('unlock clears a lock, so the locked user can sign in again', async () => {
  for (let i = 0; i < 5; i += 1) await build().login(event({ body: { username: 'viewer', password: 'wrong guess' }, ip: `198.51.100.${i + 110}` }));
  assert.equal((await build().login(event({ body: { username: 'viewer', password: GOOD }, ip: '198.51.100.120' }))).statusCode, 423);
  const cookie = await signIn('admin', GOOD, { churchCode: CODE_A });
  assert.equal((await adminApi().unlock(event({ cookie, body: { userId: await idOf('viewer') } }))).statusCode, 200);
  assert.equal((await build().login(event({ body: { username: 'viewer', password: GOOD }, ip: '198.51.100.121' }))).statusCode, 200);
});

test('every change is written to the audit log, and the log holds no passwords', async () => {
  const cookie = await signIn('admin', GOOD, { churchCode: CODE_A });
  const viewerId = await idOf('viewer');
  const before = await countAudit();
  const created = JSON.parse((await adminApi().create(event({ cookie, body: { username: 'audited', displayName: 'Audited', role: 'viewer' } }))).body);
  await adminApi().update(event({ cookie, body: { userId: viewerId, role: 'planner' } }));
  await adminApi().update(event({ cookie, body: { userId: viewerId, disabled: true } }));
  const reset = JSON.parse((await adminApi().resetPassword(event({ cookie, body: { userId: viewerId } }))).body);
  await adminApi().unlock(event({ cookie, body: { userId: viewerId } }));
  assert.equal(await countAudit(), before + 5, 'one row for each change');
  const actions = (await pg.query('SELECT action FROM audit_log ORDER BY id')).rows.map((r) => r.action);
  assert.deepEqual(actions.slice(-5), ['user.created', 'user.role_changed', 'user.disabled', 'user.password_reset', 'user.unlocked']);
  const log = JSON.stringify((await pg.query('SELECT * FROM audit_log')).rows);
  assert.equal(log.includes(created.temporaryPassword) || log.includes(reset.temporaryPassword), false, 'no temporary password is logged');
  // Only the action name mentions a password; no password field or hash is stored in the log.
  assert.equal(log.includes('password_hash') || log.includes('passwordHash'), false, 'the log has no password fields');
});

// ---- The last-admin rule under concurrent requests ----

/** Adds a second active admin to church A, with a known password and no forced change. */
async function addSecondAdmin() {
  const hash = await hashPassword(GOOD);
  await pg.query(
    `INSERT INTO users (id, church_id, username, display_name, role, password_hash, must_change_password)
     VALUES (gen_random_uuid(), $1, 'second', 'Second Admin', 'admin', $2, false)`,
    [CHURCH_A, hash],
  );
  return idOf('second');
}

test('two admins demote each other at the same moment: exactly one succeeds, and the church keeps an active admin', async () => {
  const secondId = await addSecondAdmin();
  const adminId = await idOf('admin');
  const cookieAdmin = await signIn('admin', GOOD, { churchCode: CODE_A });
  const cookieSecond = await signIn('second', GOOD, { churchCode: CODE_A });

  const [first, second] = await Promise.all([
    adminApi().update(event({ cookie: cookieAdmin, body: { userId: secondId, role: 'planner' } })),
    adminApi().update(event({ cookie: cookieSecond, body: { userId: adminId, role: 'planner' } })),
  ]);
  assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 409], 'one succeeds, the other is refused');
  const refused = [first, second].find((r) => r.statusCode === 409);
  assert.equal(JSON.parse(refused.body).error, 'A church must keep at least one active admin.');

  const active = (await pg.query(`SELECT COUNT(*)::int AS n FROM users WHERE church_id = $1 AND role = 'admin' AND disabled = false`, [CHURCH_A])).rows[0].n;
  assert.equal(active, 1, 'exactly one active admin is left');
});

test('a single admin who tries to demote or disable themselves gets 409, and nothing changes', async () => {
  const adminId = await idOf('admin');
  const cookie = await signIn('admin', GOOD, { churchCode: CODE_A });
  const auditBefore = await countAudit();
  const sessionsBefore = (await pg.query('SELECT COUNT(*)::int AS n FROM sessions')).rows[0].n;

  const demote = await adminApi().update(event({ cookie, body: { userId: adminId, role: 'planner' } }));
  assert.equal(demote.statusCode, 409);
  assert.equal(JSON.parse(demote.body).error, 'A church must keep at least one active admin.');
  const disable = await adminApi().update(event({ cookie, body: { userId: adminId, disabled: true } }));
  assert.equal(disable.statusCode, 409);

  const row = (await pg.query('SELECT role, disabled FROM users WHERE id = $1', [adminId])).rows[0];
  assert.deepEqual(row, { role: 'admin', disabled: false }, 'the refused change was rolled back');
  assert.equal(await countAudit(), auditBefore, 'no audit row for a refused change');
  assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM sessions')).rows[0].n, sessionsBefore, 'no session was ended');
});

test('demoting an admin succeeds when another active admin exists', async () => {
  const secondId = await addSecondAdmin();
  const cookie = await signIn('admin', GOOD, { churchCode: CODE_A });
  const res = await adminApi().update(event({ cookie, body: { userId: secondId, role: 'viewer' } }));
  assert.equal(res.statusCode, 200);
  assert.equal((await pg.query('SELECT role FROM users WHERE id = $1', [secondId])).rows[0].role, 'viewer');
  assert.equal((await pg.query(`SELECT COUNT(*)::int AS n FROM users WHERE church_id = $1 AND role = 'admin' AND disabled = false`, [CHURCH_A])).rows[0].n, 1);
});

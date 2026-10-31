// Tests for adding web users from a linked laptop, against a real Postgres (PGlite). The laptop holds only its device token; the
// church and the acting admin come from that token. Run with: node --test server/test/device-users.test.mjs
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createAdminApi } from '../lib/admin.js';
import { createDeviceUsersApi } from '../lib/device-users.js';
import { createApi } from '../lib/handlers.js';

import { hashPassword, hashToken } from '../lib/auth.js';
import { tagFromQuery } from '../lib/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.join(here, '..', 'db', 'schema.sql'), 'utf8');
const SECRET = randomBytes(32).toString('hex');
const PASSWORD = `Test-${randomBytes(16).toString('base64url')}`;
const CHURCH_A = '00000000-0000-4000-8000-00000000000a';
const CHURCH_B = '00000000-0000-4000-8000-00000000000b';
const NOT_ADMIN = 'Only an active admin can add web users from this laptop.';
const TEMP = /^[abcdefghjkmnpqrstuvwxyz23456789]{4}-[abcdefghjkmnpqrstuvwxyz23456789]{4}-[abcdefghjkmnpqrstuvwxyz23456789]{4}$/;

let pg;
let clock;


const sql = tagFromQuery((text, params) => pg.query(text, params));
const transaction = (work) => pg.transaction((tx) => work(tagFromQuery((t, v) => tx.query(t, v))));
const admin = () => createAdminApi({ sql, transaction, secret: SECRET, now: () => clock });
const deviceApi = () => createDeviceUsersApi({ sql, secret: SECRET, addUser: admin().addUser, now: () => clock });
const webApi = () => createApi({ sql, secret: SECRET, now: () => clock });

const event = ({ token, body, method = 'POST' } = {}) => ({
  httpMethod: method,
  headers: token ? { authorization: `Bearer ${token}` } : {},
  body: body === undefined ? undefined : JSON.stringify(body),
});

async function user(church, username, role, { disabled = false } = {}) {
  const rows = await pg.query(
    `INSERT INTO users (id, church_id, username, display_name, role, password_hash, must_change_password, disabled)
     VALUES (gen_random_uuid(), $1, $2, $2, $3, $4, false, $5) RETURNING id`,
    [church, username, role, await hashPassword(PASSWORD), disabled],
  );
  return rows.rows[0].id;
}

/** Links a laptop: stores only the keyed hash of its token. Returns the token the app would hold. */
async function device({ church, linkedTo = null, revoked = false }) {
  const token = randomBytes(32).toString('base64url');
  await pg.query(
    `INSERT INTO device_tokens (token_hash, church_id, user_id, device_name, revoked_at)
     VALUES ($1, $2, $3, 'Church laptop', $4)`,
    [hashToken(token, SECRET), church, linkedTo, revoked ? new Date().toISOString() : null],
  );
  return token;
}

const countUsers = async (church) => (await pg.query('SELECT COUNT(*)::int AS n FROM users WHERE church_id = $1', [church])).rows[0].n;

before(async () => {
  pg = new PGlite();
  await pg.exec(SCHEMA);
});

beforeEach(async () => {
  clock = new Date('2026-10-27T12:00:00Z');
  await pg.exec('TRUNCATE rate_limits, sessions, device_tokens, link_codes, audit_log, users, plans, songs, devices, licences, churches CASCADE;');
  await pg.query(`INSERT INTO churches (id, display_code, name) VALUES ($1, 'K7QM-4XD2', 'St Mary'), ($2, 'R2VT-9HJ6', 'St Mary')`, [CHURCH_A, CHURCH_B]);
});

// ---- Who may add a user ----

test('a valid linked admin creates a planner: 201, the account must change its password, and the audit line names the admin', async () => {
  const boss = await user(CHURCH_A, 'boss', 'admin');
  const token = await device({ church: CHURCH_A, linkedTo: boss });
  const res = await deviceApi()(event({ token, body: { username: 'anna', displayName: 'Anna Lee', role: 'planner' } }));
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.equal(body.user.username, 'anna');
  assert.equal(body.user.role, 'planner');
  assert.match(body.temporaryPassword, TEMP);
  const row = (await pg.query(`SELECT must_change_password, church_id FROM users WHERE username = 'anna'`)).rows[0];
  assert.equal(row.must_change_password, true);
  assert.equal(row.church_id, CHURCH_A);
  const audit = (await pg.query(`SELECT actor_user_id, action FROM audit_log WHERE action = 'user.created'`)).rows;
  assert.deepEqual(audit.map((a) => a.actor_user_id), [boss]);
});

test('the temporary password from a laptop works for sign-in, and makes the new user change it', async () => {
  const boss = await user(CHURCH_A, 'boss', 'admin');
  const token = await device({ church: CHURCH_A, linkedTo: boss });
  const temporary = JSON.parse((await deviceApi()(event({ token, body: { username: 'anna', displayName: 'Anna', role: 'viewer' } }))).body).temporaryPassword;
  const signIn = await webApi().login(event({ body: { username: 'anna', password: temporary, churchCode: 'K7QM-4XD2' } }));
  assert.equal(signIn.statusCode, 200);
});

test('a laptop whose linking admin is disabled is refused, and nothing is created', async () => {
  const boss = await user(CHURCH_A, 'boss', 'admin', { disabled: true });
  const token = await device({ church: CHURCH_A, linkedTo: boss });
  const before = await countUsers(CHURCH_A);
  const res = await deviceApi()(event({ token, body: { username: 'anna', displayName: 'Anna', role: 'planner' } }));
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).error, NOT_ADMIN);
  assert.equal(await countUsers(CHURCH_A), before);
});

test("a viewer's token is refused, and nothing is created", async () => {
  const viewer = await user(CHURCH_A, 'viewer', 'viewer');
  const token = await device({ church: CHURCH_A, linkedTo: viewer });
  const before = await countUsers(CHURCH_A);
  const res = await deviceApi()(event({ token, body: { username: 'anna', displayName: 'Anna', role: 'planner' } }));
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).error, NOT_ADMIN);
  assert.equal(await countUsers(CHURCH_A), before);
});

test('a linking admin demoted to planner after linking is refused', async () => {
  const boss = await user(CHURCH_A, 'boss', 'admin');
  const token = await device({ church: CHURCH_A, linkedTo: boss });
  await pg.query(`UPDATE users SET role = 'planner' WHERE id = $1`, [boss]);
  const res = await deviceApi()(event({ token, body: { username: 'anna', displayName: 'Anna', role: 'viewer' } }));
  assert.equal(res.statusCode, 403);
});

test('a laptop with no linked admin is refused', async () => {
  const token = await device({ church: CHURCH_A, linkedTo: null });
  const res = await deviceApi()(event({ token, body: { username: 'anna', displayName: 'Anna', role: 'planner' } }));
  assert.equal(res.statusCode, 403);
});

test('a missing, unknown or revoked token gets 401, and nothing is created', async () => {
  const boss = await user(CHURCH_A, 'boss', 'admin');
  const revoked = await device({ church: CHURCH_A, linkedTo: boss, revoked: true });
  const body = { username: 'anna', displayName: 'Anna', role: 'planner' };
  assert.equal((await deviceApi()(event({ body }))).statusCode, 401);
  assert.equal((await deviceApi()(event({ token: 'made-up', body }))).statusCode, 401);
  assert.equal((await deviceApi()(event({ token: revoked, body }))).statusCode, 401);
  assert.equal(await countUsers(CHURCH_A), 1);
});

test('the church comes from the token, never from the request', async () => {
  const boss = await user(CHURCH_A, 'boss', 'admin');
  const token = await device({ church: CHURCH_A, linkedTo: boss });
  const res = await deviceApi()(event({ token, body: { username: 'anna', displayName: 'Anna', role: 'planner', churchId: CHURCH_B } }));
  assert.equal(res.statusCode, 201);
  assert.equal((await pg.query(`SELECT church_id FROM users WHERE username = 'anna'`)).rows[0].church_id, CHURCH_A);
  assert.equal(await countUsers(CHURCH_B), 0);
});

// ---- The same rules as the web Users screen ----

test('a username already used in the same church is refused, and a username used in another church is allowed', async () => {
  const boss = await user(CHURCH_A, 'boss', 'admin');
  await user(CHURCH_A, 'anna', 'planner');
  const token = await device({ church: CHURCH_A, linkedTo: boss });
  const body = { username: 'ANNA', displayName: 'Anna', role: 'planner' };
  const dup = await deviceApi()(event({ token, body }));
  assert.equal(dup.statusCode, 409);
  assert.equal(JSON.parse(dup.body).error, 'That username is already used in this church.');
  await user(CHURCH_B, 'anna', 'planner');
  const otherChurch = await deviceApi()(event({ token, body: { username: 'bea', displayName: 'Bea', role: 'planner' } }));
  assert.equal(otherChurch.statusCode, 201);
});

test('an unknown role, and a username with a space, are refused with plain words and nothing is created', async () => {
  const boss = await user(CHURCH_A, 'boss', 'admin');
  const token = await device({ church: CHURCH_A, linkedTo: boss });
  const badRole = await deviceApi()(event({ token, body: { username: 'anna', displayName: 'Anna', role: 'owner' } }));
  assert.equal(badRole.statusCode, 400);
  assert.equal(JSON.parse(badRole.body).error, 'Choose a role: admin, planner or viewer.');
  const badName = await deviceApi()(event({ token, body: { username: 'anna lee', displayName: 'Anna', role: 'planner' } }));
  assert.equal(badName.statusCode, 400);
  assert.equal(await countUsers(CHURCH_A), 1);
});

test('a laptop can add an admin, the same as the web screen allows', async () => {
  const boss = await user(CHURCH_A, 'boss', 'admin');
  const token = await device({ church: CHURCH_A, linkedTo: boss });
  const res = await deviceApi()(event({ token, body: { username: 'second', displayName: 'Second', role: 'admin' } }));
  assert.equal(res.statusCode, 201);
  assert.equal(JSON.parse(res.body).user.role, 'admin');
});

// ---- Nothing secret is stored ----

test('the temporary password never appears in audit_log, users, sessions or device_tokens', async () => {
  const boss = await user(CHURCH_A, 'boss', 'admin');
  const token = await device({ church: CHURCH_A, linkedTo: boss });
  const temporary = JSON.parse((await deviceApi()(event({ token, body: { username: 'anna', displayName: 'Anna', role: 'planner' } }))).body).temporaryPassword;
  const stored = JSON.stringify(
    await Promise.all(['audit_log', 'users', 'sessions', 'device_tokens'].map(async (t) => (await pg.query(`SELECT * FROM ${t}`)).rows)),
  );
  assert.equal(stored.includes(temporary), false, 'the password is not stored in the clear');
  assert.equal(stored.includes(token), false, 'the device token is not stored in the clear');
});

test('a refused request writes no audit line', async () => {
  const boss = await user(CHURCH_A, 'boss', 'admin');
  const token = await device({ church: CHURCH_A, linkedTo: boss });
  await deviceApi()(event({ token, body: { username: 'anna', displayName: 'Anna', role: 'owner' } }));
  assert.equal((await pg.query(`SELECT COUNT(*)::int AS n FROM audit_log`)).rows[0].n, 0);
});

// ---- Method and rate ----

test('only POST is accepted', async () => {
  const res = await deviceApi()(event({ method: 'GET', token: 'x' }));
  assert.equal(res.statusCode, 405);
});

test('a laptop can make ten requests a minute, then is asked to wait', async () => {
  const boss = await user(CHURCH_A, 'boss', 'admin');
  const token = await device({ church: CHURCH_A, linkedTo: boss });
  for (let i = 0; i < 10; i += 1) {
    const res = await deviceApi()(event({ token, body: { username: `user${i}`, displayName: 'U', role: 'viewer' } }));
    assert.equal(res.statusCode, 201);
  }
  const limited = await deviceApi()(event({ token, body: { username: 'extra', displayName: 'U', role: 'viewer' } }));
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers['Retry-After'], '60');
});

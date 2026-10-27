// Tests for creating web planner accounts from the desktop app, against a real Postgres (PGlite). The app holds only a device
// token; the church comes from that token. Run with: node --test netlify/functions/test/app-admin.test.mjs
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createAppAdminApi } from '../lib/app-admin.js';
import { createApi } from '../lib/handlers.js';

import { hashPassword, hashToken } from '../lib/auth.js';
import { tagFromQuery } from '../lib/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.join(here, '..', '..', 'db', 'schema.sql'), 'utf8');
const SECRET = randomBytes(32).toString('hex');
const PASSWORD = `Test-${randomBytes(16).toString('base64url')}`;
const CHURCH_A = '00000000-0000-4000-8000-00000000000a';
const CHURCH_B = '00000000-0000-4000-8000-00000000000b';
const CHURCH_C = '00000000-0000-4000-8000-00000000000c';
const TEMP = /^[abcdefghjkmnpqrstuvwxyz23456789]{4}-[abcdefghjkmnpqrstuvwxyz23456789]{4}-[abcdefghjkmnpqrstuvwxyz23456789]{4}$/;

let pg;
let clock;


const query = (text, params) => pg.query(text, params);
const sql = tagFromQuery(query);
const transaction = (work) => pg.transaction((tx) => work(tagFromQuery((t, v) => tx.query(t, v))));
const appApi = () => createAppAdminApi({ sql, transaction, secret: SECRET, now: () => clock });
const webApi = () => createApi({ sql, secret: SECRET, now: () => clock });

const event = ({ token, body } = {}) => ({
  httpMethod: 'POST',
  headers: token ? { authorization: `Bearer ${token}` } : {},
  body: body === undefined ? undefined : JSON.stringify(body),
});

async function user(church, username, role, extra = {}) {
  const id = (await query(
    `INSERT INTO users (id, church_id, username, display_name, role, password_hash, must_change_password, disabled)
     VALUES (gen_random_uuid(), $1, $2, $2, $3, $4, false, $5) RETURNING id`,
    [church, username, role, await hashPassword(PASSWORD), extra.disabled ?? false],
  )).rows[0].id;
  return id;
}

/** Links a laptop: stores only the keyed hash of its token. Returns the token the app would hold. */
async function device({ church, linkedTo = null, setupUntil = null, revoked = false }) {
  const token = randomBytes(32).toString('base64url');
  await query(
    `INSERT INTO device_tokens (token_hash, church_id, user_id, device_name, setup_until, revoked_at)
     VALUES ($1, $2, $3, 'Church laptop', $4, $5)`,
    [hashToken(token, SECRET), church, linkedTo, setupUntil?.toISOString() ?? null, revoked ? new Date().toISOString() : null],
  );
  return token;
}

const countUsers = async (church) => (await query('SELECT COUNT(*)::int AS n FROM users WHERE church_id = $1', [church])).rows[0].n;

before(async () => {
  pg = new PGlite();
  await pg.exec(SCHEMA);
});

beforeEach(async () => {
  clock = new Date('2026-10-27T12:00:00Z');
  await pg.exec('TRUNCATE rate_limits, sessions, device_tokens, audit_log, users, plans, songs, devices, link_codes, licences, churches CASCADE;');
  await query(`INSERT INTO churches (id, display_code, name) VALUES ($1, 'K7QM-4XD2', 'St Mary'), ($2, 'R2VT-9HJ6', 'St Mary'), ($3, 'B8NW-3PL5', 'St Mary')`, [CHURCH_A, CHURCH_B, CHURCH_C]);
});

// ---- Who may call it ----

test('a request with no device token, or an unknown or revoked one, gets 401', async () => {
  assert.equal((await appApi()(event({ body: { username: 'x', displayName: 'X', role: 'viewer' } }))).statusCode, 401);
  assert.equal((await appApi()(event({ token: 'made-up', body: { username: 'x', displayName: 'X', role: 'viewer' } }))).statusCode, 401);
  const revoked = await device({ church: CHURCH_A, linkedTo: await user(CHURCH_A, 'boss', 'admin'), revoked: true });
  assert.equal((await appApi()(event({ token: revoked, body: { username: 'x', displayName: 'X', role: 'viewer' } }))).statusCode, 401);
});

test("a planner's laptop cannot create an account: 403", async () => {
  const planner = await device({ church: CHURCH_A, linkedTo: await user(CHURCH_A, 'planner', 'planner') });
  const res = await appApi()(event({ token: planner, body: { username: 'new', displayName: 'New', role: 'viewer' } }));
  assert.equal(res.statusCode, 403);
  assert.equal(await countUsers(CHURCH_A), 1, 'nobody was added');
});

test('a laptop not linked to any admin cannot create an account outside setup: 403', async () => {
  const orphan = await device({ church: CHURCH_A });
  assert.equal((await appApi()(event({ token: orphan, body: { username: 'new', displayName: 'New', role: 'viewer' } }))).statusCode, 403);
});

// ---- Church isolation ----

test("church A's laptop creates accounts in church A only, even when the body names church B", async () => {
  const boss = await user(CHURCH_A, 'boss', 'admin');
  await user(CHURCH_B, 'otherboss', 'admin');
  const token = await device({ church: CHURCH_A, linkedTo: boss });
  const bBefore = await countUsers(CHURCH_B);
  const res = await appApi()(event({ token, body: { church_id: CHURCH_B, churchId: CHURCH_B, username: 'intruder', displayName: 'Intruder', role: 'admin' } }));
  assert.equal(res.statusCode, 201);
  assert.equal((await query('SELECT church_id FROM users WHERE username = $1', ['intruder'])).rows[0].church_id, CHURCH_A);
  assert.equal(await countUsers(CHURCH_B), bBefore, "church B's users are unchanged");
});

test("church A's laptop cannot create an admin in church B, even as its own admin", async () => {
  const boss = await user(CHURCH_A, 'boss', 'admin');
  const token = await device({ church: CHURCH_A, linkedTo: boss });
  // The device's church is A. Creating for B needs B's own device; nothing in the request can change the church.
  await appApi()(event({ token, body: { church_id: CHURCH_B, username: 'bnew', displayName: 'B New', role: 'admin' } }));
  assert.equal((await query("SELECT COUNT(*)::int AS n FROM users WHERE username = 'bnew' AND church_id = $1", [CHURCH_B])).rows[0].n, 0);
});

// ---- Setup ----

test('setup creates the first admin of a church with no admin yet; a generated password is returned once and must be changed', async () => {
  const setupDevice = await device({ church: CHURCH_C, setupUntil: new Date(clock.getTime() + 30 * 60 * 1000) });
  const res = await appApi()(event({ token: setupDevice, body: { setup: true, username: 'firstadmin', displayName: 'First Admin' } }));
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.equal(body.user.role, 'admin');
  assert.match(body.temporaryPassword, TEMP);

  const signIn = await webApi().login(event({ body: { username: 'firstadmin', password: body.temporaryPassword } }));
  assert.equal(signIn.statusCode, 200, 'the new account can sign in on the web planner');
  assert.equal(JSON.parse(signIn.body).user.mustChangePassword, true, 'and is asked to change the password');
});

test('setup with a password the admin chose keeps must_change off, and the password is not returned', async () => {
  const setupDevice = await device({ church: CHURCH_C, setupUntil: new Date(clock.getTime() + 30 * 60 * 1000) });
  const res = await appApi()(event({ token: setupDevice, body: { setup: true, username: 'boss', displayName: 'Boss', password: 'a chosen passphrase' } }));
  assert.equal(res.statusCode, 201);
  assert.equal(JSON.parse(res.body).temporaryPassword, undefined);
  assert.equal((await query("SELECT must_change_password FROM users WHERE username = 'boss'")).rows[0].must_change_password, false);
});

test('setup only works while the church has no active admin: 409 otherwise', async () => {
  await user(CHURCH_A, 'existing', 'admin');
  const setupDevice = await device({ church: CHURCH_A, setupUntil: new Date(clock.getTime() + 30 * 60 * 1000) });
  const res = await appApi()(event({ token: setupDevice, body: { setup: true, username: 'second', displayName: 'Second' } }));
  assert.equal(res.statusCode, 409);
  assert.equal(JSON.parse(res.body).error, 'This church already has an admin. Ask an existing admin to add this account.');
});

test('setup is refused once the device setup window has closed, and for a laptop never linked in setup: 403', async () => {
  const expired = await device({ church: CHURCH_C, setupUntil: new Date(clock.getTime() - 1000) });
  assert.equal((await appApi()(event({ token: expired, body: { setup: true, username: 'late', displayName: 'Late' } }))).statusCode, 403);
  const never = await device({ church: CHURCH_C });
  assert.equal((await appApi()(event({ token: never, body: { setup: true, username: 'late', displayName: 'Late' } }))).statusCode, 403);
  assert.equal(await countUsers(CHURCH_C), 0);
});

// ---- Secrecy of the temporary password ----

test('the temporary password appears in the create response only, never in the audit log or the users table', async () => {
  const boss = await user(CHURCH_A, 'boss', 'admin');
  const token = await device({ church: CHURCH_A, linkedTo: boss });
  const res = await appApi()(event({ token, body: { username: 'viewer2', displayName: 'Viewer Two', role: 'viewer' } }));
  const { temporaryPassword } = JSON.parse(res.body);
  assert.match(temporaryPassword, TEMP);
  const audit = JSON.stringify((await query('SELECT * FROM audit_log')).rows);
  assert.equal(audit.includes(temporaryPassword), false, 'not in the audit log');
  assert.equal(audit.includes('password'), false, 'the audit log has no password fields');
  const users = JSON.stringify((await query('SELECT * FROM users')).rows);
  assert.equal(users.includes(temporaryPassword), false, 'only a hash is stored');
  assert.equal((await query("SELECT must_change_password FROM users WHERE username = 'viewer2'")).rows[0].must_change_password, true);
  // The audit row names the admin who linked the laptop.
  assert.equal((await query('SELECT actor_user_id FROM audit_log')).rows[0].actor_user_id, boss);
});

test('a created account can sign in on the web planner, is asked to change its password, and cannot use the planner yet', async () => {
  const boss = await user(CHURCH_A, 'boss', 'admin');
  const token = await device({ church: CHURCH_A, linkedTo: boss });
  const { temporaryPassword } = JSON.parse((await appApi()(event({ token, body: { username: 'planner2', displayName: 'Planner Two', role: 'planner' } }))).body);
  const login = await webApi().login(event({ body: { username: 'planner2', password: temporaryPassword } }));
  assert.equal(login.statusCode, 200);
  const cookie = login.headers['Set-Cookie'].split(';')[0];
  assert.equal(JSON.parse(login.body).user.mustChangePassword, true);
  const plans = await webApi().plans({ httpMethod: 'GET', headers: { cookie } });
  assert.equal(plans.statusCode, 403, 'the planner is closed until the password is changed');
});

// ---- Duplicates, validation and rate limit ----

test('a username used in the same church is refused, and the username rules apply', async () => {
  const boss = await user(CHURCH_A, 'boss', 'admin');
  const token = await device({ church: CHURCH_A, linkedTo: boss });
  assert.equal((await appApi()(event({ token, body: { username: 'boss', displayName: 'Dup', role: 'viewer' } }))).statusCode, 409);
  assert.equal((await appApi()(event({ token, body: { username: 'has space', displayName: 'Bad', role: 'viewer' } }))).statusCode, 400);
  assert.equal((await appApi()(event({ token, body: { username: 'ok', displayName: 'Ok', role: 'owner' } }))).statusCode, 400);
});

test('a laptop may make 10 requests a minute; the 11th is refused', async () => {
  const boss = await user(CHURCH_A, 'boss', 'admin');
  const token = await device({ church: CHURCH_A, linkedTo: boss });
  for (let i = 0; i < 10; i += 1) {
    const res = await appApi()(event({ token, body: { username: `u${i}`, displayName: `U ${i}`, role: 'viewer' } }));
    assert.notEqual(res.statusCode, 429);
  }
  const limited = await appApi()(event({ token, body: { username: 'u10', displayName: 'U 10', role: 'viewer' } }));
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers['Retry-After'], '60');
});

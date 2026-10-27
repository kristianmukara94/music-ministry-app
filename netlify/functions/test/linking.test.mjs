// Tests for linking laptops: one-time link codes, device tokens, device status and unlinking. Runs against a real Postgres
// (PGlite) with the same schema and handlers the Netlify functions run. Run with: node --test netlify/functions/test/linking.test.mjs
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createLinkingApi, REDEEM_LIMIT } from '../lib/linking.js';
import { createApi } from '../lib/handlers.js';

import { hashPassword, hashToken } from '../lib/auth.js';
import { tagFromQuery } from '../lib/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.join(here, '..', '..', 'db', 'schema.sql'), 'utf8');
const SECRET = randomBytes(32).toString('hex');
const PASSWORD = `Test-${randomBytes(16).toString('base64url')}`;
const CHURCH_A = '00000000-0000-4000-8000-00000000000a';
const CHURCH_B = '00000000-0000-4000-8000-00000000000b';
const CODE_SHAPE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;

let pg;
let clock;

const sql = tagFromQuery((text, params) => pg.query(text, params));
const transaction = (work) => pg.transaction((tx) => work(tagFromQuery((t, v) => tx.query(t, v))));
const linking = () => createLinkingApi({ sql, transaction, secret: SECRET, now: () => clock });
const web = () => createApi({ sql, secret: SECRET, now: () => clock });

const event = ({ method = 'POST', body, bearer, cookie, ip = '198.51.100.7' } = {}) => ({
  httpMethod: method,
  headers: {
    'x-nf-client-connection-ip': ip,
    ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    ...(cookie ? { cookie } : {}),
  },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const idOf = async (username, church = CHURCH_A) => (await pg.query('SELECT id FROM users WHERE username = $1 AND church_id = $2', [username, church])).rows[0].id;

/** Signs in on the web and returns the session cookie. */
async function sessionCookie(username, church = CHURCH_A) {
  const res = await web().login(event({ body: { username, password: PASSWORD, churchCode: church === CHURCH_A ? 'K7QM-4XD2' : 'R2VT-9HJ6' } }));
  assert.equal(res.statusCode, 200, res.body);
  return res.headers['Set-Cookie'].split(';')[0];
}

/** Creates a link code as the admin, and returns it. */
async function makeCode(cookie) {
  const res = await linking().createCode(event({ cookie }));
  assert.equal(res.statusCode, 201, res.body);
  return JSON.parse(res.body).code;
}

const redeem = (code, deviceLabel = 'Church laptop') => linking().redeem(event({ body: { code, deviceLabel } }));

before(async () => {
  pg = new PGlite();
  await pg.exec(SCHEMA);
});

beforeEach(async () => {
  clock = new Date('2026-10-27T12:00:00Z');
  await pg.exec('TRUNCATE rate_limits, sessions, device_tokens, link_codes, audit_log, users, plans, songs, devices, licences, churches CASCADE;');
  await pg.query(`INSERT INTO churches (id, display_code, name) VALUES ($1, 'K7QM-4XD2', 'St Mary'), ($2, 'R2VT-9HJ6', 'Holy Cross')`, [CHURCH_A, CHURCH_B]);
  const hash = await hashPassword(PASSWORD);
  for (const [church, username, role] of [[CHURCH_A, 'boss', 'admin'], [CHURCH_A, 'planner', 'planner'], [CHURCH_B, 'otherboss', 'admin']]) {
    await pg.query(
      `INSERT INTO users (id, church_id, username, display_name, role, password_hash, must_change_password)
       VALUES (gen_random_uuid(), $1, $2, $2, $3, $4, false)`,
      [church, username, role, hash],
    );
  }
});

// ---- Link codes ----

test('an admin creates a link code in the display-code form, and the server keeps only its hash', async () => {
  const code = await makeCode(await sessionCookie('boss'));
  assert.match(code, CODE_SHAPE);
  const stored = (await pg.query('SELECT code_hash, church_id, created_by FROM link_codes')).rows;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].code_hash, hashToken(code, SECRET));
  assert.equal(stored[0].church_id, CHURCH_A);
  assert.equal(stored[0].created_by, await idOf('boss'), 'the admin who created the code is recorded');
});

test('only an admin session can create a link code: a planner gets 403, and no session gets 401', async () => {
  assert.equal((await linking().createCode(event({ cookie: await sessionCookie('planner') }))).statusCode, 403);
  assert.equal((await linking().createCode(event())).statusCode, 401);
  assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM link_codes')).rows[0].n, 0);
});

test('a code works once: the second redeem is refused', async () => {
  const code = await makeCode(await sessionCookie('boss'));
  const first = await redeem(code);
  assert.equal(first.statusCode, 201);
  const second = await redeem(code);
  assert.equal(second.statusCode, 409);
  assert.equal(JSON.parse(second.body).error, 'This code has already been used. Ask your admin for a new one.');
});

test('an expired code is refused with a plain message', async () => {
  const code = await makeCode(await sessionCookie('boss'));
  clock = new Date(clock.getTime() + 10 * 60 * 1000 + 1000);
  const res = await redeem(code);
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, 'That code has expired. Ask your admin for a new one.');
  assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM device_tokens')).rows[0].n, 0, 'no laptop was linked');
});

test('a code is accepted when typed in lower case, with spaces or without the dash', async () => {
  const code = await makeCode(await sessionCookie('boss'));
  const typed = code.toLowerCase().replace('-', ' ');
  assert.equal((await redeem(typed)).statusCode, 201);
});

test("a code can only link a laptop to its own church, and the request cannot name another church", async () => {
  const code = await makeCode(await sessionCookie('boss'));
  const res = await linking().redeem(event({ body: { code, deviceLabel: 'Laptop', church_id: CHURCH_B, churchId: CHURCH_B } }));
  assert.equal(res.statusCode, 201);
  const { token, churchName } = JSON.parse(res.body);
  assert.equal(churchName, 'St Mary', "the laptop is linked to the code's church");
  const row = (await pg.query('SELECT church_id FROM device_tokens')).rows[0];
  assert.equal(row.church_id, CHURCH_A);
  const status = JSON.parse((await linking().status(event({ method: 'GET', bearer: token }))).body);
  assert.equal(status.churchName, 'St Mary');
});

test('a code whose admin has since been disabled cannot link a laptop', async () => {
  const code = await makeCode(await sessionCookie('boss'));
  await pg.query(`UPDATE users SET disabled = true WHERE username = 'boss'`);
  const res = await redeem(code);
  assert.equal(res.statusCode, 403);
  assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM device_tokens')).rows[0].n, 0);
});

test('redeem attempts are limited to 10 a minute per address', async () => {
  for (let i = 0; i < 10; i += 1) {
    const res = await linking().redeem(event({ ip: '203.0.113.9', body: { code: 'AAAA-AAAA', deviceLabel: 'x' } }));
    assert.notEqual(res.statusCode, 429);
  }
  const limited = await linking().redeem(event({ ip: '203.0.113.9', body: { code: 'AAAA-AAAA', deviceLabel: 'x' } }));
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers['Retry-After'], '60');
});

// ---- Device status, revocation and unlinking ----

test('device status returns the church, the linked admin, the laptop name and last seen, and records that it was seen', async () => {
  const code = await makeCode(await sessionCookie('boss'));
  const { token } = JSON.parse((await redeem(code, 'Operator booth')).body);
  clock = new Date(clock.getTime() + 60 * 1000);
  const res = await linking().status(event({ method: 'GET', bearer: token }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.deepEqual(
    { churchName: body.churchName, adminName: body.adminName, deviceLabel: body.deviceLabel },
    { churchName: 'St Mary', adminName: 'boss', deviceLabel: 'Operator booth' },
  );
  assert.equal(body.lastSeenAt, clock.toISOString());
  assert.equal((await pg.query('SELECT last_seen_at FROM device_tokens')).rows[0].last_seen_at !== null, true);
});

test('a revoked token is refused on device status, and so is an unknown one', async () => {
  const code = await makeCode(await sessionCookie('boss'));
  const { token } = JSON.parse((await redeem(code)).body);
  assert.equal((await linking().unlink(event({ bearer: token }))).statusCode, 200);
  assert.equal((await linking().status(event({ method: 'GET', bearer: token }))).statusCode, 401);
  assert.equal((await linking().status(event({ method: 'GET', bearer: 'made-up' }))).statusCode, 401);
  assert.equal((await linking().status(event({ method: 'GET' }))).statusCode, 401);
});

test("an admin on the website can unlink a laptop of their own church by its device id, and not another church's", async () => {
  const code = await makeCode(await sessionCookie('boss'));
  const { token } = JSON.parse((await redeem(code)).body);
  const deviceId = (await pg.query('SELECT device_id FROM device_tokens')).rows[0].device_id;

  const otherChurch = await linking().unlink(event({ cookie: await sessionCookie('otherboss', CHURCH_B), body: { deviceId } }));
  assert.equal(otherChurch.statusCode, 404, "church B's admin cannot unlink church A's laptop");
  assert.equal((await linking().status(event({ method: 'GET', bearer: token }))).statusCode, 200, 'still linked');

  const own = await linking().unlink(event({ cookie: await sessionCookie('boss'), body: { deviceId } }));
  assert.equal(own.statusCode, 200);
  assert.equal((await linking().status(event({ method: 'GET', bearer: token }))).statusCode, 401);
});

test('unlinking writes an audit row, and linking and creating codes write theirs', async () => {
  const cookie = await sessionCookie('boss');
  const code = await makeCode(cookie);
  const { token } = JSON.parse((await redeem(code)).body);
  await linking().unlink(event({ bearer: token }));
  const actions = (await pg.query('SELECT action FROM audit_log ORDER BY id')).rows.map((r) => r.action);
  assert.deepEqual(actions, ['device.link_code_created', 'device.linked', 'device.unlinked']);
});

// ---- Secrecy: the raw code and token are never stored or logged ----

test('the raw link code and device token never appear in the database or the logs', async () => {
  const logged = [];
  const original = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of Object.keys(original)) console[k] = (...args) => logged.push(args.map(String).join(' '));
  let code;
  let token;
  try {
    code = await makeCode(await sessionCookie('boss'));
    ({ token } = JSON.parse((await redeem(code)).body));
    await linking().redeem(event({ body: { code: 'ZZZZ-ZZZZ', deviceLabel: 'x' } })); // a failed attempt, to exercise the error path
    await linking().status(event({ method: 'GET', bearer: 'made-up' }));
  } finally {
    Object.assign(console, original);
  }
  const everything = JSON.stringify(
    await Promise.all(['link_codes', 'device_tokens', 'audit_log', 'sessions', 'users'].map(async (t) => (await pg.query(`SELECT * FROM ${t}`)).rows)),
  );
  assert.equal(everything.includes(code), false, 'the code is not stored');
  assert.equal(everything.includes(token), false, 'the token is not stored');
  assert.equal(logged.some((l) => l.includes(code) || l.includes(token)), false, 'neither is logged');
});

test('the web routes and the device routes do not share a session: a device token is not a web session', async () => {
  const code = await makeCode(await sessionCookie('boss'));
  const { token } = JSON.parse((await redeem(code)).body);
  const res = await web().me(event({ method: 'GET', cookie: `apccmma_session=${token}` }));
  assert.equal(res.statusCode, 401, 'a device token cannot be used as a web session');
});

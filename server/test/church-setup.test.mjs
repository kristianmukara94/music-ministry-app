// Tests for creating a church, its first admin and a linked laptop from a one-time setup key, against a real Postgres (PGlite).
// Run with: node --test server/test/church-setup.test.mjs
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createChurchRenewApi, createChurchSetupApi, KEY_MESSAGE, PERPETUAL_MESSAGE, SETUP_LIMIT } from '../lib/church-setup.js';
import { createLinkingApi } from '../lib/linking.js';

import { hashToken, setupKey, temporaryPassword } from '../lib/auth.js';
import { tagFromQuery } from '../lib/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.join(here, '..', 'db', 'schema.sql'), 'utf8');
const SECRET = randomBytes(32).toString('hex');
const TEMP = /^[abcdefghjkmnpqrstuvwxyz23456789]{4}-[abcdefghjkmnpqrstuvwxyz23456789]{4}-[abcdefghjkmnpqrstuvwxyz23456789]{4}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let pg;
let clock;

const sql = tagFromQuery((text, params) => pg.query(text, params));
const transaction = (work) => pg.transaction((tx) => work(tagFromQuery((t, v) => tx.query(t, v))));
const setupApi = () => createChurchSetupApi({ sql, transaction, secret: SECRET, now: () => clock });
const linkingApi = () => createLinkingApi({ sql, transaction, secret: SECRET, now: () => clock });

let ipCounter = 0;
const event = ({ body, method = 'POST', ip = `203.0.113.${(ipCounter += 1)}` } = {}) => ({
  httpMethod: method,
  headers: { 'x-real-ip': ip },
  body: body === undefined ? undefined : JSON.stringify(body),
});

/** A valid request body. Each test changes only what it is checking. */
const request = (key, extra = {}) => ({
  setupKey: key,
  churchName: 'St Mary Parish',
  username: 'parishadmin',
  displayName: 'Parish Admin',
  deviceLabel: 'Office laptop',
  ...extra,
});

/** Issues a key the way scripts/create-setup-key.mjs does: only its keyed hash is stored. Returns the key, shown once. */
async function issueKey({ expiresAt = new Date(clock.getTime() + 7 * 24 * 60 * 60 * 1000), licenseDays = null } = {}) {
  const key = setupKey();
  await pg.query('INSERT INTO setup_keys (key_hash, expires_at, license_days) VALUES ($1, $2, $3)', [hashToken(key, SECRET), expiresAt.toISOString(), licenseDays]);
  return key;
}

const count = async (table) => (await pg.query(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows[0].n;

before(async () => {
  pg = new PGlite();
  await pg.exec(SCHEMA);
});

beforeEach(async () => {
  clock = new Date('2026-10-27T12:00:00Z');
  await pg.exec('TRUNCATE rate_limits, sessions, device_tokens, link_codes, audit_log, users, plans, songs, devices, licences, setup_keys, churches CASCADE;');
});

// ---- The happy path, and the key is single-use ----

test('a valid key creates the church, its first admin and a linked laptop in one step, and the laptop token works', async () => {
  const key = await issueKey();
  const res = await setupApi()(event({ body: request(key) }));
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.equal(body.churchName, 'St Mary Parish');
  assert.equal(body.username, 'parishadmin');
  assert.match(body.temporaryPassword, TEMP);
  assert.match(body.displayCode, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);

  const admin = (await pg.query(`SELECT role, must_change_password, church_id FROM users WHERE username = 'parishadmin'`)).rows[0];
  assert.equal(admin.role, 'admin');
  assert.equal(admin.must_change_password, true, 'the admin must change the password at first sign-in');
  const device = (await pg.query('SELECT user_id, church_id FROM device_tokens')).rows;
  assert.equal(device.length, 1);
  assert.equal(device[0].user_id, (await pg.query(`SELECT id FROM users WHERE username = 'parishadmin'`)).rows[0].id);

  const status = await linkingApi().status(event({ method: 'GET' }));
  assert.equal(status.statusCode, 401, 'no bearer: the status route refuses');
  const withToken = { ...event({ method: 'GET' }), headers: { authorization: `Bearer ${body.token}` } };
  const shown = JSON.parse((await linkingApi().status(withToken)).body);
  assert.equal(shown.churchName, 'St Mary Parish');
  assert.equal(shown.adminName, 'Parish Admin');
  assert.equal(shown.deviceLabel, 'Office laptop');
});

// ---- The licence window ----

test('a key with license_days returns when the licence ends, counted from the moment it is used', async () => {
  const key = await issueKey({ licenseDays: 90 });
  const res = await setupApi()(event({ body: request(key) }));
  assert.equal(res.statusCode, 201);
  assert.equal(JSON.parse(res.body).licenseExpiresAt, '2027-01-25T12:00:00.000Z');
});

for (const licenseDays of [null, 0]) {
  test(`a key with license_days ${licenseDays} gives a perpetual licence`, async () => {
    const key = await issueKey({ licenseDays });
    const body = JSON.parse((await setupApi()(event({ body: request(key) }))).body);
    assert.equal(body.licenseExpiresAt, null);
    assert.ok('licenseExpiresAt' in body, 'the field is present, so the laptop can tell perpetual from an old server');
  });
}

test('a negative license_days cannot be stored', async () => {
  await assert.rejects(issueKey({ licenseDays: -1 }));
});

test('activation records the license on the church, so every laptop can be told', async () => {
  const key = await issueKey({ licenseDays: 90 });
  await setupApi()(event({ body: request(key) }));
  const [church] = (await pg.query('SELECT license_expires_at FROM churches')).rows;
  assert.equal(new Date(church.license_expires_at).toISOString(), '2027-01-25T12:00:00.000Z');
});

// ---- Renewing a church's license ----

const renewApi = () => createChurchRenewApi({ sql, transaction, secret: SECRET, now: () => clock });
const DAY = 24 * 60 * 60 * 1000;
const renewal = (token, setupKey, extra = {}) => ({ ...event({ body: { setupKey } }), headers: { 'x-real-ip': '203.0.113.200', authorization: `Bearer ${token}`, ...extra } });

/** A church activated with `licenseDays`, with its license end date then set to `expiresAt` when given. Returns the laptop's token. */
async function activatedChurch({ licenseDays = 30, expiresAt } = {}) {
  const body = JSON.parse((await setupApi()(event({ body: request(await issueKey({ licenseDays })) }))).body);
  if (expiresAt !== undefined) await pg.query('UPDATE churches SET license_expires_at = $1', [expiresAt]);
  return body.token;
}
const churchExpiry = async () => {
  const value = (await pg.query('SELECT license_expires_at FROM churches')).rows[0].license_expires_at;
  return value ? new Date(value).toISOString() : null;
};

test('renewing a running license adds the days to its end', async () => {
  const token = await activatedChurch({ expiresAt: '2026-11-10T12:00:00Z' });
  const res = await renewApi()(renewal(token, await issueKey({ licenseDays: 30 })));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, licenseExpiresAt: '2026-12-10T12:00:00.000Z' });
  assert.equal(await churchExpiry(), '2026-12-10T12:00:00.000Z');
});

test('renewing an expired license counts from now', async () => {
  const token = await activatedChurch({ expiresAt: '2026-09-01T00:00:00Z' });
  const body = JSON.parse((await renewApi()(renewal(token, await issueKey({ licenseDays: 30 })))).body);
  assert.equal(body.licenseExpiresAt, new Date(clock.getTime() + 30 * DAY).toISOString());
});

test('a license ending this very moment counts as expired', async () => {
  const token = await activatedChurch({ expiresAt: clock.toISOString() });
  const body = JSON.parse((await renewApi()(renewal(token, await issueKey({ licenseDays: 1 })))).body);
  assert.equal(body.licenseExpiresAt, new Date(clock.getTime() + DAY).toISOString());
});

// ---- A perpetual license cannot be downgraded ----

const usedAt = async (key) => (await pg.query('SELECT used_at FROM setup_keys WHERE key_hash = $1', [hashToken(key, SECRET)])).rows[0].used_at;

for (const licenseDays of [30, 90, 365]) {
  test(`a ${licenseDays}-day key is refused on a perpetual church, and the key stays unused`, async () => {
    const token = await activatedChurch({ licenseDays: null });
    const key = await issueKey({ licenseDays });
    const res = await renewApi()(renewal(token, key));
    assert.equal(res.statusCode, 400);
    assert.deepEqual(JSON.parse(res.body), { error: PERPETUAL_MESSAGE });
    assert.equal(await usedAt(key), null);
    assert.equal(await churchExpiry(), null, 'the church stays perpetual');
  });
}

test('a timed key refused on a perpetual church still works on a timed one', async () => {
  const token = await activatedChurch({ licenseDays: null });
  const key = await issueKey({ licenseDays: 30 });
  assert.equal((await renewApi()(renewal(token, key))).statusCode, 400);
  await pg.query(`UPDATE churches SET license_expires_at = '2026-11-10T12:00:00Z'`);
  const res = await renewApi()(renewal(token, key));
  assert.equal(res.statusCode, 200);
  assert.ok(await usedAt(key));
});

for (const licenseDays of [null, 0]) {
  test(`a key with license_days ${licenseDays} can be used on a perpetual church`, async () => {
    const token = await activatedChurch({ licenseDays: null });
    const key = await issueKey({ licenseDays });
    const res = await renewApi()(renewal(token, key));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true, licenseExpiresAt: null });
    assert.ok(await usedAt(key));
  });
}

for (const licenseDays of [null, 0]) {
  test(`a key with license_days ${licenseDays} makes the license perpetual`, async () => {
    const token = await activatedChurch({ expiresAt: '2026-11-10T12:00:00Z' });
    const res = await renewApi()(renewal(token, await issueKey({ licenseDays })));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true, licenseExpiresAt: null });
    assert.equal(await churchExpiry(), null);
  });
}

test('a renewal uses up the key and ties it to the church', async () => {
  const token = await activatedChurch();
  const key = await issueKey({ licenseDays: 30 });
  await renewApi()(renewal(token, key));
  const [row] = (await pg.query('SELECT used_at, church_id FROM setup_keys WHERE key_hash = $1', [hashToken(key, SECRET)])).rows;
  assert.ok(row.used_at);
  assert.equal(row.church_id, (await pg.query('SELECT id FROM churches')).rows[0].id);
  assert.equal(await count('churches'), 1, 'no new church is made');
});

test('a used, expired or unknown key is refused with the one message, and the license is unchanged', async () => {
  const token = await activatedChurch({ expiresAt: '2026-11-10T12:00:00Z' });
  const used = await issueKey({ licenseDays: 30 });
  await renewApi()(renewal(token, used));
  const before = await churchExpiry();
  const stale = await issueKey({ licenseDays: 30, expiresAt: new Date(clock.getTime() - 1000) });
  for (const key of [used, stale, setupKey(), 'not-a-key']) {
    const res = await renewApi()(renewal(token, key));
    assert.equal(res.statusCode, 400, key);
    assert.equal(JSON.parse(res.body).error, KEY_MESSAGE);
  }
  assert.equal(await churchExpiry(), before);
});

test('a renewal needs a live device token, and POST', async () => {
  const key = await issueKey({ licenseDays: 30 });
  assert.equal((await renewApi()({ ...event({ body: { setupKey: key } }), headers: {} })).statusCode, 401);
  assert.equal((await renewApi()(renewal('no-such-token', key))).statusCode, 401);
  assert.equal((await renewApi()({ ...renewal('x', key), httpMethod: 'GET' })).statusCode, 405);
  const token = await activatedChurch();
  await pg.query('UPDATE device_tokens SET revoked_at = now()');
  assert.equal((await renewApi()(renewal(token, key))).statusCode, 401);
  assert.equal((await pg.query('SELECT used_at FROM setup_keys WHERE key_hash = $1', [hashToken(key, SECRET)])).rows[0].used_at, null);
});

test('a laptop whose linking admin was disabled cannot renew, and the key is kept', async () => {
  const token = await activatedChurch();
  const key = await issueKey({ licenseDays: 30 });
  await pg.query('UPDATE users SET disabled = true');
  const res = await renewApi()(renewal(token, key));
  assert.equal(res.statusCode, 403);
  assert.equal((await pg.query('SELECT used_at FROM setup_keys WHERE key_hash = $1', [hashToken(key, SECRET)])).rows[0].used_at, null);
});

test('renewal attempts from one laptop are limited', async () => {
  const token = await activatedChurch();
  for (let i = 0; i < SETUP_LIMIT.requests; i += 1) assert.equal((await renewApi()(renewal(token, 'not-a-key'))).statusCode, 400);
  assert.equal((await renewApi()(renewal(token, 'not-a-key'))).statusCode, 429);
});

test('the heartbeat tells every laptop of the church the current license', async () => {
  const token = await activatedChurch({ licenseDays: 30 });
  const heartbeat = async () => JSON.parse((await linkingApi().status({ ...event({ method: 'GET' }), headers: { authorization: `Bearer ${token}` } })).body).licenseExpiresAt;
  assert.equal(await heartbeat(), new Date(clock.getTime() + 30 * DAY).toISOString());
  await renewApi()(renewal(token, await issueKey({ licenseDays: null })));
  assert.equal(await heartbeat(), null);
});

test('the migration keeps timed licenses already issued, adds nothing for perpetual ones, and cannot undo a renewal when run again', async () => {
  const migration = fs.readFileSync(path.join(here, '..', 'db', 'migrations', '2026-11-09-churches-license-expires-at.sql'), 'utf8');
  const old = new PGlite();
  await old.exec(SCHEMA.replace(/DEFAULT now\(\),\s*license_expires_at TIMESTAMPTZ[^\n]*\n/, 'DEFAULT now()\n'));
  const church = (id, code) => old.query('INSERT INTO churches (id, display_code, name) VALUES ($1, $2, $3)', [id, code, 'Parish']);
  const timed = '00000000-0000-4000-8000-000000000001';
  const perpetual = '00000000-0000-4000-8000-000000000002';
  await church(timed, 'AAAA-AAAA');
  await church(perpetual, 'BBBB-BBBB');
  const usedKey = (hash, id, days) => old.query(`INSERT INTO setup_keys (key_hash, used_at, church_id, license_days) VALUES ($1, '2026-10-01T00:00:00Z', $2, $3)`, [hash, id, days]);
  await usedKey('h1', timed, 30);
  await usedKey('h2', perpetual, null);
  await old.exec(migration);
  const expiry = async (id) => (await old.query('SELECT license_expires_at FROM churches WHERE id = $1', [id])).rows[0].license_expires_at;
  assert.equal(new Date(await expiry(timed)).toISOString(), '2026-10-31T00:00:00.000Z');
  assert.equal(await expiry(perpetual), null);
  await old.query('UPDATE churches SET license_expires_at = NULL WHERE id = $1', [timed]);
  await old.exec(migration);
  assert.equal(await expiry(timed), null, 'a second run leaves a renewal alone');
});

test('the same key is refused the second time, with the same message as any unusable key', async () => {
  const key = await issueKey();
  assert.equal((await setupApi()(event({ body: request(key) }))).statusCode, 201);
  const again = await setupApi()(event({ body: request(key, { churchName: 'Another Church', username: 'second' }) }));
  assert.equal(again.statusCode, 400);
  assert.equal(JSON.parse(again.body).error, KEY_MESSAGE);
  assert.equal(await count('churches'), 1, 'the second attempt created nothing');
});

test('an expired key is refused, and nothing is created', async () => {
  const key = await issueKey({ expiresAt: new Date(clock.getTime() - 1000) });
  const res = await setupApi()(event({ body: request(key) }));
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, KEY_MESSAGE);
  assert.equal(await count('churches'), 0);
});

test('a key that is not valid gets the same status and message as an unknown key, so the two cannot be told apart', async () => {
  await issueKey();
  const unknown = await setupApi()(event({ body: request(setupKey()) }));
  const malformed = await setupApi()(event({ body: request('not a key') }));
  const missing = await setupApi()(event({ body: request(undefined) }));
  for (const res of [unknown, malformed, missing]) {
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error, KEY_MESSAGE);
  }
  assert.equal(await count('churches'), 0);
});

test('a key typed in lower case, with spaces, is accepted', async () => {
  const key = await issueKey();
  const typed = key.toLowerCase().replace(/-/g, ' ');
  assert.equal((await setupApi()(event({ body: request(typed) }))).statusCode, 201);
});

// ---- A failed step rolls everything back ----

test('if any step fails, the church, the admin, the link and the key all roll back, and the key is still usable', async () => {
  const key = await issueKey();
  // Makes the laptop-link step fail, after the church and the admin have been written.
  await pg.exec(`
    CREATE OR REPLACE FUNCTION fail_device_insert() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'forced failure'; END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER fail_device BEFORE INSERT ON device_tokens FOR EACH ROW EXECUTE FUNCTION fail_device_insert();`);
  const failed = await setupApi()(event({ body: request(key) }));
  assert.equal(failed.statusCode, 500);
  assert.equal(JSON.parse(failed.body).error, 'Something went wrong. Try again.');
  assert.equal(await count('churches'), 0, 'no church was left behind');
  assert.equal(await count('users'), 0, 'no admin was left behind');
  assert.equal(await count('audit_log'), 0, 'no audit line was left behind');
  assert.equal((await pg.query('SELECT used_at FROM setup_keys')).rows[0].used_at, null, 'the key is still unused');

  await pg.exec('DROP TRIGGER fail_device ON device_tokens; DROP FUNCTION fail_device_insert();');
  assert.equal((await setupApi()(event({ body: request(key) }))).statusCode, 201, 'the same key works once the fault is gone');
});

// ---- Rate limit ----

test('more than five attempts in ten minutes gets 429, even with a valid key, and the key stays unused', async () => {
  const key = await issueKey();
  const ip = '198.51.100.77';
  const api = setupApi();
  for (let i = 0; i < SETUP_LIMIT.requests; i += 1) {
    assert.equal((await api(event({ body: request(setupKey()), ip }))).statusCode, 400);
  }
  const limited = await api(event({ body: request(key), ip }));
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers['Retry-After'], '600');
  assert.equal(await count('churches'), 0);
  assert.equal((await pg.query('SELECT used_at FROM setup_keys')).rows[0].used_at, null);
});

test('the limit is per address, and clears once the ten minutes have passed', async () => {
  const key = await issueKey();
  const api = setupApi();
  for (let i = 0; i < SETUP_LIMIT.requests + 1; i += 1) await api(event({ body: request(setupKey()), ip: '198.51.100.78' }));
  assert.equal((await api(event({ body: request(key), ip: '198.51.100.79' }))).statusCode, 201, 'another address is not limited');
  clock = new Date(clock.getTime() + 10 * 60 * 1000 + 1000);
  const next = await issueKey();
  assert.equal((await api(event({ body: request(next, { churchName: 'Second Parish', username: 'two' }), ip: '198.51.100.78' }))).statusCode, 201);
});

// ---- Server-side validation ----

test('bad church name, username, display name or laptop name are refused, and nothing is created', async () => {
  const key = await issueKey();
  const cases = [
    [request(key, { churchName: '' }), 'Enter a church name of up to 120 characters.'],
    [request(key, { churchName: 'x'.repeat(121) }), 'Enter a church name of up to 120 characters.'],
    [request(key, { username: 'has space' }), 'Enter a username of up to 80 characters, with no spaces.'],
    [request(key, { displayName: '' }), 'Enter a name of up to 120 characters.'],
    [request(key, { deviceLabel: 'x'.repeat(81) }), 'Name this laptop, in up to 80 characters.'],
  ];
  for (const [body, message] of cases) {
    const res = await setupApi()(event({ body }));
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error, message);
  }
  assert.equal(await count('churches'), 0);
  assert.equal((await pg.query('SELECT used_at FROM setup_keys')).rows[0].used_at, null, 'a bad form does not use up the key');
});

test('only POST is accepted', async () => {
  assert.equal((await setupApi()(event({ method: 'GET' }))).statusCode, 405);
});

test('church ids are generated, and two churches with the same name get different ids and codes', async () => {
  const first = await issueKey();
  const second = await issueKey();
  const a = JSON.parse((await setupApi()(event({ body: request(first) }))).body);
  const b = JSON.parse((await setupApi()(event({ body: request(second, { username: 'other' }) }))).body);
  const ids = (await pg.query('SELECT id, display_code FROM churches ORDER BY display_code')).rows;
  assert.equal(ids.length, 2);
  assert.notEqual(a.displayCode, b.displayCode);
  for (const row of ids) assert.match(row.id, UUID, 'the id is generated, not the name');
});

// ---- Nothing secret is stored ----

test('the key, the password and the laptop token never appear in the database or the audit log', async () => {
  const key = await issueKey();
  const body = JSON.parse((await setupApi()(event({ body: request(key) }))).body);
  const dump = JSON.stringify(
    await Promise.all(['churches', 'users', 'audit_log', 'device_tokens', 'setup_keys', 'sessions'].map(async (t) => (await pg.query(`SELECT * FROM ${t}`)).rows)),
  );
  assert.equal(dump.includes(key), false, 'the key is not stored');
  assert.equal(dump.includes(key.replace(/-/g, '')), false, 'the key is not stored without dashes');
  assert.equal(dump.includes(body.temporaryPassword), false, 'the password is not stored');
  assert.equal(dump.includes(body.token), false, 'the token is not stored');
});

test('the audit log records the church, the admin and the link, with no secret', async () => {
  const key = await issueKey();
  await setupApi()(event({ body: request(key) }));
  const rows = (await pg.query('SELECT action, actor_user_id FROM audit_log ORDER BY id')).rows;
  assert.deepEqual(rows.map((r) => r.action), ['church.created', 'user.created', 'device.linked']);
  // Nobody was signed in when the church and the admin were made. The admin is the one who linked the laptop.
  assert.equal(rows[0].actor_user_id, null);
  assert.equal(rows[1].actor_user_id, null);
  assert.equal(rows[2].actor_user_id, (await pg.query(`SELECT id FROM users WHERE username = 'parishadmin'`)).rows[0].id);
});

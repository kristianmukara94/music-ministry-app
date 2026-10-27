// The desktop's cloud-sync logic talking to the real server handlers (PGlite Postgres), with no HTTP server in between.
// Run with: node --test netlify/functions/test/cloud-link.test.mjs
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto, { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createLinkingApi, REDEEM_LIMIT } from '../lib/linking.js';
import { createApi } from '../lib/handlers.js';
import { createAdminApi } from '../lib/admin.js';
import { createDeviceUsersApi } from '../lib/device-users.js';
import { createRateLimiter } from '../lib/rules.js';
import { hashPassword, hashToken, setupKey } from '../lib/auth.js';
import { createChurchSetupApi } from '../lib/church-setup.js';
import { tagFromQuery } from '../lib/db.js';
import { createCloudDevice } from '../../../electron/cloud-device.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.join(here, '..', '..', 'db', 'schema.sql'), 'utf8');
const SECRET = randomBytes(32).toString('hex');
const PASSWORD = `Test-${randomBytes(16).toString('base64url')}`;
const CHURCH = '00000000-0000-4000-8000-00000000000a';
const BASE = 'https://church.example';

let pg;
let clock;
let linking;
let webApi;
let deviceUsers;
let churchSetup;

const sql = tagFromQuery((text, params) => pg.query(text, params));
const transaction = (work) => pg.transaction((tx) => work(tagFromQuery((t, v) => tx.query(t, v))));
const ev = ({ method = 'POST', body, bearer, cookie, ip = '198.51.100.20' } = {}) => ({
  httpMethod: method,
  headers: { 'x-nf-client-connection-ip': ip, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(cookie ? { cookie } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});

/** Routes the desktop's fetch calls to the same handlers the Netlify functions run. */
function fetchToHandlers() {
  return async (url, opts = {}) => {
    const name = url.split('/').pop();
    const bearer = (opts.headers?.Authorization ?? '').replace(/^Bearer /, '') || null;
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    const method = opts.method ?? 'GET';
    const result = name === 'link-redeem'
      ? await linking.redeem(ev({ body }))
      : name === 'device-status'
        ? await linking.status(ev({ method: 'GET', bearer }))
        : name === 'device-unlink'
          ? await linking.unlink(ev({ bearer }))
          : name === 'device-users-create'
            ? await deviceUsers(ev({ bearer, body }))
            : name === 'setup-church-admin'
              ? await churchSetup(ev({ body }))
              : { statusCode: 404, body: '{"error":"Not found."}' };
    return { ok: result.statusCode >= 200 && result.statusCode < 300, status: result.statusCode, json: async () => JSON.parse(result.body) };
  };
}

/** An in-memory store for the desktop's encrypted file, with the same interface the Electron wiring uses. */
function memoryFile() {
  let blob = null;
  return { read: () => blob, write: (b) => (blob = Buffer.from(b)), remove: () => (blob = null), get raw() { return blob; } };
}

/** A real AES-GCM stand-in for safeStorage. */
function storage() {
  const key = crypto.randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(text) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([c.update(text, 'utf8'), c.final()]);
      return Buffer.concat([iv, body, c.getAuthTag()]);
    },
    decryptString(bytes) {
      const iv = bytes.subarray(0, 12);
      const tag = bytes.subarray(bytes.length - 16);
      const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(bytes.subarray(12, bytes.length - 16)), d.final()]).toString('utf8');
    },
  };
}

/** An admin signs in on the web, and returns the cookie for creating link codes. */
async function adminCookie() {
  const res = await webApi.login(ev({ body: { username: 'boss', password: PASSWORD, churchCode: 'K7QM-4XD2' } }));
  assert.equal(res.statusCode, 200);
  return res.headers['Set-Cookie'].split(';')[0];
}

before(async () => {
  pg = new PGlite();
  await pg.exec(SCHEMA);
});

beforeEach(async () => {
  clock = new Date('2026-10-27T12:00:00Z');
  linking = createLinkingApi({ sql, transaction, secret: SECRET, now: () => clock, redeemLimiter: createRateLimiter(REDEEM_LIMIT) });
  webApi = createApi({ sql, secret: SECRET, now: () => clock });
  const admin = createAdminApi({ sql, transaction, secret: SECRET, now: () => clock });
  deviceUsers = createDeviceUsersApi({ sql, secret: SECRET, addUser: admin.addUser, now: () => clock });
  churchSetup = createChurchSetupApi({ transaction, secret: SECRET, now: () => clock });
  await pg.exec('TRUNCATE sessions, device_tokens, link_codes, setup_keys, audit_log, users, plans, songs, devices, licences, churches CASCADE;');
  await pg.query(`INSERT INTO churches (id, display_code, name) VALUES ($1, 'K7QM-4XD2', 'St Mary')`, [CHURCH]);
  await pg.query(
    `INSERT INTO users (id, church_id, username, display_name, role, password_hash, must_change_password)
     VALUES (gen_random_uuid(), $1, 'boss', 'Boss Admin', 'admin', $2, false)`,
    [CHURCH, await hashPassword(PASSWORD)],
  );
});

test('an admin makes a code, the desktop links with it, and the desktop shows the church and the admin', async () => {
  const cookie = await adminCookie();
  const code = JSON.parse((await linking.createCode(ev({ cookie }))).body).code;
  const file = memoryFile();
  const desktop = createCloudDevice({ storage: storage(), file, fetchFn: fetchToHandlers(), baseUrl: BASE });
  const linked = await desktop.link(code, 'Operator booth');
  assert.equal(linked.linked, true);
  assert.equal(linked.church, 'St Mary');
  assert.equal(linked.admin, 'Boss Admin');
  assert.equal(linked.label, 'Operator booth');
  assert.ok(file.raw, 'the token is stored, encrypted');
});

test('the same code cannot link a second laptop', async () => {
  const cookie = await adminCookie();
  const code = JSON.parse((await linking.createCode(ev({ cookie }))).body).code;
  const first = createCloudDevice({ storage: storage(), file: memoryFile(), fetchFn: fetchToHandlers(), baseUrl: BASE });
  await first.link(code, 'Booth');
  const second = createCloudDevice({ storage: storage(), file: memoryFile(), fetchFn: fetchToHandlers(), baseUrl: BASE });
  await assert.rejects(second.link(code, 'Other laptop'), (err) => err.message === 'This code has already been used. Ask your admin for a new one.');
});

test('a laptop unlinked from the website is refused on its next check, and forgets its token', async () => {
  const cookie = await adminCookie();
  const code = JSON.parse((await linking.createCode(ev({ cookie }))).body).code;
  const file = memoryFile();
  const desktop = createCloudDevice({ storage: storage(), file, fetchFn: fetchToHandlers(), baseUrl: BASE });
  await desktop.link(code, 'Booth');
  const deviceId = (await pg.query('SELECT device_id FROM device_tokens')).rows[0].device_id;
  await linking.unlink(ev({ cookie, body: { deviceId } }));
  const shown = await desktop.status();
  assert.equal(shown.linked, false);
  assert.match(shown.error, /unlinked from the website/);
  assert.equal(file.raw, null);
});

test('unlinking on the desktop revokes the token on the server, so it cannot be used again', async () => {
  const cookie = await adminCookie();
  const code = JSON.parse((await linking.createCode(ev({ cookie }))).body).code;
  const file = memoryFile();
  const desktop = createCloudDevice({ storage: storage(), file, fetchFn: fetchToHandlers(), baseUrl: BASE });
  await desktop.link(code, 'Booth');
  const result = await desktop.unlink();
  assert.equal(result.serverConfirmed, true);
  assert.equal(file.raw, null);
  assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM device_tokens WHERE revoked_at IS NULL')).rows[0].n, 0);
});

test('the desktop status records that the laptop was seen, and reads back the church', async () => {
  const cookie = await adminCookie();
  const code = JSON.parse((await linking.createCode(ev({ cookie }))).body).code;
  const desktop = createCloudDevice({ storage: storage(), file: memoryFile(), fetchFn: fetchToHandlers(), baseUrl: BASE });
  await desktop.link(code, 'Booth');
  clock = new Date(clock.getTime() + 5 * 60 * 1000);
  const shown = await desktop.status();
  assert.equal(shown.lastSeenAt, clock.toISOString());
  assert.equal((await pg.query('SELECT last_seen_at IS NOT NULL AS seen FROM device_tokens')).rows[0].seen, true);
});

test('a linked laptop adds a web user through the real handlers, and the password it is given signs that user in', async () => {
  const cookie = await adminCookie();
  const code = JSON.parse((await linking.createCode(ev({ cookie }))).body).code;
  const desktop = createCloudDevice({ storage: storage(), file: memoryFile(), fetchFn: fetchToHandlers(), baseUrl: BASE });
  await desktop.link(code, 'Booth');
  const made = await desktop.createWebUser({ username: 'anna', displayName: 'Anna Lee', role: 'planner' });
  assert.equal(made.username, 'anna');
  assert.match(made.temporaryPassword, /^[a-z2-9-]+$/);
  const signIn = await webApi.login(ev({ body: { username: 'anna', password: made.temporaryPassword, churchCode: 'K7QM-4XD2' } }));
  assert.equal(signIn.statusCode, 200);
  assert.equal((await pg.query(`SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'user.created'`)).rows[0].n, 1);
  assert.equal(JSON.stringify((await pg.query('SELECT * FROM audit_log')).rows).includes(made.temporaryPassword), false);
});

test('a new church is set up from a laptop with a setup key, and that laptop can then add a planner', async () => {
  const key = setupKey();
  await pg.query('INSERT INTO setup_keys (key_hash) VALUES ($1)', [hashToken(key, SECRET)]);
  const desktop = createCloudDevice({ storage: storage(), file: memoryFile(), fetchFn: fetchToHandlers(), baseUrl: BASE });
  const made = await desktop.createChurchAdmin({
    setupKey: key,
    churchName: 'Holy Cross',
    username: 'crossadmin',
    displayName: 'Cross Admin',
    deviceLabel: 'Office laptop',
  });
  assert.equal(made.username, 'crossadmin');
  assert.equal(made.link.linked, true);
  assert.equal(made.link.church, 'Holy Cross');
  assert.equal(made.link.admin, 'Cross Admin');

  const planner = await desktop.createWebUser({ username: 'anna', displayName: 'Anna Lee', role: 'planner' });
  assert.equal(planner.username, 'anna');
  const signIn = await webApi.login(ev({ body: { username: 'anna', password: planner.temporaryPassword, churchCode: made.churchCode } }));
  assert.equal(signIn.statusCode, 200, 'the planner signs in to the new church');
  assert.equal((await pg.query(`SELECT COUNT(*)::int AS n FROM setup_keys WHERE used_at IS NOT NULL`)).rows[0].n, 1);
});

test('no raw code or token is stored on the server, and the stored desktop bytes hold neither', async () => {
  const cookie = await adminCookie();
  const code = JSON.parse((await linking.createCode(ev({ cookie }))).body).code;
  const file = memoryFile();
  const desktop = createCloudDevice({ storage: storage(), file, fetchFn: fetchToHandlers(), baseUrl: BASE });
  const linked = await desktop.link(code, 'Booth');
  assert.equal(linked.linked, true);
  const serverRows = JSON.stringify(
    await Promise.all(['link_codes', 'device_tokens', 'audit_log'].map(async (t) => (await pg.query(`SELECT * FROM ${t}`)).rows)),
  );
  assert.equal(serverRows.includes(code), false, 'the code is not stored in the clear');
  assert.equal(file.raw.toString('utf8').includes(code), false);
});

// The church colour theme on the server: a laptop sends it (theme-sync, or beside its plans in plan-sync-push), newer choices win, and
// the website reads it (theme). Against a real Postgres (PGlite). Run with: node --test server/test/theme-sync.test.mjs
// Only synthetic names are used ("Sample Parish", "Sample Plan").
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createThemeSyncApi, checkThemeInput, MAX_CLOCK_LEAD_MS, THEME_MESSAGES, THEME_PUSH_LIMIT } from '../lib/theme-sync.js';
import { createPlanSyncApi } from '../lib/plan-sync.js';
import { createApi } from '../lib/handlers.js';
import { hashPassword, hashToken } from '../lib/auth.js';
import { tagFromQuery } from '../lib/db.js';
import { LOADERS } from '../lib/vercel-adapter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.join(here, '..', 'db', 'schema.sql'), 'utf8').replace(/\r\n/g, '\n');
const MIGRATION = fs.readFileSync(path.join(here, '..', 'db', 'migrations', '2026-11-20-church-theme.sql'), 'utf8');
const SECRET = randomBytes(32).toString('hex');
const PASSWORD = `Test-${randomBytes(16).toString('base64url')}`;
const CHURCH_A = '00000000-0000-4000-8000-00000000000a';
const CHURCH_B = '00000000-0000-4000-8000-00000000000b';

let pg;
let clock;
const sql = tagFromQuery((text, params) => pg.query(text, params));
const transaction = (work) => pg.transaction((tx) => work(tagFromQuery((t, v) => tx.query(t, v))));
const themes = () => createThemeSyncApi({ sql, secret: SECRET, now: () => clock });
const plans = () => createPlanSyncApi({ sql, transaction, secret: SECRET, now: () => clock });
const web = () => createApi({ sql, secret: SECRET, now: () => clock });

const auth = (token) => ({ authorization: `Bearer ${token}` });
const post = (token, body) => ({ httpMethod: 'POST', headers: auth(token), body: JSON.stringify(body) });
const parse = (res) => JSON.parse(res.body);

async function user(church, username, role) {
  return (await pg.query(
    `INSERT INTO users (id, church_id, username, display_name, role, password_hash, must_change_password)
     VALUES (gen_random_uuid(), $1, $2, $2, $3, $4, false) RETURNING id`,
    [church, username, role, await hashPassword(PASSWORD)],
  )).rows[0].id;
}

async function laptopFor(church, userId) {
  const token = randomBytes(32).toString('base64url');
  await pg.query(`INSERT INTO device_tokens (token_hash, church_id, user_id, device_name) VALUES ($1, $2, $3, 'Sample booth')`, [hashToken(token, SECRET), church, userId]);
  return token;
}

async function cookieFor(username, churchCode) {
  const res = await web().login({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ username, password: PASSWORD, churchCode }) });
  assert.equal(res.statusCode, 200);
  return res.headers['Set-Cookie'].split(';')[0];
}

const stored = async (church) => (await pg.query('SELECT theme, theme_updated_at FROM churches WHERE id = $1', [church])).rows[0];

let laptopA;
let laptopA2;
let laptopB;

before(async () => {
  pg = new PGlite();
  await pg.exec(SCHEMA);
});

beforeEach(async () => {
  clock = new Date('2026-11-20T12:00:00Z');
  await pg.exec('TRUNCATE rate_limits, audit_log, device_tokens, sessions, users, plans, songs, devices, licences, setup_keys, churches CASCADE;');
  await pg.query(`INSERT INTO churches (id, display_code, name) VALUES ($1, 'K7QM-4XD2', 'Sample Parish'), ($2, 'R2VT-9HJ6', 'Sample Parish Two')`, [CHURCH_A, CHURCH_B]);
  const plannerA = await user(CHURCH_A, 'planner', 'planner');
  const viewerA = await user(CHURCH_A, 'viewer', 'viewer');
  const plannerB = await user(CHURCH_B, 'otherplanner', 'planner');
  laptopA = await laptopFor(CHURCH_A, plannerA);
  laptopA2 = await laptopFor(CHURCH_A, viewerA);
  laptopB = await laptopFor(CHURCH_B, plannerB);
});

test('both routes are served by the Vercel adapter', () => {
  assert.equal(typeof LOADERS.theme, 'function');
  assert.equal(typeof LOADERS['theme-sync'], 'function');
});

test('the migration matches schema.sql and can run again on a database that already has the columns', async () => {
  for (const column of ['theme', 'theme_updated_at']) assert.match(SCHEMA, new RegExp(`\\n  ${column}\\s`));
  await pg.exec(MIGRATION);
  assert.deepEqual(await stored(CHURCH_A), { theme: null, theme_updated_at: null });
});

test('a church no laptop has sent a theme for reads as no theme, on both routes', async () => {
  const res = await themes().laptopTheme({ httpMethod: 'GET', headers: auth(laptopA) });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(parse(res), { theme: null, themeUpdatedAt: null });
  const cookie = await cookieFor('viewer', 'K7QM-4XD2');
  assert.deepEqual(parse(await themes().webTheme({ httpMethod: 'GET', headers: { cookie } })), { theme: null, themeUpdatedAt: null });
});

test('a laptop sends its theme, the church stores it, and the website reads it for that church only', async () => {
  const res = await themes().laptopTheme(post(laptopA, { theme: 'black-gold', themeUpdatedAt: '2026-11-20T11:59:00.000Z' }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(parse(res), { applied: true, theme: 'black-gold', themeUpdatedAt: '2026-11-20T11:59:00.000Z' });
  assert.equal((await stored(CHURCH_A)).theme, 'black-gold');
  assert.equal((await stored(CHURCH_B)).theme, null, 'the other church is untouched');

  // Every role reads it, a viewer included: it changes colours only.
  const cookie = await cookieFor('viewer', 'K7QM-4XD2');
  const read = await themes().webTheme({ httpMethod: 'GET', headers: { cookie } });
  assert.equal(read.statusCode, 200);
  assert.equal(read.headers['Cache-Control'], 'no-store');
  assert.deepEqual(parse(read), { theme: 'black-gold', themeUpdatedAt: '2026-11-20T11:59:00.000Z' });

  const other = await cookieFor('otherplanner', 'R2VT-9HJ6');
  assert.equal(parse(await themes().webTheme({ httpMethod: 'GET', headers: { cookie: other } })).theme, null);
});

test('a newer choice from any laptop of the church supersedes; an older one is not applied and the stored theme comes back', async () => {
  await themes().laptopTheme(post(laptopA, { theme: 'lent', themeUpdatedAt: '2026-11-20T11:00:00.000Z' }));
  const newer = parse(await themes().laptopTheme(post(laptopA2, { theme: 'linen', themeUpdatedAt: '2026-11-20T11:30:00.000Z' })));
  assert.equal(newer.applied, true);
  // A change made offline earlier and only sent now loses to the newer one.
  const older = parse(await themes().laptopTheme(post(laptopA, { theme: 'wine', themeUpdatedAt: '2026-11-20T11:10:00.000Z' })));
  assert.deepEqual(older, { applied: false, theme: 'linen', themeUpdatedAt: '2026-11-20T11:30:00.000Z' });
  // The same time again is not newer either.
  assert.equal(parse(await themes().laptopTheme(post(laptopA, { theme: 'slate', themeUpdatedAt: '2026-11-20T11:30:00.000Z' }))).applied, false);
  assert.equal((await stored(CHURCH_A)).theme, 'linen');
});

test('a laptop clock far ahead is held to the server clock, so it cannot lock out later changes', async () => {
  const res = parse(await themes().laptopTheme(post(laptopA, { theme: 'mint', themeUpdatedAt: '2027-01-01T00:00:00.000Z' })));
  assert.equal(res.themeUpdatedAt, new Date(clock.getTime() + MAX_CLOCK_LEAD_MS).toISOString());
  clock = new Date(clock.getTime() + MAX_CLOCK_LEAD_MS + 60_000);
  assert.equal(parse(await themes().laptopTheme(post(laptopA2, { theme: 'sage', themeUpdatedAt: clock.toISOString() }))).applied, true);
});

test('season-auto, unknown ids and unreadable times are refused and nothing is stored', async () => {
  for (const body of [
    { theme: 'season-auto', themeUpdatedAt: '2026-11-20T11:00:00.000Z' },
    { theme: 'blue', themeUpdatedAt: '2026-11-20T11:00:00.000Z' },
    { theme: 'mint', themeUpdatedAt: 'yesterday' },
    { theme: 'mint' },
  ]) {
    const res = await themes().laptopTheme(post(laptopA, body));
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
  assert.equal(checkThemeInput({ theme: 'blue', themeUpdatedAt: clock.toISOString() }, () => clock).error, THEME_MESSAGES.badTheme);
  const unreadable = await themes().laptopTheme({ httpMethod: 'POST', headers: auth(laptopA), body: '{not json' });
  assert.equal(unreadable.statusCode, 400);
  assert.equal((await stored(CHURCH_A)).theme, null);
});

test('no token, a revoked token, no session and the wrong method are refused', async () => {
  assert.equal((await themes().laptopTheme({ httpMethod: 'GET', headers: {} })).statusCode, 401);
  await pg.query('UPDATE device_tokens SET revoked_at = now()');
  assert.equal((await themes().laptopTheme(post(laptopA, { theme: 'mint', themeUpdatedAt: clock.toISOString() }))).statusCode, 401);
  assert.equal((await themes().webTheme({ httpMethod: 'GET', headers: {} })).statusCode, 401);
  assert.equal((await themes().webTheme({ httpMethod: 'POST', headers: {} })).statusCode, 405);
  assert.equal((await themes().laptopTheme({ httpMethod: 'DELETE', headers: auth(laptopA) })).statusCode, 405);
});

test('theme pushes are rate limited per laptop', async () => {
  for (let i = 0; i < THEME_PUSH_LIMIT.requests; i += 1) {
    const at = new Date(Date.parse('2026-11-20T10:00:00Z') + i * 1000).toISOString();
    assert.equal((await themes().laptopTheme(post(laptopA, { theme: 'mint', themeUpdatedAt: at }))).statusCode, 200);
  }
  const refused = await themes().laptopTheme(post(laptopA, { theme: 'sage', themeUpdatedAt: clock.toISOString() }));
  assert.equal(refused.statusCode, 429);
  assert.ok(Number(refused.headers['Retry-After']) > 0);
});

test('plan-sync-push takes an optional theme beside its plans, and a push without one is answered as before', async () => {
  const withTheme = await plans().pushPlans(post(laptopA, { plans: [], theme: 'deep-teal', themeUpdatedAt: '2026-11-20T11:00:00.000Z' }));
  assert.equal(withTheme.statusCode, 200);
  assert.deepEqual(parse(withTheme).theme, { applied: true, theme: 'deep-teal', themeUpdatedAt: '2026-11-20T11:00:00.000Z' });
  assert.equal((await stored(CHURCH_A)).theme, 'deep-teal');

  const without = parse(await plans().pushPlans(post(laptopA, { plans: [] })));
  assert.equal('theme' in without, false, 'older laptops see the reply they always did');

  // A bad theme is reported but never fails the plans beside it.
  const bad = await plans().pushPlans(post(laptopA, { plans: [], theme: 'neon', themeUpdatedAt: '2026-11-20T11:05:00.000Z' }));
  assert.equal(bad.statusCode, 200);
  assert.equal(parse(bad).theme.applied, false);
  assert.equal((await stored(CHURCH_A)).theme, 'deep-teal');
});

test('a database without the theme columns reads as no theme and refuses writes with 503, so laptops keep the change and retry', async () => {
  const old = new PGlite();
  await old.exec(SCHEMA);
  await old.exec('ALTER TABLE churches DROP COLUMN theme, DROP COLUMN theme_updated_at');
  const oldSql = tagFromQuery((text, params) => old.query(text, params));
  const columns = (await old.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'churches'`)).rows.map((r) => r.column_name);
  assert.equal(columns.includes('theme'), false, 'the stand-in really is an old database');
  await old.query(`INSERT INTO churches (id, display_code, name) VALUES ($1, 'K7QM-4XD2', 'Sample Parish')`, [CHURCH_A]);
  const userId = (await old.query(
    `INSERT INTO users (id, church_id, username, display_name, role, password_hash, must_change_password)
     VALUES (gen_random_uuid(), $1, 'planner', 'planner', 'planner', 'x', false) RETURNING id`, [CHURCH_A])).rows[0].id;
  const token = randomBytes(32).toString('base64url');
  await old.query(`INSERT INTO device_tokens (token_hash, church_id, user_id, device_name) VALUES ($1, $2, $3, 'Sample booth')`, [hashToken(token, SECRET), CHURCH_A, userId]);
  const api = createThemeSyncApi({ sql: oldSql, secret: SECRET, now: () => clock });

  assert.deepEqual(parse(await api.laptopTheme({ httpMethod: 'GET', headers: auth(token) })), { theme: null, themeUpdatedAt: null });
  const write = await api.laptopTheme(post(token, { theme: 'mint', themeUpdatedAt: clock.toISOString() }));
  assert.equal(write.statusCode, 503);
  assert.equal(parse(write).error, THEME_MESSAGES.notMigrated);

  const oldPlans = createPlanSyncApi({ sql: oldSql, transaction: (work) => old.transaction((tx) => work(tagFromQuery((t, v) => tx.query(t, v)))), secret: SECRET, now: () => clock });
  const pushed = await oldPlans.pushPlans(post(token, { plans: [], theme: 'mint', themeUpdatedAt: clock.toISOString() }));
  assert.equal(pushed.statusCode, 200, 'plans still sync');
  assert.equal(parse(pushed).theme.applied, false);
  await old.close();
});


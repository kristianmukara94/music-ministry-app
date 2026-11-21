// Plan push results that say why, multi-schedule Holy Mass plans on one date, and a database that has not had the synced_at migration yet.
// Against a real Postgres (PGlite). Run with: node --test server/test/plan-sync-errors.test.mjs
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createPlanSyncApi, PUSH_REFUSALS } from '../lib/plan-sync.js';
import { createPlanEditingApi } from '../lib/plan-editing.js';
import { createApi } from '../lib/handlers.js';
import { describeDbError, resetSchemaGuard } from '../lib/schema-guard.js';
import { hashPassword, hashToken } from '../lib/auth.js';
import { tagFromQuery } from '../lib/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.join(here, '..', 'db', 'schema.sql'), 'utf8');
const SECRET = randomBytes(32).toString('hex');
const PASSWORD = `Test-${randomBytes(16).toString('base64url')}`;
const CHURCH_A = '00000000-0000-4000-8000-0000000000a1';
const CHURCH_B = '00000000-0000-4000-8000-0000000000b1';
const SONG = randomUUID();

let pg;
let clock;
let laptopA;
const sql = tagFromQuery((text, params) => pg.query(text, params));
const transaction = (work) => pg.transaction((tx) => work(tagFromQuery((t, v) => tx.query(t, v))));
const sync = () => createPlanSyncApi({ sql, transaction, secret: SECRET, now: () => clock });
const editing = () => createPlanEditingApi({ sql, transaction, secret: SECRET, now: () => clock });
const web = () => createApi({ sql, secret: SECRET, now: () => clock });

const item = (key, order, extra = {}) => ({ key: String(key), group: 'introductory', order, kind: 'rite', ...extra });
const plan = (over = {}) => ({ id: randomUUID(), name: 'Sample Plan Title', date: '2026-12-06', kind: 'mass', baseUpdatedAt: null, items: [item(1, 1)], ...over });
const headers = (token) => ({ authorization: `Bearer ${token}` });
const create = (token, p) => sync().createPlan({ httpMethod: 'POST', headers: headers(token), body: JSON.stringify(p) });
const push = async (token, plans) => JSON.parse((await sync().pushPlans({ httpMethod: 'POST', headers: headers(token), body: JSON.stringify({ plans }) })).body);
const row = async (id) => (await pg.query('SELECT name, body, updated_at FROM plans WHERE id = $1', [id])).rows[0];

async function user(church, username) {
  return (await pg.query(
    `INSERT INTO users (id, church_id, username, display_name, role, password_hash, must_change_password)
     VALUES (gen_random_uuid(), $1, $2, $2, 'planner', $3, false) RETURNING id`,
    [church, username, await hashPassword(PASSWORD)],
  )).rows[0].id;
}
async function laptopFor(church, userId) {
  const token = randomBytes(32).toString('base64url');
  await pg.query(`INSERT INTO device_tokens (token_hash, church_id, user_id, device_name) VALUES ($1, $2, $3, 'Sample Laptop')`, [hashToken(token, SECRET), church, userId]);
  return token;
}
/** Creates a plan from the laptop and returns its stored time, the base the next push names. */
async function made(p) {
  const res = await create(laptopA, p);
  assert.equal(res.statusCode, 201, res.body);
  return JSON.parse(res.body).plan.updatedAt;
}

before(async () => {
  pg = new PGlite();
  await pg.exec(SCHEMA);
});

beforeEach(async () => {
  resetSchemaGuard();
  clock = new Date('2026-11-21T08:00:00Z');
  // Every test starts from the full schema, including tests that drop a column.
  await pg.exec('ALTER TABLE plans ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;');
  await pg.exec('TRUNCATE rate_limits, audit_log, device_tokens, sessions, users, plans, songs, devices, licences, setup_keys, churches CASCADE;');
  await pg.query(`INSERT INTO churches (id, display_code, name) VALUES ($1, 'K7QM-4XD2', 'Sample Church'), ($2, 'R2VT-9HJ6', 'Other Sample Church')`, [CHURCH_A, CHURCH_B]);
  laptopA = await laptopFor(CHURCH_A, await user(CHURCH_A, 'sampleplanner'));
  await pg.query(`INSERT INTO songs (id, church_id, title, category, language, musical_key, updated_at) VALUES ($1, $2, 'Sample Song Title', 'Entrance Procession', 'English', 'D', now())`, [SONG, CHURCH_A]);
});

test('two Holy Mass schedules on one date are created and updated from the laptop, each keeping its own time and language', async () => {
  const early = plan({ name: 'Sample Plan Title 6AM', massTime: '6:00 AM', massLanguage: 'Cebuano' });
  const late = plan({ name: 'Sample Plan Title 9AM', massTime: '9:00 AM', massLanguage: 'English' });
  const earlyAt = await made(early);
  const lateAt = await made(late);
  clock = new Date('2026-11-21T08:05:00Z');
  const res = await push(laptopA, [
    { ...early, baseUpdatedAt: earlyAt, items: [item(1, 1, { kind: 'song', songId: SONG, slot: 1 })] },
    { ...late, name: 'Sample Plan Title 9AM (updated)', baseUpdatedAt: lateAt },
  ]);
  assert.deepEqual(res.results.map((r) => r.status), ['accepted', 'accepted']);
  assert.deepEqual(res.counts, { accepted: 2, conflict: 0, error: 0 });
  assert.equal((await row(early.id)).body.massTime, '6:00 AM');
  assert.equal((await row(early.id)).body.items[0].songId, SONG);
  assert.equal((await row(late.id)).body.massLanguage, 'English');
  assert.equal((await row(late.id)).name, 'Sample Plan Title 9AM (updated)');
});

test('a laptop push is never refused over a Holy Mass time another plan on the date already has', async () => {
  const first = plan({ massTime: '7:00 AM', massLanguage: 'English' });
  const second = plan({ massTime: '8:00 AM', massLanguage: 'Tagalog' });
  await made(first);
  const at = await made(second);
  const res = await push(laptopA, [{ ...second, massTime: '07:00', baseUpdatedAt: at }]);
  assert.equal(res.results[0].status, 'accepted');
});

test('a Praise & Worship plan shares a date with Holy Mass plans and is updated on its own', async () => {
  await made(plan({ massTime: '6:00 AM', massLanguage: 'English' }));
  const pw = plan({ kind: 'pw', name: 'Sample Segment Night', items: [item('worship', 1, { kind: 'song', songId: SONG, group: 'worship' })] });
  const at = await made(pw);
  const res = await push(laptopA, [{ ...pw, baseUpdatedAt: at, items: [...pw.items, item('closing', 2, { group: 'closing' })] }]);
  assert.equal(res.results[0].status, 'accepted');
  assert.equal((await row(pw.id)).body.items.length, 2);
  assert.equal((await row(pw.id)).body.massTime, undefined, 'a Praise & Worship plan has no Holy Mass time');
});

test('one batch returns a separate, structured reason for each plan, and the good plan is still saved', async () => {
  const good = plan();
  const goodAt = await made(good);
  const pw = plan({ kind: 'pw' });
  const pwAt = await made(pw);
  const res = await push(laptopA, [
    { ...good, name: 'Sample Plan Title (updated)', baseUpdatedAt: goodAt },
    plan({ baseUpdatedAt: goodAt }),
    { ...pw, kind: 'mass', baseUpdatedAt: pwAt },
    { ...good, id: randomUUID(), items: [{ ...item(1, 1), lyrics: 'Sample' }], baseUpdatedAt: goodAt },
    { ...good, id: 'not-a-uuid' },
    { ...good, id: randomUUID(), baseUpdatedAt: 'yesterday' },
  ]);
  const shape = res.results.map((r) => [r.status, r.code ?? null]);
  assert.deepEqual(shape, [
    ['accepted', null],
    ['error', 'not_on_website'],
    ['error', 'kind_changed'],
    ['error', 'invalid'],
    ['error', 'invalid_id'],
    ['error', 'invalid_base'],
  ]);
  assert.equal(res.results[1].message, PUSH_REFUSALS.not_on_website);
  assert.equal(res.results[2].message, PUSH_REFUSALS.kind_changed);
  assert.match(res.results[3].message, /never leave the laptop/);
  for (const r of res.results.filter((x) => x.status === 'error')) {
    assert.ok(typeof r.message === 'string' && r.message.length > 20 && r.message.length <= 200, 'each reason is a plain sentence the laptop can show');
    assert.doesNotMatch(r.message, /could not be saved\. Try again, or ask your admin/, 'no generic fallback');
  }
  assert.equal((await row(good.id)).name, 'Sample Plan Title (updated)');
  assert.deepEqual(res.counts, { accepted: 1, conflict: 0, error: 5 });
});

test('a push for a plan of another church says the same as one for an id nobody has', async () => {
  const theirs = randomUUID();
  await pg.query(`INSERT INTO plans (id, church_id, name, liturgical_date, body, updated_at) VALUES ($1, $2, 'Other Sample', '2026-12-06', '{"kind":"mass","items":[]}', now())`, [theirs, CHURCH_B]);
  const res = await push(laptopA, [plan({ id: theirs, baseUpdatedAt: '2026-11-21T08:00:00.000Z' }), plan({ baseUpdatedAt: '2026-11-21T08:00:00.000Z' })]);
  const [a, b] = res.results.map(({ id: _id, ...rest }) => rest);
  assert.deepEqual(a, b);
  assert.equal((await row(theirs)).name, 'Other Sample', "another church's plan is untouched");
});

test('a database without plans.synced_at still creates, pushes, pulls, lists and saves plans', async () => {
  await pg.exec('ALTER TABLE plans DROP COLUMN synced_at;');
  const p = plan({ massTime: '6:00 AM', massLanguage: 'Cebuano' });
  const at = await made(p);
  clock = new Date('2026-11-21T08:10:00Z');
  const pushed = await push(laptopA, [{ ...p, name: 'Sample Plan Title (laptop edit)', baseUpdatedAt: at }]);
  assert.equal(pushed.results[0].status, 'accepted', JSON.stringify(pushed.results[0]));

  const pull = await sync().pullPlans({ httpMethod: 'GET', headers: headers(laptopA), queryStringParameters: null });
  assert.equal(pull.statusCode, 200);
  assert.deepEqual(JSON.parse(pull.body).plans.map((x) => [x.name, x.massTime]), [['Sample Plan Title (laptop edit)', '6:00 AM']]);

  const login = await web().login({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ username: 'sampleplanner', password: PASSWORD, churchCode: 'K7QM-4XD2' }) });
  const cookie = login.headers['Set-Cookie'].split(';')[0];
  const list = await web().plans({ httpMethod: 'GET', headers: { cookie } });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(JSON.parse(list.body).plans.map((x) => [x.name, x.synced_at, x.massTime]), [['Sample Plan Title (laptop edit)', null, '6:00 AM']]);

  const stored = new Date((await row(p.id)).updated_at).toISOString();
  const saved = await editing().savePlan({ httpMethod: 'POST', headers: { cookie }, body: JSON.stringify({ id: p.id, baseUpdatedAt: stored, items: [item(1, 1), item(2, 2)] }) });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal((await row(p.id)).body.items.length, 2);
});

test('database errors become plain, specific reasons and never the database text', () => {
  const missing = describeDbError(Object.assign(new Error('column "synced_at" of relation "plans" does not exist'), { code: '42703' }));
  assert.equal(missing.code, 'db_schema');
  assert.match(missing.message, /missing "synced_at"\. Ask your admin to run the latest database migration/);
  assert.equal(describeDbError(Object.assign(new Error('x'), { code: '42P01' })).code, 'db_schema');
  assert.equal(describeDbError(Object.assign(new Error('dup'), { code: '23505' })).code, 'db_conflict');
  assert.equal(describeDbError(Object.assign(new Error('chk'), { code: '23514' })).code, 'db_rejected');
  assert.equal(describeDbError(Object.assign(new Error('ser'), { code: '40001' })).code, 'busy');
  assert.equal(describeDbError(Object.assign(new Error('auth failed for secret-user'), { code: '28P01' })).code, 'db_unavailable');
  assert.equal(describeDbError(Object.assign(new Error('fetch failed'), { name: 'NeonDbError' })).code, 'db_unavailable');
  const other = describeDbError(new TypeError('Sample internal detail'));
  assert.equal(other.code, 'server_error');
  assert.doesNotMatch(other.message, /Sample internal detail/);
  for (const r of [missing, other]) assert.ok(r.message.length <= 200, 'short enough for the laptop to show');
});

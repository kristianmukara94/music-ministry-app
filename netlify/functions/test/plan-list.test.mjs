// Tests for the plans list and opening a plan, against a real Postgres (PGlite). Every signed-in role can list and open a plan; only
// planners and admins can save. The church always comes from the session. Run with:
//   node --test netlify/functions/test/plan-list.test.mjs
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createApi } from '../lib/handlers.js';
import { createPlanEditingApi } from '../lib/plan-editing.js';
import { hashPassword } from '../lib/auth.js';
import { tagFromQuery } from '../lib/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.join(here, '..', '..', 'db', 'schema.sql'), 'utf8');
const SECRET = randomBytes(32).toString('hex');
const PASSWORD = `Test-${randomBytes(16).toString('base64url')}`;
const CHURCH_A = '00000000-0000-4000-8000-00000000000a';
const CHURCH_B = '00000000-0000-4000-8000-00000000000b';
const ZETA = '10000000-0000-4000-8000-00000000000a';
const ALPHA = '10000000-0000-4000-8000-00000000000c';
const BETA = '10000000-0000-4000-8000-00000000000d';
const OTHER = '10000000-0000-4000-8000-00000000000b';
const NOT_FOUND = '10000000-0000-4000-8000-0000000000ff';
const PLAIN_NOT_FOUND = 'That plan is not in your church.';

let pg;
let clock;

const sql = tagFromQuery((text, params) => pg.query(text, params));
const transaction = (work) => pg.transaction((tx) => work(tagFromQuery((t, v) => tx.query(t, v))));
const web = () => createApi({ sql, secret: SECRET, now: () => clock });
const editing = () => createPlanEditingApi({ sql, transaction, secret: SECRET, now: () => clock });

const event = ({ method = 'GET', body, cookie, query } = {}) => ({
  httpMethod: method,
  headers: cookie ? { cookie } : {},
  body: body === undefined ? undefined : JSON.stringify(body),
  queryStringParameters: query,
});

async function cookieFor(username, churchCode) {
  const res = await web().login(event({ method: 'POST', body: { username, password: PASSWORD, churchCode } }));
  assert.equal(res.statusCode, 200, `${username} signs in`);
  return res.headers['Set-Cookie'].split(';')[0];
}

async function user(church, username, role) {
  await pg.query(
    `INSERT INTO users (id, church_id, username, display_name, role, password_hash, must_change_password)
     VALUES (gen_random_uuid(), $1, $2, $2, $3, $4, false)`,
    [church, username, role, await hashPassword(PASSWORD)],
  );
}

before(async () => {
  pg = new PGlite();
  await pg.exec(SCHEMA);
});

beforeEach(async () => {
  clock = new Date('2026-10-27T12:00:00Z');
  await pg.exec('TRUNCATE rate_limits, sessions, device_tokens, link_codes, audit_log, users, plans, songs, devices, licences, setup_keys, churches CASCADE;');
  await pg.query(`INSERT INTO churches (id, display_code, name) VALUES ($1, 'K7QM-4XD2', 'St Mary'), ($2, 'R2VT-9HJ6', 'Holy Cross')`, [CHURCH_A, CHURCH_B]);
  await user(CHURCH_A, 'planner', 'planner');
  await user(CHURCH_A, 'viewer', 'viewer');
  await user(CHURCH_B, 'otherplanner', 'planner');
  // Two plans share a date, so the order by name is checked too. The body holds the plan type; the list must not send it.
  await pg.query(
    `INSERT INTO plans (id, church_id, name, liturgical_date, body, updated_at) VALUES
       ($1, $2, 'Zeta Praise Night', '2026-11-08', '{"kind":"pw","segments":{"1":{"minutes":5}},"notes":{}}', '2026-10-27T10:00:00Z'),
       ($3, $2, 'Alpha Mass', '2026-11-01', '{"kind":"mass","segments":{},"notes":{}}', '2026-10-27T09:00:00Z'),
       ($4, $2, 'Beta Mass', '2026-11-01', '{"kind":"mass","segments":{},"notes":{}}', '2026-10-27T11:00:00Z'),
       ($5, $6, 'Other Church Mass', '2026-11-01', '{"kind":"mass","segments":{},"notes":{}}', '2026-10-27T10:00:00Z')`,
    [ZETA, CHURCH_A, ALPHA, BETA, OTHER, CHURCH_B],
  );
});

// ---- Listing ----

test('a viewer can list the plans, and sees each plan with its name, date and updated time, sorted by date then name', async () => {
  const cookie = await cookieFor('viewer', 'K7QM-4XD2');
  const res = await web().plans(event({ cookie }));
  assert.equal(res.statusCode, 200);
  const plans = JSON.parse(res.body).plans;
  assert.deepEqual(plans.map((p) => p.name), ['Alpha Mass', 'Beta Mass', 'Zeta Praise Night']);
  assert.equal(plans[0].liturgical_date, '2026-11-01', 'the date is a plain date');
  assert.equal(plans[0].updated_at, '2026-10-27T09:00:00.000Z');
  assert.equal(plans[2].kind, 'pw', 'the plan type is sent, so the list can link to the right editor');
});

test('the list does not send the plan body: only the list fields are in each entry', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  const plans = JSON.parse((await web().plans(event({ cookie }))).body).plans;
  for (const plan of plans) {
    assert.deepEqual(Object.keys(plan).sort(), ['id', 'kind', 'liturgical_date', 'name', 'updated_at']);
  }
  assert.equal(JSON.stringify(plans).includes('segments'), false, 'no segments in the list');
});

test('a planner from church A sees only church A\'s plans', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  const names = JSON.parse((await web().plans(event({ cookie }))).body).plans.map((p) => p.name);
  assert.equal(names.includes('Other Church Mass'), false);
  assert.equal(names.length, 3);
});

test('an empty church gets an empty list and the plain message', async () => {
  await pg.query(`INSERT INTO churches (id, display_code, name) VALUES ('00000000-0000-4000-8000-00000000000e', 'B8NW-3PL5', 'New Parish')`);
  await user('00000000-0000-4000-8000-00000000000e', 'newplanner', 'planner');
  const cookie = await cookieFor('newplanner', 'B8NW-3PL5');
  const body = JSON.parse((await web().plans(event({ cookie }))).body);
  assert.deepEqual(body.plans, []);
  assert.equal(body.message, 'No plans yet. Plans are created on the church laptop and appear here after sync.');
});

// ---- Opening a plan ----

test('a viewer can open a plan from the list, and is told they cannot edit it', async () => {
  const cookie = await cookieFor('viewer', 'K7QM-4XD2');
  const res = await editing().getPlan(event({ cookie, query: { id: ALPHA } }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.plan.name, 'Alpha Mass');
  assert.equal(body.canEdit, false);
});

test('a plan from another church is refused with the same message as an id that does not exist', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  const otherChurch = await editing().getPlan(event({ cookie, query: { id: OTHER } }));
  const missing = await editing().getPlan(event({ cookie, query: { id: NOT_FOUND } }));
  assert.equal(otherChurch.statusCode, 404);
  assert.equal(missing.statusCode, 404);
  assert.equal(JSON.parse(otherChurch.body).error, PLAIN_NOT_FOUND);
  assert.equal(JSON.parse(missing.body).error, PLAIN_NOT_FOUND, 'the reply does not reveal that the plan exists');
  assert.equal(otherChurch.body, missing.body);
});

test('a planner from church B cannot list or open church A\'s plans', async () => {
  const cookie = await cookieFor('otherplanner', 'R2VT-9HJ6');
  const names = JSON.parse((await web().plans(event({ cookie }))).body).plans.map((p) => p.name);
  assert.deepEqual(names, ['Other Church Mass']);
  assert.equal((await editing().getPlan(event({ cookie, query: { id: ZETA } }))).statusCode, 404);
});

// ---- Saving stays with planners and admins ----

test('a viewer cannot save a plan, and the plan does not change', async () => {
  const before = JSON.stringify((await pg.query('SELECT body FROM plans WHERE id = $1', [ALPHA])).rows[0].body);
  const cookie = await cookieFor('viewer', 'K7QM-4XD2');
  const res = await editing().savePlan(event({ method: 'POST', cookie, body: { id: ALPHA, segments: { 1: { minutes: 9 } }, notes: {} } }));
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).error, 'Your account can view plans but not change them.');
  assert.equal(JSON.stringify((await pg.query('SELECT body FROM plans WHERE id = $1', [ALPHA])).rows[0].body), before);
});

test('a planner still saves a plan from the list', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  const res = await editing().savePlan(event({ method: 'POST', cookie, body: { id: ALPHA, segments: { 1: { minutes: 9 } }, notes: {} } }));
  assert.equal(res.statusCode, 200);
});

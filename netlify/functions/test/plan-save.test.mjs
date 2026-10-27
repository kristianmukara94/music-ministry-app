// Tests for the web plan editor's server side: reading a plan, listing songs, and saving a plan, against a real Postgres (PGlite).
// Run with: node --test netlify/functions/test/plan-save.test.mjs
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createPlanEditingApi } from '../lib/plan-editing.js';
import { createApi } from '../lib/handlers.js';
import { hashPassword } from '../lib/auth.js';
import { tagFromQuery } from '../lib/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.join(here, '..', '..', 'db', 'schema.sql'), 'utf8');
const SECRET = randomBytes(32).toString('hex');
const PASSWORD = `Test-${randomBytes(16).toString('base64url')}`;
const CHURCH_A = '00000000-0000-4000-8000-00000000000a';
const CHURCH_B = '00000000-0000-4000-8000-00000000000b';
const PLAN_A = '10000000-0000-4000-8000-00000000000a';
const PLAN_B = '10000000-0000-4000-8000-00000000000b';
const SONG_A = '20000000-0000-4000-8000-00000000000a';
const SONG_A2 = '20000000-0000-4000-8000-00000000000c';
const SONG_B = '20000000-0000-4000-8000-00000000000b';

let pg;
let clock;

const sql = tagFromQuery((text, params) => pg.query(text, params));
const transaction = (work) => pg.transaction((tx) => work(tagFromQuery((t, v) => tx.query(t, v))));
const editing = () => createPlanEditingApi({ sql, transaction, secret: SECRET, now: () => clock });
const web = () => createApi({ sql, secret: SECRET, now: () => clock });

const event = ({ method = 'POST', body, cookie, query } = {}) => ({
  httpMethod: method,
  headers: cookie ? { cookie } : {},
  body: body === undefined ? undefined : JSON.stringify(body),
  queryStringParameters: query,
});

/** Signs a user in and returns the session cookie the browser would hold. */
async function cookieFor(username, churchCode) {
  const res = await web().login(event({ body: { username, password: PASSWORD, churchCode } }));
  assert.equal(res.statusCode, 200, `${username} signs in`);
  return res.headers['Set-Cookie'].split(';')[0];
}

async function user(church, username, role, mustChange = false) {
  await pg.query(
    `INSERT INTO users (id, church_id, username, display_name, role, password_hash, must_change_password)
     VALUES (gen_random_uuid(), $1, $2, $2, $3, $4, $5)`,
    [church, username, role, await hashPassword(PASSWORD), mustChange],
  );
}

const planBody = (over = {}) => ({
  id: PLAN_A,
  segments: {
    1: { songId: SONG_A, minutes: 5 },
    2: { text: 'Psalm 24 setting', minutes: 10 },
    3: { minutes: 6 },
  },
  notes: { 3: 'Open prayer, no slides' },
  ...over,
});

const storedBody = async (planId = PLAN_A) => (await pg.query('SELECT body, updated_at FROM plans WHERE id = $1', [planId])).rows[0];
const auditRows = async () => (await pg.query('SELECT actor_user_id, action, target_plan_id, church_id FROM audit_log ORDER BY id')).rows;

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
  await user(CHURCH_A, 'boss', 'admin');
  await user(CHURCH_B, 'otherplanner', 'planner');
  await pg.query(
    `INSERT INTO plans (id, church_id, name, liturgical_date, body, updated_at) VALUES
       ($1, $2, 'All Saints, Sunday Mass', '2026-11-01', '{"kind":"mass","segments":{},"notes":{}}', '2026-10-27T10:00:00Z'),
       ($3, $4, 'Other church plan', '2026-11-01', '{"kind":"mass","segments":{},"notes":{}}', '2026-10-27T10:00:00Z')`,
    [PLAN_A, CHURCH_A, PLAN_B, CHURCH_B],
  );
  await pg.query(
    `INSERT INTO songs (id, church_id, title, category, language, musical_key, updated_at) VALUES
       ($1, $2, 'Praise to the Lord', 'Entrance', 'English', 'D', now()),
       ($3, $2, 'Psalm 24 setting', 'Responsorial Psalm', 'English', 'F', now()),
       ($4, $5, 'Another church song', 'Entrance', 'English', 'G', now())`,
    [SONG_A, CHURCH_A, SONG_A2, SONG_B, CHURCH_B],
  );
});

// ---- Saving ----

test('a planner saves the plan: the structure is stored, and the save is one audited row', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  const res = await editing().savePlan(event({ cookie, body: planBody() }));
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).ok, true);
  const stored = (await storedBody()).body;
  assert.equal(stored.kind, 'mass', 'the plan kind is kept');
  assert.deepEqual(stored.segments[1], { songId: SONG_A, minutes: 5 });
  assert.deepEqual(stored.notes, { 3: 'Open prayer, no slides' });
  const audit = (await auditRows()).filter((a) => a.action === 'plan.saved');
  assert.equal(audit.length, 1, 'one audit row for the save');
  assert.equal(audit[0].target_plan_id, PLAN_A);
  assert.equal(audit[0].church_id, CHURCH_A);
  assert.equal(audit[0].actor_user_id, (await pg.query(`SELECT id FROM users WHERE username = 'planner'`)).rows[0].id);
});

test('the audit line carries no content: no song id, text, note or minutes', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  await editing().savePlan(event({ cookie, body: planBody() }));
  const dump = JSON.stringify((await pg.query(`SELECT * FROM audit_log WHERE action = 'plan.saved'`)).rows);
  for (const secret of [SONG_A, 'Psalm 24 setting', 'Open prayer, no slides']) {
    assert.equal(dump.includes(secret), false, `audit does not hold ${secret}`);
  }
});

test('a viewer gets 403 with a plain message, and the plan does not change', async () => {
  const before = JSON.stringify((await storedBody()).body);
  const cookie = await cookieFor('viewer', 'K7QM-4XD2');
  const res = await editing().savePlan(event({ cookie, body: planBody() }));
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).error, 'Your account can view plans but not change them.');
  assert.equal(JSON.stringify((await storedBody()).body), before);
  assert.equal((await auditRows()).length, 0);
});

test('a save from another church cannot change the plan: it is not found in that church', async () => {
  const before = JSON.stringify((await storedBody()).body);
  const cookie = await cookieFor('otherplanner', 'R2VT-9HJ6');
  const res = await editing().savePlan(event({ cookie, body: planBody({ id: PLAN_A }) }));
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error, 'That plan is not in your church.');
  assert.equal(JSON.stringify((await storedBody()).body), before);
});

test('the church comes from the session, never from the request body', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  const res = await editing().savePlan(event({ cookie, body: { ...planBody(), churchId: CHURCH_B } }));
  assert.equal(res.statusCode, 200);
  assert.equal((await pg.query('SELECT church_id FROM plans WHERE id = $1', [PLAN_A])).rows[0].church_id, CHURCH_A);
});

test('a song id that is not in this church is refused, and nothing is saved', async () => {
  const before = JSON.stringify((await storedBody()).body);
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  for (const songId of [SONG_B, '30000000-0000-4000-8000-000000000000', 'not-a-song']) {
    const res = await editing().savePlan(event({ cookie, body: planBody({ segments: { 1: { songId, minutes: 5 } } }) }));
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error, "That song is not in your church's song list. Reload the song list and try again.");
  }
  assert.equal(JSON.stringify((await storedBody()).body), before);
});

test('a duration outside 1 to 60 minutes is refused; the edges are allowed', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  for (const minutes of [0, 61, 1.5, -3, '5']) {
    const res = await editing().savePlan(event({ cookie, body: planBody({ segments: { 1: { minutes } } }) }));
    assert.equal(res.statusCode, 400, `minutes ${String(minutes)} refused`);
    assert.equal(JSON.parse(res.body).error, 'Each segment needs between 1 and 60 minutes.');
  }
  assert.equal((await editing().savePlan(event({ cookie, body: planBody({ segments: { 1: { minutes: 1 } } }) }))).statusCode, 200);
  assert.equal((await editing().savePlan(event({ cookie, body: planBody({ segments: { 1: { minutes: 60 } } }) }))).statusCode, 200);
});

test('text, notes and segment shapes are checked: too long, both song and text, unknown fields and ids are refused', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  const cases = [
    [planBody({ segments: { 1: { text: 'x'.repeat(501) } } }), 'Text for a segment can be up to 500 characters.'],
    [planBody({ segments: { 1: { songId: SONG_A, text: 'and text' } } }), 'A segment holds a song or typed text, not both.'],
    [planBody({ segments: { 1: { minutes: 5, lyrics: 'nope' } } }), 'A segment in this plan is not recognised. Reload the plan and try again.'],
    [planBody({ segments: { abc: { minutes: 5 } } }), 'A segment in this plan is not recognised. Reload the plan and try again.'],
    [planBody({ notes: { 3: 'x'.repeat(1001) } }), 'A note can be up to 1000 characters.'],
  ];
  for (const [body, message] of cases) {
    const res = await editing().savePlan(event({ cookie, body }));
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error, message);
  }
});

test('signed out, or still on a temporary password, the save is refused', async () => {
  assert.equal((await editing().savePlan(event({ body: planBody() }))).statusCode, 401);
  await user(CHURCH_A, 'fresh', 'planner', true);
  const cookie = await cookieFor('fresh', 'K7QM-4XD2');
  assert.equal((await editing().savePlan(event({ cookie, body: planBody() }))).statusCode, 403);
});

// ---- Reading ----

test('a planner and a viewer can both open the plan; only the planner is offered editing', async () => {
  const planner = JSON.parse((await editing().getPlan(event({ method: 'GET', cookie: await cookieFor('planner', 'K7QM-4XD2'), query: { id: PLAN_A } }))).body);
  assert.equal(planner.canEdit, true);
  assert.equal(planner.plan.name, 'All Saints, Sunday Mass');
  assert.equal(planner.plan.date, '2026-11-01');
  const viewer = await editing().getPlan(event({ method: 'GET', cookie: await cookieFor('viewer', 'K7QM-4XD2'), query: { id: PLAN_A } }));
  assert.equal(viewer.statusCode, 200);
  assert.equal(JSON.parse(viewer.body).canEdit, false);
});

test('a plan from another church cannot be opened, and a bad id is refused', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  assert.equal((await editing().getPlan(event({ method: 'GET', cookie, query: { id: PLAN_B } }))).statusCode, 404);
  assert.equal((await editing().getPlan(event({ method: 'GET', cookie, query: { id: 'nope' } }))).statusCode, 400);
});

test('the song list holds only this church songs', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  const songs = JSON.parse((await editing().listSongs(event({ method: 'GET', cookie }))).body).songs;
  assert.deepEqual(songs.map((s) => s.title), ['Praise to the Lord', 'Psalm 24 setting']);
  assert.equal(songs[0].key, 'D');
});

test('an empty song list is an empty list, not an error', async () => {
  await pg.exec('DELETE FROM songs;');
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  const res = await editing().listSongs(event({ method: 'GET', cookie }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body).songs, []);
});

// Tests for two-way plan sync on the server: create, pull after a cursor, and push with the base-version check, against a real Postgres
// (PGlite). Run with: node --test netlify/functions/test/plan-sync.test.mjs
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createPlanSyncApi, CREATE_LIMIT, NOT_SAVED, PUSH_LIMIT } from '../lib/plan-sync.js';
import { createPlanEditingApi } from '../lib/plan-editing.js';
import { createApi } from '../lib/handlers.js';
import { hashPassword, hashToken } from '../lib/auth.js';
import { tagFromQuery } from '../lib/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.join(here, '..', '..', 'db', 'schema.sql'), 'utf8');
const SECRET = randomBytes(32).toString('hex');
const PASSWORD = `Test-${randomBytes(16).toString('base64url')}`;
const CHURCH_A = '00000000-0000-4000-8000-00000000000a';
const CHURCH_B = '00000000-0000-4000-8000-00000000000b';
const SONG_A = randomUUID();
const SONG_GONE = randomUUID();
const SONG_B = randomUUID();

let pg;
let clock;

const sql = tagFromQuery((text, params) => pg.query(text, params));
const transaction = (work) => pg.transaction((tx) => work(tagFromQuery((t, v) => tx.query(t, v))));
const sync = () => createPlanSyncApi({ sql, transaction, secret: SECRET, now: () => clock });
const editing = () => createPlanEditingApi({ sql, transaction, secret: SECRET, now: () => clock });
const web = () => createApi({ sql, secret: SECRET, now: () => clock });

const item = (key, order, extra = {}) => ({ key: String(key), group: 'introductory', order, kind: 'rite', ...extra });
const body = (over = {}) => ({ id: randomUUID(), name: 'All Saints', date: '2026-11-01', kind: 'mass', baseUpdatedAt: null, items: [item(1, 1)], ...over });

const headers = (token) => ({ authorization: `Bearer ${token}` });
const pushReq = (token, plans) => ({ httpMethod: 'POST', headers: headers(token), body: JSON.stringify({ plans }) });
const pullReq = (who, cursor) => ({ httpMethod: 'GET', headers: who.headers ?? {}, queryStringParameters: cursor ? { cursor } : null });

async function user(church, username, role) {
  return (await pg.query(
    `INSERT INTO users (id, church_id, username, display_name, role, password_hash, must_change_password)
     VALUES (gen_random_uuid(), $1, $2, $2, $3, $4, false) RETURNING id`,
    [church, username, role, await hashPassword(PASSWORD)],
  )).rows[0].id;
}

async function laptopFor(church, userId) {
  const token = randomBytes(32).toString('base64url');
  await pg.query(`INSERT INTO device_tokens (token_hash, church_id, user_id, device_name) VALUES ($1, $2, $3, 'Operator booth')`, [hashToken(token, SECRET), church, userId]);
  return token;
}

async function cookieFor(username) {
  const res = await web().login({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ username, password: PASSWORD, churchCode: 'K7QM-4XD2' }) });
  assert.equal(res.statusCode, 200);
  return res.headers['Set-Cookie'].split(';')[0];
}

async function plantPlan(church, over = {}) {
  const id = randomUUID();
  const at = over.at ?? '2026-10-27T10:00:00.000Z';
  await pg.query(
    `INSERT INTO plans (id, church_id, name, liturgical_date, body, updated_at) VALUES ($1, $2, $3, '2026-11-01', $4::jsonb, $5)`,
    [id, church, over.name ?? 'Planted plan', JSON.stringify({ kind: over.kind ?? 'mass', items: over.items ?? [item(1, 1)] }), at],
  );
  return id;
}

const serverRow = async (id) => (await pg.query('SELECT name, liturgical_date, body, updated_at, church_id FROM plans WHERE id = $1', [id])).rows[0];
const counted = async (table) => (await pg.query(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows[0].n;

before(async () => {
  pg = new PGlite();
  await pg.exec(SCHEMA);
});

let plannerA;
let viewerA;
let plannerB;
let laptopA;
let viewerLaptop;
let laptopB;

beforeEach(async () => {
  clock = new Date('2026-10-27T12:00:00Z');
  await pg.exec('TRUNCATE rate_limits, audit_log, device_tokens, sessions, users, plans, songs, devices, licences, setup_keys, churches CASCADE;');
  await pg.query(`INSERT INTO churches (id, display_code, name) VALUES ($1, 'K7QM-4XD2', 'St Mary'), ($2, 'R2VT-9HJ6', 'Holy Cross')`, [CHURCH_A, CHURCH_B]);
  plannerA = await user(CHURCH_A, 'planner', 'planner');
  viewerA = await user(CHURCH_A, 'viewer', 'viewer');
  plannerB = await user(CHURCH_B, 'otherplanner', 'planner');
  laptopA = await laptopFor(CHURCH_A, plannerA);
  viewerLaptop = await laptopFor(CHURCH_A, viewerA);
  laptopB = await laptopFor(CHURCH_B, plannerB);
  await pg.query(
    `INSERT INTO songs (id, church_id, title, category, language, musical_key, updated_at, removed_at) VALUES
       ($1, $4, 'Praise to the Lord', 'Entrance Procession', 'English', 'D', now(), NULL),
       ($2, $4, 'Old song', 'Entrance Procession', 'English', 'G', now(), now()),
       ($3, $5, 'Holy Cross song', 'Entrance Procession', 'English', 'G', now(), NULL)`,
    [SONG_A, SONG_GONE, SONG_B, CHURCH_A, CHURCH_B],
  );
});

// ---- Creating ----

test('the web creates a plan with its own UUID: one row and one audit row, with no content', async () => {
  const cookie = await cookieFor('planner');
  const id = randomUUID();
  const res = await sync().createPlan({ httpMethod: 'POST', headers: { cookie }, body: JSON.stringify({ id, name: 'Praise night', date: '2026-11-06', kind: 'pw', items: [item(1, 1, { kind: 'song', songId: SONG_A, group: 'opening' })] }) });
  assert.equal(res.statusCode, 201);
  assert.equal((await serverRow(id)).church_id, CHURCH_A);
  const audit = (await pg.query(`SELECT action, target_plan_id, detail FROM audit_log WHERE action = 'plan.created'`)).rows;
  assert.equal(audit.length, 1);
  assert.equal(audit[0].target_plan_id, id);
  assert.equal(audit[0].detail, null, 'no content in the audit row');
  assert.equal(JSON.stringify(audit).includes('Praise night'), false);
});

test('creating with an id that already exists is refused, and a viewer cannot create', async () => {
  const cookie = await cookieFor('planner');
  const id = randomUUID();
  const make = (c) => sync().createPlan({ httpMethod: 'POST', headers: { cookie: c }, body: JSON.stringify(body({ id })) });
  assert.equal((await make(cookie)).statusCode, 201);
  assert.equal((await make(cookie)).statusCode, 409);
  const viewerCookie = await cookieFor('viewer');
  assert.equal((await sync().createPlan({ httpMethod: 'POST', headers: { cookie: viewerCookie }, body: JSON.stringify(body()) })).statusCode, 403);
});

// ---- Pulling ----

test('a pull returns only the plans changed after the cursor, with body, name, date and updated time', async () => {
  await plantPlan(CHURCH_A, { name: 'First', at: '2026-10-27T09:00:00.000Z' });
  const second = await plantPlan(CHURCH_A, { name: 'Second', at: '2026-10-27T10:00:00.000Z' });
  const third = await plantPlan(CHURCH_A, { name: 'Third', at: '2026-10-27T11:00:00.000Z' });
  const all = JSON.parse((await sync().pullPlans(pullReq({ headers: headers(laptopA) }))).body);
  assert.deepEqual(all.plans.map((p) => p.name), ['First', 'Second', 'Third']);
  assert.equal(all.plans[0].date, '2026-11-01');
  assert.equal(all.plans[0].items.length, 1, 'the body comes with the plan');
  // The cursor after the second plan: only the third is newer.
  const after = JSON.parse((await sync().pullPlans(pullReq({ headers: headers(laptopA) }, `2026-10-27T10:00:00.000Z|${second}`))).body);
  assert.deepEqual(after.plans.map((p) => p.name), ['Third'], 'only the change after the cursor');
  assert.equal(after.plans[0].id, third);
  assert.equal(after.more, false);
});

test('a pull with the last cursor returns nothing new', async () => {
  await plantPlan(CHURCH_A, { name: 'Only' });
  const first = JSON.parse((await sync().pullPlans(pullReq({ headers: headers(laptopA) }))).body);
  const again = JSON.parse((await sync().pullPlans(pullReq({ headers: headers(laptopA) }, first.cursor))).body);
  assert.deepEqual(again.plans, []);
  assert.equal(again.cursor, first.cursor);
});

test('a pull never returns another church\'s plans, and a malformed cursor is refused', async () => {
  await plantPlan(CHURCH_B, { name: 'Other church' });
  const res = JSON.parse((await sync().pullPlans(pullReq({ headers: headers(laptopA) }))).body);
  assert.deepEqual(res.plans, []);
  assert.equal((await sync().pullPlans(pullReq({ headers: headers(laptopA) }, 'not-a-cursor'))).statusCode, 400);
});

test('a signed-in web user can pull as well as a laptop', async () => {
  await plantPlan(CHURCH_A, { name: 'For the web' });
  const cookie = await cookieFor('viewer');
  const res = await sync().pullPlans({ httpMethod: 'GET', headers: { cookie }, queryStringParameters: null });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body).plans.map((p) => p.name), ['For the web']);
});

// ---- Pushing ----

test('a push with the current updated_at is accepted, and written', async () => {
  const id = await plantPlan(CHURCH_A, { name: 'Before' });
  const seen = (await serverRow(id)).updated_at.toISOString();
  const res = JSON.parse((await sync().pushPlans(pushReq(laptopA, [body({ id, name: 'After', baseUpdatedAt: seen, items: [item(1, 1, { kind: 'song', songId: SONG_A })] })]))).body);
  assert.equal(res.results[0].status, 'accepted');
  const row = await serverRow(id);
  assert.equal(row.name, 'After');
  assert.equal(row.body.items[0].songId, SONG_A);
});

test('a stale push is not applied: the server\'s version comes back and nothing is written', async () => {
  const id = await plantPlan(CHURCH_A, { name: 'Server says this' });
  const before = await serverRow(id);
  const res = JSON.parse((await sync().pushPlans(pushReq(laptopA, [body({ id, name: 'Laptop says this', baseUpdatedAt: '2026-10-01T00:00:00.000Z' })]))).body);
  assert.equal(res.results[0].status, 'conflict');
  assert.equal(res.results[0].serverVersion.name, 'Server says this');
  assert.equal(res.results[0].serverVersion.items.length, 1);
  assert.equal((await serverRow(id)).name, 'Server says this');
  assert.equal((await serverRow(id)).updated_at.getTime(), before.updated_at.getTime(), 'the server time did not move');
});

test('a push for a plan the server has but the laptop never saw is a conflict too', async () => {
  const id = await plantPlan(CHURCH_A, { name: 'Already there' });
  const res = JSON.parse((await sync().pushPlans(pushReq(laptopA, [body({ id, name: 'Clash', baseUpdatedAt: null })]))).body);
  assert.equal(res.results[0].status, 'conflict');
  assert.equal((await serverRow(id)).name, 'Already there');
});


test('a forbidden field is refused for that plan, and nothing is written for it', async () => {
  const id = randomUUID();
  const bad = body({ id, items: [item(1, 1, { lyrics: 'These words must never be sent' })] });
  const res = JSON.parse((await sync().pushPlans(pushReq(laptopA, [bad]))).body);
  assert.equal(res.results[0].status, 'error');
  assert.equal(res.results[0].message, 'Lyrics, slides, media, Bible text and announcements never leave the laptop. Nothing was saved.');
  assert.equal(await serverRow(id), undefined);
  assert.equal(JSON.stringify(await pg.query('SELECT * FROM plans')).includes('never be sent'), false);
});

test('an unknown field, an unknown song id and an out-of-range minute value are each refused', async () => {
  const cases = [
    [item(1, 1, { colour: 'red' }), 'An item in the plan has a field the planner does not accept. Nothing was saved.'],
    [item(1, 1, { kind: 'song', songId: randomUUID() }), "That song is not in your church's song list. Reload the song list and try again. Nothing was saved."],
    [item(1, 1, { minutes: 61 }), 'Each item needs between 1 and 60 minutes. Nothing was saved.'],
  ];
  for (const [bad, message] of cases) {
    const res = JSON.parse((await sync().pushPlans(pushReq(laptopA, [body({ items: [bad] })]))).body);
    assert.equal(res.results[0].status, 'error');
    assert.equal(res.results[0].message, message);
  }
  assert.equal(await counted('plans'), 0);
});


test('more than 200 items is refused', async () => {
  const items = Array.from({ length: 201 }, (_, i) => item(i + 1, i + 1));
  const res = JSON.parse((await sync().pushPlans(pushReq(laptopA, [body({ items })]))).body);
  assert.equal(res.results[0].status, 'error');
  assert.equal(res.results[0].message, 'A plan can have up to 200 items. Nothing was saved.');
});

test('a viewer\'s laptop cannot push', async () => {
  const res = await sync().pushPlans(pushReq(viewerLaptop, [body()]));
  assert.equal(res.statusCode, 403);
  assert.equal(await counted('plans'), 0);
});

test('a web session cannot push: only a laptop\'s token can', async () => {
  const cookie = await cookieFor('planner');
  const res = await sync().pushPlans({ httpMethod: 'POST', headers: { cookie }, body: JSON.stringify({ plans: [body()] }) });
  assert.equal(res.statusCode, 401);
});

test('another church\'s plan cannot be pushed over, or read', async () => {
  const id = await plantPlan(CHURCH_B, { name: 'Church B' });
  const seen = (await serverRow(id)).updated_at.toISOString();
  const res = JSON.parse((await sync().pushPlans(pushReq(laptopA, [body({ id, name: 'Hijacked', baseUpdatedAt: seen })]))).body);
  assert.equal(res.results[0].status, 'error');
  assert.equal(res.results[0].message, NOT_SAVED);
  assert.equal((await serverRow(id)).name, 'Church B');
  const cookie = await cookieFor('planner');
  assert.equal((await editing().getPlan({ httpMethod: 'GET', headers: { cookie }, queryStringParameters: { id } })).statusCode, 404);
});


test('a push writes one audit row with the counts, and no plan names or content', async () => {
  const id = await plantPlan(CHURCH_A, { name: 'Keep me' });
  const seen = (await serverRow(id)).updated_at.toISOString();
  await sync().pushPlans(pushReq(laptopA, [body({ id, name: 'Clash', baseUpdatedAt: '2026-10-01T00:00:00.000Z' }), body({ name: 'Brand new plan name', baseUpdatedAt: null })]));
  const rows = (await pg.query(`SELECT detail, actor_user_id FROM audit_log WHERE action = 'plan.synced'`)).rows;
  assert.equal(rows.length, 1, 'one audit row for the batch');
  assert.deepEqual(rows[0].detail, { accepted: 0, conflict: 1, error: 1 });
  assert.equal(rows[0].actor_user_id, plannerA);
  const dump = JSON.stringify((await pg.query('SELECT * FROM audit_log')).rows);
  assert.equal(dump.includes('Brand new plan name'), false);
  assert.equal(dump.includes('Keep me'), false);
  assert.ok(seen);
});

test('the push is rate-limited per laptop', async () => {
  for (let i = 0; i < PUSH_LIMIT.requests; i += 1) {
    assert.equal((await sync().pushPlans(pushReq(laptopA, []))).statusCode, 200);
  }
  const limited = await sync().pushPlans(pushReq(laptopA, []));
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers['Retry-After'] !== undefined, true);
  assert.equal((await sync().pushPlans(pushReq(laptopB, []))).statusCode, 200, 'another laptop has its own limit');
});

// ---- The editor reads and saves the same shape ----

test('the editor saves the item list, and a save over a newer version is refused with that version', async () => {
  const id = await plantPlan(CHURCH_A, { name: 'Editor plan' });
  const cookie = await cookieFor('planner');
  const loaded = JSON.parse((await editing().getPlan({ httpMethod: 'GET', headers: { cookie }, queryStringParameters: { id } })).body).plan;
  await pg.query(`UPDATE plans SET updated_at = $2 WHERE id = $1`, [id, '2026-10-27T11:30:00.000Z']);
  const stale = await editing().savePlan({ httpMethod: 'POST', headers: { cookie }, body: JSON.stringify({ id, baseUpdatedAt: loaded.updatedAt, items: [item(1, 1)] }) });
  assert.equal(stale.statusCode, 409);
  assert.equal(JSON.parse(stale.body).serverVersion.updatedAt, '2026-10-27T11:30:00.000Z');
  const fresh = await editing().savePlan({ httpMethod: 'POST', headers: { cookie }, body: JSON.stringify({ id, baseUpdatedAt: '2026-10-27T11:30:00.000Z', items: [item(1, 1)] }) });
  assert.equal(fresh.statusCode, 200);
});

test('a viewer can read a plan and cannot save it', async () => {
  const id = await plantPlan(CHURCH_A, { name: 'Read only' });
  const cookie = await cookieFor('viewer');
  assert.equal((await editing().getPlan({ httpMethod: 'GET', headers: { cookie }, queryStringParameters: { id } })).statusCode, 200);
  const saved = await editing().savePlan({ httpMethod: 'POST', headers: { cookie }, body: JSON.stringify({ id, baseUpdatedAt: '2026-10-27T10:00:00.000Z', items: [] }) });
  assert.equal(saved.statusCode, 403);
});

test("a push for another church's plan and a push for an unused id get the same status, message and counts", async () => {
  const other = await plantPlan(CHURCH_B, { name: 'Church B' });
  const seen = (await serverRow(other)).updated_at.toISOString();
  const unused = randomUUID();
  const a = JSON.parse((await sync().pushPlans(pushReq(laptopA, [body({ id: other, baseUpdatedAt: seen })]))).body);
  const b = JSON.parse((await sync().pushPlans(pushReq(laptopA, [body({ id: unused, baseUpdatedAt: seen })]))).body);
  const outcome = (r) => ({ status: r.status, message: r.message, keys: Object.keys(r).sort() });
  assert.deepEqual(outcome(a.results[0]), outcome(b.results[0]), 'the per-plan results match');
  assert.equal(a.results[0].message, NOT_SAVED);
  assert.deepEqual(a.counts, b.counts, 'the batch counts match');
  assert.equal((await serverRow(other)).name, 'Church B', "another church's plan is untouched");
  assert.equal(await serverRow(unused), undefined, 'nothing is created for the unused id');
  const audits = (await pg.query("SELECT detail FROM audit_log WHERE action = 'plan.synced' ORDER BY id")).rows.map((r) => r.detail);
  assert.deepEqual(audits[0], audits[1], 'the two batches write the same audit counts');
});

test("the plan editor's 404 is the same for another church's plan and a missing one", async () => {
  const other = await plantPlan(CHURCH_B, { name: 'Church B' });
  const cookie = await cookieFor('planner');
  const a = await editing().getPlan({ httpMethod: 'GET', headers: { cookie }, queryStringParameters: { id: other } });
  const b = await editing().getPlan({ httpMethod: 'GET', headers: { cookie }, queryStringParameters: { id: randomUUID() } });
  assert.equal(a.statusCode, 404);
  assert.equal(a.statusCode, b.statusCode);
  assert.equal(a.body, b.body);
});

test("a push never creates a plan: an id the server does not have is refused, and nothing is written", async () => {
  const id = randomUUID();
  const res = JSON.parse((await sync().pushPlans(pushReq(laptopA, [body({ id, name: "From the laptop", baseUpdatedAt: null })]))).body);
  assert.equal(res.results[0].status, "error");
  assert.equal(res.results[0].message, NOT_SAVED);
  assert.equal(await serverRow(id), undefined);
});

test("a reference to a removed song is accepted, and the reference is kept", async () => {
  const id = await plantPlan(CHURCH_A, { name: "Has a removed song" });
  const seen = (await serverRow(id)).updated_at.toISOString();
  const res = JSON.parse((await sync().pushPlans(pushReq(laptopA, [body({ id, baseUpdatedAt: seen, items: [item(1, 1, { kind: "song", songId: SONG_GONE })] })]))).body);
  assert.equal(res.results[0].status, "accepted");
  assert.equal((await serverRow(id)).body.items[0].songId, SONG_GONE);
  const cookie = await cookieFor("planner");
  const shown = JSON.parse((await editing().getPlan({ httpMethod: "GET", headers: { cookie }, queryStringParameters: { id } })).body);
  assert.deepEqual(shown.songs.map((s) => [s.title, s.removed]), [["Old song", true]]);
});

test("each plan in a batch is its own transaction: a bad plan does not stop a good one", async () => {
  const good = await plantPlan(CHURCH_A, { name: "Before" });
  const seen = (await serverRow(good)).updated_at.toISOString();
  const bad = randomUUID();
  const res = JSON.parse((await sync().pushPlans(pushReq(laptopA, [
    body({ id: bad, items: [item(1, 1, { lyrics: "x" })] }),
    body({ id: good, name: "Good one", baseUpdatedAt: seen }),
  ]))).body);
  assert.deepEqual(res.results.map((r) => r.status), ["error", "accepted"]);
  assert.equal(await serverRow(bad), undefined);
  assert.equal((await serverRow(good)).name, "Good one");
});

test("a linked planner's laptop creates a plan, and the church comes from its token, not the body", async () => {
  const id = randomUUID();
  const res = await sync().createPlan({ httpMethod: "POST", headers: { authorization: `Bearer ${laptopA}` }, body: JSON.stringify(body({ id, name: "Made on the laptop", churchId: CHURCH_B })) });
  assert.equal(res.statusCode, 201);
  assert.equal((await serverRow(id)).church_id, CHURCH_A);
  const audit = (await pg.query(`SELECT action, target_plan_id, detail FROM audit_log WHERE action = 'plan.created'`)).rows;
  assert.equal(audit.length, 1);
  assert.equal(audit[0].target_plan_id, id);
  assert.equal(audit[0].detail, null);
  assert.equal(JSON.stringify(audit).includes("Made on the laptop"), false);
});

test("a viewer's laptop cannot create a plan", async () => {
  const res = await sync().createPlan({ httpMethod: "POST", headers: { authorization: `Bearer ${viewerLaptop}` }, body: JSON.stringify(body()) });
  assert.equal(res.statusCode, 403);
  assert.equal(await counted("plans"), 0);
});

test("a duplicate id, in this church or another, gets the same refusal message", async () => {
  const cookie = await cookieFor("planner");
  const mine = await plantPlan(CHURCH_A, { name: "Mine" });
  const theirs = await plantPlan(CHURCH_B, { name: "Theirs" });
  const dupMine = await sync().createPlan({ httpMethod: "POST", headers: { cookie }, body: JSON.stringify(body({ id: mine })) });
  const dupTheirs = await sync().createPlan({ httpMethod: "POST", headers: { cookie }, body: JSON.stringify(body({ id: theirs })) });
  assert.equal(dupMine.statusCode, 409);
  assert.equal(dupTheirs.statusCode, 409);
  assert.equal(dupMine.body, dupTheirs.body, "the two refusals are the same");
  assert.equal(JSON.parse(dupMine.body).error, NOT_SAVED);
  assert.equal((await serverRow(theirs)).name, "Theirs");
});

test("an invalid kind or date is refused when a plan is created", async () => {
  const cookie = await cookieFor("planner");
  const kind = await sync().createPlan({ httpMethod: "POST", headers: { cookie }, body: JSON.stringify(body({ kind: "choir" })) });
  assert.equal(kind.statusCode, 400);
  assert.equal(JSON.parse(kind.body).error, "A plan must be a Mass plan or a Praise & Worship plan. Nothing was saved.");
  const date = await sync().createPlan({ httpMethod: "POST", headers: { cookie }, body: JSON.stringify(body({ date: "2026-13-40" })) });
  assert.equal(date.statusCode, 400);
  assert.equal(await counted("plans"), 0);
});

test("the create limit applies per session and per laptop", async () => {
  const cookie = await cookieFor("planner");
  for (let i = 0; i < CREATE_LIMIT.requests; i += 1) {
    const res = await sync().createPlan({ httpMethod: "POST", headers: { cookie }, body: JSON.stringify(body({ name: `Plan ${i}` })) });
    assert.equal(res.statusCode, 201);
  }
  const limited = await sync().createPlan({ httpMethod: "POST", headers: { cookie }, body: JSON.stringify(body()) });
  assert.equal(limited.statusCode, 429);
  for (let i = 0; i < CREATE_LIMIT.requests; i += 1) {
    await sync().createPlan({ httpMethod: "POST", headers: { authorization: `Bearer ${laptopA}` }, body: JSON.stringify(body()) });
  }
  const laptopLimited = await sync().createPlan({ httpMethod: "POST", headers: { authorization: `Bearer ${laptopA}` }, body: JSON.stringify(body()) });
  assert.equal(laptopLimited.statusCode, 429);
  const otherLaptop = await sync().createPlan({ httpMethod: "POST", headers: { authorization: `Bearer ${laptopB}` }, body: JSON.stringify(body()) });
  assert.equal(otherLaptop.statusCode, 201, "another laptop has its own limit");
});

// ---- Delete ----

const deleteReq = (headersObj, id) => ({ httpMethod: 'POST', headers: headersObj, body: JSON.stringify({ id }) });
const pulledPlans = async (token) => JSON.parse((await sync().pullPlans(pullReq({ headers: headers(token) }))).body).plans;

test('a laptop delete is seen by every laptop on its next pull, and the web no longer lists or opens the plan', async () => {
  const id = await plantPlan(CHURCH_A, { name: 'To remove' });
  const res = await sync().deletePlan(deleteReq(headers(laptopA), id));
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).deleted, true);
  const gone = (await pulledPlans(laptopA)).find((p) => p.id === id);
  assert.equal(gone.deleted, true);
  assert.deepEqual(gone.items, []);
  const cookie = await cookieFor('planner');
  const list = JSON.parse((await web().plans({ httpMethod: 'GET', headers: { cookie } })).body).plans;
  assert.equal(list.some((p) => p.id === id), false, 'the web list hides it');
  const opened = await editing().getPlan({ httpMethod: 'GET', headers: { cookie }, queryStringParameters: { id } });
  assert.equal(opened.statusCode, 404);
});

test('a web delete is seen by a laptop on its next pull', async () => {
  const id = await plantPlan(CHURCH_A);
  const cookie = await cookieFor('planner');
  assert.equal((await sync().deletePlan(deleteReq({ cookie }, id))).statusCode, 200);
  assert.equal((await pulledPlans(laptopA)).find((p) => p.id === id).deleted, true);
});

test('deleting again gives the same answer, and nothing else changes', async () => {
  const id = await plantPlan(CHURCH_A);
  const first = JSON.parse((await sync().deletePlan(deleteReq(headers(laptopA), id))).body);
  clock = new Date('2026-10-27T13:00:00Z');
  const again = await sync().deletePlan(deleteReq(headers(laptopA), id));
  assert.equal(again.statusCode, 200);
  assert.equal(JSON.parse(again.body).updatedAt, first.updatedAt, 'the delete time does not move');
});

test('a viewer cannot delete, and neither can a planner in another church, who gets not-found', async () => {
  const id = await plantPlan(CHURCH_A, { name: 'Keep me' });
  const cookie = await cookieFor('viewer');
  assert.equal((await sync().deletePlan(deleteReq({ cookie }, id))).statusCode, 403);
  assert.equal((await sync().deletePlan(deleteReq(headers(viewerLaptop), id))).statusCode, 403);
  const other = await sync().deletePlan(deleteReq(headers(laptopB), id));
  assert.equal(other.statusCode, 404);
  assert.equal((await serverRow(id)).body.deleted, undefined, 'the plan is untouched');
});

test('a deleted plan cannot be pushed back, and its id cannot be created again', async () => {
  const id = await plantPlan(CHURCH_A);
  const stored = await serverRow(id);
  await sync().deletePlan(deleteReq(headers(laptopA), id));
  const pushed = JSON.parse((await sync().pushPlans(pushReq(laptopA, [body({ id, baseUpdatedAt: new Date(stored.updated_at).toISOString() })]))).body);
  assert.equal(pushed.results[0].status, 'error');
  assert.equal(pushed.results[0].message, NOT_SAVED);
  const created = await sync().createPlan({ httpMethod: 'POST', headers: headers(laptopA), body: JSON.stringify(body({ id })) });
  assert.equal(created.statusCode, 409);
});

test('a real delete is recorded in the audit log as plan.deleted, against the plan, and a retry records nothing more', async () => {
  const id = await plantPlan(CHURCH_A);
  await sync().deletePlan(deleteReq(headers(laptopA), id));
  await sync().deletePlan(deleteReq(headers(laptopA), id));
  const rows = (await pg.query(`SELECT action, target_plan_id, church_id FROM audit_log WHERE action = 'plan.deleted'`)).rows;
  assert.equal(rows.length, 1, 'one delete, one row');
  assert.equal(rows[0].target_plan_id, id);
  assert.equal(rows[0].church_id, CHURCH_A);
});

test('a laptop reads one plan of its own church; another church and a viewer\'s laptop get nothing', async () => {
  const id = await plantPlan(CHURCH_A, { name: 'Ours' });
  const read = (token, planId = id) => sync().getPlan({ httpMethod: 'GET', headers: headers(token), queryStringParameters: { id: planId } });
  const own = await read(laptopA);
  assert.equal(own.statusCode, 200);
  assert.equal(JSON.parse(own.body).plan.name, 'Ours');
  assert.equal((await read(laptopB)).statusCode, 404, 'another church sees not-found');
  assert.equal((await read(viewerLaptop)).statusCode, 403, 'a viewer\'s laptop cannot read plans');
  assert.equal((await read(laptopA, randomUUID())).statusCode, 404, 'a plan that does not exist is not-found too');
});

test('a push that carries no note for an item keeps the note the server already has for it', async () => {
  const id = await plantPlan(CHURCH_A, { kind: 'pw', items: [item('prayer_authority', 1, { note: 'Pray for the parish' })] });
  const stored = await serverRow(id);
  const pushed = await sync().pushPlans(pushReq(laptopA, [body({ id, kind: 'pw', baseUpdatedAt: new Date(stored.updated_at).toISOString(), items: [item('prayer_authority', 1)] })]));
  assert.equal(JSON.parse(pushed.body).results[0].status, 'accepted');
  assert.equal((await serverRow(id)).body.items[0].note, 'Pray for the parish');
});

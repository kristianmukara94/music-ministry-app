// Tests for the plan sync engine. The laptop side is a real SQLite schema (the laptop's own migrations, in memory) and the cloud side is
// the real server code against a real Postgres (PGlite). The only fake is the network, which the tests can switch off.
// Run with: node --test electron/plan-sync.test.mjs
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { PGlite } from '@electric-sql/pglite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { HYMN_DELETE_MIGRATIONS, HYMN_FILING_MIGRATIONS, HYMN_FONT_SCALE_MIGRATIONS, HYMN_DEFAULT_SLIDES_MIGRATIONS, LYRICS_MIGRATIONS } = await import('./lyrics.js');
const { MASS_PLAN_MIGRATIONS, MASS_SCHEDULE_MIGRATIONS, MASS_SLOT_MIGRATIONS, PLAN_BIBLE_MIGRATIONS, PLAN_COMMUNION_MIGRATIONS, PLAN_CUSTOM_MIGRATIONS, PLAN_LANGUAGE_MIGRATIONS, PLAN_NOTES_MIGRATIONS } = await import('./mass-plans.js');
const { PW_MIGRATIONS } = await import('./pw-sessions.js');
const { NOTES_COPY_MIGRATIONS, NOTES_SLOT_MIGRATIONS, PRAYER_NOTES_MIGRATIONS, PRAYER_NOTES_SPLIT_MIGRATIONS } = await import('./notes.js');
const { WEB_HUB_MIGRATIONS } = await import('./web-hub-notes.js');
const { TRANSFER_MIGRATIONS } = await import('./transfer.js');
const { PLAN_SYNC_MIGRATIONS } = await import('./plan-sync-schema.js');
const { createPlanSync, UNEXPECTED_FAILURE, PUSH_BATCH } = await import('./plan-sync.js');
const { createPlanSyncStore } = await import('./plan-sync-store.js');
const { createCloudDevice } = await import('./cloud-device.js');
const { createPlanSyncApi, NOT_SAVED } = await import('../server/lib/plan-sync.js');
const { createPlanEditingApi } = await import('../server/lib/plan-editing.js');
const { createApi } = await import('../server/lib/handlers.js');
const { hashPassword, hashToken } = await import('../server/lib/auth.js');
const { tagFromQuery } = await import('../server/lib/db.js');
const { MASS_PARTS, MASS_STEP_PARTS } = await import('../shared/mass-parts.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.join(here, '..', 'server', 'db', 'schema.sql'), 'utf8');
const SECRET = randomBytes(32).toString('hex');
const PASSWORD = `Test-${randomBytes(16).toString('base64url')}`;
const BASE = 'https://cloud.test';
const CHURCH = '00000000-0000-4000-8000-00000000000a';
const HYMN_A = '11111111-1111-4111-8111-111111111111';
const HYMN_B = '22222222-2222-4222-8222-222222222222';
const T1 = '2026-10-27T10:00:00.000Z';
const T1_HALF = '2026-10-27T10:30:00.000Z';
const T2 = '2026-10-27T11:00:00.000Z';
const T3 = '2026-10-27T12:00:00.000Z';

let pg;
let serverNow;
let laptopToken;
let plannerId;
// bodies records every request body the laptop sends, so a test can check what leaves the laptop.
const network = { online: true, calls: 0, bodies: [] };

const sql = tagFromQuery((text, params) => pg.query(text, params));
const transaction = (work) => pg.transaction((tx) => work(tagFromQuery((t, v) => tx.query(t, v))));
const api = () => createPlanSyncApi({ sql, transaction, secret: SECRET, now: () => serverNow });
const web = () => createApi({ sql, secret: SECRET, now: () => serverNow });
const editing = () => createPlanEditingApi({ sql, transaction, secret: SECRET, now: () => serverNow });

/** The cloud as the laptop sees it: each call goes to the real server code, or fails the way a dead connection does. */
async function serverFetch(url, opts = {}) {
  network.calls += 1;
  if (!network.online) throw new TypeError('fetch failed');
  const u = new URL(url);
  if (opts.body !== undefined) network.bodies.push({ name: u.pathname.split('/').pop(), body: opts.body });
  const routes = {
    'plan-sync-pull': api().pullPlans, 'plan-create': api().createPlan, 'plan-sync-push': api().pushPlans,
    'plan-delete': api().deletePlan, 'plan-sync-get': api().getPlan,
  };
  const handler = routes[u.pathname.split('/').pop()];
  const out = await handler({
    httpMethod: opts.method ?? 'GET',
    headers: { authorization: opts.headers?.Authorization ?? '' },
    body: opts.body,
    queryStringParameters: Object.fromEntries(u.searchParams),
  });
  // Every reply carries the server's clock, as the real service's Date header does.
  const headers = { get: (name) => (name.toLowerCase() === 'date' ? serverNow.toUTCString() : null) };
  return { ok: out.statusCode >= 200 && out.statusCode < 300, status: out.statusCode, headers, text: async () => out.body };
}

const plainStorage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s, 'utf8'), decryptString: (b) => b.toString('utf8') };
function memoryFile(initial) {
  let blob = initial;
  return { read: () => blob, write: (b) => (blob = b), remove: () => (blob = null) };
}

/** The laptop's schema: the same migrations, in the order the app runs them. */
function laptopDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.transaction = (work) => () => {
    db.exec('BEGIN');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
  for (const sqlText of [...LYRICS_MIGRATIONS, ...HYMN_DELETE_MIGRATIONS, ...HYMN_FILING_MIGRATIONS, ...HYMN_FONT_SCALE_MIGRATIONS, ...HYMN_DEFAULT_SLIDES_MIGRATIONS, ...MASS_PLAN_MIGRATIONS, ...PLAN_LANGUAGE_MIGRATIONS, ...PLAN_BIBLE_MIGRATIONS, ...PLAN_CUSTOM_MIGRATIONS, ...PLAN_NOTES_MIGRATIONS,
    ...PW_MIGRATIONS, ...PLAN_COMMUNION_MIGRATIONS, ...MASS_SLOT_MIGRATIONS, ...TRANSFER_MIGRATIONS, ...PLAN_SYNC_MIGRATIONS, ...PRAYER_NOTES_MIGRATIONS, ...PRAYER_NOTES_SPLIT_MIGRATIONS, ...NOTES_SLOT_MIGRATIONS, ...NOTES_COPY_MIGRATIONS, ...WEB_HUB_MIGRATIONS]) {
    db.exec(sqlText);
  }
  return db;
}

/** A laptop: its database, its cloud link (with the token in the encrypted file), and its engine on a fake timer. */
function laptop(token = laptopToken, { skewMs = 0, schedule = false } = {}) {
  const db = laptopDb();
  // A laptop that keeps Holy Mass schedules (mass_time, mass_language). Most tests use one from before them, as older laptops still sync.
  if (schedule) for (const sqlText of MASS_SCHEDULE_MIGRATIONS) db.exec(sqlText);
  const record = { token, church: 'St Mary', admin: 'planner', label: 'Booth', lastSeenAt: null, linkedAddress: BASE };
  const file = memoryFile(plainStorage.encryptString(JSON.stringify(record)));
  // The laptop's own clock runs skewMs away from the server's. Nothing in the sync may trust it on its own.
  const cloud = createCloudDevice({ storage: plainStorage, file, fetchFn: serverFetch, baseUrl: BASE, now: () => Date.parse(serverNow) + skewMs });
  const timers = [];
  const store = createPlanSyncStore(db);
  const engine = createPlanSync({
    store,
    cloud,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => {},
  });
  return { db, store, engine, timers, file, cloud };
}

const seedHymn = (db, uuid, title) => db.prepare("INSERT INTO hymns (title, category, language, uuid) VALUES (?, 'General', 'EN', ?)").run(title, uuid);
const seedServerSong = (uuid, title) =>
  pg.query(`INSERT INTO songs (id, church_id, title, category, language, musical_key, updated_at) VALUES ($1, $2, $3, 'General', 'English', 'G', now())`, [uuid, CHURCH, title]);

/** A Mass plan made on the laptop, with its items, and its time set explicitly so the tests can order edits. */
function localMassPlan(db, { name, date = '2026-11-01', items = [], at = T1, uuid = null }) {
  const id = uuid
    ? Number(db.prepare('INSERT INTO mass_plans (name, liturgical_date, uuid) VALUES (?, ?, ?)').run(name, date, uuid).lastInsertRowid)
    : Number(db.prepare('INSERT INTO mass_plans (name, liturgical_date) VALUES (?, ?)').run(name, date).lastInsertRowid);
  items.forEach((it, i) => db.prepare('INSERT INTO mass_plan_items (plan_id, liturgical_block, source_module, source_id, label, display_order) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, it.block, it.module, it.sourceId, it.label, i + 1));
  db.prepare('UPDATE mass_plans SET updated_at = ? WHERE id = ?').run(at, id);
  return db.prepare('SELECT uuid FROM mass_plans WHERE id = ?').get(id).uuid;
}

const localMass = (db, uuid) => db.prepare('SELECT * FROM mass_plans WHERE uuid = ?').get(uuid);
const localMassItems = (db, uuid) => db.prepare(`SELECT i.source_module AS module, i.source_id AS sourceId, i.label, i.liturgical_block AS block FROM mass_plan_items i
  JOIN mass_plans p ON p.id = i.plan_id WHERE p.uuid = ? ORDER BY i.display_order`).all(uuid);
const editLocal = (db, uuid, changes) => db.prepare('UPDATE mass_plans SET name = ?, updated_at = ? WHERE uuid = ?').run(changes.name, changes.at, uuid);

const serverRow = async (id) => (await pg.query('SELECT name, liturgical_date, body, updated_at FROM plans WHERE id = $1', [id])).rows[0];
const serverNameOf = async (id) => (await serverRow(id)).name;

/** A plan made on the server by a laptop's token, as the website would make it. */
async function serverCreate(token, over = {}) {
  const id = randomUUID();
  const res = await api().createPlan({ httpMethod: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ id, name: 'All Saints', date: '2026-11-01', kind: 'mass', items: [], ...over }) });
  assert.equal(res.statusCode, 201, `create ${res.body}`);
  return JSON.parse(res.body).plan;
}

/** A change made on the server, as the website's planner would: against the version the server holds now. */
async function serverEdit(token, id, changes) {
  const row = await serverRow(id);
  const res = await api().pushPlans({ httpMethod: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ plans: [{ id, name: row.name, date: '2026-11-01', kind: row.body.kind, items: row.body.items ?? [], baseUpdatedAt: new Date(row.updated_at).toISOString(), ...changes }] }) });
  const result = JSON.parse(res.body).results[0];
  assert.equal(result.status, 'accepted', `server edit ${JSON.stringify(result)}`);
  return result.updatedAt;
}

const songItem = (key, order, songId, extra = {}) => ({ key, group: 'word', order, kind: 'song', songId, ...extra });
const readingItem = (key, order, text) => ({ key, group: 'word', order, kind: 'reading', text });

async function cookieFor(username) {
  const res = await web().login({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ username, password: PASSWORD, churchCode: 'K7QM-4XD2' }) });
  assert.equal(res.statusCode, 200, `${username} signs in`);
  return res.headers['Set-Cookie'].split(';')[0];
}

before(async () => {
  pg = new PGlite();
  await pg.exec(SCHEMA);
});

beforeEach(async () => {
  serverNow = new Date(T1);
  network.online = true;
  network.calls = 0;
  network.bodies = [];
  await pg.exec('TRUNCATE rate_limits, audit_log, device_tokens, sessions, users, plans, songs, devices, licences, setup_keys, churches CASCADE;');
  await pg.query(`INSERT INTO churches (id, display_code, name) VALUES ($1, 'K7QM-4XD2', 'St Mary')`, [CHURCH]);
  const hash = await hashPassword(PASSWORD);
  plannerId = (await pg.query(
    `INSERT INTO users (id, church_id, username, display_name, role, password_hash, must_change_password)
     VALUES (gen_random_uuid(), $1, 'planner', 'planner', 'planner', $2, false) RETURNING id`, [CHURCH, hash])).rows[0].id;
  laptopToken = randomBytes(32).toString('base64url');
  await pg.query(`INSERT INTO device_tokens (token_hash, church_id, user_id, device_name) VALUES ($1, $2, $3, 'Booth')`, [hashToken(laptopToken, SECRET), CHURCH, plannerId]);
});

// ---- Pull and push ----

test('a pull into an empty laptop brings in the plan, its songs and its readings', async () => {
  await seedServerSong(HYMN_A, 'Praise to the Lord');
  const created = await serverCreate(laptopToken, { items: [songItem('hymn', 1, HYMN_A), readingItem('gospel', 2, 'Gospel')] });
  const l = laptop();
  seedHymn(l.db, HYMN_A, 'Praise to the Lord');
  const status = await l.engine.runOnce();
  assert.equal(status.status === 'error', false, status.message);
  const plan = localMass(l.db, created.id);
  assert.equal(plan.name, 'All Saints');
  assert.equal(plan.liturgical_date, '2026-11-01');
  assert.deepEqual(localMassItems(l.db, created.id).map((i) => [i.module, i.label]), [['lyrics', 'Praise to the Lord'], ['lectionary', 'Gospel']]);
  assert.equal(l.store.dirtyPlans().length, 0, 'a pulled plan is not sent back');
});

test('a web edit is applied on the next run', async () => {
  const created = await serverCreate(laptopToken);
  const l = laptop();
  await l.engine.runOnce();
  serverNow = new Date(T2);
  await serverEdit(laptopToken, created.id, { name: 'All Saints (web)' });
  await l.engine.runOnce();
  assert.equal(localMass(l.db, created.id).name, 'All Saints (web)');
  assert.equal(localMass(l.db, created.id).updated_at, T2, 'the laptop copy takes the server time');
  assert.equal(l.store.dirtyPlans().length, 0);
});

test('a laptop edit is pushed on the next run', async () => {
  const created = await serverCreate(laptopToken);
  const l = laptop();
  await l.engine.runOnce();
  editLocal(l.db, created.id, { name: 'All Saints, moved', at: T2 });
  assert.equal(l.store.dirtyPlans().length, 1, 'the edit is dirty');
  serverNow = new Date(T2);
  await l.engine.runOnce();
  assert.equal(await serverNameOf(created.id), 'All Saints, moved');
  assert.equal(l.store.dirtyPlans().length, 0);
});

// ---- Conflicts: the more recent edit wins ----

test('a stale base is resolved when the laptop edit is the more recent: it is sent against the server version', async () => {
  const created = await serverCreate(laptopToken);
  const l = laptop();
  await l.engine.runOnce();
  serverNow = new Date(T2);
  await serverEdit(laptopToken, created.id, { name: 'Changed on the web' });
  editLocal(l.db, created.id, { name: 'Changed on the laptop, later', at: T3 });
  serverNow = new Date(T3);
  await l.engine.runOnce();
  assert.equal(await serverNameOf(created.id), 'Changed on the laptop, later');
});

test('a stale base is resolved when the web edit is the more recent: the laptop takes the web version', async () => {
  const created = await serverCreate(laptopToken);
  const l = laptop();
  await l.engine.runOnce();
  editLocal(l.db, created.id, { name: 'Changed on the laptop, earlier', at: T1_HALF });
  serverNow = new Date(T2);
  await serverEdit(laptopToken, created.id, { name: 'Changed on the web, later' });
  await l.engine.runOnce();
  assert.equal(localMass(l.db, created.id).name, 'Changed on the web, later');
  assert.equal(await serverNameOf(created.id), 'Changed on the web, later');
});

test('a push that finds a newer server version in the middle of a run: the more recent edit still wins', async () => {
  const created = await serverCreate(laptopToken);
  const l = laptop();
  await l.engine.runOnce();
  // The pull is skipped by moving the cursor past the web edit, so the first send meets it as a conflict.
  serverNow = new Date(T2);
  await serverEdit(laptopToken, created.id, { name: 'Web, mid-run' });
  l.store.setCursor('2026-10-27T11:30:00.000Z|ffffffff-ffff-4fff-8fff-ffffffffffff');
  editLocal(l.db, created.id, { name: 'Laptop, newest', at: T3 });
  serverNow = new Date(T3);
  await l.engine.runOnce();
  assert.equal(await serverNameOf(created.id), 'Laptop, newest');
});

test('a push that finds a newer web version and an older laptop edit takes the web version', async () => {
  const created = await serverCreate(laptopToken);
  const l = laptop();
  await l.engine.runOnce();
  serverNow = new Date(T2);
  await serverEdit(laptopToken, created.id, { name: 'Web, mid-run, later' });
  l.store.setCursor('2026-10-27T11:30:00.000Z|ffffffff-ffff-4fff-8fff-ffffffffffff');
  editLocal(l.db, created.id, { name: 'Laptop, earlier', at: T1_HALF });
  serverNow = new Date(T3);
  await l.engine.runOnce();
  assert.equal(localMass(l.db, created.id).name, 'Web, mid-run, later');
  assert.equal(await serverNameOf(created.id), 'Web, mid-run, later');
});

// ---- The first send of a plan the website already has (decision 4) ----

test('a first send that gets a 409 is settled as a conflict: the more recent laptop edit is sent', async () => {
  // The website has this id already. The laptop never pulled it, because the cursor is past it.
  const id = randomUUID();
  serverNow = new Date(T2);
  await api().createPlan({ httpMethod: 'POST', headers: { authorization: `Bearer ${laptopToken}` }, body: JSON.stringify({ id, name: 'Web copy', date: '2026-11-01', kind: 'mass', items: [] }) });
  const l = laptop();
  l.store.setCursor('2026-10-27T11:30:00.000Z|ffffffff-ffff-4fff-8fff-ffffffffffff');
  localMassPlan(l.db, { name: 'Laptop copy', at: T3, uuid: id });
  serverNow = new Date(T3);
  await l.engine.runOnce();
  assert.equal(await serverNameOf(id), 'Laptop copy');
});

test('a first send that gets a 409 takes the website version when the website edit is more recent', async () => {
  const id = randomUUID();
  serverNow = new Date(T2);
  await api().createPlan({ httpMethod: 'POST', headers: { authorization: `Bearer ${laptopToken}` }, body: JSON.stringify({ id, name: 'Web copy, newer', date: '2026-11-01', kind: 'mass', items: [] }) });
  const l = laptop();
  l.store.setCursor('2026-10-27T11:30:00.000Z|ffffffff-ffff-4fff-8fff-ffffffffffff');
  localMassPlan(l.db, { name: 'Laptop copy, older', at: T1_HALF, uuid: id });
  serverNow = new Date(T3);
  await l.engine.runOnce();
  assert.equal(localMass(l.db, id).name, 'Web copy, newer');
  assert.equal(await serverNameOf(id), 'Web copy, newer');
});

// ---- Deletes, both ways (option A) ----

test('a plan deleted on the laptop is deleted on the website, and is not brought back by the next pull', async () => {
  const created = await serverCreate(laptopToken);
  const l = laptop();
  await l.engine.runOnce();
  l.db.prepare("INSERT OR REPLACE INTO sync_tombstones (uuid, plan_kind, deleted_at) VALUES (?, 'mass', ?)").run(created.id, T2);
  l.db.prepare('DELETE FROM mass_plans WHERE uuid = ?').run(created.id);
  serverNow = new Date(T2);
  await l.engine.runOnce();
  assert.equal((await serverRow(created.id)).body.deleted, true, 'the website marks it deleted');
  assert.equal(l.db.prepare('SELECT COUNT(*) AS n FROM sync_tombstones').get().n, 0, 'the tombstone is cleared once the website confirms');
  assert.equal(localMass(l.db, created.id), undefined, 'it does not come back');
});

test('a plan deleted on the website is removed from the laptop, and no tombstone is made', async () => {
  const created = await serverCreate(laptopToken);
  const l = laptop();
  await l.engine.runOnce();
  const cookie = await cookieFor('planner');
  serverNow = new Date(T2);
  const res = await api().deletePlan({ httpMethod: 'POST', headers: { cookie }, body: JSON.stringify({ id: created.id }) });
  assert.equal(res.statusCode, 200);
  await l.engine.runOnce();
  assert.equal(localMass(l.db, created.id), undefined);
  assert.equal(l.db.prepare('SELECT COUNT(*) AS n FROM sync_tombstones').get().n, 0, 'nothing is sent back for a delete that came from the website');
});

// ---- Offline, and the link being revoked ----

test('offline, the run waits and retries; once the connection is back, the edit is sent', async () => {
  const created = await serverCreate(laptopToken);
  const l = laptop();
  await l.engine.runOnce();
  editLocal(l.db, created.id, { name: 'Written offline', at: T2 });
  network.online = false;
  serverNow = new Date(T2);
  const offline = await l.engine.runOnce();
  assert.equal(offline.status, 'offline');
  assert.equal(l.timers.length, 1, 'one retry is waiting');
  assert.equal(l.timers[0].ms, 30 * 1000, 'the first retry is after 30 seconds');
  network.online = true;
  // The retry fires as the timer would. The run is async, so wait for it to finish, up to a fixed bound.
  l.timers[0].fn();
  for (let i = 0; i < 500 && l.engine.status().status !== 'synced'; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(l.engine.status().status, 'synced', 'the retry completes');
  assert.equal(await serverNameOf(created.id), 'Written offline');
  assert.equal(l.engine.status().status, 'synced');
});

test('a revoked link stops the sync: no retry is scheduled and nothing more is sent', async () => {
  const created = await serverCreate(laptopToken);
  const l = laptop();
  await l.engine.runOnce();
  await pg.query('DELETE FROM device_tokens WHERE token_hash = $1', [hashToken(laptopToken, SECRET)]);
  editLocal(l.db, created.id, { name: 'After the unlink', at: T2 });
  serverNow = new Date(T2);
  const status = await l.engine.runOnce();
  assert.equal(status.status, 'error');
  assert.match(status.message, /unlinked from the website/);
  assert.equal(l.timers.length, 0, 'no retry');
  const before = network.calls;
  await l.engine.runOnce();
  assert.equal(network.calls, before, 'after the link is gone, no call is made');
  assert.equal(await serverNameOf(created.id), 'All Saints', 'the server copy is untouched');
});

// ---- Praise & Worship local-only fields ----

test('praise segments keep the laptop\'s own fields on a pull: leader, cues, notes and arrangement stay', async () => {
  await seedServerSong(HYMN_A, 'Praise to the Lord');
  const l = laptop();
  seedHymn(l.db, HYMN_A, 'Praise to the Lord');
  const hymnId = l.db.prepare('SELECT id FROM hymns WHERE uuid = ?').get(HYMN_A).id;
  const sessionId = Number(l.db.prepare("INSERT INTO pw_sessions (name, liturgical_date, groups) VALUES ('Night', '2026-11-06', ?)")
    .run(JSON.stringify([{ key: 'opening', name: 'Opening' }])).lastInsertRowid);
  l.db.prepare(`INSERT INTO pw_segments (session_id, display_order, segment_key, group_key, name, type, minutes, leader, content_ref, arrangement, cues, notes)
    VALUES (?, 1, 'marian_song', 'opening', 'Marian Song', 'song', 5, 'Ana', ?, '{"key":"G"}', '{"lyrics":"verse 2"}', 'Lead softly')`)
    .run(sessionId, JSON.stringify({ kind: 'song', hymnIds: [hymnId], maxSongs: 1, category: null }));
  await l.engine.runOnce();
  const uuid = l.db.prepare('SELECT uuid FROM pw_sessions WHERE id = ?').get(sessionId).uuid;
  // The website changes the minutes. The laptop's own fields must not be lost.
  serverNow = new Date(T2);
  const row = await serverRow(uuid);
  const changedItems = row.body.items.map((item) => ({ ...item, minutes: 9 }));
  const res = await api().pushPlans({ httpMethod: 'POST', headers: { authorization: `Bearer ${laptopToken}` }, body: JSON.stringify({ plans: [{ id: uuid, name: 'Night', date: '2026-11-06', kind: 'pw', items: changedItems, baseUpdatedAt: new Date(row.updated_at).toISOString() }] }) });
  assert.equal(JSON.parse(res.body).results[0].status, 'accepted');
  serverNow = new Date(T3);
  await l.engine.runOnce();
  const segment = l.db.prepare('SELECT * FROM pw_segments WHERE session_id = ?').get(sessionId);
  assert.equal(segment.minutes, 9, 'the website minutes arrive');
  assert.equal(segment.leader, 'Ana', 'the leader stays');
  assert.equal(segment.notes, 'Lead softly', 'the notes stay');
  assert.equal(segment.cues, '{"lyrics":"verse 2"}', 'the cues stay');
  assert.equal(segment.arrangement, '{"key":"G"}', 'the arrangement stays');
  assert.equal(segment.name, 'Marian Song', 'the name stays');
});

// ---- Held plans ----

test('a web item the laptop cannot show holds the plan: it is not sent, and the count says so', async () => {
  // A song from the church list that this laptop does not have. The laptop cannot show it, so the plan is held.
  await seedServerSong(HYMN_B, 'A song this laptop does not have yet');
  const created = await serverCreate(laptopToken, { items: [readingItem('gospel', 1, 'Gospel')] });
  const l = laptop();
  await l.engine.runOnce();
  serverNow = new Date(T2);
  await serverEdit(laptopToken, created.id, { items: [readingItem('gospel', 1, 'Gospel'), songItem('hymn', 2, HYMN_B)] });
  serverNow = new Date(T3);
  const status = await l.engine.runOnce();
  assert.equal(status.counts.held, 1);
  editLocal(l.db, created.id, { name: 'Laptop edit while held', at: T3 });
  await l.engine.runOnce();
  assert.equal(await serverNameOf(created.id), 'All Saints', 'the held plan is not sent');
});

// ---- Web-created plans sync; they are not held (decision 3) ----

test('the Mass parts the laptop names are the ones in src/liturgy/massOrder.ts, with the same English names', () => {
  const src = fs.readFileSync(path.join(here, '..', 'src', 'liturgy', 'massOrder.ts'), 'utf8');
  const listed = [...src.matchAll(/id: '([^']+)',\s*name: \{ en: (["'])(.*?)\2/g)].map((m) => [m[1], m[3]]);
  assert.deepEqual(listed.map(([id]) => id).sort(), Object.keys(MASS_PARTS).sort());
  for (const [id, en] of listed) assert.equal(MASS_PARTS[id], en, `${id} has the same name`);
  // Every web step names a part that exists, so the table has no dead entry.
  for (const part of Object.values(MASS_STEP_PARTS)) assert.ok(MASS_PARTS[part], `${part} is a Mass part`);
});

const MASS_WEB_PARTS = [
  // The web's step number, its group, and the item it writes when the step carries a typed setting (no song chosen).
  ['4', 'introductory', 'song', 'Lord, have mercy (Mass setting)'],
  ['5', 'introductory', 'song', 'Gloria (Mass setting)'],
  ['13', 'eucharist', 'rite', null],
  ['18', 'eucharist', 'song', 'Holy, Holy, Holy (Mass setting)'],
  ['20', 'eucharist', 'song', 'Christ has died (Mass setting)'],
  ['22', 'communion', 'song', 'Our Father'],
  ['24', 'communion', 'song', 'Lamb of God (Mass setting)'],
];

test('a web-created Mass plan with each Mass part arrives as the part, is not held, and goes back with the same keys', async () => {
  const items = MASS_WEB_PARTS.map(([key, group, kind, text], i) => (kind === 'rite'
    ? { key, group, order: i + 1, kind, note: 'Said by the priest' }
    : { key, group, order: i + 1, kind, text }));
  const created = await serverCreate(laptopToken, { items });
  const l = laptop();
  const status = await l.engine.runOnce();
  assert.equal(status.counts.held ?? 0, 0, 'no plan is held');
  const rows = localMassItems(l.db, created.id);
  // Each Mass part is on the laptop as the part, or, when the web step has a note, as that note under the web key.
  for (const [step, part] of Object.entries(MASS_STEP_PARTS)) {
    const found = rows.some((r) => (r.module === 'mass_order' && r.label === MASS_PARTS[part]) || (r.module === 'custom' && r.sourceId === `web:${step}`));
    assert.ok(found, `${MASS_PARTS[part]} (web step ${step}) is on the laptop`);
  }
  // Sent back, each part keeps its web key, so the web still finds its step.
  await l.engine.runOnce();
  const sent = (await serverRow(created.id)).body.items.map((i) => i.key).sort();
  assert.deepEqual(sent, items.map((i) => i.key).sort(), 'the web keys survive the round trip');
});

test('a Mass part with a typed note keeps the note, and a rite step with a note comes back with it', async () => {
  const created = await serverCreate(laptopToken, {
    items: [
      { key: '5', group: 'introductory', order: 1, kind: 'rite', note: 'Incense at the Gloria' },
      { key: '12', group: 'word', order: 2, kind: 'rite', note: 'Read the Gospel slowly' },
    ],
  });
  const l = laptop();
  await l.engine.runOnce();
  const rows = localMassItems(l.db, created.id);
  assert.ok(rows.some((r) => r.label === 'Incense at the Gloria'), 'the note is on the laptop');
  assert.ok(rows.some((r) => r.label === 'Read the Gospel slowly'));
  await l.engine.runOnce();
  await l.engine.runOnce();
  const body = (await serverRow(created.id)).body.items;
  assert.deepEqual(body.map((i) => [i.key, i.note]), [['5', 'Incense at the Gloria'], ['12', 'Read the Gospel slowly']], 'the notes come back under their keys, unchanged');
});

test('a web-created praise prayer segment arrives as a prayer with its template name, is not held, and keeps its minutes and note', async () => {
  const created = await serverCreate(laptopToken, {
    kind: 'pw',
    items: [{ key: 'prayer_authority', group: 'opening', order: 1, kind: 'rite', minutes: 3, note: 'Pray for the parish' }],
  });
  const l = laptop();
  const status = await l.engine.runOnce();
  assert.equal(status.counts.held ?? 0, 0);
  const session = l.db.prepare('SELECT id FROM pw_sessions WHERE uuid = ?').get(created.id);
  const segment = l.db.prepare('SELECT * FROM pw_segments WHERE session_id = ?').get(session.id);
  assert.equal(segment.type, 'prayer');
  assert.equal(segment.name, 'Prayer to Take Authority', 'the template name, as the web shows it');
  assert.equal(segment.minutes, 3);
  assert.equal(segment.notes, 'Pray for the parish');
  assert.deepEqual(JSON.parse(segment.content_ref), { kind: 'prayer', noteId: null });
});

// ---- Conflicts and the clock: server time decides (decision 5) ----

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

test('a laptop clock a year ahead does not make an older laptop edit the newer one: server time decides', async () => {
  const created = await serverCreate(laptopToken);
  const l = laptop(laptopToken, { skewMs: YEAR_MS });
  await l.engine.runOnce();
  serverNow = new Date(T2);
  await serverEdit(laptopToken, created.id, { name: 'Web, at server time T2' });
  // The laptop's clock reads a year ahead, so this edit, made at server time T1.5, carries a stamp that looks later than T2.
  editLocal(l.db, created.id, { name: 'Laptop, made at T1.5 on the server clock', at: new Date(Date.parse(T1_HALF) + YEAR_MS).toISOString() });
  serverNow = new Date(T3);
  await l.engine.runOnce();
  assert.equal(localMass(l.db, created.id).name, 'Web, at server time T2', 'the web edit wins on server time');
  assert.equal(await serverNameOf(created.id), 'Web, at server time T2');
});

test('a laptop clock a year behind does not make a newer laptop edit the older one: server time decides', async () => {
  const created = await serverCreate(laptopToken);
  const l = laptop(laptopToken, { skewMs: -YEAR_MS });
  await l.engine.runOnce();
  serverNow = new Date(T2);
  await serverEdit(laptopToken, created.id, { name: 'Web, at server time T2' });
  // Made at server time T3, which the laptop's clock reads as a year earlier than T2.
  editLocal(l.db, created.id, { name: 'Laptop, made at T3 on the server clock', at: new Date(Date.parse(T3) - YEAR_MS).toISOString() });
  serverNow = new Date(T3);
  await l.engine.runOnce();
  assert.equal(await serverNameOf(created.id), 'Laptop, made at T3 on the server clock', 'the laptop edit wins on server time');
});

// ---- A 409 on the first send (decision 1) ----

test('a 409 compares the website plan first: identical content is only marked in step, and nothing is sent', async () => {
  const id = randomUUID();
  serverNow = new Date(T2);
  await api().createPlan({ httpMethod: 'POST', headers: { authorization: `Bearer ${laptopToken}` }, body: JSON.stringify({ id, name: 'Same', date: '2026-11-01', kind: 'mass', items: [] }) });
  const l = laptop();
  l.store.setCursor('2026-10-27T11:30:00.000Z|ffffffff-ffff-4fff-8fff-ffffffffffff');
  localMassPlan(l.db, { name: 'Same', at: T3, uuid: id });
  const before = network.calls;
  serverNow = new Date(T3);
  await l.engine.runOnce();
  assert.equal(await serverNameOf(id), 'Same');
  assert.equal(localMass(l.db, id).server_updated_at, T2, 'in step with the website version');
  assert.equal(localMass(l.db, id).synced_updated_at, T3, 'the laptop stamp it is in step at');
  assert.equal(l.store.dirtyPlans().length, 0);
  assert.ok(network.calls > before, 'the website was asked first');
});

test('a 409 for an id another church holds: the laptop plan gets a new id and is created, and the other plan is untouched', async () => {
  const foreign = randomUUID();
  await pg.query(`INSERT INTO churches (id, display_code, name) VALUES ('00000000-0000-4000-8000-00000000000b', 'R2VT-9HJ6', 'Holy Cross')`);
  await pg.query(`INSERT INTO plans (id, church_id, name, liturgical_date, body, updated_at) VALUES ($1, '00000000-0000-4000-8000-00000000000b', 'Their plan', '2026-11-01', '{"kind":"mass","items":[]}', $2)`, [foreign, T2]);
  const l = laptop();
  localMassPlan(l.db, { name: 'Ours, same id', at: T3, uuid: foreign });
  serverNow = new Date(T3);
  const status = await l.engine.runOnce();
  assert.equal(status.counts.held, 0, 'nothing is held');
  assert.equal(status.counts.failed, 0);
  assert.equal(await serverNameOf(foreign), 'Their plan', "the other church's plan is untouched");
  assert.equal(localMass(l.db, foreign), undefined, 'the old id is gone from the laptop');
  const moved = l.db.prepare("SELECT uuid, name FROM mass_plans WHERE name = 'Ours, same id'").get();
  assert.notEqual(moved.uuid, foreign);
  assert.equal(await serverNameOf(moved.uuid), 'Ours, same id', "created on this church's website under its new id");
  assert.equal(l.store.dirtyPlans().length, 0);
  assert.throws(() => l.db.prepare('UPDATE mass_plans SET uuid = ? WHERE uuid = ?').run(randomUUID(), moved.uuid), /cannot be changed/, 'the id is fixed again');
});

// ---- Notes stay on the laptop (point 1) ----

test('no request body carries a note: a laptop note never leaves, and a web note never replaces it', async () => {
  await seedServerSong(HYMN_A, 'Praise to the Lord');
  const l = laptop();
  seedHymn(l.db, HYMN_A, 'Praise to the Lord');
  const hymnId = l.db.prepare('SELECT id FROM hymns WHERE uuid = ?').get(HYMN_A).id;
  const sessionId = Number(l.db.prepare("INSERT INTO pw_sessions (name, liturgical_date, groups) VALUES ('Night', '2026-11-06', ?)")
    .run(JSON.stringify([{ key: 'opening', name: 'Opening' }])).lastInsertRowid);
  l.db.prepare(`INSERT INTO pw_segments (session_id, display_order, segment_key, group_key, name, type, minutes, leader, content_ref, arrangement, cues, notes)
    VALUES (?, 1, 'marian_song', 'opening', 'Marian Song', 'song', 5, '', ?, '{}', '{}', 'Laptop-only note')`)
    .run(sessionId, JSON.stringify({ kind: 'song', hymnIds: [hymnId], maxSongs: 1, category: null }));
  await l.engine.runOnce();
  const uuid = l.db.prepare('SELECT uuid FROM pw_sessions WHERE id = ?').get(sessionId).uuid;
  // A rename makes the plan dirty, so the next run sends it again.
  serverNow = new Date(T2);
  l.db.prepare('UPDATE pw_sessions SET name = ?, updated_at = ? WHERE id = ?').run('Night, renamed', T2, sessionId);
  await l.engine.runOnce();
  // The web types a note for this segment. The laptop keeps its own note.
  serverNow = new Date(T3);
  await serverEdit(laptopToken, uuid, { items: (await serverRow(uuid)).body.items.map((i) => ({ ...i, note: 'Web note' })) });
  await l.engine.runOnce();
  assert.equal(l.db.prepare('SELECT notes FROM pw_segments WHERE session_id = ?').get(sessionId).notes, 'Laptop-only note', 'the laptop note is not replaced');
  // A laptop edit is sent again. The web's note stays on the server, because no laptop body carries a note to replace it.
  serverNow = new Date('2026-10-27T13:00:00.000Z');
  l.db.prepare('UPDATE pw_sessions SET name = ?, updated_at = ? WHERE id = ?').run('Night, again', '2026-10-27T13:00:00.000Z', sessionId);
  await l.engine.runOnce();
  const sent = network.bodies.filter((b) => b.name === 'plan-create' || b.name === 'plan-sync-push');
  assert.ok(sent.length >= 2, 'the laptop sent its plan more than once');
  for (const { body } of sent) {
    assert.equal(body.includes('"note"'), false, 'no item in any body carries a note');
    assert.equal(body.includes('Laptop-only note'), false, 'the laptop note is not in any body');
  }
  assert.equal((await serverRow(uuid)).body.items[0].note, 'Web note', 'the web note is still on the server');
});

// ---- Holy Mass slots ----

/** A laptop Mass plan whose items fill Holy Mass slots: `items` are { block, module, sourceId, label, slot }. */
function localSlottedPlan(db, { name, items, at = T1 }) {
  const id = Number(db.prepare('INSERT INTO mass_plans (name, liturgical_date) VALUES (?, ?)').run(name, '2026-11-08').lastInsertRowid);
  items.forEach((it, i) => db.prepare('INSERT INTO mass_plan_items (plan_id, liturgical_block, source_module, source_id, label, display_order, slot) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, it.block, it.module, it.sourceId, it.label, i + 1, it.slot ?? null));
  db.prepare('UPDATE mass_plans SET updated_at = ? WHERE id = ?').run(at, id);
  return db.prepare('SELECT uuid FROM mass_plans WHERE id = ?').get(id).uuid;
}

const slotsOf = (db, uuid) => db.prepare(`SELECT i.label, i.slot FROM mass_plan_items i JOIN mass_plans p ON p.id = i.plan_id WHERE p.uuid = ? ORDER BY i.display_order`).all(uuid).map((r) => [r.label, r.slot]);

async function slottedPlanOnTheWeb() {
  await seedServerSong(HYMN_A, 'Praise to the Lord');
  const l = laptop();
  const hymnId = Number(seedHymn(l.db, HYMN_A, 'Praise to the Lord').lastInsertRowid);
  const uuid = localSlottedPlan(l.db, {
    name: 'Sunday Solemn',
    items: [
      { block: 'introductory', module: 'lyrics', sourceId: String(hymnId), label: 'Praise to the Lord', slot: 'entrance' },
      { block: 'introductory', module: 'mass_order', sourceId: 'kyrie', label: 'Kyrie', slot: 'kyrie' },
      { block: 'word', module: 'lectionary', sourceId: '2026-11-08|Gospel', label: 'Gospel' },
    ],
  });
  await l.engine.runOnce();
  return { l, uuid };
}

test('a laptop plan goes to the website with each item\'s Holy Mass slot as its number, and an item with no slot has none', async () => {
  const { uuid } = await slottedPlanOnTheWeb();
  const items = (await serverRow(uuid)).body.items;
  assert.deepEqual(items.map((i) => [i.kind, i.slot ?? null]), [['song', 1], ['rite', 3], ['reading', null]]);
});

test('a second laptop pulling the plan gets the same slots, so no item lands among the additional ones', async () => {
  const { uuid } = await slottedPlanOnTheWeb();
  const other = laptop();
  seedHymn(other.db, HYMN_A, 'Praise to the Lord');
  await other.engine.runOnce();
  // A pulled Mass part is named as the laptop names it; the slots are what matter here.
  assert.deepEqual(slotsOf(other.db, uuid).map(([, slot]) => slot), ['entrance', 'kyrie', null]);
});

test('a web edit pulled back keeps every slot', async () => {
  const { l, uuid } = await slottedPlanOnTheWeb();
  serverNow = new Date(T2);
  await serverEdit(laptopToken, uuid, { name: 'Sunday Solemn, edited on the web' });
  serverNow = new Date(T3);
  await l.engine.runOnce();
  assert.equal(localMass(l.db, uuid).name, 'Sunday Solemn, edited on the web');
  assert.deepEqual(slotsOf(l.db, uuid), [['Praise to the Lord', 'entrance'], ['Kyrie', 'kyrie'], ['Gospel', null]]);
});

test('an item the website sends back without its slot keeps the slot the laptop had', async () => {
  const { l, uuid } = await slottedPlanOnTheWeb();
  const row = await serverRow(uuid);
  serverNow = new Date(T2);
  // As the website's editor sends a step it rebuilt, or as a website from before slots stores it: no slot field.
  await serverEdit(laptopToken, uuid, { name: 'No slots on the web', items: row.body.items.map(({ slot, ...item }) => item) });
  serverNow = new Date(T3);
  await l.engine.runOnce();
  assert.deepEqual(slotsOf(l.db, uuid), [['Praise to the Lord', 'entrance'], ['Kyrie', 'kyrie'], ['Gospel', null]]);
});

test('the website refuses a slot that is not 1 to 28, and takes two items in one slot', async () => {
  const created = await serverCreate(laptopToken);
  const row = await serverRow(created.id);
  const push = (items) => api().pushPlans({ httpMethod: 'POST', headers: { authorization: `Bearer ${laptopToken}` }, body: JSON.stringify({ plans: [{ id: created.id, name: row.name, date: '2026-11-01', kind: 'mass', items, baseUpdatedAt: new Date(row.updated_at).toISOString() }] }) });
  const resultOf = async (items) => JSON.parse((await push(items)).body).results?.[0] ?? JSON.parse((await push(items)).body);
  const bad = await resultOf([readingItem('a', 1, 'Gospel'), { ...readingItem('b', 2, 'First Reading'), slot: 29 }]);
  assert.match(JSON.stringify(bad), /slot must be a number from 1 to 28/);
  const twice = JSON.parse((await push([{ ...readingItem('a', 1, 'Gospel'), slot: 4 }, { ...readingItem('b', 2, 'First Reading'), slot: 4 }])).body).results[0];
  assert.equal(twice.status, 'accepted');
});

test('two songs in a slot, a key and a Content Hub entry from the web survive a laptop pull and a laptop push', async () => {
  await seedServerSong(HYMN_A, 'First communion song');
  await seedServerSong(HYMN_B, 'Second communion song');
  const l = laptop();
  seedHymn(l.db, HYMN_A, 'First communion song');
  seedHymn(l.db, HYMN_B, 'Second communion song');
  const hubEntry = { id: 'hub-1', type: 'prayer', title: 'Prayer for the fiesta', category: 'Community Prayer', text: 'The words of the prayer.', speakerNote: 'Read by the commentator' };
  const created = await serverCreate(laptopToken, {
    contentHubItems: [hubEntry],
    items: [
      { key: 's16', group: 'communion', order: 1, kind: 'song', songId: HYMN_A, slot: 16, slotId: 's16', keyTransposed: 'Eb', contentType: 'song' },
      { key: 's16.2', group: 'communion', order: 2, kind: 'song', songId: HYMN_B, slot: 16, slotId: 's16', keyTransposed: 'G', contentType: 'song' },
      { key: 's2', group: 'introductory', order: 3, kind: 'rite', text: 'Prayer for the fiesta', slot: 2, slotId: 's2', contentHubId: 'hub-1', title: 'Prayer for the fiesta', contentType: 'hub_item' },
    ],
  });
  await l.engine.runOnce();
  assert.deepEqual(slotsOf(l.db, created.id).map(([, slot]) => slot), ['communion', null, 'confess'], 'the laptop keeps one item in the slot; the second sits beside it');
  const note = l.db.prepare('SELECT id, title, body, category, display FROM notes WHERE web_hub_key = ?').get(`${created.id}:hub-1`);
  assert.deepEqual([note.title, note.body, note.category, note.display], ['Prayer for the fiesta', 'The words of the prayer.', 'Community Prayer', 'full'], 'the words are in the laptop\'s Content Hub');
  const played = l.db.prepare("SELECT source_module AS module, source_id AS sourceId FROM mass_plan_items WHERE slot = 'confess'").get();
  assert.deepEqual([played.module, played.sourceId], ['notes', String(note.id)], 'Go Live plays the slot from that note');
  serverNow = new Date(T2);
  l.db.prepare('UPDATE mass_plans SET name = ?, updated_at = ? WHERE uuid = ?').run('Edited on the laptop', T2, created.id);
  serverNow = new Date(T3);
  await l.engine.runOnce();
  const row = await serverRow(created.id);
  assert.equal(row.name, 'Edited on the laptop', 'the laptop push went through');
  assert.deepEqual(row.body.contentHubItems, [hubEntry], 'a laptop push keeps the plan\'s Hub');
  const first = row.body.items.find((i) => i.songId === HYMN_A);
  const second = row.body.items.find((i) => i.songId === HYMN_B);
  assert.deepEqual([first.slot, first.keyTransposed, first.slotId, first.contentType], [16, 'Eb', 's16', 'song'], 'a new key from the laptop still finds the web fields');
  assert.deepEqual([second.slot, second.keyTransposed, second.slotId], [16, 'G', 's16'], 'the second song gets its slot back');
  const hub = row.body.items.find((i) => i.contentHubId === 'hub-1');
  assert.deepEqual([hub.text, hub.note, hub.slot, hub.slotId, hub.contentType], ['Prayer for the fiesta', undefined, 2, 's2', 'hub_item'], 'it goes back as the same Hub entry in the same slot');
  // Nothing new from the website: an operator's edit to the note stays.
  l.db.prepare('UPDATE notes SET body = ? WHERE id = ?').run('Corrected on the laptop', note.id);
  serverNow = new Date('2026-10-27T13:00:00.000Z');
  await serverEdit(laptopToken, created.id, { name: 'Renamed on the web' });
  serverNow = new Date('2026-10-27T14:00:00.000Z');
  await l.engine.runOnce();
  assert.equal(l.db.prepare('SELECT body FROM notes WHERE id = ?').get(note.id).body, 'Corrected on the laptop');
});

test('a typed reading reference never holds a plan, goes on being sent, and comes back to the website as the same reading', async () => {
  const l = laptop();
  const references = ['Matthew 5:1-12a', '1 Cor 13:4-7, 13', 'Isaiah 52:13-53:12', 'Psalm 15-18c', '??? <b>'];
  const created = await serverCreate(laptopToken, {
    items: references.map((text, i) => ({ key: `s${20 + i}`, group: 'word', order: i + 1, kind: 'reading', text, ...(i === 0 ? { slot: 20 } : {}) })),
  });
  await l.engine.runOnce();
  assert.equal(l.store.holdOf(created.id), null, 'not held');
  assert.deepEqual(slotsOf(l.db, created.id).map(([label]) => label), references);
  serverNow = new Date(T2);
  l.db.prepare('UPDATE mass_plans SET name = ?, updated_at = ? WHERE uuid = ?').run('Edited on the laptop', T2, created.id);
  serverNow = new Date(T3);
  await l.engine.runOnce();
  const row = await serverRow(created.id);
  assert.equal(row.name, 'Edited on the laptop', 'the outbound send went through');
  assert.deepEqual(row.body.items.map((i) => [i.kind, i.text]), references.map((text) => ['reading', text]));
});

test('a Praise & Worship reading by reference is not held and does not refuse the next send', async () => {
  const l = laptop();
  const created = await serverCreate(laptopToken, { kind: 'pw', items: [{ key: 'r1', group: 'word', order: 1, kind: 'reading', text: 'Matthew 5:1-12a', minutes: 5 }] });
  await l.engine.runOnce();
  assert.equal(l.store.holdOf(created.id), null);
  const local = l.db.prepare('SELECT id FROM pw_sessions WHERE uuid = ?').get(created.id);
  serverNow = new Date(T2);
  l.db.prepare('UPDATE pw_sessions SET name = ?, updated_at = ? WHERE id = ?').run('Night, renamed', T2, local.id);
  serverNow = new Date(T3);
  await l.engine.runOnce();
  const row = await serverRow(created.id);
  assert.equal(row.name, 'Night, renamed');
  assert.equal(row.body.items[0].text, 'Matthew 5:1-12a', 'the reference is not wiped');
});

test('a plan held by an earlier version is read again once and released', async () => {
  const l = laptop();
  const created = await serverCreate(laptopToken, { items: [{ key: 's20', group: 'word', order: 1, kind: 'reading', text: 'Matthew 5:1-12a', slot: 20 }] });
  await l.engine.runOnce();
  // As an earlier version left it: held, its reading not placed, and already past the pull cursor.
  l.store.hold(created.id, 1);
  const next = createPlanSync({ store: l.store, cloud: l.cloud, setTimer: () => 0, clearTimer: () => {} });
  await next.runOnce();
  assert.equal(l.store.holdOf(created.id), null);
});

// ---- One plan cannot stop the others ----

/** A store and cloud with no database, for the send loop alone. `create` decides what the cloud does with each plan. */
function sendLoop(uuids, create, payloadFor = (plan) => ({ id: plan.uuid, name: 'Plan', date: '2026-11-15', kind: 'mass', items: [] })) {
  const synced = [];
  const store = {
    tombstones: () => [],
    cursor: () => null,
    setCursor: () => {},
    holdCount: () => 0,
    holdOf: () => null,
    heldPlans: () => [],
    dirtyPlans: () => uuids.map((uuid) => ({ uuid, updated_at: '2026-11-01T00:00:00.000Z', server_updated_at: null })),
    payloadFor,
    markSynced: (uuid) => synced.push(uuid),
  };
  const cloud = {
    pullPlans: async () => ({ plans: [], cursor: null, more: false }),
    createPlan: create,
    serverOffset: () => 0,
  };
  return { engine: createPlanSync({ store, cloud }), synced };
}
const createdOk = { status: 'created', updatedAt: '2026-11-01T00:00:01.000Z' };

test('a plan the website refuses is counted with its reason, and the plans after it still go', async () => {
  const { engine, synced } = sendLoop(['a', 'b', 'c'], async (plan) => (plan.id === 'b' ? { status: 'error', message: 'Refused for a plain reason.' } : createdOk));
  const state = await engine.runOnce();
  assert.deepEqual(synced, ['a', 'c']);
  assert.equal(state.status, 'synced');
  assert.equal(state.counts.sent, 2);
  assert.equal(state.counts.failed, 1);
  assert.equal(state.message, 'Refused for a plain reason.');
});

test('an unexpected error on one plan is counted, shows no raw text, and the plans after it still go', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const { engine, synced } = sendLoop(['a', 'b'], async (plan) => {
    if (plan.id === 'a') throw new TypeError('private detail');
    return createdOk;
  });
  const state = await engine.runOnce();
  assert.deepEqual(synced, ['b']);
  assert.equal(state.counts.failed, 1);
  assert.equal(state.message, UNEXPECTED_FAILURE, 'a plain reason, never the raw error');
  assert.doesNotMatch(JSON.stringify(state.failures), /private detail/);
  assert.equal(state.failures[0].code, 'laptop_error');
  assert.equal(logged.mock.calls[0].arguments[0], '[plan-sync] step=send name=TypeError');
});

test('a lost connection part-way stops the run as offline rather than counting every plan as failed', async () => {
  const { engine, synced } = sendLoop(['a', 'b'], async () => {
    throw Object.assign(new Error('No connection.'), { offline: true });
  });
  const state = await engine.runOnce();
  assert.equal(state.status, 'offline');
  assert.deepEqual(synced, []);
  engine.stop();
});

test('a plan with an impossible date is never sent; a blank name is sent with a default', async () => {
  const db = laptopDb();
  const store = createPlanSyncStore(db);
  const payload = (date, name) => store.payloadFor({ id: 0, kind: 'mass', uuid: 'u', name, date });
  assert.throws(() => payload('2026-02-31', 'Plan'), /no valid date/);
  assert.throws(() => payload(null, 'Plan'), /no valid date/);
  assert.equal(payload('2026-11-15', '  ').name, 'Untitled Plan');
  assert.equal(payload('2026-11-15', ' Sunday ').name, 'Sunday');
});

// ---- The Praise & Worship lineup, shared with the website ----

const HYMN_C = '33333333-3333-4333-8333-333333333333';

test("a Praise & Worship plan made on the website arrives as the laptop's own lineup, with a step's songs on one card, and round-trips", async () => {
  const webModel = await import('../web/js/plan-model.js');
  const { DEFAULT_TEMPLATE, groupOrdered } = await import('../shared/pw.js');
  const segs = webModel.praiseSegments(webModel.PRAISE_TEMPLATE);
  for (const [uuid, title] of [[HYMN_A, 'Praise to the Lord'], [HYMN_B, 'Be Thou My Vision'], [HYMN_C, 'Here I Am to Worship']]) await seedServerSong(uuid, title);
  const l = laptop();
  for (const [uuid, title] of [[HYMN_A, 'Praise to the Lord'], [HYMN_B, 'Be Thou My Vision'], [HYMN_C, 'Here I Am to Worship']]) seedHymn(l.db, uuid, title);
  const hymnId = (uuid) => l.db.prepare('SELECT id FROM hymns WHERE uuid = ?').get(uuid).id;

  // The website fills Joyful Song with one song and Worship with two, and saves the plan as its editor does.
  let segments = webModel.withEntry({}, 'joyful_song', { songId: HYMN_A });
  segments = webModel.withEntry(webModel.withEntry(segments, 'worship', { songId: HYMN_B }), 'worship', { songId: HYMN_C });
  const items = webModel.praiseToItems({ segments, notes: {}, extra: [], present: new Set() }, segs);
  const created = await serverCreate(laptopToken, { kind: 'pw', name: 'Prayer Night', items });

  const status = await l.engine.runOnce();
  assert.equal(status.counts.held ?? 0, 0);
  const session = l.db.prepare('SELECT id, groups FROM pw_sessions WHERE uuid = ?').get(created.id);
  assert.deepEqual(JSON.parse(session.groups), DEFAULT_TEMPLATE.groups);
  const rows = () => l.db.prepare('SELECT * FROM pw_segments WHERE session_id = ? ORDER BY display_order').all(session.id);
  const lineup = groupOrdered(DEFAULT_TEMPLATE.segments, DEFAULT_TEMPLATE.groups);
  assert.deepEqual(
    rows().map((r) => [r.segment_key, r.group_key, r.name, r.type, r.minutes]),
    lineup.map((t) => [t.key, t.group, t.name, t.type, t.minutes]),
    'the twelve cards of the laptop lineup, in order',
  );
  const content = (key) => JSON.parse(rows().find((r) => r.segment_key === key).content_ref);
  assert.deepEqual(content('joyful_song'), { kind: 'song', hymnIds: [hymnId(HYMN_A)], maxSongs: 1, category: null });
  assert.deepEqual(content('worship'), { kind: 'song', hymnIds: [hymnId(HYMN_B), hymnId(HYMN_C)], maxSongs: 3, category: null }, 'both Worship songs are on the Worship card');
  // Every card starts as the laptop's own template has it.
  for (const t of lineup.filter((s) => !['joyful_song', 'worship'].includes(s.key))) assert.deepEqual(content(t.key), t.content, t.key);

  // The operator names a leader and the laptop sends the plan. The website still reads both songs under Worship.
  serverNow = new Date(T2);
  l.db.prepare("UPDATE pw_segments SET leader = 'Ana' WHERE session_id = ? AND segment_key = 'worship'").run(session.id);
  l.db.prepare('UPDATE pw_sessions SET updated_at = ? WHERE id = ?').run(T2, session.id);
  await l.engine.runOnce();
  const pushed = (await serverRow(created.id)).body.items;
  assert.deepEqual(pushed.map((i) => webModel.praiseFromItems([i], segs).extra.length), pushed.map(() => 0), 'every item still belongs to a slot of the lineup');
  const onWeb = webModel.praiseFromItems(pushed, segs);
  assert.deepEqual(webModel.slotEntries(onWeb.segments.worship).map((e) => e.songId), [HYMN_B, HYMN_C]);
  assert.deepEqual(webModel.slotEntries(onWeb.segments.joyful_song).map((e) => e.songId), [HYMN_A]);
  assert.equal(webModel.praiseRow(segs.find((s) => s.id === 'gospel_acclamation'), onWeb, []).value, '', 'the lectionary slot is still its own default');

  // The website swaps the second Worship song and saves. The laptop keeps one Worship card, and the leader stays.
  const at = webModel.slotEntries(onWeb.segments.worship).findIndex((e) => e.songId === HYMN_C);
  const swapped = { ...onWeb, segments: webModel.withEntry(webModel.withoutEntry(onWeb.segments, 'worship', at), 'worship', { songId: HYMN_A }) };
  serverNow = new Date(T3);
  await serverEdit(laptopToken, created.id, { name: 'Prayer Night', items: webModel.praiseToItems(swapped, segs) });
  serverNow = new Date('2026-10-27T13:00:00.000Z');
  await l.engine.runOnce();
  assert.equal(rows().length, 12, 'no extra card is made for the new song');
  assert.deepEqual(content('worship').hymnIds, [hymnId(HYMN_B), hymnId(HYMN_A)]);
  assert.equal(rows().find((r) => r.segment_key === 'worship').leader, 'Ana');
});

test('a second laptop pulling a plan the first one sent gets the same cards, not one card for each song', async () => {
  await seedServerSong(HYMN_A, 'Praise to the Lord');
  await seedServerSong(HYMN_B, 'Be Thou My Vision');
  // As the first laptop sends a Worship card with two songs: each song numbered after the card's key.
  const created = await serverCreate(laptopToken, {
    kind: 'pw',
    items: [
      { key: 'worship.1', group: 'praise', order: 1, kind: 'song', songId: HYMN_A, minutes: 15 },
      { key: 'worship.2', group: 'praise', order: 2, kind: 'song', songId: HYMN_B },
      { key: 'custom_abc123', group: 'praise', order: 3, kind: 'rite', minutes: 5 },
    ],
  });
  const l = laptop();
  seedHymn(l.db, HYMN_A, 'Praise to the Lord');
  seedHymn(l.db, HYMN_B, 'Be Thou My Vision');
  await l.engine.runOnce();
  const session = l.db.prepare('SELECT id FROM pw_sessions WHERE uuid = ?').get(created.id);
  const rows = l.db.prepare('SELECT segment_key, name, type, minutes, content_ref FROM pw_segments WHERE session_id = ? ORDER BY display_order').all(session.id);
  assert.deepEqual(rows.map((r) => [r.segment_key, r.name, r.type, r.minutes]), [['worship', 'Worship', 'song', 15], ['custom_abc123', 'Prayer', 'prayer', 5]]);
  assert.equal(JSON.parse(rows[0].content_ref).hymnIds.length, 2);
  // Sent back, the songs keep the keys they came with.
  serverNow = new Date(T2);
  l.db.prepare('UPDATE pw_sessions SET name = ?, updated_at = ? WHERE id = ?').run('Night, renamed', T2, session.id);
  await l.engine.runOnce();
  assert.deepEqual((await serverRow(created.id)).body.items.map((i) => i.key), ['worship.1', 'worship.2', 'custom_abc123']);
});

// ---- Holy Mass schedules round-trip between the laptop and the website. Synthetic names only. ----

test('a Holy Mass time and language set on the website reach the laptop, and a laptop change goes back, without dropping either', async () => {
  const created = await serverCreate(laptopToken, { name: 'Sample Liturgical Title' });
  serverNow = new Date(T2);
  await serverEdit(laptopToken, created.id, { massTime: '06:00', massLanguage: 'Cebuano' });
  const l = laptop(laptopToken, { schedule: true });
  await l.engine.runOnce();
  const pulled = localMass(l.db, created.id);
  assert.deepEqual([pulled.mass_time, pulled.mass_language], ['06:00', 'Cebuano']);
  assert.equal(l.store.dirtyPlans().length, 0, 'a pulled schedule is not sent back');

  // The operator moves the Holy Mass on the laptop: the next run pushes the new time and language.
  l.db.prepare("UPDATE mass_plans SET mass_time = '9:30 AM', mass_language = 'Tagalog', updated_at = ? WHERE uuid = ?").run(T3, created.id);
  serverNow = new Date(T3);
  network.bodies.length = 0;
  await l.engine.runOnce();
  const sent = network.bodies.flatMap((b) => JSON.parse(b.body)?.plans ?? []).find((p) => p.id === created.id);
  assert.deepEqual([sent?.massTime, sent?.massLanguage], ['9:30 AM', 'Tagalog'], 'the push carries the schedule');
  const stored = (await serverRow(created.id)).body;
  assert.deepEqual([stored.massTime, stored.massLanguage], ['9:30 AM', 'Tagalog']);
});

test('a laptop from before schedules still syncs, and its pushes keep the schedule the website set', async () => {
  const created = await serverCreate(laptopToken, { name: 'Sample Liturgical Title' });
  serverNow = new Date(T2);
  await serverEdit(laptopToken, created.id, { massTime: '8:00 AM', massLanguage: 'English' });
  const old = laptop();
  await old.engine.runOnce();
  editLocal(old.db, created.id, { name: 'Sample Mass Item', at: T3 });
  serverNow = new Date(T3);
  await old.engine.runOnce();
  const stored = await serverRow(created.id);
  assert.equal(stored.name, 'Sample Mass Item');
  assert.deepEqual([stored.body.massTime, stored.body.massLanguage], ['8:00 AM', 'English']);
});

// ---- Recovery: plans the website does not have, Retry, Auto-Sync, Force Push, a new link ----

const NEW_CHURCH = '00000000-0000-4000-8000-0000000000c1';
/** A second church on the same website, with a planner and a laptop token: where a relinked laptop now points. */
async function otherChurchLaptop() {
  await pg.query(`INSERT INTO churches (id, display_code, name) VALUES ($1, 'W3XN-7KP4', 'Sample New Church')`, [NEW_CHURCH]);
  const user = (await pg.query(
    `INSERT INTO users (id, church_id, username, display_name, role, password_hash, must_change_password)
     VALUES (gen_random_uuid(), $1, 'newplanner', 'newplanner', 'planner', $2, false) RETURNING id`, [NEW_CHURCH, await hashPassword(PASSWORD)])).rows[0].id;
  const token = randomBytes(32).toString('base64url');
  await pg.query(`INSERT INTO device_tokens (token_hash, church_id, user_id, device_name) VALUES ($1, $2, $3, 'Booth')`, [hashToken(token, SECRET), NEW_CHURCH, user]);
  return token;
}
/** Points a laptop's link at another token, as linking it again would. */
const relink = (l, token) => l.file.write(plainStorage.encryptString(JSON.stringify({ token, church: 'Sample New Church', admin: 'newplanner', label: 'Booth', lastSeenAt: null, linkedAddress: BASE })));

test('a laptop relinked to another church: an edited plan the new website lacks is created there instead of failing for ever', async () => {
  const l = laptop();
  const uuid = localMassPlan(l.db, { name: 'Sample Plan Title', at: T1 });
  await l.engine.runOnce();
  assert.equal(await serverNameOf(uuid), 'Sample Plan Title', 'synced to the first church');

  relink(l, await otherChurchLaptop());
  serverNow = new Date(T2);
  editLocal(l.db, uuid, { name: 'Sample Plan Title (edited)', at: T2 });
  const state = await l.engine.runOnce();
  assert.equal(state.counts.failed, 0, JSON.stringify(state.failures));
  assert.deepEqual(state.failures, []);
  const moved = l.db.prepare("SELECT uuid FROM mass_plans WHERE name = 'Sample Plan Title (edited)'").get().uuid;
  assert.notEqual(moved, uuid, 'a new id, since the first church keeps the old one');
  const row = (await pg.query('SELECT church_id, name FROM plans WHERE id = $1', [moved])).rows[0];
  assert.deepEqual([row.church_id, row.name], [NEW_CHURCH, 'Sample Plan Title (edited)']);
  assert.equal(await serverNameOf(uuid), 'Sample Plan Title', "the first church's copy is untouched");
  assert.equal(l.store.dirtyPlans().length, 0);
});

test('a plan whose website copy is gone (not in this church) is created again under its own id', async () => {
  const l = laptop();
  const uuid = localMassPlan(l.db, { name: 'Sample Plan Title', at: T1 });
  await l.engine.runOnce();
  await pg.query('DELETE FROM plans WHERE id = $1', [uuid]);
  serverNow = new Date(T2);
  editLocal(l.db, uuid, { name: 'Sample Plan Title (again)', at: T2 });
  const state = await l.engine.runOnce();
  assert.equal(state.counts.failed, 0);
  assert.equal(state.counts.sent, 1);
  assert.equal(await serverNameOf(uuid), 'Sample Plan Title (again)', 'same id, since nobody else holds it');
});

test('a push answered "deleted" removes the laptop copy, as a pull of the delete would', async () => {
  const l = laptop();
  const uuid = localMassPlan(l.db, { name: 'Sample Plan Title', at: T1 });
  await l.engine.runOnce();
  const stored = await serverRow(uuid);
  await pg.query(`UPDATE plans SET body = '{"kind":"mass","items":[],"deleted":true}'::jsonb WHERE id = $1`, [uuid]);
  // The pull does not see it (its updated time did not move), so only the push can learn of the delete.
  assert.equal(new Date((await serverRow(uuid)).updated_at).getTime(), new Date(stored.updated_at).getTime());
  serverNow = new Date(T2);
  editLocal(l.db, uuid, { name: 'Sample Plan Title (late edit)', at: T2 });
  const state = await l.engine.runOnce();
  assert.equal(state.counts.failed, 0);
  assert.equal(localMass(l.db, uuid), undefined);
});

test('failed plans are listed with title, date, schedule and exact reason, are retried on the next cycle, and Retry Failed sends them', async () => {
  const l = laptop(laptopToken, { schedule: true });
  const uuid = localMassPlan(l.db, { name: 'Sample Plan Title', date: '2026-12-06', at: T1 });
  l.db.prepare("UPDATE mass_plans SET mass_time = '6:00 AM', mass_language = 'Cebuano', updated_at = ? WHERE uuid = ?").run(T1, uuid);
  // The website refuses this laptop's account for now.
  await pg.query("UPDATE users SET role = 'viewer' WHERE id = $1", [plannerId]);
  const failed = await l.engine.runOnce();
  assert.equal(failed.counts.failed, 1);
  const [f] = failed.failures;
  assert.deepEqual([f.uuid, f.title, f.date, f.kind, f.massTime, f.massLanguage, f.code], [uuid, 'Sample Plan Title', '2026-12-06', 'mass', '6:00 AM', 'Cebuano', 'not_allowed']);
  assert.match(f.reason, /Only a planner or admin can create plans/);
  assert.equal(l.store.dirtyPlans().length, 1, 'still waiting, so the next cycle tries it again');

  await pg.query("UPDATE users SET role = 'planner' WHERE id = $1", [plannerId]);
  const retried = await l.engine.retryFailed();
  assert.deepEqual(retried.failures, []);
  assert.equal(retried.counts.sent, 1);
  assert.equal(await serverNameOf(uuid), 'Sample Plan Title');
});

test('Auto-Sync paused: no background run is scheduled, Sync Now still runs, and resuming schedules again', async () => {
  const l = laptop();
  l.engine.setAutoSync(false);
  l.engine.start();
  await new Promise((r) => setImmediate(r));
  await l.engine.runOnce();
  assert.equal(l.timers.length, 0, 'nothing on the timer while paused');
  assert.equal(l.engine.status().autoSync, false);
  const uuid = localMassPlan(l.db, { name: 'Sample Plan Title', at: T2 });
  await l.engine.runOnce('manual');
  assert.equal(await serverNameOf(uuid), 'Sample Plan Title', 'a manual sync still sends');
  l.engine.setAutoSync(true);
  assert.equal(l.engine.status().autoSync, true);
  assert.equal(l.timers.length, 1, 'the interval is back');
  l.engine.stop();
});

test('Force Push Plans re-sends every plan in batches and brings a stale website copy back in step', async () => {
  const l = laptop();
  const uuids = [];
  // Made in two runs an hour apart: the website takes 20 new plans per laptop per 10 minutes.
  for (let i = 0; i < 15; i += 1) uuids.push(localMassPlan(l.db, { name: `Sample Plan Title ${i}`, date: '2026-12-06', at: T1 }));
  await l.engine.runOnce();
  serverNow = new Date(T2);
  for (let i = 15; i < PUSH_BATCH + 3; i += 1) uuids.push(localMassPlan(l.db, { name: `Sample Plan Title ${i}`, date: '2026-12-06', at: T2 }));
  await l.engine.runOnce();
  assert.equal(l.store.dirtyPlans().length, 0);
  // The website's copy of one plan was changed behind the laptop's back without moving its time (a hand-run fix).
  await pg.query("UPDATE plans SET name = 'Stale copy' WHERE id = $1", [uuids[0]]);
  network.bodies = [];
  serverNow = new Date(T3);
  const state = await l.engine.forcePushAll();
  assert.equal(state.counts.failed, 0);
  assert.equal(state.counts.sent, uuids.length);
  const pushes = network.bodies.filter((b) => b.name === 'plan-sync-push');
  assert.equal(pushes.length, 2, `${uuids.length} plans go in two requests, not one each`);
  assert.equal(await serverNameOf(uuids[0]), 'Sample Plan Title 0');
});

test('a new link forgets the old website versions and cursor, so every plan reaches the new church', async () => {
  const l = laptop();
  const clean = localMassPlan(l.db, { name: 'Sample Plan Title (clean)', at: T1 });
  await l.engine.runOnce();
  // The cursor the first church left: later than anything the new church has, so a pull from it would skip the new church's plans.
  l.store.setCursor('2027-01-01T00:00:00.000Z|ffffffff-ffff-4fff-8fff-ffffffffffff');
  const token = await otherChurchLaptop();
  const fromWeb = await serverCreate(token, { name: 'Sample Plan Title (made on the new website)' });
  relink(l, token);
  serverNow = new Date(T2);
  const state = await l.engine.resetForNewLink();
  assert.ok(l.store.planByUuid(fromWeb.id), "the new church's own plan is pulled in");
  assert.equal(state.counts.failed, 0, JSON.stringify(state.failures));
  const inNew = (await pg.query('SELECT name FROM plans WHERE church_id = $1 ORDER BY name', [NEW_CHURCH])).rows.map((r) => r.name);
  assert.deepEqual(inNew, ['Sample Plan Title (clean)', 'Sample Plan Title (made on the new website)'], 'a plan with no unsent edit still reaches the new church');
  assert.equal(await serverNameOf(clean), 'Sample Plan Title (clean)', 'the old church keeps its copy');
});

test('a run reports to the activity log without plan titles', async () => {
  const runs = [];
  const db = laptopDb();
  const cloud = createCloudDevice({ storage: plainStorage, file: memoryFile(plainStorage.encryptString(JSON.stringify({ token: laptopToken, church: 'St Mary', admin: 'planner', label: 'Booth', lastSeenAt: null, linkedAddress: BASE }))), fetchFn: serverFetch, baseUrl: BASE });
  const engine = createPlanSync({ store: createPlanSyncStore(db), cloud, setTimer: () => 0, clearTimer: () => {}, onRun: (r) => runs.push(r) });
  localMassPlan(db, { name: 'Sample Plan Title', at: T1 });
  await engine.runOnce('manual');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].trigger, 'manual');
  assert.equal(runs[0].status, 'synced');
  assert.equal(runs[0].counts.sent, 1);
  assert.doesNotMatch(JSON.stringify(runs), /Sample Plan Title/);
});

// ---- Prayers and Scripture typed on the website ----

/** A laptop Bible with one synthetic passage (Sample verse text only), the shape the offline Bible has: books by code, verses by chapter. */
function seedBible(db) {
  db.exec(`CREATE TABLE bible_books (translation_id TEXT NOT NULL, book_number INTEGER NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, testament TEXT NOT NULL, PRIMARY KEY (translation_id, book_number));
    CREATE TABLE bible_verses (id INTEGER PRIMARY KEY, translation_id TEXT NOT NULL, book_number INTEGER NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL, text TEXT NOT NULL);`);
  db.prepare("INSERT INTO bible_books VALUES ('WEB', 43, 'JHN', 'John', 'NT')").run();
  db.prepare("INSERT INTO bible_books VALUES ('TGL', 43, 'JHN', 'Juan', 'NT')").run();
  for (const translation of ['WEB', 'TGL']) for (const verse of [16, 17]) db.prepare('INSERT INTO bible_verses (translation_id, book_number, chapter, verse, text) VALUES (?, 43, 3, ?, ?)').run(translation, verse, 'Sample verse text');
}

test('prayers and Scripture references from the website reach the laptop as its own rows, go back as the same items, and are never duplicated', async () => {
  const l = laptop();
  seedBible(l.db);
  const items = [
    { key: 's18', group: 'introductory', order: 1, kind: 'rite', text: 'Gloria', contentType: 'prayer', slot: 18, note: 'Sample Cue' },
    { key: 's2', group: 'introductory', order: 2, kind: 'rite', text: 'I Confess (Confiteor)', contentType: 'prayer', slot: 2 },
    { key: 's23', group: 'word', order: 3, kind: 'reading', text: 'John 3:16-17 (WEB)', contentType: 'scripture', slot: 23 },
    { key: 's24', group: 'word', order: 4, kind: 'reading', text: 'John 3:16 (TGL)', contentType: 'scripture', slot: 24 },
    { key: 's25', group: 'eucharist', order: 5, kind: 'reading', text: 'Sample Book 9:9 (WEB)', contentType: 'scripture', slot: 25 },
  ];
  const created = await serverCreate(laptopToken, { items });
  await l.engine.runOnce();
  assert.equal(l.store.holdOf(created.id), null, 'not held');
  assert.deepEqual(localMassItems(l.db, created.id).map((i) => [i.module, i.sourceId, i.label]), [
    ['mass_order', 'gloria', MASS_PARTS.gloria],
    ['custom', 'webref:s2', 'I Confess (Confiteor)'],
    ['bible', 'WEB|John|3|16-17', 'John 3:16-17 (WEB)'],
    ['bible', 'TGL|Juan|3|16', 'John 3:16 (TGL)'],
    ['custom', 'webref:s25', 'Sample Book 9:9 (WEB)'],
  ], 'a Holy Mass Order part, a prayer kept by its title, two passages in the laptop Bible (the Tagalog book by its own name), and one it cannot find kept as words');

  // The laptop changes the plan's name, and the whole plan goes back.
  serverNow = new Date(T2);
  l.db.prepare('UPDATE mass_plans SET name = ?, updated_at = ? WHERE uuid = ?').run('Sample Plan Title', T2, created.id);
  serverNow = new Date(T3);
  await l.engine.runOnce();
  const row = await serverRow(created.id);
  assert.equal(row.name, 'Sample Plan Title');
  assert.equal(row.body.items.length, items.length, 'no item duplicated or lost');
  const by = (slot) => row.body.items.find((i) => i.slot === slot);
  assert.deepEqual([by(18).text, by(18).contentType, by(18).note], ['Gloria', 'prayer', 'Sample Cue'], 'the part comes back as the prayer it was, with the web note');
  assert.deepEqual([by(2).text, by(2).contentType], ['I Confess (Confiteor)', 'prayer']);
  assert.deepEqual([by(23).text, by(23).contentType, by(23).kind], ['John 3:16-17 (WEB)', 'scripture', 'reading']);
  assert.deepEqual([by(24).text, by(24).contentType], ['John 3:16 (TGL)', 'scripture']);
  assert.deepEqual([by(25).text, by(25).contentType], ['Sample Book 9:9 (WEB)', 'scripture']);
  // Nothing but references and titles was sent: no verse text and no prayer words.
  assert.ok(!JSON.stringify(row.body.items).includes('Sample verse text'));

  // A second pull and push leave it exactly as it is.
  serverNow = new Date('2026-10-27T13:00:00.000Z');
  await l.engine.runOnce();
  assert.deepEqual((await serverRow(created.id)).body.items.map((i) => [i.slot, i.text, i.contentType]), row.body.items.map((i) => [i.slot, i.text, i.contentType]));
});

test('a Bible passage added on the laptop reaches the website as its reference only, and comes back without change', async () => {
  const l = laptop();
  seedBible(l.db);
  const uuid = localMassPlan(l.db, { name: 'Sample Plan Title', items: [{ block: 'word', module: 'bible', sourceId: 'WEB|John|3|16-17', label: 'John 3:16-17' }] });
  await l.engine.runOnce();
  const row = await serverRow(uuid);
  assert.deepEqual(row.body.items.map((i) => [i.kind, i.text, i.contentType]), [['reading', 'John 3:16-17 (WEB)', 'scripture']]);
  assert.ok(!JSON.stringify(row.body).includes('Sample verse text'));
});

test('a prayer and a Scripture reference on Praise & Worship segments survive the laptop push, and one Holy Mass part in two slots does not break the push', async () => {
  const l = laptop();
  seedBible(l.db);
  const created = await serverCreate(laptopToken, {
    kind: 'pw',
    items: [
      { key: 'prayer_authority', group: 'opening', order: 1, kind: 'rite', text: 'Prayer to Take Authority', contentType: 'prayer', slotId: 'prayer_authority', minutes: 3, note: 'Sample Cue' },
      { key: 'bible_enthronement', group: 'opening', order: 2, kind: 'reading', text: 'John 3:16-17 (WEB)', contentType: 'scripture', slotId: 'bible_enthronement', minutes: 4 },
    ],
  });
  await l.engine.runOnce();
  serverNow = new Date(T2);
  const local = l.db.prepare('SELECT id FROM pw_sessions WHERE uuid = ?').get(created.id);
  l.db.prepare('UPDATE pw_sessions SET name = ?, updated_at = ? WHERE id = ?').run('Sample Plan Title', T2, local.id);
  serverNow = new Date(T3);
  await l.engine.runOnce();
  const row = await serverRow(created.id);
  assert.equal(row.name, 'Sample Plan Title', 'the push went through');
  assert.deepEqual(row.body.items.map((i) => [i.key, i.text, i.contentType, i.slotId ?? null]), [
    ['prayer_authority', 'Prayer to Take Authority', 'prayer', 'prayer_authority'],
    ['bible_enthronement', 'John 3:16-17 (WEB)', 'scripture', 'bible_enthronement'],
  ], 'the prayer title and the reference are not wiped by the laptop, which sends the segment without words');
  assert.equal(row.body.items[0].note, 'Sample Cue');

  // The same Holy Mass part in two slots: both rows are that part, and the push still goes through with distinct keys.
  const mass = await serverCreate(laptopToken, {
    items: [
      { key: 's18', group: 'introductory', order: 1, kind: 'rite', text: 'Gloria', contentType: 'prayer', slot: 18 },
      { key: 's1.2', group: 'introductory', order: 2, kind: 'rite', text: 'Gloria', contentType: 'prayer', slot: 1 },
    ],
  });
  serverNow = new Date('2026-10-27T13:00:00.000Z');
  await l.engine.runOnce();
  assert.deepEqual(localMassItems(l.db, mass.id).map((i) => [i.module, i.sourceId]), [['mass_order', 'gloria'], ['mass_order', 'gloria']]);
  l.db.prepare('UPDATE mass_plans SET name = ?, updated_at = ? WHERE uuid = ?').run('Sample Plan Title', '2026-10-27T13:30:00.000Z', mass.id);
  serverNow = new Date('2026-10-27T14:00:00.000Z');
  await l.engine.runOnce();
  const sent = await serverRow(mass.id);
  assert.equal(sent.name, 'Sample Plan Title', 'the push was accepted');
  assert.deepEqual(sent.body.items.map((i) => [i.slot, i.text, i.contentType]).sort((a, b) => a[0] - b[0]), [[1, 'Gloria', 'prayer'], [18, 'Gloria', 'prayer']]);
});

test('a segment added on the website arrives as a card of that name, keeps its name and words on the push, and follows a rename', async () => {
  const l = laptop();
  const created = await serverCreate(laptopToken, {
    kind: 'pw',
    items: [
      { key: 'prayer_authority', group: 'opening', order: 1, kind: 'rite', slotId: 'prayer_authority', minutes: 3 },
      { key: 'seg_1', group: 'praise', order: 2, kind: 'rite', text: 'Sample Prayer Title', contentType: 'prayer', slotId: 'seg_1', minutes: 5, title: 'Sample Segment Title' },
      { key: 'seg_2', group: 'word', order: 3, kind: 'reading', text: 'Sample Book 1:1-3 (WEB)', contentType: 'scripture', slotId: 'seg_2', minutes: 4, title: 'Sample Scripture Segment' },
    ],
  });
  await l.engine.runOnce();
  const local = l.db.prepare('SELECT id FROM pw_sessions WHERE uuid = ?').get(created.id);
  const cards = () => l.db.prepare('SELECT segment_key AS key, name, group_key AS grp, type FROM pw_segments WHERE session_id = ? ORDER BY display_order').all(local.id);
  assert.deepEqual(cards().slice(1).map((c) => [c.key, c.name, c.grp, c.type]), [
    ['seg_1', 'Sample Segment Title', 'praise', 'prayer'],
    ['seg_2', 'Sample Scripture Segment', 'word', 'scripture'],
  ], 'a card of the website\'s making is named by its first item, in the section it names');

  // The laptop's push carries the name back, and the words the laptop does not keep.
  serverNow = new Date(T2);
  l.db.prepare('UPDATE pw_sessions SET name = ?, updated_at = ? WHERE id = ?').run('Sample Plan Title', T2, local.id);
  serverNow = new Date(T3);
  await l.engine.runOnce();
  const row = await serverRow(created.id);
  assert.equal(row.name, 'Sample Plan Title', 'the push went through');
  const custom = row.body.items.filter((i) => i.key.startsWith('seg_'));
  assert.deepEqual(custom.map((i) => [i.key, i.title, i.text ?? null, i.contentType ?? null]), [
    ['seg_1', 'Sample Segment Title', 'Sample Prayer Title', 'prayer'],
    ['seg_2', 'Sample Scripture Segment', 'Sample Book 1:1-3 (WEB)', 'scripture'],
  ]);
  assert.equal(row.body.items.filter((i) => i.key === 'seg_1').length, 1, 'no duplicate');

  // A rename made on the website reaches the card; the lineup's own cards keep the laptop's names.
  serverNow = new Date('2026-10-27T13:00:00.000Z');
  await serverEdit(laptopToken, created.id, { items: row.body.items.map((i) => (i.key === 'seg_1' ? { ...i, title: 'Sample Renamed Segment' } : i)) });
  await l.engine.runOnce();
  assert.equal(cards().find((c) => c.key === 'seg_1').name, 'Sample Renamed Segment');
  assert.equal(cards().length, 3);
});

// ---- Plan Appearance: the plan's own slide look, both ways ----

const { PLAN_APPEARANCE_MIGRATIONS } = await import('./plan-appearance.js');
const { appearanceToSend, pulledAppearance } = await import('./plan-appearance-sync.js');
const { parsePlanAppearance } = await import('../shared/plan-appearance.js');

/** A laptop that keeps Plan Appearance, with Media Library item 42 in its library. */
function lookLaptop(token = laptopToken) {
  const l = laptop(token);
  for (const sqlText of PLAN_APPEARANCE_MIGRATIONS) l.db.exec(sqlText);
  l.db.exec('CREATE TABLE media_assets (id INTEGER PRIMARY KEY)');
  l.db.prepare('INSERT INTO media_assets (id) VALUES (42)').run();
  // The store reads which columns exist when it opens, so it is made again now.
  const store = createPlanSyncStore(l.db);
  const engine = createPlanSync({ store, cloud: l.cloud, setTimer: () => 1, clearTimer: () => {} });
  return { ...l, store, engine };
}
const lookOf = (db, uuid, table = 'mass_plans') => parsePlanAppearance(db.prepare(`SELECT appearance_json AS json FROM ${table} WHERE uuid = ?`).get(uuid).json);
const WEB_LOOK = { enabled: true, background: { type: 'color', color: '#1B3B2B', dimOpacity: 0 }, typography: { fontFamily: 'playfair', fontSizeScale: 1.25 } };
const BOOTH_LOOK = { enabled: true, background: { type: 'image', color: '#0F2A4A', dimOpacity: 0.3, mediaPath: 'apcc-media://media/42', mediaId: '42' }, typography: { textColor: '#ECC98A' } };

test('pulledAppearance: absent or null keeps the laptop\'s look; a web edit keeps the laptop\'s own picture; a picture this laptop lacks falls back to the colour', () => {
  const has = (id) => String(id) === '42';
  const local = JSON.stringify(BOOTH_LOOK);
  assert.equal(pulledAppearance(undefined, local, has), undefined, 'a server from before Plan Appearance');
  assert.equal(pulledAppearance(null, local, has), undefined, 'a plan nobody gave a look on the website');
  // The website changed the colour and the font and says nothing of the picture: this laptop keeps it.
  const edited = { enabled: true, background: { type: 'image', color: '#4A1E2E', dimOpacity: 0.3 }, typography: { fontFamily: 'serif' } };
  const kept = parsePlanAppearance(pulledAppearance(edited, local, has));
  assert.equal(kept.background.color, '#4A1E2E');
  assert.equal(kept.background.mediaPath, 'apcc-media://media/42');
  assert.equal(kept.typography.fontFamily, 'serif');
  // The website switched to a plain colour: the picture goes.
  const plain = parsePlanAppearance(pulledAppearance({ enabled: true, background: { type: 'color', color: '#000000', dimOpacity: 0 }, typography: {} }, local, has));
  assert.equal(plain.background.mediaPath, undefined);
  // Another laptop's picture is only a number here: without that item in the library it is the colour.
  const foreign = { enabled: true, background: { type: 'motion', color: '#2E1A47', dimOpacity: 0, mediaPath: 'apcc-media://media/99', mediaId: '99' }, typography: {} };
  const fallback = parsePlanAppearance(pulledAppearance(foreign, null, has));
  assert.deepEqual([fallback.background.type, fallback.background.color, fallback.background.mediaPath], ['color', '#2E1A47', undefined]);
  // The default look (Use Global Default, nothing else) is stored as NULL, and anything unreadable is the default too.
  assert.equal(pulledAppearance({ enabled: false, background: { type: 'color', color: '#000000', dimOpacity: 0 }, typography: {} }, local, has), null);
  assert.equal(pulledAppearance({ enabled: 'yes', typography: 'x' }, local, has), null);
});

test('appearanceToSend: always an object for a laptop that keeps Plan Appearance, nothing for one that does not', () => {
  assert.equal(appearanceToSend(null, false), undefined);
  assert.equal(appearanceToSend(JSON.stringify(BOOTH_LOOK), false), undefined);
  assert.deepEqual(appearanceToSend(null, true), { enabled: false, background: { type: 'color', color: '#000000', dimOpacity: 0 }, typography: {} });
  assert.deepEqual(appearanceToSend(JSON.stringify(BOOTH_LOOK), true), BOOTH_LOOK);
  assert.deepEqual(appearanceToSend('not json', true).enabled, false);
});

test('a look set on the website reaches a Holy Mass and a Praise & Worship plan on the laptop, and is not sent back', async () => {
  const mass = await serverCreate(laptopToken, { name: 'Sample Plan Title', appearance: WEB_LOOK });
  const pw = await serverCreate(laptopToken, { name: 'Sample Praise Night', kind: 'pw', appearance: WEB_LOOK });
  const l = lookLaptop();
  await l.engine.runOnce();
  assert.deepEqual(lookOf(l.db, mass.id), WEB_LOOK);
  assert.deepEqual(lookOf(l.db, pw.id, 'pw_sessions'), WEB_LOOK);
  assert.equal(l.store.dirtyPlans().length, 0, 'a pulled look is not a laptop edit');
  network.bodies.length = 0;
  await l.engine.runOnce();
  assert.equal(network.bodies.filter((b) => b.name === 'plan-sync-push').length, 0, 'nothing to send back');
});

test('a look set at the booth is sent with the plan and read back by the website, picture reference included', async () => {
  const l = lookLaptop();
  const uuid = localMassPlan(l.db, { name: 'Sample Plan Title', date: '2026-12-06', at: T1 });
  await l.engine.runOnce();
  assert.deepEqual((await serverRow(uuid)).body.appearance, { enabled: false, background: { type: 'color', color: '#000000', dimOpacity: 0 }, typography: {} }, 'a plan with no look sends the default');

  // What the Plan Appearance drawer does: it only writes the column, and the touch trigger marks the plan as changed.
  l.db.prepare('UPDATE mass_plans SET appearance_json = ? WHERE uuid = ?').run(JSON.stringify(BOOTH_LOOK), uuid);
  assert.equal(l.store.dirtyPlans().length, 1, 'a look change alone makes the plan dirty');
  serverNow = new Date(T3);
  await l.engine.runOnce();
  assert.deepEqual((await serverRow(uuid)).body.appearance, BOOTH_LOOK);
  assert.equal(l.store.dirtyPlans().length, 0);

  // The website edits the colour only; the booth keeps its picture and takes the colour.
  const row = await serverRow(uuid);
  serverNow = new Date('2026-10-27T13:00:00.000Z');
  await serverEdit(laptopToken, uuid, { appearance: { ...row.body.appearance, background: { type: 'image', color: '#4A1E2E', dimOpacity: 0.3 } } });
  await l.engine.runOnce();
  const now = lookOf(l.db, uuid);
  assert.equal(now.background.color, '#4A1E2E');
  assert.equal(now.background.mediaPath, 'apcc-media://media/42', 'the website cannot see the picture, and does not remove it');
  assert.equal(now.typography.textColor, '#ECC98A');
});

test('a laptop that keeps no Plan Appearance still syncs, sends no look and leaves the website\'s look as it is', async () => {
  const created = await serverCreate(laptopToken, { name: 'Sample Plan Title', appearance: WEB_LOOK });
  const old = laptop();
  await old.engine.runOnce();
  editLocal(old.db, created.id, { name: 'Sample Renamed Plan', at: T3 });
  serverNow = new Date(T3);
  network.bodies.length = 0;
  await old.engine.runOnce();
  const sent = network.bodies.flatMap((b) => JSON.parse(b.body)?.plans ?? []).find((p) => p.id === created.id);
  assert.equal(sent && 'appearance' in sent, false, 'no appearance key from an older laptop');
  const stored = await serverRow(created.id);
  assert.equal(stored.name, 'Sample Renamed Plan');
  assert.deepEqual(stored.body.appearance, WEB_LOOK);
});

test('a plan the website never gave a look leaves the booth\'s own look alone when pulled', async () => {
  const created = await serverCreate(laptopToken, { name: 'Sample Plan Title' });
  const l = lookLaptop();
  await l.engine.runOnce();
  // Written the way a sync writes (touch triggers off), so the booth's look is there and the plan is still in step with the website.
  l.db.exec('INSERT INTO transfer_import_guard (active) VALUES (1)');
  l.db.prepare('UPDATE mass_plans SET appearance_json = ? WHERE uuid = ?').run(JSON.stringify(BOOTH_LOOK), created.id);
  l.db.exec('DELETE FROM transfer_import_guard');
  assert.equal(l.store.dirtyPlans().length, 0);
  serverNow = new Date(T2);
  await serverEdit(laptopToken, created.id, { name: 'Sample Renamed Plan' });
  await l.engine.runOnce();
  assert.equal(localMass(l.db, created.id).name, 'Sample Renamed Plan');
  assert.deepEqual(lookOf(l.db, created.id), BOOTH_LOOK);
});

// ---- Praise & Worship prayers from the Web Planner: they arrive assigned, and stay ----

const { segmentStatus } = await import('../shared/pw.js');
const { createPwService } = await import('./pw-sessions.js');

const webModules = async () => ({
  model: await import('../web/js/plan-model.js'),
  lineup: await import('../web/js/praise-lineup.js'),
  prayers: await import('../web/js/prayer-scripture.js'),
});

/** The laptop's cards for a plan, read the way the planner reads them. */
function cardsOf(db, uuid) {
  const { id } = db.prepare('SELECT id FROM pw_sessions WHERE uuid = ?').get(uuid);
  return createPwService(db).getSession(id).segments;
}
const noteOf = (db, id) => db.prepare('SELECT title, body, display, category FROM notes WHERE id = ?').get(id);
const notesTitled = (db, title) => db.prepare('SELECT COUNT(*) AS n FROM notes WHERE title = ?').get(title).n;
/** A laptop edit, then a run, so the whole plan is sent back. */
async function renameAndSync(l, uuid, name, at) {
  l.db.prepare('UPDATE pw_sessions SET name = ?, updated_at = ? WHERE uuid = ?').run(name, at, uuid);
  serverNow = new Date(at);
  await l.engine.runOnce();
}

test('a prayer the Web Planner assigns to a lineup segment, and one on a new segment, arrive assigned and Ready, and survive the laptop push', async () => {
  const web = await webModules();
  const l = laptop();
  seedHymn(l.db, HYMN_A, 'Sample Song Title');
  await seedServerSong(HYMN_A, 'Sample Song Title');
  const created = await serverCreate(laptopToken, { kind: 'pw', name: 'Sample Plan Title', items: [] });
  await l.engine.runOnce();

  // The web editor: a prayer into the first segment (Insert into segment) and a new segment holding another (Add selected).
  let segs = web.lineup.lineupFromPlan([]).segs;
  const built = web.lineup.buildSegment({ name: 'Sample Segment Title', type: 'prayer', group: 'praise', minutes: 4 }, segs);
  segs = web.lineup.withSegmentAdded(segs, built.seg);
  let segments = web.model.withEntry({}, 'prayer_authority', web.prayers.prayerEntry({ title: 'Sample Prayer Title' }));
  segments = web.model.withEntry(segments, built.seg.id, web.prayers.prayerEntry({ title: 'Sample Second Prayer Title' }));
  segments = web.model.withEntry(segments, 'joyful_song', { songId: HYMN_A, contentType: 'song' });
  const items = web.model.praiseToItems({ segments, notes: {}, extra: [], present: new Set() }, segs);
  serverNow = new Date(T2);
  await serverEdit(laptopToken, created.id, { items });
  await l.engine.runOnce();

  const check = () => {
    const cards = cardsOf(l.db, created.id);
    for (const [key, title] of [['prayer_authority', 'Sample Prayer Title'], [built.seg.id, 'Sample Second Prayer Title']]) {
      const card = cards.find((c) => c.key === key);
      assert.ok(card, `${key} is on the laptop`);
      assert.equal(card.type, 'prayer', `${key} is a prayer card`);
      assert.equal(segmentStatus(card), 'ready', `${key} is Ready`);
      assert.equal(card.stale, false);
      assert.ok(Number.isInteger(card.content.noteId), `${key} has a prayer assigned`);
      assert.equal(noteOf(l.db, card.content.noteId).title, title);
      assert.equal(notesTitled(l.db, title), 1, 'one note, however often the plan is read');
    }
    assert.equal(cards.find((c) => c.key === built.seg.id).name, 'Sample Segment Title');
    assert.equal(segmentStatus(cards.find((c) => c.key === 'joyful_song')), 'ready');
    return cards;
  };
  const first = check();

  await renameAndSync(l, created.id, 'Sample Renamed Plan', T3);
  const row = await serverRow(created.id);
  assert.equal(row.name, 'Sample Renamed Plan', 'the push went through');
  const sent = row.body.items.filter((i) => i.contentType === 'prayer');
  assert.deepEqual(sent.map((i) => [i.key, i.text]), [['prayer_authority', 'Sample Prayer Title'], [built.seg.id, 'Sample Second Prayer Title']]);
  assert.equal(new Set(row.body.items.map((i) => i.key)).size, row.body.items.length, 'no key twice');
  // The website's editor still shows both.
  const reopened = web.lineup.lineupFromPlan(row.body.items);
  const back = web.model.praiseFromItems(row.body.items, reopened.segs);
  assert.deepEqual(['prayer_authority', built.seg.id].map((id) => web.model.slotEntries(back.segments[id]).map((e) => e.text)), [['Sample Prayer Title'], ['Sample Second Prayer Title']]);

  // A further web save (a rename there) is pulled: the same cards, the same notes.
  serverNow = new Date('2026-10-27T13:00:00.000Z');
  await serverEdit(laptopToken, created.id, { name: 'Sample Web Rename' });
  await l.engine.runOnce();
  assert.deepEqual(check().map((c) => [c.key, c.content.noteId ?? null]), first.map((c) => [c.key, c.content.noteId ?? null]));
});

/** A synced laptop holding a web Praise & Worship plan, and ways to save it on the website or on the laptop and sync, one hour apart. */
async function prayerPlan(items, setup = () => {}) {
  const l = laptop();
  seedHymn(l.db, HYMN_A, 'Sample Song Title');
  await seedServerSong(HYMN_A, 'Sample Song Title');
  setup(l.db);
  const created = await serverCreate(laptopToken, { kind: 'pw', name: 'Sample Plan Title', items });
  await l.engine.runOnce();
  let hour = 10;
  const next = () => `2026-10-27T${(hour += 1)}:00:00.000Z`;
  // The Web Planner's own save, signed in: what it sends is what is stored.
  const cookie = await cookieFor('planner');
  const webSave = async (changed) => {
    const at = next();
    serverNow = new Date(at);
    const row = await serverRow(created.id);
    const body = { id: created.id, name: `Sample Web ${hour}`, baseUpdatedAt: new Date(row.updated_at).toISOString(), items: changed.map((item, i) => ({ ...item, order: i + 1 })) };
    const res = await editing().savePlan({ httpMethod: 'POST', headers: { cookie }, body: JSON.stringify(body) });
    assert.equal(res.statusCode, 200, res.body);
    await l.engine.runOnce();
  };
  const sessionId = () => l.db.prepare('SELECT id FROM pw_sessions WHERE uuid = ?').get(created.id).id;
  const laptopSave = async (change) => {
    const at = next();
    const service = createPwService(l.db);
    const id = sessionId();
    service.saveSession(id, { segments: change(service.getSession(id).segments) });
    l.db.prepare('UPDATE pw_sessions SET updated_at = ? WHERE id = ?').run(at, id);
    serverNow = new Date(at);
    await l.engine.runOnce();
    assert.equal(l.engine.status().counts.failed, 0, JSON.stringify(l.engine.status().failures));
  };
  const serverItems = async () => (await serverRow(created.id)).body.items;
  const card = (key) => cardsOf(l.db, created.id).find((c) => c.key === key);
  const titleOfCard = (key) => noteOf(l.db, card(key).content.noteId)?.title ?? null;
  return { l, id: created.id, webSave, laptopSave, items: serverItems, card, titleOfCard };
}
const webPrayer = (key, order, text, extra = {}) => ({ key, group: 'opening', order, kind: 'rite', text, contentType: 'prayer', slotId: key.replace(/\.\d+$/, ''), ...extra });
const seedNote = (db, title, body, extra = {}) =>
  Number(db.prepare('INSERT INTO notes (title, category, body, display, copy_owner) VALUES (?, ?, ?, ?, ?)')
    .run(title, extra.category ?? 'Community Prayer', body, extra.display ?? 'full', extra.owner ?? null).lastInsertRowid);
const withContent = (key, content) => (segments) => segments.map((s) => (s.key === key ? { ...s, content } : s));

test('the parish\'s own note of a prayer\'s title is used, never a Go Live copy, a private note or a Mass intention', async () => {
  let own;
  const p = await prayerPlan([webPrayer('prayer_authority', 1, 'Pater Noster (Our Father)')], (db) => {
    seedNote(db, 'Pater Noster (Our Father)', 'Sample copy words', { owner: 'pw:1:prayer_authority' });
    seedNote(db, 'Pater Noster (Our Father)', 'Sample booth words', { display: 'operator' });
    seedNote(db, 'Pater Noster (Our Father)', 'Sample intention', { category: 'Mass Intention' });
    own = seedNote(db, 'our  father', 'Sample approved words');
  });
  assert.equal(p.card('prayer_authority').content.noteId, own, 'found under the prayer\'s other name');
  assert.equal(p.l.db.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 4, 'no note was made');
  await p.laptopSave((segments) => segments);
  assert.equal((await p.items())[0].text, 'Pater Noster (Our Father)', 'sent back under the website\'s title');
});

for (const approved of [0, 1]) {
  test(`a prayer with no note gets one with the Rosary wording only when the parish has approved it (approved: ${approved})`, async () => {
    const p = await prayerPlan([webPrayer('prayer_authority', 1, 'Hail Mary')], (db) => {
      db.exec('CREATE TABLE rosary_prayers (key TEXT PRIMARY KEY, text_en TEXT, text_tl TEXT, text_ceb TEXT, approved_en INTEGER, approved_tl INTEGER, approved_ceb INTEGER)');
      db.prepare("INSERT INTO rosary_prayers VALUES ('hail_mary', 'Sample approved wording', '', '', ?, 0, 0)").run(approved);
    });
    assert.equal(noteOf(p.l.db, p.card('prayer_authority').content.noteId).body, approved ? 'Sample approved wording' : '');
    assert.equal(segmentStatus(p.card('prayer_authority')), 'ready');
  });
}

test('further prayers on a filled step join its card, and prayers and songs survive laptop pushes without new cards', async () => {
  const p = await prayerPlan([
    webPrayer('prayer_authority', 1, 'Sample First Prayer'),
    webPrayer('prayer_authority.2', 2, 'Sample Second Prayer'),
    songItem('prayer_authority.3', 3, HYMN_A, { slotId: 'prayer_authority', group: 'opening' }),
    songItem('worship', 4, HYMN_A, { slotId: 'worship', group: 'praise' }),
    webPrayer('worship.2', 5, 'Sample Third Prayer', { group: 'praise' }),
  ]);
  const check = () => {
    assert.deepEqual(cardsOf(p.l.db, p.id).map((c) => [c.key, c.type]), [['prayer_authority', 'prayer'], ['worship', 'song']], 'no card of its own for a further item');
    assert.equal(p.titleOfCard('prayer_authority'), 'Sample First Prayer');
    assert.deepEqual(p.card('prayer_authority').content.more.map((m) => noteOf(p.l.db, m.noteId).title), ['Sample Second Prayer']);
    assert.equal(p.card('prayer_authority').content.hymnIds.length, 1);
    assert.deepEqual(p.card('worship').content.more.map((m) => noteOf(p.l.db, m.noteId).title), ['Sample Third Prayer']);
    assert.equal(p.card('worship').content.hymnIds.length, 1);
  };
  check();
  await p.laptopSave((segments) => segments);
  const sent = await p.items();
  assert.deepEqual(sent.filter((i) => i.contentType === 'prayer').map((i) => i.text), ['Sample First Prayer', 'Sample Second Prayer', 'Sample Third Prayer']);
  assert.equal(sent.filter((i) => i.songId).length, 2);
  assert.equal(new Set(sent.map((i) => i.key)).size, sent.length);
  await p.webSave(sent);
  check();
  // The website takes the second prayer and the card's song out: the laptop follows.
  await p.webSave((await p.items()).filter((i) => i.text !== 'Sample Second Prayer' && !(i.songId && i.key.startsWith('prayer_authority'))));
  assert.equal(p.card('prayer_authority').content.more, undefined);
  assert.deepEqual(p.card('prayer_authority').content.hymnIds, []);
  assert.equal(p.titleOfCard('prayer_authority'), 'Sample First Prayer');
});

test('the website putting a new prayer first moves the old first prayer down the card', async () => {
  const p = await prayerPlan([webPrayer('prayer_authority', 1, 'Sample First Prayer')]);
  const first = p.card('prayer_authority').content.noteId;
  await p.webSave([webPrayer('prayer_authority.2', 1, 'Sample New Prayer'), webPrayer('prayer_authority', 2, 'Sample First Prayer')]);
  assert.equal(p.titleOfCard('prayer_authority'), 'Sample New Prayer');
  assert.deepEqual(p.card('prayer_authority').content.more.map((m) => m.noteId), [first]);
});

test('a prayer swapped on the laptop for the parish\'s own is kept, and its title never leaves the laptop', async () => {
  const p = await prayerPlan([webPrayer('prayer_authority', 1, 'Sample Prayer Title')]);
  const own = seedNote(p.l.db, 'Sample Private Booth Title', 'Sample words');
  await p.laptopSave(withContent('prayer_authority', { kind: 'prayer', noteId: own }));
  assert.equal((await p.items())[0].text, 'Sample Prayer Title', 'the website keeps what it had');
  await p.webSave(await p.items());
  assert.equal(p.card('prayer_authority').content.noteId, own, 'an unrelated web save does not undo the swap');
  assert.ok(!JSON.stringify(network.bodies).includes('Sample Private Booth Title'));
  // The website then chooses another prayer: that is a real change, and it arrives.
  await p.webSave([webPrayer('prayer_authority', 1, 'Sample New Prayer')]);
  assert.equal(p.titleOfCard('prayer_authority'), 'Sample New Prayer');
});

test('a prayer taken off on the laptop stays off; a catalog prayer chosen there reaches the website', async () => {
  const p = await prayerPlan([webPrayer('prayer_authority', 1, 'Sample Prayer Title')]);
  await p.laptopSave(withContent('prayer_authority', { kind: 'prayer', noteId: null }));
  await p.webSave(await p.items());
  assert.equal(p.card('prayer_authority').content.noteId, null);
  const glory = seedNote(p.l.db, 'Glory Be', 'Sample words');
  await p.laptopSave(withContent('prayer_authority', { kind: 'prayer', noteId: glory }));
  assert.deepEqual((await p.items()).map((i) => [i.text, i.contentType]), [['Glory Be', 'prayer']]);
  await p.webSave(await p.items());
  assert.equal(p.card('prayer_authority').content.noteId, glory);
  // The website empties the step: the prayer it knew leaves the card.
  await p.webSave([{ key: 'prayer_authority', group: 'opening', order: 1, kind: 'rite' }]);
  assert.equal(p.card('prayer_authority').content.noteId, null);
});

test('a plan an earlier version pulled with empty prayer cards is read once more and filled, with no web save', async () => {
  const p = await prayerPlan([webPrayer('prayer_authority', 1, 'Sample Prayer Title')]);
  // What an earlier version left behind: the card empty, and nothing remembered.
  p.l.db.prepare('INSERT INTO transfer_import_guard (active) VALUES (1)').run();
  p.l.db.prepare(`UPDATE pw_segments SET content_ref = '{"kind":"prayer","noteId":null}'`).run();
  p.l.db.prepare('DELETE FROM transfer_import_guard').run();
  p.l.db.prepare("DELETE FROM sync_state WHERE key LIKE 'pwcards:%'").run();
  p.l.db.prepare('DELETE FROM notes').run();
  const restart = () => createPlanSync({ store: createPlanSyncStore(p.l.db), cloud: p.l.cloud, setTimer: () => 0, clearTimer: () => {} });
  await restart().runOnce();
  assert.equal(p.titleOfCard('prayer_authority'), 'Sample Prayer Title');
  const calls = network.calls;
  await restart().runOnce();
  assert.equal(network.calls, calls + 1, 'only the pull: the plan is not read again');
});

test('the laptop knows the same prayer titles as the Web Planner\'s catalog', async () => {
  const { PRAYER_CATALOG } = await import('../web/js/prayer-scripture.js');
  const { WEB_PRAYERS } = await import('../shared/pw-web-prayers.js');
  assert.deepEqual(WEB_PRAYERS.map((x) => x.title), PRAYER_CATALOG.map((x) => x.title));
});

test('a pulled Praise & Worship plan is announced once it is written, so an open lineup can be read again', async () => {
  const l = laptop();
  const announced = [];
  const store = createPlanSyncStore(l.db, {
    onPraiseChanged: (id) => announced.push([id, createPwService(l.db).getSession(id).segments.map((s) => segmentStatus(s))]),
  });
  const engine = createPlanSync({ store, cloud: l.cloud, setTimer: () => 0, clearTimer: () => {} });
  await serverCreate(laptopToken);
  const created = await serverCreate(laptopToken, { kind: 'pw', items: [{ key: 'prayer_authority', group: 'opening', order: 1, kind: 'rite', text: 'Sample Prayer Title', contentType: 'prayer' }] });
  await engine.runOnce();
  const { id } = l.db.prepare('SELECT id FROM pw_sessions WHERE uuid = ?').get(created.id);
  assert.deepEqual(announced, [[id, ['ready']]], 'the Holy Mass plan is not announced, and the prayer is already assigned when this one is');
});

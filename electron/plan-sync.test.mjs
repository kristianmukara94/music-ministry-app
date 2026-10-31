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
const { HYMN_DELETE_MIGRATIONS, LYRICS_MIGRATIONS } = await import('./lyrics.js');
const { MASS_PLAN_MIGRATIONS, PLAN_BIBLE_MIGRATIONS, PLAN_COMMUNION_MIGRATIONS, PLAN_CUSTOM_MIGRATIONS, PLAN_NOTES_MIGRATIONS } = await import('./mass-plans.js');
const { PW_MIGRATIONS } = await import('./pw-sessions.js');
const { TRANSFER_MIGRATIONS } = await import('./transfer.js');
const { PLAN_SYNC_MIGRATIONS } = await import('./plan-sync-schema.js');
const { createPlanSync } = await import('./plan-sync.js');
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
  for (const sqlText of [...LYRICS_MIGRATIONS, ...HYMN_DELETE_MIGRATIONS, ...MASS_PLAN_MIGRATIONS, ...PLAN_BIBLE_MIGRATIONS, ...PLAN_CUSTOM_MIGRATIONS, ...PLAN_NOTES_MIGRATIONS,
    ...PW_MIGRATIONS, ...PLAN_COMMUNION_MIGRATIONS, ...TRANSFER_MIGRATIONS, ...PLAN_SYNC_MIGRATIONS]) {
    db.exec(sqlText);
  }
  return db;
}

/** A laptop: its database, its cloud link (with the token in the encrypted file), and its engine on a fake timer. */
function laptop(token = laptopToken, { skewMs = 0 } = {}) {
  const db = laptopDb();
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
  return { db, store, engine, timers, file };
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

test('a 409 for a plan of another church is refused and held, and it is not sent', async () => {
  const foreign = randomUUID();
  await pg.query(`INSERT INTO churches (id, display_code, name) VALUES ('00000000-0000-4000-8000-00000000000b', 'R2VT-9HJ6', 'Holy Cross')`);
  await pg.query(`INSERT INTO plans (id, church_id, name, liturgical_date, body, updated_at) VALUES ($1, '00000000-0000-4000-8000-00000000000b', 'Their plan', '2026-11-01', '{"kind":"mass","items":[]}', $2)`, [foreign, T2]);
  const l = laptop();
  localMassPlan(l.db, { name: 'Ours, same id', at: T3, uuid: foreign });
  serverNow = new Date(T3);
  const status = await l.engine.runOnce();
  assert.equal(status.counts.held, 1, 'the plan is held');
  assert.equal(await serverNameOf(foreign), 'Their plan', 'the other church\'s plan is untouched');
  assert.equal(localMass(l.db, foreign).name, 'Ours, same id', 'the laptop copy is kept');
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

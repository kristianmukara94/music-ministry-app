// Tests for the web plan editor's save: one plan, saved as its item list, with the version check. Against a real Postgres (PGlite).
// Run with: node --test server/test/plan-save.test.mjs
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createPlanEditingApi } from '../lib/plan-editing.js';
import { createApi } from '../lib/handlers.js';
import { hashPassword } from '../lib/auth.js';
import { tagFromQuery } from '../lib/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.join(here, '..', 'db', 'schema.sql'), 'utf8');
const SECRET = randomBytes(32).toString('hex');
const PASSWORD = `Test-${randomBytes(16).toString('base64url')}`;
const CHURCH_A = '00000000-0000-4000-8000-00000000000a';
const CHURCH_B = '00000000-0000-4000-8000-00000000000b';
const PLAN_A = '10000000-0000-4000-8000-00000000000a';
const SONG_A = randomUUID();
const SONG_B = randomUUID();
const AT = '2026-10-27T10:00:00.000Z';

let pg;
let clock;

const sql = tagFromQuery((text, params) => pg.query(text, params));
const transaction = (work) => pg.transaction((tx) => work(tagFromQuery((t, v) => tx.query(t, v))));
const editing = () => createPlanEditingApi({ sql, transaction, secret: SECRET, now: () => clock });
const web = () => createApi({ sql, secret: SECRET, now: () => clock });

const item = (key, order, extra = {}) => ({ key: String(key), group: 'introductory', order, kind: 'rite', ...extra });
const save = (cookie, over = {}) =>
  editing().savePlan({ httpMethod: 'POST', headers: { cookie }, body: JSON.stringify({ id: PLAN_A, baseUpdatedAt: AT, items: [item(1, 1)], ...over }) });

async function cookieFor(username, churchCode) {
  const res = await web().login({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ username, password: PASSWORD, churchCode }) });
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

const storedPlan = async () => (await pg.query('SELECT body, updated_at FROM plans WHERE id = $1', [PLAN_A])).rows[0];

before(async () => {
  pg = new PGlite();
  await pg.exec(SCHEMA);
});

beforeEach(async () => {
  clock = new Date('2026-10-27T12:00:00Z');
  await pg.exec('TRUNCATE rate_limits, sessions, users, plans, songs, devices, licences, audit_log, setup_keys, device_tokens, churches CASCADE;');
  await pg.query(`INSERT INTO churches (id, display_code, name) VALUES ($1, 'K7QM-4XD2', 'St Mary'), ($2, 'R2VT-9HJ6', 'Holy Cross')`, [CHURCH_A, CHURCH_B]);
  await user(CHURCH_A, 'planner', 'planner');
  await user(CHURCH_A, 'viewer', 'viewer');
  await user(CHURCH_B, 'otherplanner', 'planner');
  await pg.query(
    `INSERT INTO plans (id, church_id, name, liturgical_date, body, updated_at) VALUES ($1, $2, 'All Saints', '2026-11-01', '{"kind":"mass","items":[]}', $3)`,
    [PLAN_A, CHURCH_A, AT],
  );
  await pg.query(
    `INSERT INTO songs (id, church_id, title, category, language, musical_key, updated_at) VALUES
       ($1, $3, 'Praise to the Lord', 'Entrance Procession', 'English', 'D', now()),
       ($2, $3, 'Old song', 'Entrance Procession', 'English', 'G', now())`,
    [SONG_A, SONG_B, CHURCH_A],
  );
  await pg.query(`UPDATE songs SET removed_at = now() WHERE id = $1`, [SONG_B]);
});

test('a planner saves the item list: the items are stored in order, and the kind is kept', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  const res = await save(cookie, { items: [item(2, 2, { kind: 'song', songId: SONG_A }), item(1, 1, { note: 'Incense at the Gospel' })] });
  assert.equal(res.statusCode, 200);
  const row = await storedPlan();
  assert.equal(row.body.kind, 'mass');
  assert.deepEqual(row.body.items.map((i) => i.key), ['1', '2'], 'stored in order');
  assert.equal(row.body.items[1].songId, SONG_A);
  assert.equal(row.body.items[0].note, 'Incense at the Gospel');
  assert.ok(row.updated_at.getTime() > new Date(AT).getTime(), 'the save stamps the server time');
});

test('a save over a newer version is refused with the server\'s version, and nothing is written', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  await pg.query(`UPDATE plans SET updated_at = $2 WHERE id = $1`, [PLAN_A, '2026-10-27T11:30:00.000Z']);
  const before = await storedPlan();
  const res = await save(cookie, { items: [item(1, 1, { note: 'Mine' })] });
  assert.equal(res.statusCode, 409);
  assert.equal(JSON.parse(res.body).serverVersion.updatedAt, '2026-10-27T11:30:00.000Z');
  assert.equal((await storedPlan()).body.items.length, 0, 'the server copy is unchanged');
  assert.equal((await storedPlan()).updated_at.getTime(), before.updated_at.getTime());
});

test('a save with no version named is refused', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  const res = await save(cookie, { baseUpdatedAt: undefined });
  assert.equal(res.statusCode, 400);
});

const latest = async () => (await storedPlan()).updated_at.toISOString();

test('a song can keep a key for the plan, written as a key, and only a chosen song can', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  assert.equal((await save(cookie, { items: [item(1, 1, { kind: 'song', songId: SONG_A, keyTransposed: 'F#m' })] })).statusCode, 200);
  assert.equal((await storedPlan()).body.items[0].keyTransposed, 'F#m');
  const song = await pg.query('SELECT musical_key FROM songs WHERE id = $1', [SONG_A]);
  assert.equal(song.rows[0].musical_key, 'D', 'the song in the list keeps its own key');
  const base = await latest();
  for (const bad of ['H', 'g', 'G<b>', 7, '']) {
    assert.equal((await save(cookie, { baseUpdatedAt: base, items: [item(1, 1, { kind: 'song', songId: SONG_A, keyTransposed: bad })] })).statusCode, 400, String(bad));
  }
  assert.equal((await save(cookie, { baseUpdatedAt: base, items: [item(1, 1, { kind: 'song', text: 'typed', keyTransposed: 'G' })] })).statusCode, 400, 'typed text has no key');
});

test('a reading can name its type, only from the list and only with a title', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  const items = [item(1, 1, { kind: 'reading', text: 'Psalm 100:1-5', contentType: 'scripture' }), item(2, 2, { kind: 'reading', text: 'Parish fiesta', contentType: 'announcement' })];
  assert.equal((await save(cookie, { items })).statusCode, 200);
  assert.deepEqual((await storedPlan()).body.items.map((i) => i.contentType), ['scripture', 'announcement']);
  const base = await latest();
  assert.equal((await save(cookie, { baseUpdatedAt: base, items: [item(1, 1, { kind: 'reading', text: 'x', contentType: 'homily' })] })).statusCode, 400);
  assert.equal((await save(cookie, { baseUpdatedAt: base, items: [item(1, 1, { kind: 'reading', contentType: 'prayer' })] })).statusCode, 400, 'no title');
  assert.equal((await save(cookie, { baseUpdatedAt: base, items: [item(1, 1, { kind: 'rite', text: 'x', contentType: 'prayer' })] })).statusCode, 400, 'not a reading');
  assert.equal((await save(cookie, { baseUpdatedAt: base, items: [item(1, 1, { kind: 'reading', text: 'x', announcement: 'the words' })] })).statusCode, 400, 'a field that would carry the words is still refused');
});

test('a plan keeps its Content Hub: saved, read back by the editor, kept when a save leaves it out, and refused when a step names one it does not have', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  const entry = { id: 'hub-1', type: 'announcement', title: 'Fiesta', category: 'Event Reminder', text: 'The full notice.', speakerNote: '' };
  const items = [item(1, 1, { text: 'Fiesta', slot: 27, contentHubId: 'hub-1', contentType: 'hub_item' })];
  assert.equal((await save(cookie, { items, contentHubItems: [entry] })).statusCode, 200);
  const read = JSON.parse((await editing().getPlan({ httpMethod: 'GET', headers: { cookie }, queryStringParameters: { id: PLAN_A } })).body);
  assert.deepEqual(read.plan.contentHubItems, [entry]);
  assert.equal((await save(cookie, { baseUpdatedAt: await latest(), items })).statusCode, 200, 'a save that does not mention the Hub');
  assert.deepEqual((await storedPlan()).body.contentHubItems, [entry]);
  const refused = await save(cookie, { baseUpdatedAt: await latest(), items, contentHubItems: [] });
  assert.equal(refused.statusCode, 400);
  assert.match(JSON.parse(refused.body).error, /does not have/);
  assert.equal((await save(cookie, { baseUpdatedAt: await latest(), items: [item(1, 1)], contentHubItems: [] })).statusCode, 200);
  assert.equal('contentHubItems' in (await storedPlan()).body, false, 'an empty Hub leaves the body as it was');
});

test('a viewer cannot save, and the plan does not change', async () => {
  const cookie = await cookieFor('viewer', 'K7QM-4XD2');
  const res = await save(cookie, { items: [item(1, 1, { note: 'x' })] });
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).error, 'Your account can view plans but not change them.');
  assert.equal((await storedPlan()).body.items.length, 0);
});

test('a save from another church cannot change the plan', async () => {
  const cookie = await cookieFor('otherplanner', 'R2VT-9HJ6');
  const res = await save(cookie, { items: [item(1, 1)] });
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error, 'That plan is not in your church.');
});

test('an unknown song is refused; a removed song that the plan already uses is accepted', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  const unknown = await save(cookie, { items: [item(1, 1, { kind: 'song', songId: randomUUID() })] });
  assert.equal(unknown.statusCode, 400);
  const removed = await save(cookie, { items: [item(1, 1, { kind: 'song', songId: SONG_B })] });
  assert.equal(removed.statusCode, 200, 'the reference to a removed song is kept');
  assert.equal((await storedPlan()).body.items[0].songId, SONG_B);
});

test('a minute value outside 1 to 60 is refused, and an unknown field is refused', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  assert.equal((await save(cookie, { items: [item(1, 1, { minutes: 0 })] })).statusCode, 400);
  assert.equal((await save(cookie, { items: [item(1, 1, { minutes: 61 })] })).statusCode, 400);
  assert.equal((await save(cookie, { items: [item(1, 1, { colour: 'red' })] })).statusCode, 400);
  assert.equal((await save(cookie, { items: [item(1, 1, { minutes: 60 })] })).statusCode, 200);
});

test('lyrics and media fields are refused, and more than 200 items is refused', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  const lyrics = await save(cookie, { items: [item(1, 1, { lyrics: 'x' })] });
  assert.equal(lyrics.statusCode, 400);
  assert.equal(JSON.parse(lyrics.body).error, 'Lyrics, slides, media, Bible text and announcements never leave the laptop. Nothing was saved.');
  const many = Array.from({ length: 201 }, (_, i) => item(i + 1, i + 1));
  assert.equal((await save(cookie, { items: many })).statusCode, 400);
});

test('the save writes one audit row that names the plan and the actor, and no content', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  await save(cookie, { items: [item(1, 1, { note: 'A private note' })] });
  const rows = (await pg.query(`SELECT action, target_plan_id, detail FROM audit_log WHERE action = 'plan.saved'`)).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].target_plan_id, PLAN_A);
  assert.equal(JSON.stringify(rows).includes('private note'), false);
});

test('a signed-out save is refused', async () => {
  const res = await editing().savePlan({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ id: PLAN_A, baseUpdatedAt: AT, items: [] }) });
  assert.equal(res.statusCode, 401);
});

// ---- A Holy Mass plan's language and Mass time ----

test('a save keeps the plan\'s language and Mass time, and the plan reads back with them', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  const res = await save(cookie, { language: 'TL', massTime: '08:00' });
  assert.equal(res.statusCode, 200);
  const row = await storedPlan();
  assert.equal(row.body.language, 'TL');
  assert.equal(row.body.massTime, '08:00');
  const read = await editing().getPlan({ httpMethod: 'GET', headers: { cookie }, queryStringParameters: { id: PLAN_A } });
  const { plan } = JSON.parse(read.body);
  assert.equal(plan.language, 'TL');
  assert.equal(plan.massTime, '08:00');
});

test('a save that leaves the details out keeps the stored ones; massTime null clears the time', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  const first = await save(cookie, { language: 'CEB', massTime: '17:30' });
  const savedAt = JSON.parse(first.body).savedAt;
  await save(cookie, { baseUpdatedAt: savedAt });
  assert.deepEqual([(await storedPlan()).body.language, (await storedPlan()).body.massTime], ['CEB', '17:30'], 'an older editor that sends no details changes neither');
  const cleared = (await storedPlan()).updated_at.toISOString();
  await save(cookie, { baseUpdatedAt: cleared, massTime: null });
  assert.equal((await storedPlan()).body.massTime, undefined);
  assert.equal((await storedPlan()).body.language, 'CEB');
});

test('a plan saved before languages reads with neither detail, so it opens in English', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  const read = await editing().getPlan({ httpMethod: 'GET', headers: { cookie }, queryStringParameters: { id: PLAN_A } });
  const { plan } = JSON.parse(read.body);
  assert.equal('language' in plan, false);
  assert.equal('massTime' in plan, false);
});

test('an unknown language or a malformed Mass time is refused, and nothing is written', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  for (const bad of [{ language: 'FR' }, { language: 'tl' }, { massTime: '8:00' }, { massTime: '24:00' }, { massTime: 800 }]) {
    const res = await save(cookie, bad);
    assert.equal(res.statusCode, 400, JSON.stringify(bad));
  }
  const row = await storedPlan();
  assert.equal(row.body.language, undefined);
  assert.equal(row.updated_at.toISOString(), AT);
});

test('a Praise & Worship plan takes no language or Mass time', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  await pg.query(`UPDATE plans SET body = '{"kind":"pw","items":[]}' WHERE id = $1`, [PLAN_A]);
  const res = await save(cookie, { language: 'TL', massTime: '08:00' });
  assert.equal(res.statusCode, 200);
  const row = await storedPlan();
  assert.deepEqual(Object.keys(row.body).sort(), ['items', 'kind']);
});

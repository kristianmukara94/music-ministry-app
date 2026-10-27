// Tests for the song list sync: a linked laptop sends its full song list (metadata only), and the web picker reads the church's
// songs. Against a real Postgres (PGlite). Run with: node --test netlify/functions/test/songs-sync.test.mjs
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createSongsSyncApi, failureLine, SONGS_PUSH_LIMIT } from '../lib/songs-sync.js';
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
const HYMN_1 = randomUUID();
const HYMN_2 = randomUUID();
const HYMN_3 = randomUUID();
const B_SONG = randomUUID();
const LYRIC_WORDS = 'These are lyric words that must never be sent';

let pg;
let clock;

const sql = tagFromQuery((text, params) => pg.query(text, params));
const transaction = (work) => pg.transaction((tx) => work(tagFromQuery((t, v) => tx.query(t, v))));
const songs = () => createSongsSyncApi({ sql, transaction, secret: SECRET, now: () => clock });
const web = () => createApi({ sql, secret: SECRET, now: () => clock });
const planEditing = () => createPlanEditingApi({ sql, transaction, secret: SECRET, now: () => clock });

const laptopSong = (id, title, extra = {}) => ({ id, title, category: 'Entrance Procession', language: 'English', key: 'D', ...extra });

/** A laptop's request: its device token as the Authorization header. */
const push = (token, body, api = songs()) =>
  api.pushSongs({ httpMethod: 'POST', headers: { authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });

async function user(church, username, role) {
  const id = (await pg.query(
    `INSERT INTO users (id, church_id, username, display_name, role, password_hash, must_change_password)
     VALUES (gen_random_uuid(), $1, $2, $2, $3, $4, false) RETURNING id`,
    [church, username, role, await hashPassword(PASSWORD)],
  )).rows[0].id;
  return id;
}

/** Links a laptop to a user. Only the keyed hash of its token is stored, as the real link does. */
async function laptopFor(church, userId) {
  const token = randomBytes(32).toString('base64url');
  await pg.query(`INSERT INTO device_tokens (token_hash, church_id, user_id, device_name) VALUES ($1, $2, $3, 'Operator booth')`, [hashToken(token, SECRET), church, userId]);
  return token;
}

async function cookieFor(username, churchCode) {
  const res = await web().login({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ username, password: PASSWORD, churchCode }) });
  assert.equal(res.statusCode, 200, `${username} signs in`);
  return res.headers['Set-Cookie'].split(';')[0];
}

const activeTitles = async (church) => (await pg.query('SELECT title FROM songs WHERE church_id = $1 AND removed_at IS NULL ORDER BY title', [church])).rows.map((r) => r.title);

before(async () => {
  pg = new PGlite();
  await pg.exec(SCHEMA);
});

let laptopA;
let laptopB;
let plannerA;
let viewerA;

beforeEach(async () => {
  clock = new Date('2026-10-27T12:00:00Z');
  await pg.exec('TRUNCATE rate_limits, audit_log, device_tokens, sessions, users, plans, songs, devices, licences, setup_keys, churches CASCADE;');
  await pg.query(`INSERT INTO churches (id, display_code, name) VALUES ($1, 'K7QM-4XD2', 'St Mary'), ($2, 'R2VT-9HJ6', 'Holy Cross')`, [CHURCH_A, CHURCH_B]);
  plannerA = await user(CHURCH_A, 'planner', 'planner');
  viewerA = await user(CHURCH_A, 'viewer', 'viewer');
  const planner2B = await user(CHURCH_B, 'otherplanner', 'planner');
  laptopA = await laptopFor(CHURCH_A, plannerA);
  laptopB = await laptopFor(CHURCH_B, planner2B);
  await pg.query(
    `INSERT INTO songs (id, church_id, title, category, language, musical_key, updated_at) VALUES ($1, $2, 'Holy Cross song', 'Entrance Procession', 'English', 'G', now())`,
    [B_SONG, CHURCH_B],
  );
});

// ---- Creating and renaming ----

test('a push creates the songs, and the web picker then lists them', async () => {
  const res = await push(laptopA, { songs: [laptopSong(HYMN_1, 'Praise to the Lord'), laptopSong(HYMN_2, 'Be Thou My Vision', { key: 'Eb' })] });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { created: 2, updated: 0, unchanged: 0, removed: 0 });
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  const listed = JSON.parse((await planEditing().listSongs({ httpMethod: 'GET', headers: { cookie } })).body).songs;
  assert.deepEqual(listed.map((s) => s.title), ['Be Thou My Vision', 'Praise to the Lord'], 'the picker reads the laptop songs');
  assert.equal(listed.find((s) => s.title === 'Be Thou My Vision').key, 'Eb');
});

test('a rename updates the same row: the id stays and the title changes', async () => {
  await push(laptopA, { songs: [laptopSong(HYMN_1, 'Praise to the Lord')] });
  const res = await push(laptopA, { songs: [laptopSong(HYMN_1, 'Praise to the Lord, the Almighty')] });
  assert.deepEqual(JSON.parse(res.body), { created: 0, updated: 1, unchanged: 0, removed: 0 });
  const rows = (await pg.query('SELECT id, title FROM songs WHERE church_id = $1', [CHURCH_A])).rows;
  assert.equal(rows.length, 1, 'still one row');
  assert.equal(rows[0].title, 'Praise to the Lord, the Almighty');
});

test('a push with nothing changed counts as unchanged', async () => {
  await push(laptopA, { songs: [laptopSong(HYMN_1, 'Praise to the Lord')] });
  const res = await push(laptopA, { songs: [laptopSong(HYMN_1, 'Praise to the Lord')] });
  assert.deepEqual(JSON.parse(res.body), { created: 0, updated: 0, unchanged: 1, removed: 0 });
});

// ---- Removing ----

test('a song the laptop no longer has is marked removed, drops out of the picker, and keeps its row', async () => {
  await push(laptopA, { songs: [laptopSong(HYMN_1, 'Praise to the Lord'), laptopSong(HYMN_2, 'Be Thou My Vision')] });
  const res = await push(laptopA, { songs: [laptopSong(HYMN_1, 'Praise to the Lord')] });
  assert.deepEqual(JSON.parse(res.body), { created: 0, updated: 0, unchanged: 1, removed: 1 });
  assert.deepEqual(await activeTitles(CHURCH_A), ['Praise to the Lord']);
  assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM songs WHERE church_id = $1', [CHURCH_A])).rows[0].n, 2, 'the removed song is kept, not deleted');
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  const listed = JSON.parse((await planEditing().listSongs({ httpMethod: 'GET', headers: { cookie } })).body).songs;
  assert.deepEqual(listed.map((s) => s.title), ['Praise to the Lord'], 'the removed song is not in the picker');
});

test('a removed song that comes back is restored under the same id', async () => {
  await push(laptopA, { songs: [laptopSong(HYMN_1, 'Praise to the Lord'), laptopSong(HYMN_2, 'Be Thou My Vision')] });
  await push(laptopA, { songs: [laptopSong(HYMN_1, 'Praise to the Lord')] });
  const res = await push(laptopA, { songs: [laptopSong(HYMN_1, 'Praise to the Lord'), laptopSong(HYMN_2, 'Be Thou My Vision')] });
  assert.deepEqual(JSON.parse(res.body), { created: 0, updated: 1, unchanged: 1, removed: 0 });
  assert.deepEqual(await activeTitles(CHURCH_A), ['Be Thou My Vision', 'Praise to the Lord']);
});

test('an empty list is refused while the church has songs, so a failed read cannot remove them all', async () => {
  await push(laptopA, { songs: [laptopSong(HYMN_1, 'Praise to the Lord')] });
  const res = await push(laptopA, { songs: [] });
  assert.equal(res.statusCode, 409);
  assert.match(JSON.parse(res.body).error, /nothing was changed/);
  assert.deepEqual(await activeTitles(CHURCH_A), ['Praise to the Lord'], 'the songs are still there');
});

// ---- Only what is allowed ----

test('a push with a lyrics field is refused as a whole, with a plain message, and nothing is written', async () => {
  const res = await push(laptopA, { songs: [laptopSong(HYMN_1, 'Praise to the Lord'), laptopSong(HYMN_2, 'Be Thou My Vision', { lyrics: LYRIC_WORDS })] });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, 'Lyrics, slides, media and Bible text never leave the laptop. The song list was not sent.');
  assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM songs WHERE church_id = $1', [CHURCH_A])).rows[0].n, 0, 'the good songs in the batch were not written either');
  assert.equal(JSON.stringify((await pg.query('SELECT * FROM audit_log')).rows).includes(LYRIC_WORDS), false);
});

test('media, slide and Bible fields are refused by name', async () => {
  for (const field of ['mediaFiles', 'slides', 'bibleText', 'stanzas']) {
    const res = await push(laptopA, { songs: [laptopSong(HYMN_1, 'Praise', { [field]: 'x' })] });
    assert.equal(res.statusCode, 400, `${field} is refused`);
  }
});

test('an unexpected field, a bad id, a bad language and a long title are each refused', async () => {
  assert.equal((await push(laptopA, { songs: [laptopSong(HYMN_1, 'Praise', { colour: 'red' })] })).statusCode, 400);
  assert.equal((await push(laptopA, { songs: [laptopSong('not-an-id', 'Praise')] })).statusCode, 400);
  assert.equal((await push(laptopA, { songs: [laptopSong(HYMN_1, 'Praise', { language: 'Latin' })] })).statusCode, 400);
  assert.equal((await push(laptopA, { songs: [laptopSong(HYMN_1, 'x'.repeat(201))] })).statusCode, 400);
});

test('the web session cannot push songs: only a laptop\'s device token can', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  const res = await songs().pushSongs({ httpMethod: 'POST', headers: { cookie }, body: JSON.stringify({ songs: [laptopSong(HYMN_1, 'Praise')] }) });
  assert.equal(res.statusCode, 401);
  assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM songs WHERE church_id = $1', [CHURCH_A])).rows[0].n, 0);
});

test('a viewer\'s laptop cannot push songs', async () => {
  const viewerLaptop = await laptopFor(CHURCH_A, viewerA);
  const res = await push(viewerLaptop, { songs: [laptopSong(HYMN_1, 'Praise')] });
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).error, 'Only a planner or admin can send the song list from this laptop.');
});

test('a revoked or unknown token cannot push songs', async () => {
  assert.equal((await push('made-up-token', { songs: [] })).statusCode, 401);
});

// ---- Church isolation ----

test('another church\'s songs are not touched by this church\'s pushes, even with the same id', async () => {
  await push(laptopA, { songs: [laptopSong(HYMN_1, 'Praise to the Lord')] });
  await push(laptopA, { songs: [laptopSong(B_SONG, 'Stolen title')] });
  assert.deepEqual(await activeTitles(CHURCH_B), ['Holy Cross song'], 'church B keeps its own song');
  // Each push is the church's full list, so 'Praise to the Lord' is removed by the second push. The same id made a separate row.
  assert.deepEqual(await activeTitles(CHURCH_A), ['Stolen title'], 'the same id made a separate row in church A');
  assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM songs WHERE id = $1', [B_SONG])).rows[0].n, 2, 'one row per church for that id');
});

test('a church\'s push marks its own songs removed, and never another church\'s', async () => {
  await push(laptopA, { songs: [laptopSong(HYMN_1, 'Praise')] });
  await push(laptopA, { songs: [laptopSong(HYMN_2, 'Other')] });
  assert.deepEqual(await activeTitles(CHURCH_A), ['Other']);
  assert.deepEqual(await activeTitles(CHURCH_B), ['Holy Cross song'], 'church B is untouched');
});

// ---- Audit and limit ----

test('each sync writes one audit row, with the counts and no song titles', async () => {
  await push(laptopA, { songs: [laptopSong(HYMN_1, 'Praise to the Lord'), laptopSong(HYMN_2, 'Be Thou My Vision')] });
  await push(laptopA, { songs: [laptopSong(HYMN_1, 'Praise to the Lord, the Almighty')] });
  const rows = (await pg.query(`SELECT detail, actor_user_id FROM audit_log WHERE action = 'songs.synced' ORDER BY id`)).rows;
  assert.equal(rows.length, 2, 'one row per sync');
  assert.deepEqual(rows[0].detail, { created: 2, updated: 0, unchanged: 0, removed: 0 });
  assert.deepEqual(rows[1].detail, { created: 0, updated: 1, unchanged: 0, removed: 1 });
  assert.equal(rows[0].actor_user_id, plannerA, 'the linked planner is the actor');
  const dump = JSON.stringify((await pg.query('SELECT * FROM audit_log')).rows);
  for (const title of ['Praise to the Lord', 'Be Thou My Vision', 'Praise to the Lord, the Almighty']) {
    assert.equal(dump.includes(title), false, 'no song title in the audit log');
  }
});

test('a laptop can make ten song pushes in ten minutes, then is asked to wait', async () => {
  const api = songs();
  for (let i = 0; i < SONGS_PUSH_LIMIT.requests; i += 1) {
    assert.equal((await push(laptopA, { songs: [laptopSong(HYMN_1, `Praise ${i}`)] }, api)).statusCode, 200);
  }
  const limited = await push(laptopA, { songs: [laptopSong(HYMN_1, 'Praise')] }, api);
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers['Retry-After'] !== undefined, true);
  assert.equal(SONGS_PUSH_LIMIT.requests, 10);
  assert.equal(SONGS_PUSH_LIMIT.windowMs, 600000);
});

test('the list and the push limits are kept apart: another laptop is not limited by this one', async () => {
  const api = songs();
  for (let i = 0; i < SONGS_PUSH_LIMIT.requests + 1; i += 1) await push(laptopA, { songs: [laptopSong(HYMN_1, 'Praise')] }, api);
  assert.equal((await push(laptopB, { songs: [laptopSong(HYMN_3, 'Other church song')] }, api)).statusCode, 200);
});

// ---- Logging ----

test('a database failure is logged with its step, name, code and constraint, never the title or the token', async () => {
  const titleText = 'A title that must never reach the log';
  const dbError = Object.assign(new Error(`new row violates check: ${titleText}`), { name: 'error', code: '23514', constraint: 'songs_title_check' });
  const failing = createSongsSyncApi({ sql, transaction: async () => { throw dbError; }, secret: SECRET, now: () => clock });
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  let res;
  try {
    res = await push(laptopA, { songs: [laptopSong(HYMN_1, titleText)] }, failing);
  } finally {
    console.error = original;
  }
  assert.equal(res.statusCode, 500);
  assert.deepEqual(JSON.parse(res.body), { error: 'Something went wrong. Try again.' }, 'the laptop gets the plain message');
  assert.deepEqual(logged, ['[songs] step=transaction name=error code=23514 constraint=songs_title_check']);
  const line = logged.join('\n');
  for (const secret of [titleText, laptopA, SECRET, 'new row violates']) assert.equal(line.includes(secret), false, 'nothing private is logged');
});

test('the log line names the column for a missing-column error, and the step for anything else', () => {
  assert.equal(failureLine('write', Object.assign(new Error('x'), { name: 'error', code: '42703', column: 'musical_key' })), '[songs] step=write name=error code=42703 column=musical_key');
  assert.equal(failureLine('read', Object.assign(new Error('column "musical_key" does not exist'), { name: 'error', code: '42703' })), '[songs] step=read name=error code=42703 column=musical_key');
  assert.equal(failureLine('validate', new TypeError('boom')), '[songs] step=validate name=TypeError');
  assert.equal(failureLine('auth', undefined), '[songs] step=auth name=Error');
});

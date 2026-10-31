// Tests that a song chosen in the Mass or Praise editor is saved with the id of a song in the church's songs table. The picker's list
// comes from songs-list (the real church list), the editor builds its items with the same functions the page uses, and the save goes
// through the real plan-save route against a real Postgres (PGlite). Run with: node --test server/test/editor-song-picker.test.mjs
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
import { massSteps, massToItems, praiseSegments, praiseToItems, savePayload } from '../../web/js/plan-model.js';
import { MASS_PLAN, PRAISE_PLAN } from '../../web/js/sample-data.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.join(here, '..', 'db', 'schema.sql'), 'utf8');
const SECRET = randomBytes(32).toString('hex');
const PASSWORD = `Test-${randomBytes(16).toString('base64url')}`;
const CHURCH_A = '00000000-0000-4000-8000-00000000000a';
const CHURCH_B = '00000000-0000-4000-8000-00000000000b';
const AT = '2026-10-27T10:00:00.000Z';
const MASS_STEPS = massSteps(MASS_PLAN);
const PRAISE_SEGMENTS = praiseSegments(PRAISE_PLAN);

let pg;
const sql = tagFromQuery((text, params) => pg.query(text, params));
const transaction = (work) => pg.transaction((tx) => work(tagFromQuery((t, v) => tx.query(t, v))));
const editing = () => createPlanEditingApi({ sql, transaction, secret: SECRET, now: () => new Date(AT) });
const web = () => createApi({ sql, secret: SECRET, now: () => new Date(AT) });

async function cookieFor(username, churchCode) {
  const res = await web().login({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ username, password: PASSWORD, churchCode }) });
  assert.equal(res.statusCode, 200, `${username} signs in`);
  return res.headers['Set-Cookie'].split(';')[0];
}

/** The list the picker shows, read exactly as the Mass and Praise pages read it. */
async function pickerSongs(cookie) {
  return JSON.parse((await editing().listSongs({ httpMethod: 'GET', headers: { cookie } })).body).songs;
}

async function plantPlan(church, kind) {
  const id = randomUUID();
  await pg.query(`INSERT INTO plans (id, church_id, name, liturgical_date, body, updated_at) VALUES ($1, $2, 'Editor check', '2026-11-01', $3::jsonb, $4)`,
    [id, church, JSON.stringify({ kind, items: [] }), AT]);
  return id;
}

async function save(cookie, id, items, kind) {
  const plan = { id, updatedAt: AT };
  return editing().savePlan({ httpMethod: 'POST', headers: { cookie }, body: JSON.stringify(savePayload(plan, items)) });
}

const songInChurch = async (church, songId) =>
  (await pg.query('SELECT id, church_id, removed_at FROM songs WHERE id = $1 AND church_id = $2', [songId, church])).rows[0];

before(async () => {
  pg = new PGlite();
  await pg.exec(SCHEMA);
});

beforeEach(async () => {
  await pg.exec('TRUNCATE rate_limits, audit_log, device_tokens, sessions, users, plans, songs, devices, licences, setup_keys, churches CASCADE;');
  await pg.query(`INSERT INTO churches (id, display_code, name) VALUES ($1, 'K7QM-4XD2', 'St Mary'), ($2, 'R2VT-9HJ6', 'Holy Cross')`, [CHURCH_A, CHURCH_B]);
  const hash = await hashPassword(PASSWORD);
  await pg.query(`INSERT INTO users (id, church_id, username, display_name, role, password_hash, must_change_password)
    VALUES (gen_random_uuid(), $1, 'planner', 'planner', 'planner', $2, false)`, [CHURCH_A, hash]);
  await pg.query(`INSERT INTO songs (id, church_id, title, category, language, musical_key, updated_at) VALUES
    ($1, $3, 'Gloria, setting one', 'Gloria', 'English', 'C', now()),
    ($2, $3, 'Joyful song', 'Entrance Procession', 'English', 'G', now()),
    ($4, $3, 'Removed hymn', 'Communion', 'English', 'D', now())`,
  [randomUUID(), randomUUID(), CHURCH_A, randomUUID()]);
  // Mark the third song removed, so the picker must not offer it.
  await pg.query(`UPDATE songs SET removed_at = now() WHERE church_id = $1 AND title = 'Removed hymn'`, [CHURCH_A]);
  await pg.query(`INSERT INTO songs (id, church_id, title, category, language, musical_key, updated_at) VALUES ($1, $2, 'Holy Cross song', 'Communion', 'English', 'E', now())`,
    [randomUUID(), CHURCH_B]);
});

test('a song chosen for a Mass step is saved with the id of a song in the church\'s songs table', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  const picker = await pickerSongs(cookie);
  const gloria = picker.find((s) => s.title === 'Gloria, setting one');
  assert.ok(gloria, 'the picker offers the church song');
  const planId = await plantPlan(CHURCH_A, 'mass');
  const gloriaStep = MASS_STEPS.find((s) => s.name === 'Gloria').n;
  const items = massToItems({ segments: { [gloriaStep]: { songId: gloria.id } }, notes: {}, extra: [] }, MASS_STEPS);
  const res = await save(cookie, planId, items);
  assert.equal(res.statusCode, 200, `the save succeeds: ${res.body}`);
  const saved = (await pg.query('SELECT body FROM plans WHERE id = $1', [planId])).rows[0].body.items;
  const chosen = saved.find((i) => i.songId);
  assert.equal(chosen.songId, gloria.id);
  const row = await songInChurch(CHURCH_A, chosen.songId);
  assert.ok(row, 'the saved songId is a row in this church\'s songs table');
  assert.equal(row.removed_at, null, 'and it is not removed');
});

test('a song chosen for a Praise segment is saved with the id of a song in the church\'s songs table', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  const picker = await pickerSongs(cookie);
  const joyful = picker.find((s) => s.title === 'Joyful song');
  const planId = await plantPlan(CHURCH_A, 'pw');
  const segment = PRAISE_SEGMENTS.find((s) => s.kind === 'song');
  const items = praiseToItems({ segments: { [segment.id]: { songId: joyful.id, minutes: segment.defaultMinutes } }, notes: {}, extra: [] }, PRAISE_SEGMENTS);
  const res = await save(cookie, planId, items);
  assert.equal(res.statusCode, 200, `the save succeeds: ${res.body}`);
  const saved = (await pg.query('SELECT body FROM plans WHERE id = $1', [planId])).rows[0].body.items;
  const chosen = saved.find((i) => i.songId === joyful.id);
  assert.ok(chosen, 'the chosen song is saved on its segment');
  assert.ok(await songInChurch(CHURCH_A, chosen.songId), 'and it is a song in this church\'s table');
});

test('the picker never offers a removed song, and another church\'s song is never offered', async () => {
  const picker = await pickerSongs(await cookieFor('planner', 'K7QM-4XD2'));
  assert.equal(picker.some((s) => s.title === 'Removed hymn'), false);
  assert.equal(picker.some((s) => s.title === 'Holy Cross song'), false);
});

test('a song id that is not in the church\'s songs table cannot be saved from the editor', async () => {
  const cookie = await cookieFor('planner', 'K7QM-4XD2');
  const planId = await plantPlan(CHURCH_A, 'mass');
  const gloriaStep = MASS_STEPS.find((s) => s.name === 'Gloria').n;
  const stray = randomUUID();
  const res = await save(cookie, planId, massToItems({ segments: { [gloriaStep]: { songId: stray } }, notes: {}, extra: [] }, MASS_STEPS));
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /not in your church's song list/);
  assert.equal((await pg.query('SELECT body FROM plans WHERE id = $1', [planId])).rows[0].body.items.length, 0, 'nothing was written');
});

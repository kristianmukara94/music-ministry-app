// The web Planner end to end, against a real Postgres (PGlite): a Holy Mass made from a calendar day, a second Holy Mass on the same day, a
// song and slot notes chosen and the title changed in the Plan Editor, the calendar's progress pills from the plan list, and the church
// laptop's pull and push carrying all of it. Also the calendar's day memos. Synthetic names only.
// Run with: node --test server/test/web-planner-roundtrip.test.mjs
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createApi } from '../lib/handlers.js';
import { createPlanEditingApi } from '../lib/plan-editing.js';
import { createPlanSyncApi } from '../lib/plan-sync.js';
import { createDayNotesApi, MAX_DAY_NOTE } from '../lib/day-notes.js';
import { hashPassword, hashToken } from '../lib/auth.js';
import { tagFromQuery } from '../lib/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const SCHEMA = fs.readFileSync(path.join(here, '..', 'db', 'schema.sql'), 'utf8');
const MIGRATION = fs.readFileSync(path.join(here, '..', 'db', 'migrations', '2026-11-22-calendar-day-notes.sql'), 'utf8');
const web = (file) => import(pathToFileURL(path.join(root, 'web', 'js', file)).href);
const model = await web('plan-model.js');
const cal = await web('planner-calendar.js');
const form = await web('new-plan-form.js');
const schedule = await web('schedule-ui.js');
const { MASS_PLAN } = await web('sample-data.js');
const { requiredSlotsFor } = await web('liturgical-calendar.js');

const SECRET = randomBytes(32).toString('hex');
const PASSWORD = `Test-${randomBytes(16).toString('base64url')}`;
const CHURCH_A = '00000000-0000-4000-8000-00000000000a';
const CHURCH_B = '00000000-0000-4000-8000-00000000000b';
const SONG = randomUUID();
const DAY = '2026-11-08';
const ROWS = model.massRows(MASS_PLAN);
const rowOfSlot = (n) => ROWS.find((r) => r.slot === n);

let pg;
let clock;
let laptop;
const sql = tagFromQuery((text, params) => pg.query(text, params));
const transaction = (work) => pg.transaction((tx) => work(tagFromQuery((t, v) => tx.query(t, v))));
const api = () => createApi({ sql, secret: SECRET, now: () => clock });
const editing = () => createPlanEditingApi({ sql, transaction, secret: SECRET, now: () => clock });
const sync = () => createPlanSyncApi({ sql, transaction, secret: SECRET, now: () => clock });
const memos = () => createDayNotesApi({ sql, secret: SECRET, now: () => clock });
const body = (res) => JSON.parse(res.body);

async function user(church, username, role) {
  const rows = await pg.query(
    `INSERT INTO users (id, church_id, username, display_name, role, password_hash, must_change_password)
     VALUES (gen_random_uuid(), $1, $2, $2, $3, $4, false) RETURNING id`,
    [church, username, role, await hashPassword(PASSWORD)],
  );
  return rows.rows[0].id;
}

async function cookieFor(username, churchCode = 'K7QM-4XD2') {
  const res = await api().login({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ username, password: PASSWORD, churchCode }) });
  assert.equal(res.statusCode, 200, `${username} signs in`);
  return res.headers['Set-Cookie'].split(';')[0];
}

const listPlans = async (cookie) => body(await api().plans({ httpMethod: 'GET', headers: { cookie } })).plans;
const getPlan = async (cookie, id) => body(await editing().getPlan({ httpMethod: 'GET', headers: { cookie }, queryStringParameters: { id } }));
const savePlan = (cookie, payload) => editing().savePlan({ httpMethod: 'POST', headers: { cookie }, body: JSON.stringify(payload) });
const createPlan = (cookie, payload) => sync().createPlan({ httpMethod: 'POST', headers: { cookie }, body: JSON.stringify(payload) });
const pull = async () => body(await sync().pullPlans({ httpMethod: 'GET', headers: { authorization: `Bearer ${laptop}` }, queryStringParameters: null }));
const memoGet = (cookie, query = null) => memos().dayNotes({ httpMethod: 'GET', headers: { cookie }, queryStringParameters: query });
const memoPost = (cookie, payload) => memos().dayNotes({ httpMethod: 'POST', headers: { cookie }, body: JSON.stringify(payload) });

before(async () => {
  pg = new PGlite();
  await pg.exec(SCHEMA);
});

beforeEach(async () => {
  clock = new Date('2026-11-02T12:00:00Z');
  await pg.exec('TRUNCATE rate_limits, audit_log, device_tokens, sessions, users, plans, songs, devices, licences, setup_keys, churches CASCADE;');
  await pg.query(`INSERT INTO churches (id, display_code, name) VALUES ($1, 'K7QM-4XD2', 'Sample Parish A'), ($2, 'R2VT-9HJ6', 'Sample Parish B')`, [CHURCH_A, CHURCH_B]);
  const planner = await user(CHURCH_A, 'planner', 'planner');
  await user(CHURCH_A, 'viewer', 'viewer');
  await user(CHURCH_B, 'otherplanner', 'planner');
  laptop = randomBytes(32).toString('base64url');
  await pg.query(`INSERT INTO device_tokens (token_hash, church_id, user_id, device_name) VALUES ($1, $2, $3, 'Sample booth')`, [hashToken(laptop, SECRET), CHURCH_A, planner]);
  await pg.query(
    `INSERT INTO songs (id, church_id, title, category, language, musical_key, updated_at) VALUES ($1, $2, 'Sample Song Title', 'Entrance Procession', 'English', 'D', now())`,
    [SONG, CHURCH_A],
  );
});

/** A Holy Mass made as the calendar's New Plan modal makes it: named after the liturgical day, with its time and language. */
async function createFromDay(cookie, { massTime, massLanguage }) {
  const id = randomUUID();
  const request = model.newPlanRequest({ name: form.dayNameOf(DAY), date: DAY, kind: 'mass', language: 'EN', massTime, massLanguage }, id);
  const res = await createPlan(cookie, request);
  assert.equal(res.statusCode, 201, res.body);
  return body(res).plan;
}

test('a Holy Mass made from a calendar day, then a second one that day: both on the Liturgical Calendar, listed in the order they are celebrated', async () => {
  const cookie = await cookieFor('planner');
  const late = await createFromDay(cookie, { massTime: '9:30 AM', massLanguage: 'English' });
  assert.equal(late.name, '32nd Sunday in Ordinary Time');
  assert.equal(late.date, DAY);
  const early = await createFromDay(cookie, { massTime: '6:00 AM', massLanguage: 'Cebuano' });
  // The same time again is refused, and the server names the Holy Mass already there.
  const clash = await createPlan(cookie, model.newPlanRequest({ name: 'Sample Plan Title', date: DAY, kind: 'mass', language: 'EN', massTime: '06:00' }, randomUUID()));
  assert.equal(clash.statusCode, 409);
  assert.equal(body(clash).conflict.id, early.id);

  const plans = await listPlans(cookie);
  assert.deepEqual(plans.map((p) => p.filledSlots), [[], []], 'nothing filled yet');
  const month = cal.calendarMonth({ kind: 'mass', month: '2026-11', plans });
  const cell = month.weeks.flat().find((c) => c.iso === DAY);
  const total = requiredSlotsFor(DAY).length;
  assert.deepEqual(cell.badges.map((b) => [b.label, b.count]), [['6:00 AM · CEB', `0/${total}`], ['9:30 AM · EN', `0/${total}`]]);
  const click = cal.dayClick('mass', plans, DAY, true);
  assert.equal(click.action, 'pick', 'Available Holy Mass Schedules');
  assert.deepEqual(click.plans.map((p) => p.id), [early.id, late.id]);
  // The Praise & Worship Calendar does not show them.
  assert.equal(cal.dayClick('pw', plans, DAY, true).action, 'create');
});

test('the Plan Editor: a song and its cue, a note-only slot and a new title are saved, counted on the calendar and pulled by the laptop', async () => {
  const cookie = await cookieFor('planner');
  const created = await createFromDay(cookie, { massTime: '9:30 AM', massLanguage: 'English' });
  const { plan, canEdit } = await getPlan(cookie, created.id);
  assert.equal(canEdit, true);

  // What the editor does: the Entrance Hymn gets the song with a musician cue; the Confiteor gets only a note.
  const state = { ...model.massFromItems(plan.items, ROWS), contentHubItems: [] };
  const entrance = rowOfSlot(1);
  const confiteor = rowOfSlot(2);
  state.segments = model.withEntry(state.segments, entrance.id, { songId: SONG, contentType: 'song' });
  state.notes[entrance.id] = 'Sample Slot Note';
  state.notes[confiteor.id] = 'Sample Musician Cue';
  const payload = model.savePayload(plan, model.massToItems(state, ROWS), { name: '  Sample Plan Title ', language: 'EN', massTime: '9:30 AM', massLanguage: 'English' });
  assert.equal(payload.name, 'Sample Plan Title');

  clock = new Date('2026-11-02T12:05:00Z');
  const saved = await savePlan(cookie, payload);
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(body(saved).name, 'Sample Plan Title');

  // The calendar: the new title, and two slots filled.
  const listed = (await listPlans(cookie)).find((p) => p.id === created.id);
  assert.equal(listed.name, 'Sample Plan Title');
  assert.deepEqual(listed.filledSlots, [1, 2]);
  assert.equal(cal.massBadge(listed, DAY).count, `2/${requiredSlotsFor(DAY).length}`);

  // The editor reads it back as it was saved.
  const reread = await getPlan(cookie, created.id);
  const back = model.massFromItems(reread.plan.items, ROWS);
  assert.equal(model.slotEntries(back.segments[entrance.id])[0].songId, SONG);
  assert.equal(back.notes[entrance.id], 'Sample Slot Note');
  assert.equal(back.notes[confiteor.id], 'Sample Musician Cue');

  // The laptop's next pull carries the title, the schedule, the song in slot 1 with its cue, and the note in slot 2.
  const pulled = (await pull()).plans.find((p) => p.id === created.id);
  assert.equal(pulled.name, 'Sample Plan Title');
  assert.equal(pulled.date, DAY);
  assert.equal(pulled.massTime, '9:30 AM');
  assert.equal(pulled.massLanguage, 'English');
  const song = pulled.items.find((i) => i.slot === 1);
  assert.equal(song.songId, SONG);
  assert.equal(song.kind, 'song');
  assert.equal(song.note, 'Sample Slot Note');
  assert.equal(pulled.items.find((i) => i.slot === 2).note, 'Sample Musician Cue');

  // The laptop sends the plan back with a new key for the song and no notes (it keeps one item per slot): the web's notes stay.
  clock = new Date('2026-11-02T12:10:00Z');
  const pushed = await sync().pushPlans({
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${laptop}` },
    body: JSON.stringify({ plans: [{ id: created.id, name: 'Sample Plan Title', date: DAY, kind: 'mass', baseUpdatedAt: pulled.updatedAt, massTime: '9:30 AM', massLanguage: 'English', items: [{ key: 'laptop-1', group: 'introductory', order: 1, kind: 'song', songId: SONG, slot: 1 }, { key: pulled.items.find((i) => i.slot === 2).key, group: 'introductory', order: 2, kind: 'rite', slot: 2 }] }] }),
  });
  assert.equal(body(pushed).results[0].status, 'accepted', pushed.body);
  const after = (await pull()).plans.find((p) => p.id === created.id);
  assert.equal(after.items.find((i) => i.slot === 1).note, 'Sample Slot Note', 'the cue on the song survives a laptop push');
  assert.equal(after.items.find((i) => i.slot === 2).note, 'Sample Musician Cue');
});

test('a title is checked like a new plan\'s, a viewer cannot save one, and a save without a title keeps the name', async () => {
  const cookie = await cookieFor('planner');
  const created = await createFromDay(cookie, { massTime: '', massLanguage: '' });
  const { plan } = await getPlan(cookie, created.id);
  const blank = await savePlan(cookie, { id: plan.id, baseUpdatedAt: plan.updatedAt, items: [], name: '   ' });
  assert.equal(blank.statusCode, 400);
  assert.match(body(blank).error, /1 to 120 characters/);
  const long = await savePlan(cookie, { id: plan.id, baseUpdatedAt: plan.updatedAt, items: [], name: 'x'.repeat(121) });
  assert.equal(long.statusCode, 400);
  const viewer = await savePlan(await cookieFor('viewer'), { id: plan.id, baseUpdatedAt: plan.updatedAt, items: [], name: 'Sample Plan Title' });
  assert.equal(viewer.statusCode, 403);
  clock = new Date('2026-11-02T12:05:00Z');
  const kept = await savePlan(cookie, { id: plan.id, baseUpdatedAt: plan.updatedAt, items: [] });
  assert.equal(kept.statusCode, 200);
  assert.equal(body(kept).name, '32nd Sunday in Ordinary Time');
  assert.equal((await pg.query('SELECT name FROM plans WHERE id = $1', [plan.id])).rows[0].name, '32nd Sunday in Ordinary Time');
});

test('a Praise & Worship plan made from its calendar shows its item count, and its rename reaches the laptop', async () => {
  const cookie = await cookieFor('planner');
  const id = randomUUID();
  const res = await createPlan(cookie, model.newPlanRequest({ name: 'Sample Praise Night', date: DAY, kind: 'pw' }, id));
  assert.equal(res.statusCode, 201);
  const { plan } = await getPlan(cookie, id);
  clock = new Date('2026-11-02T12:05:00Z');
  const items = [{ key: 'opening', group: 'opening', order: 1, kind: 'song', songId: SONG, slotId: 'opening', note: 'Sample Musician Cue' }];
  assert.equal((await savePlan(cookie, { id, baseUpdatedAt: plan.updatedAt, items, name: 'Sample Renamed Night' })).statusCode, 200);
  const listed = (await listPlans(cookie)).find((p) => p.id === id);
  assert.equal('filledSlots' in listed, false, 'only Holy Mass plans carry slots');
  const cell = cal.calendarMonth({ kind: 'pw', month: '2026-11', plans: [listed] }).weeks.flat().find((c) => c.iso === DAY);
  assert.deepEqual(cell.badges.map((b) => [b.label, b.count]), [['Sample Renamed Night', '1']]);
  assert.equal(cal.dayClick('pw', [listed], DAY, true).action, 'open');
  const pulled = (await pull()).plans.find((p) => p.id === id);
  assert.equal(pulled.name, 'Sample Renamed Night');
  assert.equal(pulled.items[0].note, 'Sample Musician Cue');
});

// ---- The CREATE A PLAN card's action, against the real server ----

/** What the card's action card posts through: plan-api.js's createPlan, with this server behind it. Every request is kept in `sent`. */
function cardCreate(cookie, sent = []) {
  return async (request) => {
    sent.push(request);
    const res = await createPlan(cookie, request);
    const answer = body(res);
    if (res.statusCode !== 201) {
      const err = new Error(answer.error ?? `refused (${res.statusCode})`);
      if (answer.conflict) err.conflict = answer.conflict;
      throw err;
    }
    return answer;
  };
}

test('Create Holy Mass Plan from a Liturgical Calendar day: the time chip and a custom language are kept, and the plan opens in the Plan Editor', async () => {
  const cookie = await cookieFor('planner');
  const card = form.newPlanCard({ kind: 'mass', date: DAY, name: 'Sample Plan Title', massTime: '8:00 AM', plans: await listPlans(cookie) });
  assert.equal(card.action.title, 'Create Holy Mass Plan');
  assert.equal(card.canCreate, true);
  const massLanguage = 'Sample Custom Language';
  const input = { name: 'Sample Plan Title', date: DAY, kind: 'mass', language: schedule.textsLanguageFor(massLanguage), massTime: '8:00 AM', massLanguage };
  const result = await form.submitNewPlan(input, { known: await listPlans(cookie), create: cardCreate(cookie) });
  assert.ok(result.plan, JSON.stringify(result));
  assert.equal(result.plan.kind, 'mass');
  assert.equal(model.editorPathFor(result.plan), `plan/mass.html?id=${result.plan.id}`, 'the Plan Editor opens on it');
  const listed = (await listPlans(cookie)).find((p) => p.id === result.plan.id);
  assert.deepEqual([listed.name, listed.massTime, listed.massLanguage], ['Sample Plan Title', '8:00 AM', massLanguage]);
  // The calendar's pill shows it.
  const cell = cal.calendarMonth({ kind: 'mass', month: '2026-11', plans: [listed] }).weeks.flat().find((c) => c.iso === DAY);
  assert.equal(cell.badges.length, 1);
  assert.match(cell.badges[0].label, /^8:00 AM · /);
});

test('a taken time is held back by the card before anything is sent; one made elsewhere meanwhile comes back as the server\'s conflict', async () => {
  const cookie = await cookieFor('planner');
  const first = await form.submitNewPlan(
    { name: 'Sample Plan Title', date: DAY, kind: 'mass', language: 'EN', massTime: '6:00 AM', massLanguage: 'English' },
    { known: [], create: cardCreate(cookie) },
  );
  assert.ok(first.plan);
  const known = await listPlans(cookie);
  // The card knows the time is taken ("06:00" is "6:00 AM", whatever the language): it warns, and sends nothing.
  assert.equal(form.newPlanCard({ kind: 'mass', date: DAY, name: 'Sample Plan Title', massTime: '06:00', plans: known }).canCreate, false);
  const sent = [];
  const held = await form.submitNewPlan(
    { name: 'Sample Plan Title', date: DAY, kind: 'mass', language: 'CEB', massTime: '06:00', massLanguage: 'Cebuano' },
    { known, create: cardCreate(cookie, sent) },
  );
  assert.equal(held.conflict?.id, first.plan.id);
  assert.deepEqual(sent, [], 'nothing sent');
  // A card opened before the first plan was made does not know it: the server refuses, and the card shows the plan already there.
  const late = await form.submitNewPlan(
    { name: 'Sample Plan Title', date: DAY, kind: 'mass', language: 'EN', massTime: '6 am', massLanguage: 'English' },
    { known: [], create: cardCreate(cookie, sent) },
  );
  assert.equal(sent.length, 1);
  assert.equal(late.conflict?.id, first.plan.id);
  assert.equal(form.newPlanCard({ kind: 'mass', date: DAY, name: 'Sample Plan Title', massTime: '6:00 AM', plans: [late.conflict] }).conflict?.id, first.plan.id);
  assert.equal((await listPlans(cookie)).length, 1, 'no duplicate was made');
  // Another time the same day is free.
  const other = await form.submitNewPlan(
    { name: 'Sample Plan Title', date: DAY, kind: 'mass', language: 'EN', massTime: '5:00 PM', massLanguage: 'English' },
    { known, create: cardCreate(cookie) },
  );
  assert.ok(other.plan);
});

test('Create Praise & Worship Plan from its calendar: the default name, no Holy Mass schedule, and it opens in the Plan Editor', async () => {
  const cookie = await cookieFor('planner');
  const name = model.suggestPlanName({ kind: 'pw', date: DAY, dayName: form.dayNameOf(DAY) });
  assert.equal(name, 'Praise & Worship Night (8 Nov)');
  const card = form.newPlanCard({ kind: 'pw', date: DAY, name, massTime: '6:00 AM', plans: await listPlans(cookie) });
  assert.equal(card.action.title, 'Create Praise & Worship Plan');
  const sent = [];
  const result = await form.submitNewPlan({ name, date: DAY, kind: 'pw', language: 'EN', massTime: '6:00 AM', massLanguage: 'English' }, { create: cardCreate(cookie, sent) });
  assert.ok(result.plan, JSON.stringify(result));
  assert.equal('massTime' in sent[0], false, 'a Praise & Worship plan carries no Holy Mass time');
  assert.equal(model.editorPathFor(result.plan), `plan/praise.html?id=${result.plan.id}`);
  const listed = (await listPlans(cookie)).find((p) => p.id === result.plan.id);
  assert.equal(listed.kind, 'pw');
  assert.equal(cal.dayClick('pw', [listed], DAY, true).action, 'open');
});

test('the card sends nothing without a name or a whole date, and a viewer\'s create is refused with the server\'s reason', async () => {
  const sent = [];
  const create = cardCreate(await cookieFor('planner'), sent);
  assert.deepEqual(await form.submitNewPlan({ name: '  ', date: DAY, kind: 'mass' }, { create }), { problem: 'Enter a name for the plan.' });
  assert.deepEqual(await form.submitNewPlan({ name: 'Sample Plan Title', date: '2026-11-xx', kind: 'mass' }, { create }), { problem: 'Choose a date for the plan.' });
  assert.deepEqual(sent, []);
  const viewer = await form.submitNewPlan({ name: 'Sample Plan Title', date: DAY, kind: 'mass', language: 'EN' }, { create: cardCreate(await cookieFor('viewer')) });
  assert.equal(typeof viewer.problem, 'string');
  assert.ok(viewer.problem.length > 0);
  assert.equal(viewer.plan, undefined);
});

test('day memos: planners set and remove them, everyone in the church reads them, other churches never see them', async () => {
  const planner = await cookieFor('planner');
  const viewer = await cookieFor('viewer');
  const other = await cookieFor('otherplanner', 'R2VT-9HJ6');

  const set = await memoPost(planner, { date: DAY, note: '  Sample\nmemo   text  ' });
  assert.equal(set.statusCode, 200);
  assert.equal(body(set).note, 'Sample memo text', 'one line, spaces collapsed');
  await memoPost(planner, { date: '2026-12-06', note: 'Sample Liturgical Day memo' });
  assert.deepEqual(body(await memoGet(viewer)), { notes: { [DAY]: 'Sample memo text', '2026-12-06': 'Sample Liturgical Day memo' }, available: true });
  assert.deepEqual(body(await memoGet(viewer, { from: '2026-11-01', to: '2026-11-30' })).notes, { [DAY]: 'Sample memo text' });
  assert.deepEqual(body(await memoGet(other)).notes, {});

  // Changing it keeps one memo for the day; a blank one removes it.
  await memoPost(planner, { date: DAY, note: 'Sample updated memo' });
  assert.equal(body(await memoGet(planner)).notes[DAY], 'Sample updated memo');
  assert.equal(body(await memoPost(planner, { date: DAY, note: '   ' })).note, '');
  assert.equal(DAY in body(await memoGet(planner)).notes, false);

  assert.equal((await memoPost(viewer, { date: DAY, note: 'Sample memo' })).statusCode, 403);
  assert.equal((await memoPost(planner, { date: '2026-02-30', note: 'Sample memo' })).statusCode, 400);
  assert.equal((await memoPost(planner, { date: DAY, note: 'x'.repeat(MAX_DAY_NOTE + 1) })).statusCode, 400);
  assert.equal((await memoPost(planner, { date: DAY })).statusCode, 400);
  assert.equal((await memos().dayNotes({ httpMethod: 'GET', headers: {} })).statusCode, 401);
  assert.equal((await memos().dayNotes({ httpMethod: 'DELETE', headers: { cookie: planner } })).statusCode, 405);
});

test('a database without the memo table still shows the calendar: no memos, and a save says why; the migration adds it', async () => {
  const planner = await cookieFor('planner');
  await pg.exec('DROP TABLE calendar_day_notes');
  try {
    assert.deepEqual(body(await memoGet(planner)), { notes: {}, available: false });
    const refused = await memoPost(planner, { date: DAY, note: 'Sample memo' });
    assert.equal(refused.statusCode, 503);
    assert.match(body(refused).error, /cannot be saved yet/);
  } finally {
    // The migration file creates it, and running it twice is safe.
    await pg.exec(MIGRATION);
    await pg.exec(MIGRATION);
  }
  assert.equal((await memoPost(planner, { date: DAY, note: 'Sample memo' })).statusCode, 200);
});

// ---- The Liturgical Plan workspace, end to end ----

const workspace = await web('mass-workspace.js');

test('the Liturgical Plan workspace: library + into the target and by category, cues, reorder and a template, saved and round-tripped with the laptop', async () => {
  const cookie = await cookieFor('planner');
  const second = randomUUID();
  await pg.query(
    `INSERT INTO songs (id, church_id, title, category, language, musical_key, updated_at) VALUES ($1, $2, 'Sample Kyrie Setting', 'Kyrie', 'Tagalog', 'G', now())`,
    [second, CHURCH_A],
  );
  const created = await createFromDay(cookie, { massTime: '9:30 AM', massLanguage: 'English' });
  const { plan, songs } = await getPlan(cookie, created.id);
  const library = body(await editing().listSongs({ httpMethod: 'GET', headers: { cookie }, queryStringParameters: null })).songs;
  // The library gets titles and metadata, never words.
  assert.deepEqual(Object.keys(library[0]).sort(), Object.keys(library[0]).filter((k) => !/lyric|words|body|slides/i.test(k)).sort());
  assert.deepEqual(workspace.librarySongs(library, { category: 'kyrie' }).map((s) => s.title), ['Sample Kyrie Setting']);

  const state = { ...model.massFromItems(plan.items, ROWS), contentHubItems: [] };
  const entrance = rowOfSlot(1);
  const kyrie = rowOfSlot(3);
  // + with no target: each song goes to the slot of its category.
  for (const id of [SONG, second]) {
    const song = library.find((s) => s.id === id);
    state.segments = model.withEntry(state.segments, workspace.slotForSong(song, ROWS, state.segments), { songId: id, contentType: 'song' });
  }
  // The Entrance Hymn made the target: the Kyrie setting goes there too, then is moved up to come first.
  state.segments = model.withEntry(state.segments, workspace.slotForSong(library.find((s) => s.id === second), ROWS, state.segments, entrance.id), { songId: second, contentType: 'song' });
  state.segments = model.withEntryMoved(state.segments, entrance.id, 1, 0);
  assert.deepEqual(model.slotEntries(state.segments[entrance.id]).map((e) => e.songId), [second, SONG]);
  // Notes & Cues on the target.
  state.notes[entrance.id] = workspace.withCue(state.notes[entrance.id], 'Sample Musician Cue');
  state.notes[entrance.id] = workspace.withCue(state.notes[entrance.id], 'Choir only');
  const ready = workspace.readiness({ rows: ROWS, segments: state.segments, notes: state.notes, date: DAY });
  assert.deepEqual([ready.songs.done, ready.texts.done], [2, 0]);

  // Save plan (Ctrl + S runs the same save): one request with the whole plan.
  clock = new Date('2026-11-02T12:05:00Z');
  const saved = await savePlan(cookie, model.savePayload(plan, model.massToItems(state, ROWS), { name: 'Sample Plan Title', language: 'EN', massTime: '9:30 AM', massLanguage: 'English' }));
  assert.equal(saved.statusCode, 200, saved.body);
  const listed = (await listPlans(cookie)).find((p) => p.id === created.id);
  assert.deepEqual(listed.filledSlots, [1, 3]);

  // The editor reads back what it saved: the order, both slots and the cues.
  const back = model.massFromItems((await getPlan(cookie, created.id)).plan.items, ROWS);
  assert.deepEqual(model.slotEntries(back.segments[entrance.id]).map((e) => e.songId), [second, SONG]);
  assert.deepEqual(model.slotEntries(back.segments[kyrie.id]).map((e) => e.songId), [second]);
  assert.equal(back.notes[entrance.id], 'Sample Musician Cue\nChoir only');

  // The laptop pulls slot 1 (the first item fills it, with the cue), the Kyrie, and the second Entrance song as one more item.
  const pulled = (await pull()).plans.find((p) => p.id === created.id);
  assert.equal(pulled.name, 'Sample Plan Title');
  const inSlot = (n) => pulled.items.filter((i) => i.slot === n);
  assert.equal(inSlot(1)[0].songId, second);
  assert.equal(inSlot(1)[0].note, 'Sample Musician Cue\nChoir only');
  assert.ok(pulled.items.some((i) => i.songId === SONG), 'the second song is in the plan');
  assert.equal(inSlot(3)[0].songId, second);

  // The laptop pushes it back unchanged in its own shape: the web keeps the order and the cues.
  clock = new Date('2026-11-02T12:10:00Z');
  const pushed = await sync().pushPlans({
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${laptop}` },
    body: JSON.stringify({ plans: [{ id: created.id, name: pulled.name, date: DAY, kind: 'mass', baseUpdatedAt: pulled.updatedAt, massTime: '9:30 AM', massLanguage: 'English', items: pulled.items.map(({ note: _note, ...item }) => item) }] }),
  });
  assert.equal(body(pushed).results[0].status, 'accepted', pushed.body);
  const after = model.massFromItems((await getPlan(cookie, created.id)).plan.items, ROWS);
  assert.deepEqual(model.slotEntries(after.segments[entrance.id]).map((e) => e.songId), [second, SONG]);
  assert.equal(after.notes[entrance.id], 'Sample Musician Cue\nChoir only');

  // The Weekday template replaces it all with its cues; saved, the songs are gone and the said slots count as filled.
  const { plan: fresh } = await getPlan(cookie, created.id);
  const weekday = workspace.templateState('weekday', ROWS, after.segments);
  clock = new Date('2026-11-02T12:15:00Z');
  const reset = await savePlan(cookie, model.savePayload(fresh, model.massToItems({ ...after, ...weekday, contentHubItems: [] }, ROWS), {}));
  assert.equal(reset.statusCode, 200, reset.body);
  const relisted = (await listPlans(cookie)).find((p) => p.id === created.id);
  assert.deepEqual(relisted.filledSlots, [...workspace.WEEKDAY_SAID_SLOTS].sort((a, b) => a - b));
  const cleared = (await pull()).plans.find((p) => p.id === created.id);
  assert.equal(cleared.items.filter((i) => i.songId).length, 0);
  assert.ok(cleared.items.filter((i) => i.note).every((i) => i.note === workspace.WEEKDAY_CUE));
});

test('Copy from another Holy Mass: the second Holy Mass of the day takes the first one\'s songs and cues, and a viewer cannot save it', async () => {
  const cookie = await cookieFor('planner');
  const first = await createFromDay(cookie, { massTime: '6:00 AM', massLanguage: 'Cebuano' });
  const other = await createFromDay(cookie, { massTime: '9:30 AM', massLanguage: 'English' });
  const { plan: source } = await getPlan(cookie, first.id);
  const filled = { ...model.massFromItems(source.items, ROWS), contentHubItems: [] };
  filled.segments = model.withEntry(filled.segments, rowOfSlot(16).id, { songId: SONG, contentType: 'song' });
  filled.notes[rowOfSlot(16).id] = 'Sample Musician Cue';
  clock = new Date('2026-11-02T12:05:00Z');
  assert.equal((await savePlan(cookie, model.savePayload(source, model.massToItems(filled, ROWS), {}))).statusCode, 200);

  // What the Templates tab's Copy does: read the other plan and take its slots and notes.
  const copied = model.massFromItems((await getPlan(cookie, first.id)).plan.items, ROWS);
  const { plan: target } = await getPlan(cookie, other.id);
  clock = new Date('2026-11-02T12:10:00Z');
  const saved = await savePlan(cookie, model.savePayload(target, model.massToItems({ ...copied, extra: [], contentHubItems: [] }, ROWS), {}));
  assert.equal(saved.statusCode, 200, saved.body);
  const back = model.massFromItems((await getPlan(cookie, other.id)).plan.items, ROWS);
  assert.equal(model.slotEntries(back.segments[rowOfSlot(16).id])[0].songId, SONG);
  assert.equal(back.notes[rowOfSlot(16).id], 'Sample Musician Cue');
  // Each keeps its own Holy Mass time.
  const plans = await listPlans(cookie);
  assert.deepEqual(plans.filter((p) => p.liturgical_date === DAY).map((p) => p.massTime).sort(), ['6:00 AM', '9:30 AM']);

  // A viewer opens it read-only, and a save is refused.
  const viewer = await cookieFor('viewer');
  const read = await getPlan(viewer, other.id);
  assert.equal(read.canEdit, false);
  const refused = await savePlan(viewer, model.savePayload(read.plan, [], {}));
  assert.equal(refused.statusCode, 403);
});

// ---- The day's readings, web to laptop and back ----

const dayReadings = await web('day-readings.js');
const laptopMap = await import(pathToFileURL(path.join(root, 'electron', 'plan-sync-map.js')).href);
const laptopStore = await import(pathToFileURL(path.join(root, 'electron', 'plan-sync-store.js')).href);

/** A Holy Mass made as the New Plan card makes it: with the day's readings in their slots. */
async function createWithReadings(cookie, { massTime = '9:30 AM', date = DAY } = {}) {
  const request = model.newPlanRequest({ name: 'Sample Plan Title', date, kind: 'mass', language: 'EN', massTime, massLanguage: 'English' }, randomUUID());
  const res = await createPlan(cookie, { ...request, items: dayReadings.dayReadingItems(date) });
  assert.equal(res.statusCode, 201, res.body);
  return body(res).plan;
}

/** What the laptop sends for the plan it pulled: each item as a laptop row, and back as the laptop's own item with the laptop's own key. */
function laptopRowsOf(pulled, date) {
  const hymnByUuid = () => null;
  const rows = pulled.items
    .map((item, at) => ({ item, row: laptopStore.massRowFrom(item, date, hymnByUuid) }))
    .filter(({ row }) => row)
    .map(({ row, item }, order) => ({ ...row, order, slot: laptopSlotId(item.slot) }));
  return laptopMap.massEntries(rows, () => null).filter((e) => e.item).map((e, i) => ({ key: e.key, order: i + 1, ...e.item }));
}
const laptopSlotId = (number) => webSlotIds.find((s) => s.number === number)?.id ?? null;
const webSlotIds = (await web('mass-slots.js')).MASS_SLOTS;

test('a Holy Mass made with the day\'s readings: the server keeps them, the calendar counts them, and the laptop maps each to its Lectionary reading by date and name', async () => {
  const cookie = await cookieFor('planner');
  const created = await createWithReadings(cookie);
  const listed = (await listPlans(cookie)).find((p) => p.id === created.id);
  assert.deepEqual([...listed.filledSlots].sort((a, b) => a - b), [4, 20, 21, 22]);
  assert.equal(cal.massBadge(listed, DAY).count, `4/${requiredSlotsFor(DAY).length}`);

  const pulled = (await pull()).plans.find((p) => p.id === created.id);
  assert.deepEqual(pulled.items.map((i) => [i.slot, i.kind, i.text, i.group]), [[20, 'reading', 'First Reading', 'word'], [4, 'reading', 'Responsorial Psalm', 'word'], [21, 'reading', 'Second Reading', 'word'], [22, 'reading', 'Gospel', 'word']]);
  // The laptop's own rule (electron/plan-sync-store.js): each is the Lectionary reading of the plan's date, found locally, never a typed reference.
  for (const item of pulled.items) {
    assert.deepEqual(laptopStore.massRowFrom(item, DAY, () => null), { block: 'word', module: 'lectionary', sourceId: `${DAY}|${item.text}`, label: item.text });
  }
  // No reference, no reading words are stored on the website.
  const stored = JSON.stringify((await pg.query('SELECT body FROM plans WHERE id = $1', [created.id])).rows[0].body);
  for (const { citation } of dayReadings.dayReadingsFor(DAY).readings) assert.ok(!stored.includes(citation));

  // A weekday has no Second Reading.
  const weekday = await createWithReadings(cookie, { date: '2026-11-10', massTime: '6:00 AM' });
  assert.deepEqual((await pull()).plans.find((p) => p.id === weekday.id).items.map((i) => i.slot), [20, 4, 22]);
});

test('web readings survive the laptop\'s push: one reading per slot, no duplicates, and the web\'s note, sung psalm and reference stay', async () => {
  const cookie = await cookieFor('planner');
  const created = await createWithReadings(cookie);
  const { plan } = await getPlan(cookie, created.id);
  // The planner adds a note on the First Reading, a sung psalm beside the Psalm reading, and a Gospel reference typed for the day.
  const state = { ...model.massFromItems(plan.items, ROWS), contentHubItems: [] };
  state.notes.s20 = 'Sample Musician Cue';
  state.segments = model.withEntry(state.segments, 's4', { songId: SONG, contentType: 'song' });
  clock = new Date('2026-11-02T12:05:00Z');
  assert.equal((await savePlan(cookie, model.savePayload(plan, model.massToItems(state, ROWS), {}))).statusCode, 200);

  const pulled = (await pull()).plans.find((p) => p.id === created.id);
  assert.equal(pulled.items.find((i) => i.slot === 20).note, 'Sample Musician Cue');
  // The laptop resolves the readings, keeps them as Lectionary rows, and pushes the plan back with ITS keys.
  const sent = laptopRowsOf(pulled, DAY);
  assert.equal(sent.filter((i) => i.kind === 'reading').length, 4, 'four lectionary rows');
  assert.ok(sent.filter((i) => i.kind === 'reading').every((i) => /^h/.test(i.key)), 'the laptop\'s own keys, not the web\'s');
  clock = new Date('2026-11-02T12:10:00Z');
  const pushed = await sync().pushPlans({
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${laptop}` },
    body: JSON.stringify({ plans: [{ id: created.id, name: pulled.name, date: DAY, kind: 'mass', baseUpdatedAt: pulled.updatedAt, massTime: '9:30 AM', massLanguage: 'English', items: sent }] }),
  });
  assert.equal(body(pushed).results[0].status, 'accepted', pushed.body);

  const after = (await pull()).plans.find((p) => p.id === created.id);
  const readingsAfter = after.items.filter((i) => i.kind === 'reading');
  assert.deepEqual(readingsAfter.map((i) => [i.slot, i.text]), [[20, 'First Reading'], [4, 'Responsorial Psalm'], [21, 'Second Reading'], [22, 'Gospel']], 'exactly one per slot');
  assert.equal(after.items.find((i) => i.slot === 20).note, 'Sample Musician Cue', 'the web note on the reading survives the push');
  assert.ok(readingsAfter.every((i) => i.contentType === 'scripture'), 'still marked as readings');

  // The editor reads it back: four readings by name, the planner's note, and Populate has nothing to add.
  const back = model.massFromItems((await getPlan(cookie, created.id)).plan.items, ROWS);
  assert.equal(model.slotEntries(back.segments.s20)[0].text, 'First Reading');
  assert.equal(back.notes.s20, 'Sample Musician Cue');
  const populated = dayReadings.withDayReadings(back.segments, DAY);
  assert.deepEqual(populated.filled, []);
  assert.equal(populated.current.length, 4);
  // Saved again from the editor: still one per slot, keyed as the laptop keyed them.
  const { plan: fresh } = await getPlan(cookie, created.id);
  clock = new Date('2026-11-02T12:15:00Z');
  assert.equal((await savePlan(cookie, model.savePayload(fresh, model.massToItems({ ...back, contentHubItems: [] }, ROWS), {}))).statusCode, 200);
  assert.deepEqual((await pull()).plans.find((p) => p.id === created.id).items.filter((i) => i.kind === 'reading').map((i) => i.slot), [20, 4, 21, 22]);
});

test('Populate on an older, empty plan fills the readings and saves them; a plan from another date keeps typed references', async () => {
  const cookie = await cookieFor('planner');
  const created = await createFromDay(cookie, { massTime: '9:30 AM', massLanguage: 'English' });
  const { plan } = await getPlan(cookie, created.id);
  const state = { ...model.massFromItems(plan.items, ROWS), contentHubItems: [] };
  assert.equal(dayReadings.readingStatus(state.segments, DAY).empty, 4, 'the banner offers Populate');
  state.segments = dayReadings.withDayReadings(state.segments, DAY).segments;
  clock = new Date('2026-11-02T12:05:00Z');
  assert.equal((await savePlan(cookie, model.savePayload(plan, model.massToItems(state, ROWS), {}))).statusCode, 200);
  assert.deepEqual((await listPlans(cookie)).find((p) => p.id === created.id).filledSlots.sort((a, b) => a - b), [4, 20, 21, 22]);

  // A reading taken from another date is words the laptop keeps, never a by-name reading for this plan's date.
  const reading = dayReadings.dayReadingsFor('2026-11-10').readings[0];
  const elsewhere = dayReadings.withReading(state.segments, reading, '2026-11-10', DAY);
  const { plan: again } = await getPlan(cookie, created.id);
  clock = new Date('2026-11-02T12:10:00Z');
  assert.equal((await savePlan(cookie, model.savePayload(again, model.massToItems({ ...state, segments: elsewhere }, ROWS), {}))).statusCode, 200);
  const pulled = (await pull()).plans.find((p) => p.id === created.id);
  const first = pulled.items.find((i) => i.slot === 20);
  assert.match(first.text, /^First Reading: /);
  assert.equal(laptopStore.massRowFrom(first, DAY, () => null).module, 'custom', 'kept as words');
});

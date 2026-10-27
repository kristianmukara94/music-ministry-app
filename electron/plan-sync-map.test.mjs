// Tests for the plan sync mapping and the migration. Run with: node --test electron/plan-sync-map.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { itemKey, massBody, massEntries, mergeEntries, MapRefused, praiseBody, praiseEntries } from './plan-sync-map.js';
import { PLAN_SYNC_MIGRATIONS, recordTombstone } from './plan-sync-schema.js';
import { MASS_PARTS, MASS_STEP_PARTS } from '../shared/mass-parts.js';
import { MASS_PLAN } from '../web/js/sample-data.js';

const HYMN_A = '11111111-1111-4111-8111-111111111111';
const HYMN_B = '22222222-2222-4222-8222-222222222222';
const hymnUuidOf = (id) => ({ '5': HYMN_A, '6': HYMN_B }[String(id)] ?? null);
const ALLOWED_FIELDS = ['key', 'group', 'order', 'kind', 'songId', 'text', 'minutes', 'note'];

const massRows = () => [
  { block: 'word', module: 'lyrics', sourceId: '5', label: 'Praise to the Lord', order: 1 },
  { block: 'word', module: 'lectionary', sourceId: '2026-11-01|Gospel', label: 'Gospel', order: 2 },
  { block: 'word', module: 'announcements', sourceId: '9', label: 'Parish news', order: 3 },
  { block: 'eucharist', module: 'mass_order', sourceId: 'gloria', label: 'Gloria', order: 4 },
];

// ---- Mass plans -------------------------------------------------------------------------------------------------------

test('a Mass plan sends its songs, readings and Mass parts, and keeps announcements on the laptop', () => {
  const body = massBody(massEntries(massRows(), hymnUuidOf));
  assert.equal(body.kind, 'mass');
  assert.deepEqual(body.items.map((i) => i.kind), ['song', 'reading', 'rite']);
  assert.equal(body.items[0].songId, HYMN_A);
  assert.equal(body.items[1].text, 'Gospel');
  assert.equal(body.items[2].text, 'Gloria');
  assert.deepEqual(body.items.map((i) => i.order), [1, 2, 3]);
  assert.equal(JSON.stringify(body).includes('Parish news'), false, 'announcement text does not leave the laptop');
});

test('an item carries only the fields the server accepts', () => {
  const body = massBody(massEntries(massRows(), hymnUuidOf));
  for (const item of body.items) {
    for (const field of Object.keys(item)) assert.ok(ALLOWED_FIELDS.includes(field), `${field} is an allowed field`);
  }
});

test('a song with no uuid on the laptop is kept there, not sent', () => {
  const rows = [{ block: 'word', module: 'lyrics', sourceId: '7', label: 'New hymn', order: 1 }];
  const entries = massEntries(rows, hymnUuidOf);
  assert.equal(entries[0].synced, false);
  assert.equal(massBody(entries).items.length, 0);
});

test('a reading whose label is not a reading name refuses the plan and names no content', () => {
  const verse = 'For God so loved the world that he gave his only Son';
  const rows = [{ block: 'word', module: 'lectionary', sourceId: '2026-11-01|Gospel', label: verse, order: 1 }];
  assert.throws(
    () => massEntries(rows, hymnUuidOf),
    (err) => err instanceof MapRefused && err.message === 'A reading in this plan is not a reading name. Nothing was sent.' && !err.message.includes(verse),
  );
});

test('verse text on a reading row is never read into the body', () => {
  const rows = massRows();
  rows[1] = { ...rows[1], rawText: 'For God so loved the world', citation: 'John 3:16' };
  const body = massBody(massEntries(rows, hymnUuidOf));
  assert.equal(JSON.stringify(body).includes('For God so loved'), false);
  assert.equal(JSON.stringify(body).includes('John 3:16'), false);
});

test('item keys do not change when the items are reordered', () => {
  const rows = massRows();
  const before = massEntries(rows, hymnUuidOf).map((e) => e.key).sort();
  const after = massEntries([...rows].reverse().map((r, i) => ({ ...r, order: i + 1 })), hymnUuidOf).map((e) => e.key).sort();
  assert.deepEqual(after, before);
});

test('the same song twice in a plan gets two different keys', () => {
  const rows = [
    { block: 'word', module: 'lyrics', sourceId: '5', label: 'Praise', order: 1 },
    { block: 'word', module: 'lyrics', sourceId: '5', label: 'Praise', order: 2 },
  ];
  const keys = massEntries(rows, hymnUuidOf).map((e) => e.key);
  assert.equal(new Set(keys).size, 2);
});

// ---- Praise & Worship plans -------------------------------------------------------------------------------------------

const seg = (over) => ({ key: 'seg', group: 'opening', order: 1, type: 'song', minutes: 0, contentRef: '{}', ...over });

test('a song segment with two songs sends both, with the minutes on the first only', () => {
  const entries = praiseEntries([seg({ key: 'opening_songs', type: 'song', minutes: 8, contentRef: JSON.stringify({ kind: 'song', hymnIds: [5, 6] }) })], hymnUuidOf);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].item.minutes, 8);
  assert.equal(entries[1].item.minutes, undefined);
  assert.equal(entries[0].item.songId, HYMN_A);
  assert.equal(entries[1].item.songId, HYMN_B);
});

test('a prayer segment sends its slot and minutes, never its words', () => {
  const entries = praiseEntries([seg({ key: 'closing_prayer', group: 'closing', type: 'prayer', minutes: 3, contentRef: JSON.stringify({ kind: 'prayer', noteId: 4 }) })], hymnUuidOf);
  const body = praiseBody(entries);
  assert.deepEqual(body.items, [{ key: 'closing_prayer', order: 1, kind: 'rite', group: 'closing', minutes: 3 }]);
});

test('a scripture segment linked to a reading sends the reading name only, and the acclamation is allowed here', () => {
  const entries = praiseEntries([
    seg({ key: 'gospel', group: 'word', type: 'scripture', contentRef: JSON.stringify({ kind: 'lectionary', readingType: 'Gospel' }) }),
    seg({ key: 'acclamation', group: 'word', order: 2, type: 'scripture', contentRef: JSON.stringify({ kind: 'lectionary', readingType: 'Gospel Acclamation' }) }),
  ], hymnUuidOf);
  assert.deepEqual(praiseBody(entries).items.map((i) => i.text), ['Gospel', 'Gospel Acclamation']);
});

test('a scripture segment with an unknown reading name refuses the plan', () => {
  assert.throws(
    () => praiseEntries([seg({ type: 'scripture', contentRef: JSON.stringify({ kind: 'lectionary', readingType: 'Psalm 23 in full' }) })], hymnUuidOf),
    MapRefused,
  );
});

test('a title scripture segment sends no text, and a segment over an hour refuses the plan', () => {
  const body = praiseBody(praiseEntries([seg({ key: 'title_slide', type: 'scripture', contentRef: JSON.stringify({ kind: 'title' }) })], hymnUuidOf));
  assert.equal(body.items[0].text, undefined);
  assert.throws(() => praiseEntries([seg({ type: 'prayer', minutes: 61, contentRef: '{}' })], hymnUuidOf), MapRefused);
});

test('a long segment key is shortened to a key the server accepts, the same each time', () => {
  const key = itemKey(['a_very_long_segment_key_that_goes_past_twenty']);
  assert.ok(key.length <= 20);
  assert.equal(key, itemKey(['a_very_long_segment_key_that_goes_past_twenty']));
});

// ---- Pull: keyed merge ------------------------------------------------------------------------------------------------

/** The laptop's row for a server item, for the tests: a song, a reading or a rite, by its key. */
const resolveFrom = (rowsByKey) => (item) => rowsByKey[item.key] ?? null;

test('a pulled plan keeps the laptop\'s announcement beside the item it sat next to', () => {
  const local = massEntries(massRows(), hymnUuidOf);
  const [song, reading, announcement, gloria] = local;
  const server = [
    { key: gloria.key, order: 1, kind: 'rite', group: 'eucharist', text: 'Gloria' },
    { key: song.key, order: 2, kind: 'song', group: 'word', songId: HYMN_A },
    { key: reading.key, order: 3, kind: 'reading', group: 'word', text: 'Gospel' },
  ];
  const rows = Object.fromEntries(local.filter((e) => e.synced).map((e) => [e.key, e.row]));
  const { entries, unresolved } = mergeEntries(local, server, resolveFrom(rows));
  assert.deepEqual(unresolved, []);
  // The announcement sat after the reading on the laptop, so it stays after the reading.
  assert.deepEqual(entries.map((e) => e.key), [gloria.key, song.key, reading.key, announcement.key]);
});

test('a laptop item whose neighbour is removed on the web moves to the nearest item that is still there', () => {
  const local = massEntries(massRows(), hymnUuidOf);
  const [song, reading, announcement, gloria] = local;
  const server = [
    { key: reading.key, order: 1, kind: 'reading', group: 'word', text: 'Gospel' },
    { key: gloria.key, order: 2, kind: 'rite', group: 'eucharist', text: 'Gloria' },
  ];
  const rows = Object.fromEntries(local.filter((e) => e.synced).map((e) => [e.key, e.row]));
  const { entries } = mergeEntries(local, server, resolveFrom(rows));
  // The song is gone on the web, so the announcement, which sat after it, moves up to the reading before it.
  assert.deepEqual(entries.map((e) => e.key), [reading.key, announcement.key, gloria.key]);
});

test('a web item the laptop cannot place is reported, not dropped without a word', () => {
  const local = massEntries(massRows(), hymnUuidOf);
  const server = [{ key: 'webnew', order: 1, kind: 'song', group: 'word', songId: '33333333-3333-4333-8333-333333333333' }];
  const { entries, unresolved } = mergeEntries(local, server, () => null);
  assert.deepEqual(unresolved, ['webnew']);
  assert.equal(entries.some((e) => e.key === 'webnew'), false);
});

// ---- Migration --------------------------------------------------------------------------------------------------------

test('the migration adds the sync columns and tables, and a tombstone is recorded once per plan', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE mass_plans (id INTEGER PRIMARY KEY, name TEXT, uuid TEXT, updated_at TEXT);
    CREATE TABLE pw_sessions (id INTEGER PRIMARY KEY, name TEXT, uuid TEXT, updated_at TEXT);
    INSERT INTO mass_plans (id, name, uuid, updated_at) VALUES (1, 'Sunday', '44444444-4444-4444-8444-444444444444', '2026-10-27T10:00:00.000Z');`);
  db.exec(PLAN_SYNC_MIGRATIONS[0]);
  const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  for (const table of ['mass_plans', 'pw_sessions']) {
    assert.ok(columns(table).includes('server_updated_at'), `${table} has server_updated_at`);
    assert.ok(columns(table).includes('synced_updated_at'), `${table} has synced_updated_at`);
  }
  assert.deepEqual(columns('sync_state'), ['key', 'value']);
  assert.deepEqual(columns('sync_tombstones'), ['uuid', 'plan_kind', 'deleted_at']);
  // Existing plans start with no synced stamp, so the first sync sends them.
  assert.equal(db.prepare('SELECT synced_updated_at FROM mass_plans WHERE id = 1').get().synced_updated_at, null);

  recordTombstone(db, { uuid: '44444444-4444-4444-8444-444444444444', kind: 'mass' });
  recordTombstone(db, { uuid: '44444444-4444-4444-8444-444444444444', kind: 'mass' });
  recordTombstone(db, { uuid: null, kind: 'praise' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sync_tombstones').get().n, 1);
});

// ---- Notes stay on the laptop (point 1) and the web step numbers (point 2) ----

test('a praise segment note is never in a push body', () => {
  const body = praiseBody(praiseEntries([{ key: 'prayer_authority', group: 'opening', order: 1, type: 'prayer', minutes: 3,
    contentRef: '{"kind":"prayer","noteId":null}', notes: 'Private laptop note' }], hymnUuidOf));
  assert.equal(JSON.stringify(body).includes('Private laptop note'), false);
  assert.equal(body.items.some((item) => 'note' in item), false, 'no item carries a note');
});

// The web's step name for each Mass part. A step number is checked against the template's own name for it, and against the part.
const PART_STEP_NAMES = {
  kyrie: ['Kyrie'],
  gloria: ['Gloria'],
  credo: ['Profession of Faith (Creed)'],
  sanctus: ['Holy, Holy, Holy (Sanctus)'],
  'memorial-acclamation': ['Memorial Acclamation'],
  'pater-noster': ['Our Father'],
  'agnus-dei': ['Lamb of God (Agnus Dei)'],
};

test('each Mass part step number in the web template is that Mass part, by its step name, and the part exists in massOrder.ts', () => {
  const byStep = new Map(MASS_PLAN.sections.flatMap((section) => section.rows).map((row) => [row[0], row[1]]));
  for (const [step, part] of Object.entries(MASS_STEP_PARTS)) {
    const name = byStep.get(Number(step));
    assert.ok(name !== undefined, `web step ${step} exists in the template`);
    assert.ok(PART_STEP_NAMES[part].includes(name), `web step ${step} is "${name}", which should be the part ${part}`);
    assert.ok(MASS_PARTS[part], `${part} has a name in massOrder.ts`);
  }
  assert.deepEqual(Object.keys(PART_STEP_NAMES).sort(), Object.values(MASS_STEP_PARTS).sort(), 'every part has a step, and every step a part');
});

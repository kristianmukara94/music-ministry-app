// Tests for the library export and import. Run with: node --test electron/transfer.test.mjs
// The database is SQLite in memory, through Node's built-in sqlite, so no Electron is needed. The migration files import
// Electron, so the loader below stubs it. The schema is the same migrations, in the order announcements.js runs them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { HYMN_DELETE_MIGRATIONS, LYRICS_MIGRATIONS, LYRICS_STYLE_MIGRATIONS } = await import('./lyrics.js');
const { MASS_PLAN_MIGRATIONS, MASS_SLOT_MIGRATIONS, PLAN_BIBLE_MIGRATIONS, PLAN_CUSTOM_MIGRATIONS, PLAN_NOTES_MIGRATIONS, PLAN_COMMUNION_MIGRATIONS } = await import('./mass-plans.js');
const { PW_MIGRATIONS } = await import('./pw-sessions.js');
const { SONG_CATEGORY_MIGRATIONS, SONG_SCOPE_MIGRATIONS } = await import('./song-categories.js');
const {
  TRANSFER_MIGRATIONS,
  applyImport,
  checkExportOptions,
  collectLibrary,
  decodeTransfer,
  defaultExportName,
  encodeTransfer,
  previewImport,
} = await import('./transfer.js');

// The migrations the library tables come from, in announcements.js order (the others do not touch these tables).
const EARLIER = [
  ...LYRICS_MIGRATIONS,
  ...HYMN_DELETE_MIGRATIONS,
  ...MASS_PLAN_MIGRATIONS,
  ...PLAN_BIBLE_MIGRATIONS,
  ...LYRICS_STYLE_MIGRATIONS,
  ...PLAN_CUSTOM_MIGRATIONS,
  ...PLAN_NOTES_MIGRATIONS,
  ...PW_MIGRATIONS,
  ...PLAN_COMMUNION_MIGRATIONS,
  ...SONG_CATEGORY_MIGRATIONS, ...SONG_SCOPE_MIGRATIONS, ...MASS_SLOT_MIGRATIONS,
];

function makeDb({ withTransfer = true } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const sql of EARLIER) db.exec(sql);
  if (withTransfer) for (const sql of TRANSFER_MIGRATIONS) db.exec(sql);
  return db;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ALL = { plans: true, setlists: true, praiseWorship: true, songs: true };

/** Two songs, a setlist, a plan with a song and a reading, and a Praise & Worship session that uses the first song. */
function seed(db) {
  const hymn = (title, language, category) =>
    Number(db.prepare("INSERT INTO hymns (title, composer, category, language) VALUES (?, 'Anon', ?, ?)").run(title, category, language).lastInsertRowid);
  const stanza = (hymnId, type, text, order) =>
    db.prepare('INSERT INTO hymn_stanzas (hymn_id, stanza_type, lyrics_text, display_order) VALUES (?, ?, ?, ?)').run(hymnId, type, text, order);

  const a = hymn('Amazing Grace', 'EN', 'Entrance');
  stanza(a, 'Verse', 'Amazing grace', 1);
  stanza(a, 'Chorus', 'How sweet the sound', 2);
  db.prepare("INSERT INTO pw_hymn_tags (hymn_id, segment_key) VALUES (?, 'worship')").run(a);
  const b = hymn('Gloria', 'TL', 'Entrance');

  const setlist = Number(db.prepare("INSERT INTO setlists (name, date) VALUES ('Sunday 1', '2026-10-25')").run().lastInsertRowid);
  db.prepare('INSERT INTO setlist_items (setlist_id, hymn_id, position) VALUES (?, ?, 1)').run(setlist, a);
  db.prepare('INSERT INTO setlist_items (setlist_id, hymn_id, position) VALUES (?, ?, 2)').run(setlist, b);

  const plan = Number(db.prepare("INSERT INTO mass_plans (name, liturgical_date) VALUES ('Plan A', '2026-10-25')").run().lastInsertRowid);
  db.prepare("INSERT INTO mass_plan_items (plan_id, liturgical_block, source_module, source_id, label, display_order) VALUES (?, 'introductory', 'lyrics', ?, 'Amazing Grace', 1)").run(plan, String(a));
  db.prepare("INSERT INTO mass_plan_items (plan_id, liturgical_block, source_module, source_id, label, display_order) VALUES (?, 'word', 'lectionary', '2026-10-25|First Reading', 'First Reading', 2)").run(plan);

  const session = Number(db.prepare("INSERT INTO pw_sessions (name, liturgical_date, groups) VALUES ('Praise night', '2026-10-25', '[\"opening\"]')").run().lastInsertRowid);
  const order = db.prepare('SELECT id FROM hymn_stanzas WHERE hymn_id = ? ORDER BY display_order, id').all(a).map((r) => r.id);
  db.prepare(
    `INSERT INTO pw_segments (session_id, display_order, segment_key, group_key, name, type, minutes, leader, content_ref, arrangement, cues, notes)
     VALUES (?, 1, 'worship', 'praise', 'Worship', 'song', 10, '', ?, ?, '{}', '')`,
  ).run(session, JSON.stringify({ kind: 'song', hymnIds: [a], maxSongs: 1, category: null }), JSON.stringify({ [String(a)]: [String(order[1]), String(order[0])] }));
  return { a, b, setlist, plan, session };
}

const uuidOfTitle = (db, title) => db.prepare('SELECT uuid FROM hymns WHERE title = ?').get(title).uuid;
const count = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

function exportFrom(db, options = ALL, lyrics = true) {
  return encodeTransfer(collectLibrary(db, { ...options, lyrics }, { laptop: 'PC1', exportedAt: '2026-10-27T05:52:00.000Z' }));
}

// ---- Migration -------------------------------------------------------------------------------------------------------

test('existing records get a UUID and an updated_at when the migration runs', () => {
  const db = makeDb({ withTransfer: false });
  seed(db);
  for (const sql of TRANSFER_MIGRATIONS) db.exec(sql);
  for (const table of ['hymns', 'setlists', 'mass_plans', 'pw_sessions']) {
    const rows = db.prepare(`SELECT uuid, updated_at FROM ${table}`).all();
    assert.ok(rows.length > 0, `${table} has rows`);
    for (const row of rows) {
      assert.match(row.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, `${table} UUID is a version 4 UUID`);
      assert.match(row.updated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
    const uuids = rows.map((r) => r.uuid);
    assert.equal(new Set(uuids).size, uuids.length, `${table} UUIDs are unique`);
  }
});

test('a new record gets its UUID and updated_at from the database, and a change moves updated_at on', async () => {
  const db = makeDb();
  const ids = seed(db);
  const before = db.prepare('SELECT uuid, updated_at FROM hymns WHERE id = ?').get(ids.a);
  assert.ok(before.uuid && before.updated_at);
  await sleep(5);
  db.prepare('UPDATE hymns SET title = ? WHERE id = ?').run('Amazing Grace (new)', ids.a);
  const after = db.prepare('SELECT uuid, updated_at FROM hymns WHERE id = ?').get(ids.a);
  assert.equal(after.uuid, before.uuid, 'the UUID does not change');
  assert.notEqual(after.updated_at, before.updated_at, 'updated_at moves on');
});

test('a change to a song\'s lyrics or tags, or to a plan item, counts as a change to that record', async () => {
  const db = makeDb();
  const ids = seed(db);
  const stamp = (table, id) => db.prepare(`SELECT updated_at FROM ${table} WHERE id = ?`).get(id).updated_at;
  await sleep(5);
  let old = stamp('hymns', ids.a);
  db.prepare("INSERT INTO hymn_stanzas (hymn_id, stanza_type, lyrics_text, display_order) VALUES (?, 'Bridge', 'x', 3)").run(ids.a);
  assert.notEqual(stamp('hymns', ids.a), old, 'a new stanza stamps the song');
  await sleep(5);
  old = stamp('mass_plans', ids.plan);
  db.prepare('DELETE FROM mass_plan_items WHERE plan_id = ? AND display_order = 2').run(ids.plan);
  assert.notEqual(stamp('mass_plans', ids.plan), old, 'a removed plan item stamps the plan');
});

test('the UUID cannot be changed once it is set', () => {
  const db = makeDb();
  const ids = seed(db);
  assert.throws(() => db.prepare('UPDATE hymns SET uuid = ? WHERE id = ?').run('someone-else', ids.a), /cannot be changed/);
});

test('deleting a plan or a song still works, and the rows that belonged to it go too', () => {
  const db = makeDb();
  const ids = seed(db);
  db.prepare('DELETE FROM mass_plans WHERE id = ?').run(ids.plan);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mass_plan_items WHERE plan_id = ?').get(ids.plan).n, 0);
  db.prepare('DELETE FROM hymns WHERE id = ?').run(ids.a);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM hymn_stanzas WHERE hymn_id = ?').get(ids.a).n, 0);
});

// ---- File format -----------------------------------------------------------------------------------------------------

test('a file round-trips, and any changed byte is refused with a checksum error', () => {
  const db = makeDb();
  seed(db);
  const text = exportFrom(db);
  const data = decodeTransfer(text);
  assert.equal(data.format, 'apccmma-library');
  assert.equal(data.formatVersion, 1);
  assert.equal(data.laptop, 'PC1');
  assert.equal(data.exportedAt, '2026-10-27T05:52:00.000Z');
  assert.deepEqual(data.counts, { songs: 2, setlists: 1, plans: 1, praiseWorship: 1, massOrder: 0 });

  assert.throws(() => decodeTransfer(text.replace('Amazing Grace', 'Amazing Grac3')), /checksum does not match/);
  assert.throws(() => decodeTransfer(text.replace('"PC1"', '"PC2"')), /checksum does not match/);
  assert.throws(() => decodeTransfer(text.replace(/[0-9a-f]{64}/, (h) => (h[0] === 'a' ? 'b' : 'a') + h.slice(1))), /checksum does not match/);
  assert.throws(() => decodeTransfer(text.replace('{\n', '{ \n')), /checksum does not match/, 'even a space is caught');
  assert.throws(() => decodeTransfer(text + ' '), /damaged/, 'bytes after the checksum line are caught');
  assert.throws(() => decodeTransfer('{"format":"other"}'), /damaged/);
});

test('a file of another format version is refused', () => {
  const db = makeDb();
  seed(db);
  const data = collectLibrary(db, { ...ALL, lyrics: true }, { laptop: 'PC1' });
  const future = encodeTransfer({ ...data, formatVersion: 2 });
  assert.throws(() => decodeTransfer(future), /format version 2/);
});

test('the export options must choose something, and the default file name is dated', () => {
  assert.throws(() => checkExportOptions({ lyrics: true }), /at least one/);
  assert.deepEqual(checkExportOptions({ songs: true }), { plans: false, setlists: false, praiseWorship: false, songs: true, lyrics: false, massOrder: false });
  assert.equal(defaultExportName(new Date(2026, 9, 27, 13, 52)), 'APCCMMA-export-2026-10-27-1352.apccmma');
});

test('lyrics leave the laptop only when they are ticked', () => {
  const db = makeDb();
  seed(db);
  const withLyrics = exportFrom(db, ALL, true);
  const withoutLyrics = exportFrom(db, ALL, false);
  assert.match(withLyrics, /How sweet the sound/);
  assert.doesNotMatch(withoutLyrics, /How sweet the sound/);
  assert.doesNotMatch(withoutLyrics, /lyricsText|"lyrics":/);
  const data = decodeTransfer(withoutLyrics);
  assert.equal(data.includesLyrics, false);
  assert.equal('lyrics' in data.songs[0], false);
  assert.deepEqual(data.praiseWorship[0].segments[0].arrangement, {}, 'arrangements need lyrics, so they are left out');
});

test('a song that a chosen setlist or plan uses comes along, even when the song list is not chosen', () => {
  const db = makeDb();
  seed(db);
  const data = decodeTransfer(exportFrom(db, { setlists: true }, false));
  assert.deepEqual(data.songs.map((s) => s.title).sort(), ['Amazing Grace', 'Gloria']);
  assert.deepEqual(data.plans, [], 'plans were not chosen');
});

// ---- Import ----------------------------------------------------------------------------------------------------------

test('a file imports into an empty library: everything is new, and the links between records are kept', () => {
  const source = makeDb();
  seed(source);
  const data = decodeTransfer(exportFrom(source));
  const target = makeDb();

  const preview = previewImport(target, data);
  assert.deepEqual(preview.totals, { new: 5, same: 0, changed: 0 });
  assert.deepEqual(applyImport(target, data), {
    added: { songs: 2, setlists: 1, plans: 1, praiseWorship: 1, massOrder: 0 },
    skipped: { songs: 0, setlists: 0, plans: 0, praiseWorship: 0, massOrder: 0 },
    changed: { kept: 0, used: 0 },
  });

  const amazing = target.prepare("SELECT id FROM hymns WHERE title = 'Amazing Grace'").get();
  assert.equal(target.prepare('SELECT uuid FROM hymns WHERE id = ?').get(amazing.id).uuid, uuidOfTitle(source, 'Amazing Grace'), 'the UUID carries over');
  assert.equal(target.prepare("SELECT source_id FROM mass_plan_items WHERE source_module = 'lyrics'").get().source_id, String(amazing.id), 'the plan points at the new song');
  const items = target.prepare('SELECT hymn_id FROM setlist_items ORDER BY position').all().map((r) => r.hymn_id);
  assert.equal(items[0], amazing.id, 'the setlist keeps its order');
  const segment = target.prepare('SELECT content_ref, arrangement FROM pw_segments').get();
  assert.deepEqual(JSON.parse(segment.content_ref).hymnIds, [amazing.id]);
  const stanzaIds = target.prepare('SELECT id FROM hymn_stanzas WHERE hymn_id = ? ORDER BY display_order, id').all(amazing.id).map((r) => r.id);
  assert.deepEqual(JSON.parse(segment.arrangement), { [String(amazing.id)]: [String(stanzaIds[1]), String(stanzaIds[0])] }, 'the stanza order is kept');
  assert.equal(target.prepare('SELECT updated_at FROM hymns WHERE id = ?').get(amazing.id).updated_at, source.prepare('SELECT updated_at FROM hymns WHERE title = ?').get('Amazing Grace').updated_at, 'the imported time is kept');
});

test('importing the same file again adds nothing, and everything is skipped', () => {
  const source = makeDb();
  seed(source);
  const data = decodeTransfer(exportFrom(source));
  const target = makeDb();
  applyImport(target, data);
  const before = ['hymns', 'hymn_stanzas', 'setlists', 'setlist_items', 'mass_plans', 'mass_plan_items', 'pw_sessions', 'pw_segments'].map((t) => count(target, t));

  assert.deepEqual(previewImport(target, data).totals, { new: 0, same: 5, changed: 0 });
  assert.deepEqual(applyImport(target, data), {
    added: { songs: 0, setlists: 0, plans: 0, praiseWorship: 0, massOrder: 0 },
    skipped: { songs: 2, setlists: 1, plans: 1, praiseWorship: 1, massOrder: 0 },
    changed: { kept: 0, used: 0 },
  });
  const after = ['hymns', 'hymn_stanzas', 'setlists', 'setlist_items', 'mass_plans', 'mass_plan_items', 'pw_sessions', 'pw_segments'].map((t) => count(target, t));
  assert.deepEqual(after, before);
});

test('a song edited here shows as CHANGED, the local version is kept by default, and the imported one can be chosen', async () => {
  const source = makeDb();
  seed(source);
  const data = decodeTransfer(exportFrom(source));
  const target = makeDb();
  applyImport(target, data);

  await sleep(5);
  target.prepare("UPDATE hymns SET title = 'Amazing Grace (edited here)' WHERE title = 'Amazing Grace'").run();
  const preview = previewImport(target, data);
  assert.deepEqual(preview.totals, { new: 0, same: 4, changed: 1 });
  assert.equal(preview.changed[0].key, `songs:${uuidOfTitle(source, 'Amazing Grace')}`);

  const kept = applyImport(target, data);
  assert.equal(kept.changed.kept, 1);
  assert.equal(target.prepare('SELECT COUNT(*) AS n FROM hymns WHERE title = ?').get('Amazing Grace (edited here)').n, 1, 'the local title is kept');

  const used = applyImport(target, data, { [preview.changed[0].key]: 'use' });
  assert.equal(used.changed.used, 1);
  assert.equal(target.prepare("SELECT COUNT(*) AS n FROM hymns WHERE title = 'Amazing Grace'").get().n, 1, 'the imported title replaces it, once');
  assert.deepEqual(previewImport(target, data).totals, { new: 0, same: 5, changed: 0 }, 'after choosing, the file is clean again');
});

test('a song already here under another ID, with the same title and language, is matched and not added again', () => {
  const source = makeDb();
  seed(source);
  const data = decodeTransfer(exportFrom(source));
  const target = makeDb();
  const local = Number(target.prepare("INSERT INTO hymns (title, composer, category, language) VALUES ('  gloria  ', 'Anon', 'Entrance', 'TL')").run().lastInsertRowid);
  // Same content as the file's copy, so the updated_at matches too.
  target.prepare('UPDATE hymns SET updated_at = ? WHERE id = ?').run(data.songs.find((s) => s.title === 'Gloria').updatedAt, local);

  assert.deepEqual(previewImport(target, data).totals, { new: 4, same: 1, changed: 0 }, 'Gloria is already here');
  applyImport(target, data);
  assert.equal(count(target, 'hymns'), 2, 'only Amazing Grace was added');
  const again = applyImport(target, data);
  assert.equal(again.added.songs, 0, 'the second import still adds nothing');
  assert.equal(count(target, 'hymns'), 2);
});

test('a failed write rolls back everything, including the songs written before it', () => {
  const source = makeDb();
  seed(source);
  const data = decodeTransfer(exportFrom(source));
  data.plans[0].items[0].sourceId = 'a-song-the-file-never-had';
  const target = makeDb();
  assert.throws(() => applyImport(target, data), /nothing was changed/);
  assert.equal(count(target, 'hymns'), 0);
  assert.equal(count(target, 'setlists'), 0);
  assert.equal(count(target, 'mass_plans'), 0);
  assert.equal(count(target, 'transfer_song_aliases'), 0);
});

test('nothing is deleted on import, even when the file leaves a record out', () => {
  const source = makeDb();
  seed(source);
  const target = makeDb();
  applyImport(target, decodeTransfer(exportFrom(source)));
  target.prepare("INSERT INTO hymns (title, composer, category, language) VALUES ('Only Here', '', 'General', 'EN')").run();
  applyImport(target, decodeTransfer(exportFrom(makeDb())));
  assert.equal(count(target, 'hymns'), 3);
});

// ---- The parish's Holy Mass Order words, titles and items --------------------------------------------------------

const { MASS_ORDER_CUSTOM_MIGRATIONS, MASS_ORDER_TEXT_MIGRATIONS, createMassOrderTexts } = await import('./mass-order.js');
const SYNOD = 'mass_order_custom_5b7f0f3c-2a6e-4d1b-9a77-0c4c1b2f9e10';

/** A library with the Holy Mass Order tables. */
function makeMassOrderDb() {
  const db = makeDb();
  for (const sql of [...MASS_ORDER_TEXT_MIGRATIONS, ...MASS_ORDER_CUSTOM_MIGRATIONS]) db.exec(sql);
  return db;
}
const massOrderOf = (db) => createMassOrderTexts(db).list();
const textsOf = (db) => massOrderOf(db).texts.map(({ partId, lang, text, title }) => [partId, lang, text, title]);

/** The parish's own words: a renamed Kyrie with Cebuano words, a Tagalog Gloria, and a parish item. */
function seedMassOrder(db) {
  const texts = createMassOrderTexts(db, { newId: () => SYNOD });
  texts.saveAll('kyrie', { en: { text: null, title: 'Kyrie Eleison' }, ceb: { text: 'P: Ginoo, kaloy-i kami.\nGinoo, kaloy-i kami.', title: null } });
  texts.saveAll('gloria', { tl: { text: 'Papuri sa Diyos sa kaitaasan.', title: 'Papuri' } });
  texts.create({ en: { text: 'P: Let us pray for the synod.\nAmen.', title: 'Diocesan Synod Prayer' }, ceb: { text: null, title: 'Pag-ampo alang sa Sinodo' } });
  return texts;
}

test('the export carries every edited title and text, in all three languages, and every parish item', () => {
  const db = makeMassOrderDb();
  seedMassOrder(db);
  const data = decodeTransfer(exportFrom(db, { massOrder: true }));
  assert.equal(data.counts.massOrder, 3);
  const byId = Object.fromEntries(data.massOrder.map((r) => [r.id, r]));
  assert.deepEqual(byId.kyrie.texts, { en: { text: null, title: 'Kyrie Eleison' }, ceb: { text: 'P: Ginoo, kaloy-i kami.\nGinoo, kaloy-i kami.', title: null } });
  assert.equal(byId.kyrie.custom, false);
  assert.deepEqual(byId.gloria.texts, { tl: { text: 'Papuri sa Diyos sa kaitaasan.', title: 'Papuri' } });
  assert.equal(byId[SYNOD].custom, true);
  assert.ok(byId[SYNOD].createdAt, 'a parish item keeps when it was made, so it lists in the same order elsewhere');
  assert.equal(byId[SYNOD].texts.ceb.title, 'Pag-ampo alang sa Sinodo');
  // Not asked for: none.
  assert.equal(decodeTransfer(exportFrom(db, { songs: true })).massOrder.length, 0);
  assert.equal(checkExportOptions({ massOrder: true }).massOrder, true, 'the Holy Mass Order alone is a valid export');
});

test('a plan that uses a parish item takes the item with it, even when the Holy Mass Order is not chosen', () => {
  const db = makeMassOrderDb();
  seed(db);
  seedMassOrder(db);
  const plan = db.prepare('SELECT id FROM mass_plans').get().id;
  db.prepare("INSERT INTO mass_plan_items (plan_id, liturgical_block, source_module, source_id, label, display_order) VALUES (?, 'communion', 'mass_order', ?, 'Diocesan Synod Prayer', 3)").run(plan, SYNOD);
  const data = decodeTransfer(exportFrom(db, { plans: true }));
  assert.deepEqual(data.massOrder.map((r) => r.id), [SYNOD], 'only the item the plan uses, not the other edits');
  const target = makeMassOrderDb();
  applyImport(target, data);
  assert.equal(target.prepare('SELECT source_id AS s FROM mass_plan_items WHERE source_module = ?').get('mass_order').s, SYNOD);
  assert.deepEqual(massOrderOf(target).custom.map((c) => c.id), [SYNOD], 'so the plan finds its item on the other laptop');
});

test('an import into a laptop without the parish words adds them all, and restores them exactly', () => {
  const source = makeMassOrderDb();
  seedMassOrder(source);
  const target = makeMassOrderDb();
  const data = decodeTransfer(exportFrom(source, { massOrder: true }));
  assert.deepEqual(previewImport(target, data).counts.massOrder, { new: 3, same: 0, changed: 0 });
  assert.equal(applyImport(target, data).added.massOrder, 3);
  assert.deepEqual(textsOf(target), textsOf(source));
  assert.deepEqual(massOrderOf(target).custom.map((c) => c.id), [SYNOD]);
  // The same file again: everything is already here.
  const again = applyImport(target, data);
  assert.deepEqual([again.added.massOrder, again.skipped.massOrder], [0, 3]);
});

test("a part both laptops changed differently is the operator's choice, keeping this laptop's words by default; nothing is deleted", () => {
  const source = makeMassOrderDb();
  seedMassOrder(source);
  const data = decodeTransfer(exportFrom(source, { massOrder: true }));
  const prepare = () => {
    const db = makeMassOrderDb();
    const here = createMassOrderTexts(db);
    here.saveAll('kyrie', { en: { text: null, title: 'Lord, Have Mercy (Parish)' } });
    here.saveAll('sanctus', { ceb: { text: 'Santos, santos, santos.', title: null } });
    return db;
  };

  const target = prepare();
  const preview = previewImport(target, data);
  assert.deepEqual(preview.counts.massOrder, { new: 2, same: 0, changed: 1 });
  const [kyrie] = preview.changed;
  assert.equal(kyrie.key, 'massOrder:kyrie');
  assert.equal(kyrie.type, 'massOrder');
  assert.equal(kyrie.name, 'Kyrie Eleison', 'the preview names the part by its title');

  // Default: keep this laptop's Kyrie.
  const kept = prepare();
  applyImport(kept, data);
  assert.equal(massOrderOf(kept).texts.find((r) => r.partId === 'kyrie' && r.lang === 'en').title, 'Lord, Have Mercy (Parish)');

  // Use the imported one: it replaces this laptop's Kyrie in every language.
  const summary = applyImport(target, data, { 'massOrder:kyrie': 'use' });
  assert.deepEqual(summary.changed, { kept: 0, used: 1 });
  assert.deepEqual(textsOf(target).filter((r) => r[0] === 'kyrie'), [
    ['kyrie', 'ceb', 'P: Ginoo, kaloy-i kami.\nGinoo, kaloy-i kami.', null],
    ['kyrie', 'en', null, 'Kyrie Eleison'],
  ]);
  // The Sanctus was not in the file: it stays.
  assert.equal(massOrderOf(target).texts.find((r) => r.partId === 'sanctus').text, 'Santos, santos, santos.');
});

test('a parish item shared between laptops stays one item: matched by its id, never added twice', () => {
  const a = makeMassOrderDb();
  seedMassOrder(a);
  const b = makeMassOrderDb();
  applyImport(b, decodeTransfer(exportFrom(a, { massOrder: true })));
  // Laptop B adds a Tagalog title to the item and sends it back.
  createMassOrderTexts(b).saveAll(SYNOD, { tl: { text: null, title: 'Panalangin para sa Sinodo' } });
  const back = decodeTransfer(exportFrom(b, { massOrder: true }));
  assert.deepEqual(previewImport(a, back).counts.massOrder, { new: 0, same: 2, changed: 1 });
  applyImport(a, back, { [`massOrder:${SYNOD}`]: 'use' });
  assert.deepEqual(massOrderOf(a).custom.map((c) => c.id), [SYNOD], 'still one item');
  assert.equal(massOrderOf(a).texts.find((r) => r.partId === SYNOD && r.lang === 'tl').title, 'Panalangin para sa Sinodo');
});

test('a damaged Holy Mass Order entry refuses the whole file before anything is written', () => {
  const source = makeMassOrderDb();
  seed(source);
  seedMassOrder(source);
  const good = decodeTransfer(exportFrom(source, { massOrder: true, songs: true }));
  const target = makeMassOrderDb();
  const bad = (record) => ({ ...good, massOrder: [...good.massOrder, record] });
  assert.throws(() => previewImport(target, bad({ id: '../etc', texts: { en: { text: 'x', title: 'x' } } })), /id this app does not know/);
  assert.throws(() => previewImport(target, bad({ id: 'gloria', texts: { fr: { text: 'x', title: null } } })), /language this app does not keep/);
  assert.throws(() => previewImport(target, bad({ id: 'mass_order_custom_0000', custom: true, texts: { en: { text: 'Words only', title: null } } })), /no title or no words/);
  assert.throws(() => applyImport(target, bad({ id: 'credo', texts: { en: { text: 'x'.repeat(20001), title: null } } })), /nothing was changed/);
  assert.deepEqual(massOrderOf(target), { texts: [], custom: [] });
  assert.equal(count(target, 'hymns'), 0, 'not even the songs before it');
});

test('a file from before the Holy Mass Order was shared still imports, with nothing to add for it', () => {
  const source = makeDb();
  seed(source);
  const data = decodeTransfer(exportFrom(source));
  delete data.massOrder;
  const target = makeMassOrderDb();
  assert.deepEqual(previewImport(target, data).counts.massOrder, { new: 0, same: 0, changed: 0 });
  assert.equal(applyImport(target, data).added.massOrder, 0);
});

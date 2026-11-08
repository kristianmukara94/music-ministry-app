// Tests the parish's Holy Mass Order words, titles and items in the database: saving in English, Tagalog and Cebuano, titles, the parish's own
// items (create, edit, delete), the upgrade of words saved before Cebuano and titles, and a database backup carrying all of it through a restore.
// Run with: node --test electron/mass-order.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { MASS_ORDER_CUSTOM_MIGRATIONS, MASS_ORDER_TEXT_MIGRATIONS, createMassOrderTexts } = await import('./mass-order.js');
const { exportBackup, importBackup } = await import('./database-backup.js');

const MIGRATIONS = [...MASS_ORDER_TEXT_MIGRATIONS, ...MASS_ORDER_CUSTOM_MIGRATIONS];

function setup(file = ':memory:') {
  const db = new DatabaseSync(file);
  for (const sql of MIGRATIONS) db.exec(sql);
  let n = 0;
  const texts = createMassOrderTexts(db, { newId: () => `mass_order_custom_00000000-0000-4000-8000-00000000000${++n}` });
  return { db, texts };
}
const rowsOf = (texts) => texts.list().texts.map((r) => [r.partId, r.lang, r.text, r.title]);

test('words and titles are saved per part and language, Cebuano included, all languages in one go', () => {
  const { texts } = setup();
  assert.deepEqual(texts.list(), { texts: [], custom: [] });
  texts.saveAll('gloria', {
    en: { text: 'Glory to God in the highest,\r\nand on earth peace.', title: null },
    tl: { text: null, title: 'Papuri sa Diyos (Awit)' },
    ceb: { text: 'Himaya sa Dios sa kahitas-an.', title: 'Himaya' },
  });
  assert.deepEqual(rowsOf(texts), [
    ['gloria', 'ceb', 'Himaya sa Dios sa kahitas-an.', 'Himaya'],
    ['gloria', 'en', 'Glory to God in the highest,\nand on earth peace.', null],
    ['gloria', 'tl', null, 'Papuri sa Diyos (Awit)'],
  ]);
  // Changing one language leaves the others; a language with neither words nor title goes back to standard.
  texts.saveAll('gloria', { tl: { text: null, title: null }, en: { text: 'Glory to God.', title: '  Gloria  in Excelsis ' } });
  assert.deepEqual(rowsOf(texts), [
    ['gloria', 'ceb', 'Himaya sa Dios sa kahitas-an.', 'Himaya'],
    ['gloria', 'en', 'Glory to God.', 'Gloria in Excelsis'],
  ]);
});

test('reset removes the parish words and title for one language only', () => {
  const { texts } = setup();
  texts.saveAll('sanctus', { en: { text: 'Holy, Holy, Holy', title: 'Holy' }, ceb: { text: 'Santu, Santu, Santu', title: null } });
  assert.equal(texts.reset('sanctus', 'en'), true);
  assert.equal(texts.reset('sanctus', 'en'), false, 'nothing left to remove');
  assert.deepEqual(texts.list().texts.map((r) => r.lang), ['ceb']);
});

test('a save with one bad language saves nothing, and unusable parts, languages and titles are refused', () => {
  const { texts } = setup();
  assert.throws(() => texts.saveAll('gloria', { en: { text: 'Fine.', title: null }, tl: { text: 'x'.repeat(20001), title: null } }), /too long/);
  assert.deepEqual(texts.list().texts, [], 'the good English words were not kept either');
  assert.throws(() => texts.saveAll('../etc', { en: { text: 'x', title: null } }), /not a Holy Mass Order part/);
  assert.throws(() => texts.saveAll('gloria', { fr: { text: 'x', title: null } }), /English, Tagalog or Cebuano/);
  assert.throws(() => texts.saveAll('gloria', { en: { text: null, title: 'x'.repeat(121) } }), /title is too long/);
  assert.throws(() => texts.saveAll('gloria', null), /Nothing to save/);
});

test('a parish item is created with a mass_order_custom_ id, edited, listed in order, and deleted with all its words', () => {
  const { texts } = setup();
  const communion = texts.create({
    en: { text: 'P: My Jesus, I believe that you are present in the Most Holy Sacrament.\nI love you above all things.', title: 'Act of Spiritual Communion' },
    ceb: { text: 'Akong Hesus, nagatoo ako nga ania ka sa Labing Balaang Sakramento.', title: 'Buhat sa Espirituhanong Pakigkomunyon' },
  });
  const synod = texts.create({ tl: { text: 'Panalangin para sa Sinodo.', title: 'Diocesan Synod Prayer' } });
  assert.match(communion, /^mass_order_custom_[0-9a-f-]{36}$/);
  assert.deepEqual(texts.list().custom.map((c) => c.id), [communion, synod], 'in the order they were made');
  assert.equal(texts.list().texts.filter((r) => r.partId === communion).length, 2);

  // Editing: a new Tagalog title and words; the item must keep a title and words somewhere.
  texts.saveAll(communion, { tl: { text: 'Hesus ko, sumasampalataya ako.', title: 'Gawang Espirituwal na Pakikinabang' } });
  assert.equal(texts.list().texts.filter((r) => r.partId === communion).length, 3);
  assert.throws(
    () => texts.saveAll(communion, { en: { text: null, title: null }, tl: { text: null, title: null }, ceb: { text: null, title: null } }),
    /title in at least one language/,
  );
  assert.equal(texts.list().texts.filter((r) => r.partId === communion).length, 3, 'the refused edit changed nothing');

  assert.throws(() => texts.reset(communion, 'en'), /no standard text/);
  assert.throws(() => texts.remove('kyrie'), /Only the parish's own items/);
  assert.equal(texts.remove(communion), true);
  assert.deepEqual(texts.list().custom.map((c) => c.id), [synod]);
  assert.equal(texts.list().texts.some((r) => r.partId === communion), false, 'its words went with it');
  assert.throws(() => texts.saveAll(communion, { en: { text: 'x', title: 'x' } }), /deleted/);
});

test('a new item without a title or without words is refused and leaves nothing behind', () => {
  const { texts } = setup();
  assert.throws(() => texts.create({ en: { text: 'Words only.', title: null } }), /title in at least one language/);
  assert.throws(() => texts.create({ en: { text: null, title: 'Title only' } }), /words of the new item/);
  assert.deepEqual(texts.list(), { texts: [], custom: [] });
});

test('words saved before Cebuano and titles are kept by the upgrade', () => {
  const db = new DatabaseSync(':memory:');
  for (const sql of MASS_ORDER_TEXT_MIGRATIONS) db.exec(sql);
  db.prepare("INSERT INTO mass_order_texts (part_id, lang, text) VALUES ('kyrie', 'en', 'Lord, have mercy.'), ('gloria', 'tl', 'Papuri')").run();
  for (const sql of MASS_ORDER_CUSTOM_MIGRATIONS) db.exec(sql);
  const texts = createMassOrderTexts(db);
  assert.deepEqual(rowsOf(texts), [
    ['gloria', 'tl', 'Papuri', null],
    ['kyrie', 'en', 'Lord, have mercy.', null],
  ]);
  texts.saveAll('kyrie', { ceb: { text: 'Ginoo, kaloy-i kami.', title: null } });
  assert.equal(texts.list().texts.length, 3);
});

test('the tables are part of the app\'s migrations, appended at the end', () => {
  const source = fs.readFileSync(new URL('./announcements.js', import.meta.url), 'utf8');
  // Later migrations follow them (the Lectionary's Prayer of the Faithful, the plan's language and slot titles, the song categories' target
  // mode, the Whiteboard's own speaker notes), so they keep their place in the sequence.
  assert.match(source, /\.\.\.MASS_SLOT_MIGRATIONS,\s*\.\.\.MASS_ORDER_TEXT_MIGRATIONS,\s*\.\.\.MASS_ORDER_CUSTOM_MIGRATIONS,\s*\.\.\.LECTIONARY_PRAYER_MIGRATIONS,\s*\.\.\.PLAN_LANGUAGE_MIGRATIONS,\s*\.\.\.PLAN_SLOT_TITLE_MIGRATIONS,\s*\.\.\.SONG_CATEGORY_MODE_MIGRATIONS,\s*\.\.\.WHITEBOARD_NOTES_MIGRATIONS,\s*\.\.\.NOTES_SLOT_MIGRATIONS,\s*\.\.\.DB_CRYPTO_MIGRATIONS,\s*\];/);
  const plans = fs.readFileSync(new URL('./mass-plans.js', import.meta.url), 'utf8');
  const part = new RegExp(plans.match(/const MASS_PART = \/(.+)\/;/)[1]);
  assert.ok(part.test('mass_order_custom_5b7f0f3c-2a6e-4d1b-9a77-0c4c1b2f9e10'), 'a plan can hold a parish item');
  assert.ok(part.test('agnus-dei'));
  assert.ok(!part.test('../x') && !part.test('Kyrie'));
});

test('a database backup carries the parish words, titles and items, and a restore brings them back', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apcc-mass-order-'));
  try {
    // The live database: an app database (it has the hymns table) with parish words in three languages and a parish item.
    const livePath = path.join(dir, 'live.db');
    const live = setup(livePath);
    live.db.exec('CREATE TABLE hymns (id INTEGER PRIMARY KEY)');
    live.texts.saveAll('kyrie', { ceb: { text: 'Ginoo, kaloy-i kami.', title: 'Ginoo, Kaloy-i Kami' }, en: { text: null, title: 'Kyrie Eleison' } });
    const item = live.texts.create({ en: { text: 'P: Let us pray for the synod.', title: 'Diocesan Synod Prayer' } });
    const before = live.texts.list();

    const schemaVersion = 99;
    const open = (file) => new DatabaseSync(file, { readOnly: true });
    const backupPath = path.join(dir, 'apccmma-backup.db');
    await exportBackup({ target: backupPath, backup: async (target) => live.db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`), schemaVersion, open });

    // The parish then changes things, and restores the backup.
    live.texts.remove(item);
    live.texts.reset('kyrie', 'ceb');
    live.db.close();
    const restored = importBackup({
      source: backupPath,
      activePath: livePath,
      schemaVersion,
      open,
      openForMigration: (file) => new DatabaseSync(file),
      closeDatabase: () => {},
    });
    assert.equal(restored.ok, true, restored.error);

    const back = new DatabaseSync(livePath);
    const after = createMassOrderTexts(back).list();
    assert.deepEqual(after.texts.map(({ partId, lang, text, title }) => ({ partId, lang, text, title })), before.texts.map(({ partId, lang, text, title }) => ({ partId, lang, text, title })));
    assert.deepEqual(after.custom.map((c) => c.id), [item]);
    back.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

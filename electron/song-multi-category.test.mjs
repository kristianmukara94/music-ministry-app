// A song filed under several song categories is listed under each of them, and a song's own projector font size is saved and read back.
// Synthetic songs only. Run with: node --test electron/song-multi-category.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { HYMN_DELETE_MIGRATIONS, HYMN_FILING_MIGRATIONS, LYRICS_MIGRATIONS, LYRICS_STYLE_MIGRATIONS, createLyricsService } = await import('./lyrics.js');
const { SONG_CATEGORY_MIGRATIONS, SONG_CATEGORY_MODE_MIGRATIONS, SONG_SCOPE_MIGRATIONS, createSongCategoryService } = await import('./song-categories.js');

const RAW = '[Verse 1]\nSample line 1\nSample line 2\n\n[Chorus]\nSample line 3';

function setup({ filing = true } = {}) {
  const db = new DatabaseSync(':memory:');
  db.transaction = (work) => (...args) => {
    db.exec('BEGIN');
    try {
      const result = work(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
  for (const sql of [...LYRICS_MIGRATIONS, ...LYRICS_STYLE_MIGRATIONS, ...HYMN_DELETE_MIGRATIONS, ...SONG_CATEGORY_MIGRATIONS, ...SONG_SCOPE_MIGRATIONS, ...SONG_CATEGORY_MODE_MIGRATIONS]) db.exec(sql);
  const categories = createSongCategoryService(db);
  for (const name of ['Category A', 'Category B', 'Category C', 'Category D']) categories.createSongCategory({ name });
  const migrate = () => HYMN_FILING_MIGRATIONS.forEach((sql) => db.exec(sql));
  if (filing) migrate();
  return { db, categories, migrate, service: () => createLyricsService(db) };
}

const input = (extra = {}) => ({ title: 'Sample Song', composer: '', language: 'EN', musicalKey: '', primaryCategory: 'GENERAL', raw: RAW, ...extra });
const titles = (service, songCategory) => service.listHymns({ songCategory }).map((h) => h.title).sort();

test('a song saved with three categories is listed under each of them, and only them', () => {
  const { service: make } = setup();
  const service = make();
  const { id } = service.createHymn(input({ categories: ['Category A', 'Category B', 'Category C'] }));
  service.createHymn(input({ title: 'Other Song', songCategory: 'Category D' }));

  for (const name of ['Category A', 'Category B', 'Category C', 'category b']) assert.deepEqual(titles(service, name), ['Sample Song'], name);
  assert.deepEqual(titles(service, 'Category D'), ['Other Song']);
  assert.equal(service.listHymns({}).length, 2);

  const hymn = service.getHymn(id);
  assert.deepEqual(hymn.categories, ['Category A', 'Category B', 'Category C']);
  // The first is the primary category, which the older code and exports still read.
  assert.equal(hymn.songCategory, 'Category A');
  const row = service.listHymns({ songCategory: 'Category C' })[0];
  assert.deepEqual(row.categories, ['Category A', 'Category B', 'Category C']);
});

test('an edit can add and remove categories, and the list follows', () => {
  const service = setup().service();
  const { id } = service.createHymn(input({ categories: ['Category A', 'Category B'] }));
  service.editHymn(id, input({ categories: ['Category B', 'Category C'] }));
  assert.deepEqual(service.getHymn(id).categories, ['Category B', 'Category C']);
  assert.equal(service.getHymn(id).songCategory, 'Category B');
  assert.deepEqual(titles(service, 'Category A'), []);
  assert.deepEqual(titles(service, 'Category C'), ['Sample Song']);
});

test('a song needs at least one category, and every one must be on the list', () => {
  const service = setup().service();
  assert.throws(() => service.createHymn(input({ categories: [] })), /category/i);
  assert.throws(() => service.createHymn(input({ categories: ['Category A', 'Not On The List'] })), /not in the song categories/);
  assert.equal(service.listHymns({}).length, 0);
});

test('a caller that sends only songCategory files the song under that one, and an edit from it keeps the others', () => {
  const service = setup().service();
  const { id } = service.createHymn(input({ songCategory: 'Category A' }));
  assert.deepEqual(service.getHymn(id).categories, ['Category A']);
  service.editHymn(id, input({ categories: ['Category A', 'Category B'] }));
  // An older form sends the primary category only: the second category stays.
  service.editHymn(id, input({ songCategory: 'Category A' }));
  assert.deepEqual(service.getHymn(id).categories, ['Category A', 'Category B']);
});

test('a song saved before the list existed keeps its one category and is found under it', () => {
  const { db, migrate, service } = setup({ filing: false });
  db.prepare("INSERT INTO hymns (title, category, language, song_category) VALUES ('Sample Song', 'General', 'EN', 'Category A')").run();
  migrate();
  const s = service();
  assert.deepEqual(s.listHymns({ songCategory: 'Category A' }).map((h) => h.categories), [['Category A']]);
  assert.equal(s.listHymns({})[0].fontScale, 1);
});

test('renaming a category renames it inside every song list that has it', () => {
  const { categories, service: make } = setup();
  const service = make();
  const { id } = service.createHymn(input({ categories: ['Category A', 'Category B'] }));
  const b = categories.listSongCategories().find((c) => c.name === 'Category B');
  categories.renameSongCategory(b.id, { name: 'Category B2' });
  assert.deepEqual(service.getHymn(id).categories, ['Category A', 'Category B2']);
  assert.deepEqual(titles(service, 'Category B2'), ['Sample Song']);
  assert.deepEqual(titles(service, 'Category B'), []);
});

test('a category removed from the list stays on the songs that carry it, so their other details can still be saved', () => {
  const { categories, service: make } = setup();
  const service = make();
  const { id } = service.createHymn(input({ categories: ['Category A', 'Category B'] }));
  categories.deleteSongCategory(categories.listSongCategories().find((c) => c.name === 'Category B').id);
  service.editHymn(id, input({ title: 'Sample Song Renamed', categories: ['Category A', 'Category B'] }));
  assert.deepEqual(service.getHymn(id).categories, ['Category A', 'Category B']);
});

test('the font scale is saved, read back, clamped, and kept by an edit that does not send it', () => {
  const service = setup().service();
  for (const scale of [0.8, 1, 1.15, 1.3, 1.5]) {
    const { id } = service.createHymn(input({ title: `Sample Song ${scale}`, songCategory: 'Category A', fontScale: scale }));
    assert.equal(service.getHymn(id).fontScale, scale);
  }
  const { id } = service.createHymn(input({ songCategory: 'Category A' }));
  assert.equal(service.getHymn(id).fontScale, 1);
  service.editHymn(id, input({ songCategory: 'Category A', fontScale: 1.25 }));
  assert.equal(service.getHymn(id).fontScale, 1.25);
  service.editHymn(id, input({ songCategory: 'Category A', title: 'Sample Song Edited' }));
  assert.equal(service.getHymn(id).fontScale, 1.25);
  service.editHymn(id, input({ songCategory: 'Category A', fontScale: 7 }));
  assert.equal(service.getHymn(id).fontScale, 1.5);
  assert.equal(service.listHymns({}).find((h) => h.id === id).fontScale, 1.5);
});

test('changing the words on air keeps the song categories and font size', () => {
  const service = setup().service();
  const { id } = service.createHymn(input({ categories: ['Category A', 'Category C'], fontScale: 1.2 }));
  service.editLyrics(id, '[Verse 1]\nSample line 9');
  const hymn = service.getHymn(id);
  assert.deepEqual(hymn.categories, ['Category A', 'Category C']);
  assert.equal(hymn.fontScale, 1.2);
  assert.equal(hymn.stanzas[0].lyricsText, 'Sample line 9');
});

test('the batch save files every song under all the chosen categories', () => {
  const service = setup().service();
  const results = service.createHymns([input({ title: 'Sample Song 1', songCategory: 'Category A', categories: ['Category A', 'Category B'] }), input({ title: 'Sample Song 2', songCategory: 'Category A', categories: ['Category A', 'Category B'] })]);
  assert.ok(results.every((r) => r.id));
  assert.deepEqual(titles(service, 'Category B'), ['Sample Song 1', 'Sample Song 2']);
});

test('saving from the Edit Hymn form tells every window, and the song reads back with its new words, categories and font size', () => {
  const { db } = setup();
  const changed = [];
  const service = createLyricsService(db, { onLyricsChanged: (id) => changed.push(id) });
  const { id } = service.createHymn(input({ songCategory: 'Category A' }));
  changed.length = 0;
  service.editHymn(id, input({ categories: ['Category A', 'Category B'], fontScale: 1.3, raw: '[Verse 1]\nSample lyric line 1\n\n[Chorus]\nSample lyric line 2' }));
  assert.deepEqual(changed, [id]);
  const hymn = service.getHymn(id);
  assert.deepEqual(hymn.categories, ['Category A', 'Category B']);
  assert.equal(hymn.fontScale, 1.3);
  assert.deepEqual(hymn.stanzas.map((s) => [s.stanzaType, s.lyricsText]), [['Verse 1', 'Sample lyric line 1'], ['Chorus', 'Sample lyric line 2']]);
});

test('two categories added back to back save at once, keep their scope, and wake no sync or window broadcast', () => {
  const { db } = setup();
  const hooks = [];
  // The same hooks the app wires to the cloud song sync and to every window. A category change must call neither.
  const service = createLyricsService(db, { onHymnChanged: () => hooks.push('sync'), onLyricsChanged: () => hooks.push('broadcast') });
  const started = performance.now();
  const a = service.createSongCategory({ name: 'Sample Category A', targetMode: 'HOLY_MASS' });
  const b = service.createSongCategory({ name: 'Sample Category B', targetMode: 'PRAISE_AND_WORSHIP' });
  const c = service.createSongCategory({ name: 'Sample Category C' });
  // Local SQLite writes only: well under any network timeout, even on a slow test machine.
  assert.ok(performance.now() - started < 500, 'saved without waiting on anything');
  assert.deepEqual(hooks, []);
  assert.deepEqual([a, b, c].map((x) => [x.name, x.targetMode]), [['Sample Category A', 'HOLY_MASS'], ['Sample Category B', 'PRAISE_AND_WORSHIP'], ['Sample Category C', 'ALL']]);
  const saved = service.listSongCategories().filter((x) => x.name.startsWith('Sample Category'));
  assert.deepEqual(saved.map((x) => [x.name, x.targetMode]), [['Sample Category A', 'HOLY_MASS'], ['Sample Category B', 'PRAISE_AND_WORSHIP'], ['Sample Category C', 'ALL']]);
  // A rename and a remove are local too.
  service.renameSongCategory(a.id, { name: 'Sample Category A2' });
  service.deleteSongCategory(b.id);
  assert.deepEqual(hooks, []);
});

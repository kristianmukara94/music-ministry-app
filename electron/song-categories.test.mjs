// Tests for the song category service. Run with: node --test electron/song-categories.test.mjs
// Uses Node's built-in SQLite, so no Electron is needed. The hymns table here has only the columns the service touches,
// and the real migrations from song-categories.js are applied to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SONG_CATEGORY_MIGRATIONS, SONG_CATEGORY_MAX, SONG_CATEGORY_MODE_MIGRATIONS, SONG_SCOPE_MIGRATIONS, createSongCategoryService, resolveSongCategory } from './song-categories.js';
import { SONG_CATEGORY_NAMES } from '../shared/mass-flow.js';

// The service calls db.transaction(fn), which node:sqlite does not have. This adds it, as better-sqlite3 does.
function openDatabase() {
  const db = new DatabaseSync(':memory:');
  const wrapped = {
    prepare: (sql) => db.prepare(sql),
    exec: (sql) => db.exec(sql),
    transaction: (fn) => (...args) => {
      db.exec('BEGIN');
      try {
        const result = fn(...args);
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
  // The hymns table as the app has it before this change, with a hymn already in it.
  db.exec(`
    CREATE TABLE hymns (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      title    TEXT NOT NULL,
      category TEXT NOT NULL
    );
    INSERT INTO hymns (title, category) VALUES ('Existing hymn', 'General');
  `);
  for (const sql of [...SONG_CATEGORY_MIGRATIONS, ...SONG_CATEGORY_MODE_MIGRATIONS]) db.exec(sql);
  return wrapped;
}

const hymnSongCategory = (db, title) => db.prepare('SELECT song_category AS songCategory FROM hymns WHERE title = ?').get(title)?.songCategory;

test('migrations add the column without touching existing hymns, and seed the Mass song categories', () => {
  const db = openDatabase();
  assert.equal(hymnSongCategory(db, 'Existing hymn'), '');
  const names = createSongCategoryService(db).listSongCategories().map((c) => c.name);
  assert.deepEqual(names, SONG_CATEGORY_NAMES);
});

test('create adds a category at the end, with the name trimmed', () => {
  const service = createSongCategoryService(openDatabase());
  const added = service.createSongCategory({ name: '  Psalm Refrain  ' });
  assert.equal(added.name, 'Psalm Refrain');
  assert.equal(added.position, SONG_CATEGORY_NAMES.length + 1);
  assert.ok(added.id > 0);
  const list = service.listSongCategories();
  assert.equal(list.at(-1).name, 'Psalm Refrain');
});

test('create refuses a duplicate name, whatever the letter case', () => {
  const service = createSongCategoryService(openDatabase());
  assert.throws(() => service.createSongCategory({ name: 'kyrie' }), /already exists/);
  assert.throws(() => service.createSongCategory({ name: 'KYRIE' }), /already exists/);
  assert.equal(service.listSongCategories().length, SONG_CATEGORY_NAMES.length);
});

test('names must be 1 to 40 characters after trimming', () => {
  const service = createSongCategoryService(openDatabase());
  assert.throws(() => service.createSongCategory({ name: '' }), /1 to 40 characters/);
  assert.throws(() => service.createSongCategory({ name: '   ' }), /1 to 40 characters/);
  assert.throws(() => service.createSongCategory({ name: 'x'.repeat(SONG_CATEGORY_MAX + 1) }), /1 to 40 characters/);
  assert.equal(service.createSongCategory({ name: 'x'.repeat(SONG_CATEGORY_MAX) }).name.length, SONG_CATEGORY_MAX);
  assert.throws(() => service.createSongCategory({}), /1 to 40 characters/);
});

test('rename changes the category and the hymns that use it', () => {
  const db = openDatabase();
  const service = createSongCategoryService(db);
  db.prepare("INSERT INTO hymns (title, category, song_category) VALUES ('Kyrie song', 'General', 'Kyrie')").run();
  const kyrie = service.listSongCategories().find((c) => c.name === 'Kyrie');
  const renamed = service.renameSongCategory(kyrie.id, { name: 'Lord, Have Mercy' });
  assert.equal(renamed.name, 'Lord, Have Mercy');
  assert.equal(renamed.position, kyrie.position);
  assert.equal(hymnSongCategory(db, 'Kyrie song'), 'Lord, Have Mercy');
  assert.equal(hymnSongCategory(db, 'Existing hymn'), '', 'hymns without the category are untouched');
});

test('rename can change only the letter case of its own name', () => {
  const service = createSongCategoryService(openDatabase());
  const kyrie = service.listSongCategories().find((c) => c.name === 'Kyrie');
  assert.equal(service.renameSongCategory(kyrie.id, { name: 'KYRIE' }).name, 'KYRIE');
});

test('rename refuses a name another category already has, and changes nothing', () => {
  const db = openDatabase();
  const service = createSongCategoryService(db);
  db.prepare("INSERT INTO hymns (title, category, song_category) VALUES ('Kyrie song', 'General', 'Kyrie')").run();
  const kyrie = service.listSongCategories().find((c) => c.name === 'Kyrie');
  assert.throws(() => service.renameSongCategory(kyrie.id, { name: 'gloria' }), /already exists/);
  assert.equal(service.listSongCategories().find((c) => c.id === kyrie.id).name, 'Kyrie');
  assert.equal(hymnSongCategory(db, 'Kyrie song'), 'Kyrie');
});

test('rename and delete refuse an id that is not on the list', () => {
  const service = createSongCategoryService(openDatabase());
  assert.throws(() => service.renameSongCategory(9999, { name: 'Anything' }), /no longer exists/);
  assert.equal(service.deleteSongCategory(9999), false);
});

test('delete removes the category, and hymns that used it keep their text', () => {
  const db = openDatabase();
  const service = createSongCategoryService(db);
  db.prepare("INSERT INTO hymns (title, category, song_category) VALUES ('Gloria song', 'General', 'Gloria')").run();
  const gloria = service.listSongCategories().find((c) => c.name === 'Gloria');
  assert.equal(service.deleteSongCategory(gloria.id), true);
  assert.ok(!service.listSongCategories().some((c) => c.name === 'Gloria'));
  assert.equal(hymnSongCategory(db, 'Gloria song'), 'Gloria');
});

test('a name is resolved to the list spelling, and an unlisted name is refused with a readable message', () => {
  const db = openDatabase();
  assert.equal(resolveSongCategory(db, 'kyrie'), 'Kyrie');
  assert.equal(resolveSongCategory(db, '  Our Father  '), 'Our Father');
  assert.equal(resolveSongCategory(db, ''), '');
  assert.equal(resolveSongCategory(db, undefined), '');
  assert.throws(() => resolveSongCategory(db, 'Not a category'), /"Not a category" is not in the song categories/);
});

test('the target mode migration keeps shipped categories where they were and makes the operator\'s own All', () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE hymns (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, category TEXT NOT NULL)");
  for (const sql of [...SONG_CATEGORY_MIGRATIONS, ...SONG_SCOPE_MIGRATIONS]) db.exec(sql);
  // A category the operator added before target modes existed.
  db.prepare("INSERT INTO song_categories (name, position) VALUES ('Youth Night', 999)").run();
  for (const sql of SONG_CATEGORY_MODE_MIGRATIONS) db.exec(sql);
  const mode = (name) => db.prepare('SELECT target_mode AS m FROM song_categories WHERE name = ?').get(name).m;
  assert.equal(mode('Gloria'), 'HOLY_MASS');
  assert.equal(mode('Marian Song'), 'HOLY_MASS');
  assert.equal(mode('Joyful Song'), 'PRAISE_AND_WORSHIP');
  assert.equal(mode('Repentance Song'), 'ALL', 'a theme for both scopes is All');
  assert.equal(mode('Youth Night'), 'ALL');
  assert.throws(() => db.prepare("UPDATE song_categories SET target_mode = 'MASS' WHERE name = 'Gloria'").run(), /CHECK/);
});

test('create stores the chosen target mode, defaults to All, and refuses an unknown one', () => {
  const service = createSongCategoryService(openDatabase());
  assert.equal(service.createSongCategory({ name: 'Youth Night', targetMode: 'PRAISE_AND_WORSHIP' }).targetMode, 'PRAISE_AND_WORSHIP');
  assert.equal(service.createSongCategory({ name: 'Anything' }).targetMode, 'ALL');
  assert.throws(() => service.createSongCategory({ name: 'Bad', targetMode: 'MASS' }), /Holy Mass, Praise & Worship or All/);
  const list = service.listSongCategories();
  assert.equal(list.find((c) => c.name === 'Youth Night').targetMode, 'PRAISE_AND_WORSHIP');
  assert.ok(!list.some((c) => c.name === 'Bad'));
});

test('editing a category can change its target mode, and leaving it out keeps the one it has', () => {
  const db = openDatabase();
  const service = createSongCategoryService(db);
  db.prepare("INSERT INTO hymns (title, category, song_category) VALUES ('Kyrie song', 'General', 'Kyrie')").run();
  const kyrie = service.listSongCategories().find((c) => c.name === 'Kyrie');
  assert.equal(kyrie.targetMode, 'HOLY_MASS');
  assert.equal(service.renameSongCategory(kyrie.id, { name: 'Kyrie', targetMode: 'ALL' }).targetMode, 'ALL');
  assert.equal(service.renameSongCategory(kyrie.id, { name: 'Lord, Have Mercy' }).targetMode, 'ALL');
  assert.equal(hymnSongCategory(db, 'Kyrie song'), 'Lord, Have Mercy');
  assert.equal(service.renameSongCategory(kyrie.id, { targetMode: 'PRAISE_AND_WORSHIP' }).name, 'Lord, Have Mercy', 'a mode-only change keeps the name');
  assert.throws(() => service.renameSongCategory(kyrie.id, { name: 'Kyrie', targetMode: 'BOTH' }), /Holy Mass, Praise & Worship or All/);
  assert.equal(service.listSongCategories().find((c) => c.id === kyrie.id).targetMode, 'PRAISE_AND_WORSHIP');
});

test('a hymn keeps its current category even when the list no longer has it', () => {
  const db = openDatabase();
  assert.equal(resolveSongCategory(db, 'Retired', 'Retired'), 'Retired');
  assert.throws(() => resolveSongCategory(db, 'Retired', 'Something else'), /not in the song categories/);
});

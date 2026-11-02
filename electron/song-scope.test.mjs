// Song scopes (General, Mass, Praise & Worship) in the database: the migration's backfill and seeded themes, saving a scope, and the library
// filter that keeps Mass and Praise & Worship songs apart. Run with: node --test electron/song-scope.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { HYMN_DELETE_MIGRATIONS, LYRICS_MIGRATIONS, LYRICS_STYLE_MIGRATIONS, createLyricsService } = await import('./lyrics.js');
const { MASS_PLAN_MIGRATIONS, PLAN_BIBLE_MIGRATIONS, PLAN_COMMUNION_MIGRATIONS, PLAN_CUSTOM_MIGRATIONS, PLAN_NOTES_MIGRATIONS } = await import('./mass-plans.js');
const { PW_MIGRATIONS } = await import('./pw-sessions.js');
const { SONG_CATEGORY_MIGRATIONS, SONG_SCOPE_MIGRATIONS, createSongCategoryService } = await import('./song-categories.js');
const { TRANSFER_MIGRATIONS } = await import('./transfer.js');
const { PLAN_SYNC_MIGRATIONS } = await import('./plan-sync-schema.js');
const { THEME_NAMES } = await import('../shared/song-taxonomy.js');

const BEFORE_SCOPE = [...LYRICS_MIGRATIONS, ...LYRICS_STYLE_MIGRATIONS, ...HYMN_DELETE_MIGRATIONS, ...MASS_PLAN_MIGRATIONS, ...PLAN_BIBLE_MIGRATIONS,
  ...PLAN_CUSTOM_MIGRATIONS, ...PLAN_NOTES_MIGRATIONS, ...PW_MIGRATIONS, ...PLAN_COMMUNION_MIGRATIONS, ...SONG_CATEGORY_MIGRATIONS];
const AFTER_SCOPE = [...TRANSFER_MIGRATIONS, ...PLAN_SYNC_MIGRATIONS];

function open() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
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
  return db;
}

const HYMN = { title: 'A song', composer: '', category: 'General', language: 'EN', musicalKey: '', songCategory: 'Joyful Song', raw: 'First line\n\nSecond line' };

function setup() {
  const db = open();
  for (const sql of [...BEFORE_SCOPE, ...SONG_SCOPE_MIGRATIONS, ...AFTER_SCOPE]) db.exec(sql);
  return { db, service: createLyricsService(db) };
}

test('the migration files an old library: Mass parts and Mass slots become Mass, everything else General, and nothing is lost', () => {
  const db = open();
  for (const sql of BEFORE_SCOPE) db.exec(sql);
  const add = db.prepare("INSERT INTO hymns (title, composer, category, language, musical_key, song_category) VALUES (?, '', ?, 'EN', '', ?)");
  add.run('Entrance by part', 'General', 'Entrance Procession');
  add.run('Entrance by slot', 'Recessional', '');
  add.run('Plain song', 'General', '');
  add.run('Custom category', 'General', 'Youth Night');
  for (const sql of SONG_SCOPE_MIGRATIONS) db.exec(sql);
  const scopeOf = (title) => db.prepare('SELECT primary_category AS p FROM hymns WHERE title = ?').get(title).p;
  assert.equal(scopeOf('Entrance by part'), 'MASS');
  assert.equal(scopeOf('Entrance by slot'), 'MASS');
  assert.equal(scopeOf('Plain song'), 'GENERAL');
  assert.equal(scopeOf('Custom category'), 'GENERAL');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM hymns').get().n, 4);
});

test('the migration adds the themes to the category list once, after the existing ones, and never twice', () => {
  const db = open();
  for (const sql of BEFORE_SCOPE) db.exec(sql);
  const before = db.prepare('SELECT COUNT(*) AS n, MAX(position) AS top FROM song_categories').get();
  // An operator who already made "marian song" keeps theirs, in their own spelling.
  createSongCategoryService(db).createSongCategory({ name: 'marian song' });
  for (const sql of SONG_SCOPE_MIGRATIONS) db.exec(sql);
  const names = db.prepare('SELECT name FROM song_categories ORDER BY position').all().map((r) => r.name);
  for (const theme of THEME_NAMES) assert.equal(names.filter((n) => n.toLowerCase() === theme.toLowerCase()).length, 1, theme);
  assert.ok(names.includes('marian song'));
  assert.equal(names.length, before.n + THEME_NAMES.length);
  assert.ok(db.prepare('SELECT position FROM song_categories WHERE name = ?').get('Joyful Song').position > before.top);
});

test('a song is saved with its scope, a missing scope means General, and anything else is refused with nothing written', () => {
  const { db, service } = setup();
  const id = service.createHymn({ ...HYMN, primaryCategory: 'MASS' }).id;
  assert.equal(service.getHymn(id).primaryCategory, 'MASS');
  assert.equal(service.getHymn(service.createHymn({ ...HYMN, title: 'No scope sent' }).id).primaryCategory, 'GENERAL');
  const before = db.prepare('SELECT COUNT(*) AS n FROM hymns').get().n;
  assert.throws(() => service.createHymn({ ...HYMN, title: 'Bad', primaryCategory: 'CHOIR' }), /Primary category/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM hymns').get().n, before);
  service.editHymn(id, { ...HYMN, primaryCategory: 'PRAISE_AND_WORSHIP' });
  assert.equal(service.getHymn(id).primaryCategory, 'PRAISE_AND_WORSHIP', 'an edit changes the scope');
});

test('the Mass filter leaves Praise & Worship songs out, the Praise & Worship filter leaves Mass out, and General shows everything', () => {
  const { service } = setup();
  const make = (title, primaryCategory) => service.createHymn({ ...HYMN, title, primaryCategory });
  make('Mass song', 'MASS');
  make('Worship song', 'PRAISE_AND_WORSHIP');
  make('Any-time song', 'GENERAL');
  const titles = (filter) => service.listHymns(filter).map((h) => h.title).sort();
  assert.deepEqual(titles({ primaryCategory: 'MASS' }), ['Any-time song', 'Mass song']);
  assert.deepEqual(titles({ primaryCategory: 'PRAISE_AND_WORSHIP' }), ['Any-time song', 'Worship song']);
  assert.deepEqual(titles({ primaryCategory: 'GENERAL' }), ['Any-time song', 'Mass song', 'Worship song']);
  assert.deepEqual(titles({}), ['Any-time song', 'Mass song', 'Worship song'], 'no scope limits nothing');
  assert.deepEqual(titles({ primaryCategory: 'NOT_A_SCOPE' }), ['Any-time song', 'Mass song', 'Worship song'], 'an unknown scope limits nothing');
});

test('the scope combines with the search and the song category', () => {
  const { service } = setup();
  const make = (title, primaryCategory, songCategory) => service.createHymn({ ...HYMN, title, primaryCategory, songCategory });
  make('Ave Maria', 'MASS', 'Marian Song');
  make('Ave Joy', 'PRAISE_AND_WORSHIP', 'Joyful Song');
  make('Joyful Mass', 'MASS', 'Joyful Song');
  const titles = (filter) => service.listHymns(filter).map((h) => h.title).sort();
  assert.deepEqual(titles({ primaryCategory: 'MASS', search: 'Ave' }), ['Ave Maria']);
  assert.deepEqual(titles({ primaryCategory: 'MASS', songCategory: 'Joyful Song' }), ['Joyful Mass']);
  assert.deepEqual(titles({ primaryCategory: 'PRAISE_AND_WORSHIP', songCategory: 'Marian Song' }), []);
});

test('the list and the open song carry the scope', () => {
  const { service } = setup();
  const { id } = service.createHymn({ ...HYMN, primaryCategory: 'MASS' });
  assert.equal(service.listHymns({}).find((h) => h.id === id).primaryCategory, 'MASS');
  assert.equal(service.getHymn(id).primaryCategory, 'MASS');
});

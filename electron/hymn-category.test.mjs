// Tests that a hymn cannot be saved without a song category, in the service, so a save is refused even if the form's check is bypassed.
// Refused saves write nothing. The laptop's schema is real and in memory. Run with: node --test electron/hymn-category.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { HYMN_DELETE_MIGRATIONS, LYRICS_MIGRATIONS, LYRICS_STYLE_MIGRATIONS, createLyricsService } = await import('./lyrics.js');
const { MASS_PLAN_MIGRATIONS, PLAN_BIBLE_MIGRATIONS, PLAN_COMMUNION_MIGRATIONS, PLAN_CUSTOM_MIGRATIONS, PLAN_NOTES_MIGRATIONS } = await import('./mass-plans.js');
const { PW_MIGRATIONS } = await import('./pw-sessions.js');
const { SONG_CATEGORY_MIGRATIONS, createSongCategoryService } = await import('./song-categories.js');
const { TRANSFER_MIGRATIONS } = await import('./transfer.js');
const { PLAN_SYNC_MIGRATIONS } = await import('./plan-sync-schema.js');
const { SONG_CATEGORY_REQUIRED_EN } = await import('../shared/hymn-category.js');

function laptopDb() {
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
  for (const sqlText of [...LYRICS_MIGRATIONS, ...LYRICS_STYLE_MIGRATIONS, ...HYMN_DELETE_MIGRATIONS, ...MASS_PLAN_MIGRATIONS, ...PLAN_BIBLE_MIGRATIONS,
    ...PLAN_CUSTOM_MIGRATIONS, ...PLAN_NOTES_MIGRATIONS, ...PW_MIGRATIONS, ...PLAN_COMMUNION_MIGRATIONS, ...SONG_CATEGORY_MIGRATIONS, ...TRANSFER_MIGRATIONS, ...PLAN_SYNC_MIGRATIONS]) {
    db.exec(sqlText);
  }
  return db;
}

function setup() {
  const db = laptopDb();
  createSongCategoryService(db).createSongCategory({ name: 'Entrance' });
  return { db, service: createLyricsService(db) };
}

const counts = (db) => ({
  hymns: db.prepare('SELECT COUNT(*) AS n FROM hymns').get().n,
  stanzas: db.prepare('SELECT COUNT(*) AS n FROM hymn_stanzas').get().n,
});
const HYMN = { title: 'Praise the Lord', composer: '', category: 'General', language: 'EN', musicalKey: 'G', raw: 'First line\n\nSecond line' };

test('saving a new hymn with no song category is refused with the plain message, and nothing is written', () => {
  const { db, service } = setup();
  const before = counts(db);
  assert.throws(() => service.createHymn({ ...HYMN, songCategory: '' }), (err) => err.message === SONG_CATEGORY_REQUIRED_EN);
  assert.throws(() => service.createHymn({ ...HYMN }), (err) => err.message === SONG_CATEGORY_REQUIRED_EN, 'a missing value is refused too');
  assert.throws(() => service.createHymn({ ...HYMN, songCategory: '   ' }), (err) => err.message === SONG_CATEGORY_REQUIRED_EN, 'blank counts as none');
  assert.deepEqual(counts(db), before, 'no hymn and no stanza was written');
});

test('saving a new hymn with a song category succeeds', () => {
  const { db, service } = setup();
  const { id } = service.createHymn({ ...HYMN, songCategory: 'Entrance' });
  assert.equal(db.prepare('SELECT song_category FROM hymns WHERE id = ?').get(id).song_category, 'Entrance');
  assert.equal(counts(db).stanzas, 2);
});

test('editing a hymn to have no song category is refused, and the saved hymn is unchanged', () => {
  const { db, service } = setup();
  const { id } = service.createHymn({ ...HYMN, songCategory: 'Entrance' });
  const before = db.prepare('SELECT title, song_category FROM hymns WHERE id = ?').get(id);
  const stanzasBefore = counts(db).stanzas;
  assert.throws(() => service.editHymn(id, { ...HYMN, title: 'Changed title', songCategory: '' }), (err) => err.message === SONG_CATEGORY_REQUIRED_EN);
  assert.deepEqual(db.prepare('SELECT title, song_category FROM hymns WHERE id = ?').get(id), before, 'the title and category are as they were');
  assert.equal(counts(db).stanzas, stanzasBefore, 'the lyrics are as they were');
});

test('editing an existing hymn that has no song category is refused until one is chosen', () => {
  const { db, service } = setup();
  // A hymn saved before this rule, with no category.
  const legacy = Number(db.prepare("INSERT INTO hymns (title, composer, category, language, musical_key, song_category) VALUES ('Old hymn', '', 'General', 'EN', '', '')").run().lastInsertRowid);
  assert.throws(() => service.editHymn(legacy, { ...HYMN, title: 'Old hymn, edited', songCategory: '' }), (err) => err.message === SONG_CATEGORY_REQUIRED_EN);
  assert.equal(db.prepare('SELECT title FROM hymns WHERE id = ?').get(legacy).title, 'Old hymn', 'the old title is kept');
  service.editHymn(legacy, { ...HYMN, title: 'Old hymn, edited', songCategory: 'Entrance' });
  assert.equal(db.prepare('SELECT title, song_category FROM hymns WHERE id = ?').get(legacy).song_category, 'Entrance', 'once a category is chosen, the edit saves');
});

test('the refusal is the same English message the form recognises, so the form can show its translated prompt', () => {
  assert.equal(SONG_CATEGORY_REQUIRED_EN, 'Choose a song category before saving.');
});

// The song category filter is strict: one chosen category lists only the songs filed under exactly that category, and the page code that
// asks for it behaves as promised. Run with: node --test electron/song-category-filter.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { HYMN_DELETE_MIGRATIONS, LYRICS_MIGRATIONS, LYRICS_STYLE_MIGRATIONS, createLyricsService } = await import('./lyrics.js');
const { MASS_PLAN_MIGRATIONS, PLAN_BIBLE_MIGRATIONS, PLAN_COMMUNION_MIGRATIONS, PLAN_CUSTOM_MIGRATIONS, PLAN_LANGUAGE_MIGRATIONS, PLAN_NOTES_MIGRATIONS } = await import('./mass-plans.js');
const { PW_MIGRATIONS } = await import('./pw-sessions.js');
const { SONG_CATEGORY_MIGRATIONS, SONG_CATEGORY_MODE_MIGRATIONS, SONG_SCOPE_MIGRATIONS, createSongCategoryService } = await import('./song-categories.js');
const { TRANSFER_MIGRATIONS } = await import('./transfer.js');
const { PLAN_SYNC_MIGRATIONS } = await import('./plan-sync-schema.js');

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

function setup() {
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
  for (const sql of [...LYRICS_MIGRATIONS, ...LYRICS_STYLE_MIGRATIONS, ...HYMN_DELETE_MIGRATIONS, ...MASS_PLAN_MIGRATIONS, ...PLAN_LANGUAGE_MIGRATIONS, ...PLAN_BIBLE_MIGRATIONS,
    ...PLAN_CUSTOM_MIGRATIONS, ...PLAN_NOTES_MIGRATIONS, ...PW_MIGRATIONS, ...PLAN_COMMUNION_MIGRATIONS, ...SONG_CATEGORY_MIGRATIONS, ...SONG_SCOPE_MIGRATIONS, ...SONG_CATEGORY_MODE_MIGRATIONS,
    ...TRANSFER_MIGRATIONS, ...PLAN_SYNC_MIGRATIONS]) {
    db.exec(sql);
  }
  // Two names where one is the start of the other, to prove the match is of the whole name.
  createSongCategoryService(db).createSongCategory({ name: 'Worship' });
  const service = createLyricsService(db);
  const make = (title, songCategory, extra = {}) =>
    service.createHymn({ title, composer: '', language: 'EN', musicalKey: '', raw: 'A line of words', primaryCategory: 'GENERAL', songCategory, ...extra });
  make('Healing one', 'Healing Song');
  make('Healing two', 'Healing Song');
  make('Worship one', 'Worship Song');
  make('Worship short', 'Worship');
  make('Marian one', 'Marian Song');
  make('Joyful one', 'Joyful Song', { language: 'TL' });
  return { service };
}

const titles = (service, filter) => service.listHymns(filter).map((h) => h.title).sort();

test('one chosen category lists only the songs filed under exactly that category', () => {
  const { service } = setup();
  assert.deepEqual(titles(service, { songCategory: 'Healing Song' }), ['Healing one', 'Healing two']);
  assert.deepEqual(titles(service, { songCategory: 'Marian Song' }), ['Marian one']);
  assert.ok(service.listHymns({ songCategory: 'Healing Song' }).every((h) => h.songCategory === 'Healing Song'));
});

test('the match is of the whole name: a category that begins another one does not bring the other in', () => {
  const { service } = setup();
  assert.deepEqual(titles(service, { songCategory: 'Worship' }), ['Worship short']);
  assert.deepEqual(titles(service, { songCategory: 'Worship Song' }), ['Worship one']);
  assert.deepEqual(titles(service, { songCategory: 'Heal' }), [], 'a part of a name matches nothing');
  assert.deepEqual(titles(service, { songCategory: '%' }), [], 'a wildcard is just a character');
});

test('letter case and spaces around the name do not matter, and an unknown category lists nothing', () => {
  const { service } = setup();
  assert.deepEqual(titles(service, { songCategory: 'healing song' }), ['Healing one', 'Healing two']);
  assert.deepEqual(titles(service, { songCategory: '  HEALING SONG ' }), ['Healing one', 'Healing two']);
  assert.deepEqual(titles(service, { songCategory: 'Not a category' }), []);
});

test('no category, a blank one or nothing lists every song', () => {
  const { service } = setup();
  const all = ['Healing one', 'Healing two', 'Joyful one', 'Marian one', 'Worship one', 'Worship short'];
  assert.deepEqual(titles(service, {}), all);
  assert.deepEqual(titles(service, { songCategory: '' }), all);
  assert.deepEqual(titles(service, { songCategory: '   ' }), all);
  assert.deepEqual(titles(service, { songCategory: undefined }), all);
});

test('the category narrows the search and the language, and never widens them', () => {
  const { service } = setup();
  assert.deepEqual(titles(service, { songCategory: 'Healing Song', search: 'two' }), ['Healing two']);
  assert.deepEqual(titles(service, { songCategory: 'Healing Song', search: 'Worship' }), []);
  assert.deepEqual(titles(service, { songCategory: 'Joyful Song', language: 'TL' }), ['Joyful one']);
  assert.deepEqual(titles(service, { songCategory: 'Joyful Song', language: 'EN' }), []);
});

test('the filter bar: one category option means an exact request, the list is fetched at once and kept until the new one arrives', () => {
  const hook = read('src/lyrics/useSongFilter.ts');
  assert.match(hook, /state\.songCategory\.trim\(\) && state\.songCategory !== ALL_CATEGORIES \? state\.songCategory\.trim\(\) : undefined/);
  assert.match(hook, /typing \? SEARCH_DELAY_MS : 0/, 'a dropdown change is not delayed');
  assert.doesNotMatch(hook, /setHymns\(\[\]\)/, 'the old list is not blanked while the new one loads');
});

test('the bar shows a live count, a Clear filters button only while a filter is on, and the list goes back to its top', () => {
  const bar = read('src/lyrics/SongFilterBar.tsx');
  assert.match(bar, /role="status"/);
  assert.match(bar, /categoryCount/);
  assert.match(bar, /\{filter\.narrowed && \(/);
  assert.match(bar, /onClick=\{filter\.clearFilters\}/);
  const page = read('src/lyrics/SongLyrics.tsx');
  assert.match(page, /<SongFilterBar filter=\{filter\} t=\{t\} \/>/);
  assert.match(page, /scrollTo\(\{ top: 0 \}\)/);
  assert.match(page, /\[filter\.scope, filter\.songCategory, filter\.language\]/);
  assert.match(read('src/lyrics/CategorySelectGroup.tsx'), /mode === 'filter' \?[\s\S]*?byScope\.map/, 'a filter lists the categories grouped under their scope');
});

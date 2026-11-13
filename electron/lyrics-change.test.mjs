// Tests that a song change in Song Lyrics is announced to the windows that read the song: a create, edit, delete, undo, or style change.
// The planners reload the song on that announcement, so the new lyrics show without a restart. A deleted song leaves the library
// lists, and a recycled one is gone for good. The laptop's schema is real and in memory. Run with: node --test electron/lyrics-change.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { HYMN_DELETE_MIGRATIONS, LYRICS_MIGRATIONS, LYRICS_STYLE_MIGRATIONS, createLyricsService, purgeDeletedHymns } = await import('./lyrics.js');
const { MASS_PLAN_MIGRATIONS, PLAN_BIBLE_MIGRATIONS, PLAN_COMMUNION_MIGRATIONS, PLAN_CUSTOM_MIGRATIONS, PLAN_LANGUAGE_MIGRATIONS, PLAN_NOTES_MIGRATIONS } = await import('./mass-plans.js');
const { PW_MIGRATIONS } = await import('./pw-sessions.js');
const { SONG_CATEGORY_MIGRATIONS, SONG_CATEGORY_MODE_MIGRATIONS, SONG_SCOPE_MIGRATIONS, createSongCategoryService } = await import('./song-categories.js');
const { TRANSFER_MIGRATIONS } = await import('./transfer.js');
const { PLAN_SYNC_MIGRATIONS } = await import('./plan-sync-schema.js');
const { LECTIONARY_MIGRATIONS } = await import('./lectionary.js');
const { MEDIA_MIGRATIONS } = await import('./media.js');
const { BIBLE_MIGRATIONS } = await import('./bible-seed.js');
const { PRAYER_NOTES_MIGRATIONS } = await import('./notes.js');

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
  for (const sqlText of [...LYRICS_MIGRATIONS, ...LYRICS_STYLE_MIGRATIONS, ...HYMN_DELETE_MIGRATIONS, ...MASS_PLAN_MIGRATIONS, ...PLAN_LANGUAGE_MIGRATIONS, ...PLAN_BIBLE_MIGRATIONS,
    ...PLAN_CUSTOM_MIGRATIONS, ...PLAN_NOTES_MIGRATIONS, ...PW_MIGRATIONS, ...PLAN_COMMUNION_MIGRATIONS, ...SONG_CATEGORY_MIGRATIONS, ...SONG_SCOPE_MIGRATIONS, ...SONG_CATEGORY_MODE_MIGRATIONS, ...TRANSFER_MIGRATIONS, ...PLAN_SYNC_MIGRATIONS,
    ...LECTIONARY_MIGRATIONS, ...MEDIA_MIGRATIONS, ...BIBLE_MIGRATIONS, ...PRAYER_NOTES_MIGRATIONS]) {
    db.exec(sqlText);
  }
  db.exec('CREATE TABLE IF NOT EXISTS announcement_slides (id INTEGER PRIMARY KEY)');
  return db;
}

const hymn = (title, raw = `${title}, first line\n\nSecond line of ${title}`) => ({ title, composer: '', category: 'General', songCategory: 'General', language: 'EN', musicalKey: 'G', raw });

/** A library with one category and a service that records every announcement, and every cloud-sync call, for the test to read. */
function library(overrides = {}) {
  const db = laptopDb();
  createSongCategoryService(db).createSongCategory({ name: 'General' });
  const announced = [];
  const synced = [];
  const service = createLyricsService(db, {
    onHymnChanged: () => synced.push(true),
    onLyricsChanged: (id) => announced.push(id),
    ...overrides,
  });
  return { db, service, announced, synced };
}

const lyricsOf = (hymnRow) => hymnRow.stanzas.map((s) => s.lyricsText).join('\n');

test('a created song is announced by its id', () => {
  const { service, announced } = library();
  const { id } = service.createHymn(hymn('New song'));
  assert.deepEqual(announced, [id]);
});

test('an edit is announced, and the planners read the new lyrics from the library', () => {
  const { service, announced } = library();
  const { id } = service.createHymn(hymn('Praise song'));
  service.editHymn(id, hymn('Praise song', 'Brand new first line\n\nBrand new second line'));
  assert.deepEqual(announced, [id, id]);
  const read = service.getHymn(id);
  assert.match(lyricsOf(read), /Brand new first line/);
  assert.doesNotMatch(lyricsOf(read), /Second line of Praise song/, 'the old lyrics are gone');
});

test('an edit still goes to the cloud sync, as before', () => {
  const { service, synced } = library();
  const { id } = service.createHymn(hymn('Praise song'));
  service.editHymn(id, hymn('Praise song', 'Changed.'));
  assert.equal(synced.length, 2, 'create and edit both sync');
});

test('a deleted song is announced and leaves the library list; undo brings it back and is announced too', () => {
  const { service, announced } = library();
  const { id } = service.createHymn(hymn('Praise song'));
  service.deleteHymn(id);
  assert.ok(!service.listHymns({}).some((h) => h.id === id), 'deleted songs leave the list');
  assert.ok(service.getHymn(id).deletedAt, 'and are kept in Recently deleted');
  service.undoDeleteHymn(id);
  assert.ok(service.listHymns({}).some((h) => h.id === id), 'undo puts it back in the list');
  assert.deepEqual(announced, [id, id, id]);
});

test('a recycled song is gone for good after the recycle period, and its id is no longer read', () => {
  const { db, service } = library();
  const { id } = service.createHymn(hymn('Old song'));
  service.deleteHymn(id, new Date('2026-01-01T00:00:00Z'));
  purgeDeletedHymns(db, new Date('2026-03-01T00:00:00Z'));
  assert.equal(service.getHymn(id), null);
  assert.ok(!service.listHymns({}).some((h) => h.id === id));
});

test('a projector style change is announced, so a window holding the song reads it again', () => {
  const { service, announced, synced } = library();
  const { id } = service.createHymn(hymn('Praise song'));
  announced.length = 0;
  synced.length = 0;
  service.setStyle(id, { fontSize: 80 });
  assert.deepEqual(announced, [id]);
  assert.equal(synced.length, 0, 'a style change does not start a cloud sync, as before');
});

test('a window that fails to hear the announcement does not fail the save', () => {
  const { service, db } = library({ onLyricsChanged: () => { throw new Error('no window'); } });
  const { id } = service.createHymn(hymn('Praise song'));
  service.editHymn(id, hymn('Praise song', 'Still saved.'));
  assert.match(lyricsOf(service.getHymn(id)), /Still saved/);
  assert.ok(db);
});

// The song form saves its slides as shown: a continuation slide is stored under the part it carries on.
const { lyricSlides, slidesToSaved } = await import('../shared/lyric-slides.js');
const twelve = Array.from({ length: 12 }, (_, i) => `Line ${i + 1}`).join('\n');

test('a song saved with continuation slides stores each under its inherited part', () => {
  const { service } = library();
  const { slides } = lyricSlides(`${twelve}\n\n[Chorus]\nSample lyric line 1\nSample lyric line 2`);
  const { id } = service.createHymn(hymn('Sample Song', slidesToSaved(slides)));
  const stored = service.getHymn(id).stanzas;
  assert.deepEqual(stored.map((s) => s.stanzaType), ['Verse 1', 'Verse 1', 'Verse 1', 'Chorus']);
  assert.deepEqual(stored.map((s) => s.lyricsText.split('\n').length), [4, 4, 4, 2]);
});

test('an edit that cuts a long verse into slides puts the new slides after it in a saved lineup arrangement', () => {
  const { db, service } = library();
  const { id } = service.createHymn(hymn('Sample Song', `[Verse 1]\n${twelve}\n\n[Chorus]\nSample lyric line 1`));
  const [verse, chorus] = service.getHymn(id).stanzas.map((s) => s.id);
  const sessionId = Number(db.prepare("INSERT INTO pw_sessions (name, liturgical_date, groups) VALUES ('Night', '2026-11-06', '[]')").run().lastInsertRowid);
  db.prepare(`INSERT INTO pw_segments (session_id, display_order, segment_key, group_key, name, type, minutes, leader, content_ref, arrangement, cues, notes)
    VALUES (?, 1, 'joyful_song', 'praise', 'Joyful', 'song', 5, '', '{}', ?, '{}', '')`)
    .run(sessionId, JSON.stringify({ [id]: [String(chorus), String(verse), String(chorus)] }));

  service.editHymn(id, hymn('Sample Song', slidesToSaved(lyricSlides(`[Verse 1]\n${twelve}\n\n[Chorus]\nSample lyric line 1`).slides)));
  const after = service.getHymn(id).stanzas;
  assert.deepEqual(after.map((s) => s.stanzaType), ['Verse 1', 'Verse 1', 'Verse 1', 'Chorus']);
  assert.equal(after[0].id, verse, 'the verse keeps its id');
  assert.equal(after[3].id, chorus);
  const arrangement = JSON.parse(db.prepare('SELECT arrangement FROM pw_segments').get().arrangement)[id];
  assert.deepEqual(arrangement.map(Number), [chorus, verse, after[1].id, after[2].id, chorus]);
});

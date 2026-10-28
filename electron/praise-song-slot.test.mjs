// Tests that a song can be saved into lineup segment 4 (Bible Enthronement) and the title slide put back, and that a saved session
// reloads with both kinds right, while segments 3 and 5 are unchanged. The laptop's schema is real and in memory.
// Run with: node --test electron/praise-song-slot.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { HYMN_DELETE_MIGRATIONS, LYRICS_MIGRATIONS, LYRICS_STYLE_MIGRATIONS, createLyricsService } = await import('./lyrics.js');
const { MASS_PLAN_MIGRATIONS, PLAN_BIBLE_MIGRATIONS, PLAN_COMMUNION_MIGRATIONS, PLAN_CUSTOM_MIGRATIONS, PLAN_NOTES_MIGRATIONS } = await import('./mass-plans.js');
const { PW_MIGRATIONS, createPwService } = await import('./pw-sessions.js');
const { SONG_CATEGORY_MIGRATIONS, createSongCategoryService } = await import('./song-categories.js');
const { LECTIONARY_MIGRATIONS } = await import('./lectionary.js');
const { MEDIA_MIGRATIONS } = await import('./media.js');
const { BIBLE_MIGRATIONS } = await import('./bible-seed.js');
const { PRAYER_NOTES_MIGRATIONS } = await import('./notes.js');
const { TRANSFER_MIGRATIONS } = await import('./transfer.js');
const { PLAN_SYNC_MIGRATIONS } = await import('./plan-sync-schema.js');
const { DEFAULT_TEMPLATE, readiness, segmentStatus, songAssignment, scriptureAssignment, typesFor } = await import('../shared/pw.js');
const { songDrop } = await import('../shared/pw-drop.js');

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
    ...PLAN_CUSTOM_MIGRATIONS, ...PLAN_NOTES_MIGRATIONS, ...PW_MIGRATIONS, ...PLAN_COMMUNION_MIGRATIONS, ...SONG_CATEGORY_MIGRATIONS, ...TRANSFER_MIGRATIONS, ...PLAN_SYNC_MIGRATIONS,
    ...LECTIONARY_MIGRATIONS, ...MEDIA_MIGRATIONS, ...BIBLE_MIGRATIONS, ...PRAYER_NOTES_MIGRATIONS]) {
    db.exec(sqlText);
  }
  // The announcement slides table is only checked for existence by the plan read, so a minimal one is enough here.
  db.exec('CREATE TABLE IF NOT EXISTS announcement_slides (id INTEGER PRIMARY KEY)');
  return db;
}

const hymn = (title) => ({ title, composer: '', category: 'General', songCategory: 'General', language: 'EN', musicalKey: 'G', raw: `${title}, first line\n\nSecond line of ${title}` });

/** A laptop with the built-in lineup seeded and one song in the library, and a session made from the lineup. */
function setup() {
  const db = laptopDb();
  createSongCategoryService(db).createSongCategory({ name: 'General' });
  const lyrics = createLyricsService(db);
  const song = lyrics.createHymn(hymn('Praise song'));
  const pw = createPwService(db);
  pw.seedDefaultTemplate();
  const session = pw.createSession({ name: 'Night', liturgicalDate: '2026-11-06' });
  return { pw, session, songId: song.id, lyrics };
}

/** The session's segments as the editor saves them: each one with the fields it sends. */
const toSave = (segments) => segments.map(({ id, stale, deleted, ...s }) => s);

const bySlot = (segments, key) => segments.find((s) => s.key === key);

test('a song saved into segment 4 reloads as a song, with the slot minutes and no title content', () => {
  const { pw, session, songId } = setup();
  const seg4 = bySlot(session.segments, 'bible_enthronement');
  assert.equal(seg4.type, 'scripture', 'the lineup starts with the title slide');

  const patch = songAssignment(seg4, songId, null);
  const segments = session.segments.map((s) => (s.key === 'bible_enthronement' ? { ...s, ...patch } : s));
  pw.saveSession(session.id, { segments: toSave(segments) });

  const reloaded = pw.getSession(session.id);
  const back = bySlot(reloaded.segments, 'bible_enthronement');
  assert.equal(back.type, 'song');
  assert.deepEqual(back.content, { kind: 'song', hymnIds: [songId], maxSongs: 1, category: null });
  assert.equal(back.minutes, 4);
  assert.equal(segmentStatus(back), 'ready');
  assert.equal(back.stale, false);
});

test('a title slide put back into segment 4 after a song reloads as the title slide', () => {
  const { pw, session, songId } = setup();
  const seg4 = bySlot(session.segments, 'bible_enthronement');
  const withSong = { ...seg4, ...songAssignment(seg4, songId, null) };
  pw.saveSession(session.id, { segments: toSave(session.segments.map((s) => (s.key === 'bible_enthronement' ? withSong : s))) });

  const reloaded = pw.getSession(session.id);
  const again = bySlot(reloaded.segments, 'bible_enthronement');
  const titled = { ...again, ...scriptureAssignment(again, { kind: 'title' }) };
  pw.saveSession(session.id, { segments: toSave(reloaded.segments.map((s) => (s.key === 'bible_enthronement' ? titled : s))) });

  const final = bySlot(pw.getSession(session.id).segments, 'bible_enthronement');
  assert.equal(final.type, 'scripture');
  assert.deepEqual(final.content, { kind: 'title' });
  assert.equal(final.minutes, 4);
});

test('segments 3 and 5 reload exactly as the lineup made them, with a song in segment 4', () => {
  const { pw, session, songId } = setup();
  const seg4 = bySlot(session.segments, 'bible_enthronement');
  const segments = session.segments.map((s) => (s.key === 'bible_enthronement' ? { ...s, ...songAssignment(seg4, songId, null) } : s));
  pw.saveSession(session.id, { segments: toSave(segments) });

  const reloaded = pw.getSession(session.id);
  for (const key of ['marian_song', 'joyful_song']) {
    const before = bySlot(session.segments, key);
    const after = bySlot(reloaded.segments, key);
    assert.equal(after.type, 'song', key);
    assert.deepEqual(after.content, before.content, key);
    assert.equal(after.minutes, before.minutes, key);
    assert.deepEqual(typesFor(after), ['song'], key);
  }
});

test('readiness counts segment 4 as ready with a song or the title slide', () => {
  const { pw, session, songId } = setup();
  const seg4 = bySlot(session.segments, 'bible_enthronement');
  const withSong = session.segments.map((s) => (s.key === 'bible_enthronement' ? { ...s, ...songAssignment(seg4, songId, null) } : s));
  pw.saveSession(session.id, { segments: toSave(withSong) });
  const reloaded = pw.getSession(session.id).segments;
  assert.equal(readiness(reloaded).ready, readiness(session.segments).ready, 'a song in segment 4 is as ready as the title slide');
  assert.equal(DEFAULT_TEMPLATE.segments.length, session.segments.length);
});

test('songs dropped from the Song List reload in the right slots, and a refused drop saves nothing', () => {
  const { pw, session, lyrics } = setup();
  const ids = ['Song A', 'Song B', 'Song C', 'Song D'].map((title) => lyrics.createHymn(hymn(title)).id);
  const drop = (segments, key, hymnId) => {
    const index = segments.findIndex((s) => s.key === key);
    const result = songDrop(segments[index], hymnId);
    if (!('patch' in result)) return segments;
    return segments.map((s, i) => (i === index ? { ...s, ...result.patch } : s));
  };
  // Song A onto segment 4 (accepted), Song B onto Marian Song, Songs C and D onto Worship (it takes 3), and C again (already there, refused).
  let segments = session.segments;
  segments = drop(segments, 'bible_enthronement', ids[0]);
  segments = drop(segments, 'marian_song', ids[1]);
  segments = drop(segments, 'worship', ids[2]);
  segments = drop(segments, 'worship', ids[3]);
  segments = drop(segments, 'worship', ids[2]);
  pw.saveSession(session.id, { segments: toSave(segments) });

  const reloaded = pw.getSession(session.id).segments;
  assert.equal(bySlot(reloaded, 'bible_enthronement').type, 'song');
  assert.deepEqual(bySlot(reloaded, 'bible_enthronement').content.hymnIds, [ids[0]]);
  assert.deepEqual(bySlot(reloaded, 'marian_song').content.hymnIds, [ids[1]]);
  assert.deepEqual(bySlot(reloaded, 'worship').content.hymnIds, [ids[2], ids[3]], 'worship keeps the two drops; the repeat of Song C was refused');
});

test('a drop refused on a scripture slot leaves that slot as it was when saved', () => {
  const { pw, session, lyrics } = setup();
  const hymnId = lyrics.createHymn(hymn('Song E')).id;
  const before = bySlot(session.segments, 'gospel_acclamation');
  assert.deepEqual(songDrop(before, hymnId), { refused: 'type' });
  pw.saveSession(session.id, { segments: toSave(session.segments) });
  const after = bySlot(pw.getSession(session.id).segments, 'gospel_acclamation');
  assert.equal(after.type, 'scripture');
  assert.equal(after.content.kind, 'lectionary');
});

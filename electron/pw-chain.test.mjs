// Tests that chained items on prayer and scripture cards save and reload in order, with their minutes, and that the server refuses
// a chain it cannot project. The session service is the real one, on a real in-memory schema.
// Run with: node --test electron/pw-chain.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { HYMN_DELETE_MIGRATIONS, LYRICS_MIGRATIONS, LYRICS_STYLE_MIGRATIONS } = await import('./lyrics.js');
const { MASS_PLAN_MIGRATIONS, PLAN_BIBLE_MIGRATIONS, PLAN_COMMUNION_MIGRATIONS, PLAN_CUSTOM_MIGRATIONS, PLAN_NOTES_MIGRATIONS } = await import('./mass-plans.js');
const { PW_MIGRATIONS, createPwService } = await import('./pw-sessions.js');
const { SONG_CATEGORY_MIGRATIONS } = await import('./song-categories.js');
const { TRANSFER_MIGRATIONS } = await import('./transfer.js');
const { PLAN_SYNC_MIGRATIONS } = await import('./plan-sync-schema.js');
const { LECTIONARY_MIGRATIONS } = await import('./lectionary.js');
const { MEDIA_MIGRATIONS } = await import('./media.js');
const { BIBLE_MIGRATIONS } = await import('./bible-seed.js');
const { PRAYER_NOTES_MIGRATIONS, PRAYER_NOTES_SPLIT_MIGRATIONS, createNotesService } = await import('./notes.js');
const { MAX_CHAIN, MAX_SONGS } = await import('../shared/pw.js');
const { createLyricsService } = await import('./lyrics.js');
const { createSongCategoryService } = await import('./song-categories.js');

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
    ...LECTIONARY_MIGRATIONS, ...MEDIA_MIGRATIONS, ...BIBLE_MIGRATIONS, ...PRAYER_NOTES_MIGRATIONS, ...PRAYER_NOTES_SPLIT_MIGRATIONS]) {
    db.exec(sqlText);
  }
  db.exec('CREATE TABLE IF NOT EXISTS announcement_slides (id INTEGER PRIMARY KEY)');
  return db;
}

const BODY = 'First line of the prayer.\n\nSecond line of the prayer.';

function setup() {
  const db = laptopDb();
  const notes = createNotesService(db);
  const prayers = ['One', 'Two', 'Three'].map((title) => notes.save({ title, category: 'Community Prayer', body: `${title} ${BODY}`, display: 'full' }).id);
  const operator = notes.save({ title: 'Private', category: 'Community Prayer', body: BODY, display: 'operator' }).id;
  const pw = createPwService(db);
  pw.seedDefaultTemplate();
  const session = pw.createSession({ name: 'Night', liturgicalDate: '2026-11-06' });
  createSongCategoryService(db).createSongCategory({ name: 'General' });
  return { pw, session, prayers, operator, lyrics: createLyricsService(db) };
}

const toSave = (segments) => segments.map(({ id, stale, deleted, ...s }) => s);
const bySlot = (segments, key) => segments.find((s) => s.key === key);

test('a chain of prayers saves and reloads in order, with each item’s minutes', () => {
  const { pw, session, prayers } = setup();
  const segments = toSave(session.segments);
  const i = segments.findIndex((s) => s.key === 'prayer_authority');
  segments[i] = {
    ...segments[i],
    content: {
      kind: 'prayer',
      noteId: prayers[0],
      more: [
        { kind: 'prayer', noteId: prayers[2], minutes: 2 },
        { kind: 'prayer', noteId: prayers[1], minutes: 4 },
      ],
    },
  };
  pw.saveSession(session.id, { segments });
  const reloaded = bySlot(pw.getSession(session.id).segments, 'prayer_authority');
  assert.equal(reloaded.content.noteId, prayers[0]);
  assert.deepEqual(reloaded.content.more, [
    { kind: 'prayer', noteId: prayers[2], minutes: 2 },
    { kind: 'prayer', noteId: prayers[1], minutes: 4 },
  ]);
  assert.equal(reloaded.stale, false);
});

test('a reading chain on a scripture card saves and reloads', () => {
  const { pw, session } = setup();
  const segments = toSave(session.segments);
  const i = segments.findIndex((s) => s.key === 'bible_enthronement');
  segments[i] = { ...segments[i], content: { kind: 'title', hymnIds: [], more: [{ kind: 'lectionary', readingType: 'Gospel Acclamation', minutes: 1 }] } };
  pw.saveSession(session.id, { segments });
  const reloaded = bySlot(pw.getSession(session.id).segments, 'bible_enthronement');
  assert.deepEqual(reloaded.content, { kind: 'title', hymnIds: [], more: [{ kind: 'lectionary', readingType: 'Gospel Acclamation', minutes: 1 }] });
});

test('a card with no chain keeps its saved shape, with no chain field added', () => {
  const { pw, session } = setup();
  const reloaded = bySlot(pw.getSession(session.id).segments, 'bible_enthronement');
  assert.deepEqual(reloaded.content, { kind: 'title', hymnIds: [] });
});

test('a chain that points at a missing prayer is refused on save', () => {
  const { pw, session, prayers } = setup();
  const segments = toSave(session.segments);
  const i = segments.findIndex((s) => s.key === 'prayer_authority');
  segments[i] = { ...segments[i], content: { kind: 'prayer', noteId: prayers[0], more: [{ kind: 'prayer', noteId: 9999, minutes: 0 }] } };
  assert.throws(() => pw.saveSession(session.id, { segments }), /no longer exists/);
});

test('an operator-only prayer is refused in a chain, as it is as the first item', () => {
  const { pw, session, prayers, operator } = setup();
  const segments = toSave(session.segments);
  const i = segments.findIndex((s) => s.key === 'prayer_authority');
  segments[i] = { ...segments[i], content: { kind: 'prayer', noteId: prayers[0], more: [{ kind: 'prayer', noteId: operator, minutes: 0 }] } };
  assert.throws(() => pw.saveSession(session.id, { segments }), /Operator-only/);
});

test('a card chains a reading after a prayer, refuses an unknown item kind, and refuses more than the limit', () => {
  const { pw, session, prayers } = setup();
  const segments = toSave(session.segments);
  const i = segments.findIndex((s) => s.key === 'prayer_authority');
  segments[i] = { ...segments[i], content: { kind: 'prayer', noteId: prayers[0], more: [{ kind: 'lectionary', readingType: 'Gospel Acclamation', minutes: 0 }] } };
  pw.saveSession(session.id, { segments });
  segments[i] = { ...segments[i], content: { kind: 'prayer', noteId: prayers[0], more: [{ kind: 'song', hymnId: 1, minutes: 0 }] } };
  assert.throws(() => pw.saveSession(session.id, { segments }), /prayers and readings/);

  const many = Array.from({ length: MAX_CHAIN + 1 }, () => ({ kind: 'prayer', noteId: prayers[1], minutes: 0 }));
  segments[i] = { ...segments[i], content: { kind: 'prayer', noteId: prayers[0], more: many } };
  assert.throws(() => pw.saveSession(session.id, { segments }), /at most/);
});

const hymn = (title) => ({ title, composer: '', category: 'General', songCategory: 'General', language: 'EN', musicalKey: 'G', raw: `${title}, first line` });

test('a song card saves and reloads with more songs than its template limit, up to the cap', () => {
  const { pw, session, lyrics } = setup();
  const ids = Array.from({ length: MAX_SONGS + 1 }, (_, n) => lyrics.createHymn(hymn('Song ' + n)).id);
  const save = (hymnIds) => {
    const segments = toSave(session.segments);
    const i = segments.findIndex((s) => s.key === 'marian_song');
    // The template gives this card room for one song. The card's own limit rises to hold what was attached.
    segments[i] = { ...segments[i], content: { kind: 'song', hymnIds, maxSongs: hymnIds.length, category: null } };
    return pw.saveSession(session.id, { segments });
  };
  const saved = save(ids.slice(0, MAX_SONGS));
  assert.deepEqual(bySlot(saved.segments, 'marian_song').content.hymnIds, ids.slice(0, MAX_SONGS));
  assert.deepEqual(bySlot(pw.getSession(session.id).segments, 'marian_song').content.hymnIds, ids.slice(0, MAX_SONGS));
  // One past the cap is still refused.
  assert.throws(() => save(ids), /at most/);
});

test('a prayer card saves and reloads with songs and a chain on it, in one card', () => {
  const { pw, session, prayers, lyrics } = setup();
  const songIds = ['Song X', 'Song Y'].map((title) => lyrics.createHymn(hymn(title)).id);
  const segments = toSave(session.segments);
  const i = segments.findIndex((s) => s.key === 'prayer_authority');
  segments[i] = { ...segments[i], content: { kind: 'prayer', noteId: prayers[0], hymnIds: songIds, more: [{ kind: 'lectionary', readingType: 'Gospel Acclamation', minutes: 1 }] } };
  pw.saveSession(session.id, { segments });
  const back = bySlot(pw.getSession(session.id).segments, 'prayer_authority');
  assert.equal(back.content.kind, 'prayer');
  assert.equal(back.content.noteId, prayers[0]);
  assert.deepEqual(back.content.hymnIds, songIds);
  assert.deepEqual(back.content.more, [{ kind: 'lectionary', readingType: 'Gospel Acclamation', minutes: 1 }]);
});

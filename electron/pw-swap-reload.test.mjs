// Tests that a lineup with swapped and moved items saves and reloads in its new order, with each item's arrangement and minutes with it.
// The session service is the real one, on a real in-memory schema. Run with: node --test electron/pw-swap-reload.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { HYMN_DELETE_MIGRATIONS, LYRICS_MIGRATIONS, LYRICS_STYLE_MIGRATIONS, createLyricsService } = await import('./lyrics.js');
const { MASS_PLAN_MIGRATIONS, PLAN_BIBLE_MIGRATIONS, PLAN_COMMUNION_MIGRATIONS, PLAN_CUSTOM_MIGRATIONS, PLAN_NOTES_MIGRATIONS } = await import('./mass-plans.js');
const { PW_MIGRATIONS, createPwService } = await import('./pw-sessions.js');
const { SONG_CATEGORY_MIGRATIONS, createSongCategoryService } = await import('./song-categories.js');
const { TRANSFER_MIGRATIONS } = await import('./transfer.js');
const { PLAN_SYNC_MIGRATIONS } = await import('./plan-sync-schema.js');
const { LECTIONARY_MIGRATIONS } = await import('./lectionary.js');
const { MEDIA_MIGRATIONS } = await import('./media.js');
const { BIBLE_MIGRATIONS } = await import('./bible-seed.js');
const { PRAYER_NOTES_MIGRATIONS } = await import('./notes.js');
const { exchangeSlots } = await import('../shared/pw-slots.js');
const { DEFAULT_TEMPLATE, segmentFromTemplate } = await import('../shared/pw.js');

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
  db.exec('CREATE TABLE IF NOT EXISTS announcement_slides (id INTEGER PRIMARY KEY)');
  return db;
}

const hymn = (title) => ({ title, composer: '', category: 'General', songCategory: 'General', language: 'EN', musicalKey: 'G', raw: `${title}, first line\n\nSecond line of ${title}` });
const toSave = (segments) => segments.map(({ id, stale, deleted, ...s }) => s);
const bySlot = (segments, key) => segments.find((s) => s.key === key);
const index = (segments, key) => segments.findIndex((s) => s.key === key);

function setup() {
  const db = laptopDb();
  createSongCategoryService(db).createSongCategory({ name: 'General' });
  const lyrics = createLyricsService(db);
  const pw = createPwService(db);
  pw.seedDefaultTemplate();
  const session = pw.createSession({ name: 'Night', liturgicalDate: '2026-11-06' });
  return { pw, session, songs: ['Song A', 'Song B', 'Song C'].map((title) => lyrics.createHymn(hymn(title)).id) };
}

test('a swapped lineup saves and reloads in its new order, with each song’s arrangement and minutes', () => {
  const { pw, session, songs } = setup();
  const [a, b] = songs;
  let segments = session.segments.map((s) => {
    if (s.key === 'joyful_song') return { ...s, content: { ...s.content, hymnIds: [a] }, arrangement: { [a]: ['1'] }, minutes: 9 };
    if (s.key === 'repentance') return { ...s, content: { ...s.content, hymnIds: [b] }, arrangement: { [b]: ['1'] }, minutes: 4 };
    return s;
  });
  const result = exchangeSlots(segments, index(segments, 'joyful_song'), index(segments, 'repentance'));
  assert.ok(result.segments);
  pw.saveSession(session.id, { segments: toSave(result.segments) });

  const reloaded = pw.getSession(session.id).segments;
  const joyful = bySlot(reloaded, 'joyful_song');
  const repentance = bySlot(reloaded, 'repentance');
  assert.deepEqual(joyful.content.hymnIds, [b]);
  assert.deepEqual(joyful.arrangement, { [b]: ['1'] });
  assert.equal(joyful.minutes, 4);
  assert.deepEqual(repentance.content.hymnIds, [a]);
  assert.deepEqual(repentance.arrangement, { [a]: ['1'] });
  assert.equal(repentance.minutes, 9);
});

test('a move into an empty slot saves and reloads with the old slot empty', () => {
  const { pw, session, songs } = setup();
  const [a] = songs;
  const segments = session.segments.map((s) => (s.key === 'joyful_song' ? { ...s, content: { ...s.content, hymnIds: [a] }, minutes: 6 } : s));
  const result = exchangeSlots(segments, index(segments, 'joyful_song'), index(segments, 'marian_song'));
  assert.ok(result.segments);
  pw.saveSession(session.id, { segments: toSave(result.segments) });

  const reloaded = pw.getSession(session.id).segments;
  assert.deepEqual(bySlot(reloaded, 'marian_song').content.hymnIds, [a]);
  assert.equal(bySlot(reloaded, 'marian_song').minutes, 6);
  assert.deepEqual(bySlot(reloaded, 'joyful_song').content.hymnIds, []);
});

test('a swap that would break the worship limit is refused, and the saved lineup is unchanged', () => {
  const { pw, session, songs } = setup();
  const [a, b, c] = songs;
  const segments = session.segments.map((s) => {
    if (s.key === 'worship') return { ...s, content: { ...s.content, hymnIds: [a, b, c] } };
    if (s.key === 'joyful_song') return { ...s, content: { ...s.content, hymnIds: [a] } };
    return s;
  });
  pw.saveSession(session.id, { segments: toSave(segments) });
  const before = pw.getSession(session.id).segments;
  const refused = exchangeSlots(segments, index(segments, 'worship'), index(segments, 'joyful_song'));
  assert.deepEqual(refused, { refused: 'limit' });
  const after = pw.getSession(session.id).segments;
  assert.deepEqual(after, before, 'nothing was saved');
});

test('segment 4 keeps its title slide after a save: a song cannot be swapped into it while it holds the title', () => {
  const { pw, session, songs } = setup();
  const [a] = songs;
  const segments = session.segments.map((s) => (s.key === 'joyful_song' ? { ...s, content: { ...s.content, hymnIds: [a] } } : s));
  pw.saveSession(session.id, { segments: toSave(segments) });
  const before = pw.getSession(session.id).segments;
  const refused = exchangeSlots(before, index(before, 'joyful_song'), index(before, 'bible_enthronement'));
  assert.deepEqual(refused, { refused: 'type' }, 'a song and the title slide are different types, so the swap is refused');
  const reloaded = bySlot(pw.getSession(session.id).segments, 'bible_enthronement');
  assert.equal(reloaded.type, 'scripture');
  assert.deepEqual(reloaded.content, { kind: 'title' });
  assert.equal(segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === 'bible_enthronement')).type, 'scripture');
});

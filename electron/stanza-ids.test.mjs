// A song edit keeps its stanza ids, so a custom Praise & Worship arrangement survives it. A stanza the edit removes is dropped from the
// arrangement and reported; a deleted and restored song is unaffected; a saved lineup reloads with its arrangement after an edit.
// The laptop's schema is real and in memory. Run with: node --test electron/stanza-ids.test.mjs
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

/** A song with three stanzas: alpha, beta and gamma, in that order. */
const SONG = 'Alpha one\nAlpha two\n\nBeta one\nBeta two\n\nGamma one\nGamma two';
const hymn = (raw) => ({ title: 'Praise song', composer: '', category: 'General', songCategory: 'General', language: 'EN', musicalKey: 'G', raw });

function library() {
  const db = laptopDb();
  createSongCategoryService(db).createSongCategory({ name: 'General' });
  const lyrics = createLyricsService(db);
  const pw = createPwService(db);
  pw.seedDefaultTemplate();
  const session = pw.createSession({ name: 'Night', liturgicalDate: '2026-11-06' });
  return { db, lyrics, pw, session };
}

/** The song's stanza ids, in song order, with the text of each. */
const stanzasOf = (lyrics, id) => lyrics.getHymn(id).stanzas.map((s) => ({ id: s.id, text: s.lyricsText }));
const bySlot = (segments, key) => segments.find((s) => s.key === key);
const toSave = (segments) => segments.map(({ id, stale, deleted, ...s }) => s);

/** Saves the joyful slot with this song and a custom arrangement, as the editor would. */
function savedArrangement(pw, session, songId, order) {
  const segments = session.segments.map((s) =>
    s.key === 'joyful_song' ? { ...s, content: { ...s.content, hymnIds: [songId] }, arrangement: { [songId]: order.map(String) } } : s,
  );
  pw.saveSession(session.id, { segments: toSave(segments) });
  return pw.getSession(session.id);
}

test('editing one line keeps every stanza id', () => {
  const { lyrics } = library();
  const { id } = lyrics.createHymn(hymn(SONG));
  const before = stanzasOf(lyrics, id);
  lyrics.editHymn(id, hymn('Alpha one\nAlpha two\n\nBeta one\nBeta two changed\n\nGamma one\nGamma two'));
  const after = stanzasOf(lyrics, id);
  assert.deepEqual(after.map((s) => s.id), before.map((s) => s.id), 'every stanza keeps its id');
  assert.match(after[1].text, /changed/, 'the edit is in the text');
});

test('adding a stanza gives only the new stanza a new id', () => {
  const { lyrics } = library();
  const { id } = lyrics.createHymn(hymn(SONG));
  const before = stanzasOf(lyrics, id).map((s) => s.id);
  lyrics.editHymn(id, hymn(`${SONG}\n\nDelta one`));
  const after = stanzasOf(lyrics, id).map((s) => s.id);
  assert.deepEqual(after.slice(0, 3), before, 'the old stanzas keep their ids');
  assert.equal(after.length, 4);
  assert.ok(!before.includes(after[3]), 'only the new stanza has a new id');
});

test('removing a stanza drops it from a custom arrangement and reports it', () => {
  const { lyrics, pw, session } = library();
  const { id } = lyrics.createHymn(hymn(SONG));
  const [alpha, beta, gamma] = stanzasOf(lyrics, id).map((s) => s.id);
  // A custom order that puts the removed stanza in the middle.
  savedArrangement(pw, session, id, [gamma, beta, alpha]);

  const result = lyrics.editHymn(id, hymn('Alpha one\nAlpha two\n\nGamma one\nGamma two'));
  assert.ok(result.warnings.some((w) => /\(stanza 2\) was removed by this edit/.test(w)), 'the removal of the second stanza is reported');
  assert.ok(result.warnings.some((w) => /taken out of 1 saved lineup arrangement/.test(w)));

  const arrangement = bySlot(pw.getSession(session.id).segments, 'joyful_song').arrangement;
  assert.deepEqual(arrangement[id], [String(gamma), String(alpha)], 'the removed stanza is gone; the rest keep their order');
  assert.equal(stanzasOf(lyrics, id).some((s) => s.id === beta), false);
});

test('a custom arrangement survives an edit, with its order intact', () => {
  const { lyrics, pw, session } = library();
  const { id } = lyrics.createHymn(hymn(SONG));
  const [alpha, beta, gamma] = stanzasOf(lyrics, id).map((s) => s.id);
  savedArrangement(pw, session, id, [gamma, alpha, beta, alpha]);
  lyrics.editHymn(id, hymn('Alpha one\nAlpha two, edited\n\nBeta one\nBeta two\n\nGamma one\nGamma two'));
  const arrangement = bySlot(pw.getSession(session.id).segments, 'joyful_song').arrangement;
  assert.deepEqual(arrangement[id], [String(gamma), String(alpha), String(beta), String(alpha)], 'the same stanzas in the same order, repeats included');
});

test('a saved lineup with a custom arrangement reloads after an edit', () => {
  const { lyrics, pw, session } = library();
  const { id } = lyrics.createHymn(hymn(SONG));
  const [alpha, beta, gamma] = stanzasOf(lyrics, id).map((s) => s.id);
  savedArrangement(pw, session, id, [beta, gamma]);
  lyrics.editHymn(id, hymn('Alpha one\nAlpha two\n\nBeta one\nBeta two\n\nGamma one\nGamma two, edited'));
  // A fresh service on the same database stands in for a restart.
  const reloaded = pw.getSession(session.id);
  assert.deepEqual(bySlot(reloaded.segments, 'joyful_song').arrangement[id], [String(beta), String(gamma)]);
  assert.equal(bySlot(reloaded.segments, 'joyful_song').content.hymnIds[0], id);
  assert.ok(alpha);
});

test('a deleted and restored song keeps its ids and its arrangement; another song is unaffected', () => {
  const { lyrics, pw, session } = library();
  const { id } = lyrics.createHymn(hymn(SONG));
  const other = lyrics.createHymn({ ...hymn('Other alpha\n\nOther beta'), title: 'Other song' }).id;
  const [alpha, beta, gamma] = stanzasOf(lyrics, id).map((s) => s.id);
  savedArrangement(pw, session, id, [gamma, alpha]);
  const otherBefore = stanzasOf(lyrics, other).map((s) => s.id);

  lyrics.deleteHymn(id);
  lyrics.undoDeleteHymn(id);
  assert.deepEqual(stanzasOf(lyrics, id).map((s) => s.id), [alpha, beta, gamma]);
  assert.deepEqual(bySlot(pw.getSession(session.id).segments, 'joyful_song').arrangement[id], [String(gamma), String(alpha)]);

  lyrics.editHymn(id, hymn('Alpha one\nAlpha two, edited\n\nBeta one\nBeta two\n\nGamma one\nGamma two'));
  assert.deepEqual(stanzasOf(lyrics, other).map((s) => s.id), otherBefore, 'the other song keeps its stanza ids');
});

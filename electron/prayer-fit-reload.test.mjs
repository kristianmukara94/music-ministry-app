// Tests that a prayer's slide split is the same after the session is saved and read back: the prayer's text is stored in the
// notes table and the session points at it, so the split is computed from the same text both times. The laptop's schema is real
// and in memory. Run with: node --test electron/prayer-fit-reload.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { HYMN_DELETE_MIGRATIONS, LYRICS_MIGRATIONS, LYRICS_STYLE_MIGRATIONS } = await import('./lyrics.js');
const { MASS_PLAN_MIGRATIONS, PLAN_BIBLE_MIGRATIONS, PLAN_COMMUNION_MIGRATIONS, PLAN_CUSTOM_MIGRATIONS, PLAN_NOTES_MIGRATIONS } = await import('./mass-plans.js');
const { PW_MIGRATIONS, createPwService } = await import('./pw-sessions.js');
const { SONG_CATEGORY_MIGRATIONS } = await import('./song-categories.js');
const { LECTIONARY_MIGRATIONS } = await import('./lectionary.js');
const { MEDIA_MIGRATIONS } = await import('./media.js');
const { BIBLE_MIGRATIONS } = await import('./bible-seed.js');
const { PRAYER_NOTES_MIGRATIONS } = await import('./notes.js');
const { TRANSFER_MIGRATIONS } = await import('./transfer.js');
const { PLAN_SYNC_MIGRATIONS } = await import('./plan-sync-schema.js');
const { DEFAULT_TEMPLATE, slidesFor } = await import('../shared/pw.js');
const { prayerSlidesFor } = await import('../shared/prayer-slides.js');

// A synthetic prayer of long lines, not the church's wording.
const BODY = [
  'Lord God, we ask you to take authority over every power that would turn our hearts away from you and our families away from your house,',
  'through the intercession of Saint Michael the Archangel, who stands before your throne, and of Our Lady, Queen of the Angels and the Saints,',
  'we pray that your Word be proclaimed without fear in this parish, and that every heart here be made ready to receive your mercy tonight.',
  'Amen.',
  '',
  'Holy Spirit, fill this place with your presence and your peace, and let every worship song lift the name of Jesus above all things.',
].join('\n');

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

test('a prayer split is the same after the session is saved and read back', () => {
  const db = laptopDb();
  const pw = createPwService(db);
  pw.seedDefaultTemplate();
  const noteId = Number(db.prepare("INSERT INTO notes (title, category, body, display) VALUES ('Prayer to Take Authority', 'Prayers', ?, 'full')").run(BODY).lastInsertRowid);
  const session = pw.createSession({ name: 'Night', liturgicalDate: '2026-11-06' });

  const lineup = session.segments.map((s) =>
    s.key === 'prayer_authority' ? { ...s, content: { kind: 'prayer', noteId } } : s,
  );
  const seg = lineup.find((s) => s.key === 'prayer_authority');
  const before = slidesFor(seg, { prayer: { title: 'Prayer to Take Authority', body: BODY } }).filter((s) => s.kind === 'prayer').map((s) => s.text);
  assert.deepEqual(before, prayerSlidesFor(BODY, null).pages.map((p) => p.text));

  pw.saveSession(session.id, { segments: lineup.map(({ id, stale, deleted, ...s }) => s) });
  const reloaded = pw.getSession(session.id).segments.find((s) => s.key === 'prayer_authority');
  assert.equal(reloaded.content.noteId, noteId);

  const storedBody = db.prepare('SELECT body FROM notes WHERE id = ?').get(noteId).body;
  const after = slidesFor(reloaded, { prayer: { title: 'Prayer to Take Authority', body: storedBody } }).filter((s) => s.kind === 'prayer').map((s) => s.text);
  assert.deepEqual(after, before);
  assert.equal(DEFAULT_TEMPLATE.segments.find((s) => s.key === 'prayer_authority').type, 'prayer');
});

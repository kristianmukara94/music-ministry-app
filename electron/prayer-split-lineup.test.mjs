// A prayer's saved split goes from the notes record into the lineup: it survives a save and a reload, the lineup shows the saved
// slides, and a split made for text that has since changed is not used. The notes table is real and in memory.
// Run with: node --test electron/prayer-split-lineup.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { PRAYER_NOTES_MIGRATIONS, PRAYER_NOTES_SPLIT_MIGRATIONS, createNotesService } = await import('./notes.js');
const { DEFAULT_TEMPLATE, segmentFromTemplate, slidesFor } = await import('../shared/pw.js');
const { prayerSlidesFor } = await import('../shared/prayer-slides.js');

const BODY = [
  'Lord God, we ask you to take authority over every power that would turn our hearts away from you and our families away from your house,',
  'through the intercession of Saint Michael the Archangel, who stands before your throne, and of Our Lady, Queen of the Angels and the Saints,',
  'we pray that your Word be proclaimed without fear in this parish, and that every heart here be made ready to receive your mercy tonight.',
  'Amen.',
  '',
  'Holy Spirit, fill this place with your presence and your peace, and let every worship song lift the name of Jesus above all things.',
].join('\n');
const segment = segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === 'prayer_authority'));

/** The lineup's prayer slides for a note, as the store builds them: the note's title, body and saved split. */
const lineupFor = (note) => slidesFor({ ...segment, cues: { ...segment.cues, titleFirst: false } }, { prayer: { title: note.title, body: note.body, split: note.split ?? null } });

function notesDb() {
  const db = new DatabaseSync(':memory:');
  for (const sqlText of [...PRAYER_NOTES_MIGRATIONS, ...PRAYER_NOTES_SPLIT_MIGRATIONS]) db.exec(sqlText);
  return db;
}

test('a saved split survives a save and a reload, and the lineup shows the saved slides', () => {
  const db = notesDb();
  const notes = createNotesService(db);
  const saved = notes.save({ title: 'Prayer to Take Authority', category: 'Community Prayer', body: BODY, display: 'full', split: { mode: 'manual', at: [2, 3] } });

  const reloaded = createNotesService(db).list().find((n) => n.id === saved.id);
  const slides = lineupFor(reloaded);
  // Each part of the saved split is kept in order; a part too long for one slide at full size is split again by sentence.
  const lines = BODY.split('\n');
  assert.ok(slides.length >= 3, 'the saved split gives at least its three parts');
  assert.ok(lines[0].startsWith(slides[0].text.split('\n')[0]), 'the first slide starts with the first line');
  assert.deepEqual(slides.map((s) => s.text).join(' ').split(/\s+/).filter(Boolean), BODY.split(/\s+/).filter(Boolean), 'no words lost or repeated');
  assert.ok(slides.every((s) => s.notice === undefined), 'a current split has no notice');
});

test('a prayer with no saved split shows the automatic split in the lineup', () => {
  const notes = createNotesService(notesDb());
  const saved = notes.save({ title: 'Prayer', category: 'Community Prayer', body: BODY, display: 'full' });
  const slides = lineupFor(notes.get(saved.id));
  assert.deepEqual(slides.map((s) => s.text), prayerSlidesFor(BODY, null).pages.map((p) => p.text));
});

test('a split made for text that has since changed is not used, and the lineup says so', () => {
  const db = notesDb();
  const notes = createNotesService(db);
  const saved = notes.save({ title: 'Prayer', category: 'Community Prayer', body: BODY, display: 'full', split: { mode: 'manual', at: [2, 3] } });
  // The text is changed and the old split is kept with it, as an out-of-date save would leave it.
  const changed = notes.save({ id: saved.id, title: 'Prayer', category: 'Community Prayer', body: `${BODY}\nAdded line.`, display: 'full', split: notes.get(saved.id).split });
  const slides = lineupFor(changed);
  assert.deepEqual(slides.map((s) => s.text), prayerSlidesFor(changed.body, null).pages.map((p) => p.text));
  assert.ok(slides.every((s) => s.notice === 'stale'));
});

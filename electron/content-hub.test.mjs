// Tests the Liturgical Content Hub's entries through the notes service: Mass flow texts and parish announcements save under their new
// categories with no migration, a private note can take any category, and a lower-third entry keeps its `---` slide breaks for a full-screen
// take. Every save tells the windows, which is how the Liturgical Plan's library populates.
// Run with: node --test electron/content-hub.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { NOTES_SLOT_MIGRATIONS, PRAYER_NOTES_MIGRATIONS, PRAYER_NOTES_SPLIT_MIGRATIONS, createNotesService } = await import('./notes.js');
const { dividedNote, sectionOfCategory } = await import('../shared/notes.js');

function notesDb() {
  const db = new DatabaseSync(':memory:');
  for (const sqlText of [...PRAYER_NOTES_MIGRATIONS, ...PRAYER_NOTES_SPLIT_MIGRATIONS, ...NOTES_SLOT_MIGRATIONS]) db.exec(sqlText);
  return db;
}

test('Mass flow texts and announcements save under their categories and land in their sections', () => {
  const notes = createNotesService(notesDb());
  notes.save({ title: 'Nicene Creed', category: 'Creed', body: '(parish text)', display: 'full', style: null });
  notes.save({ title: 'Parish Fiesta', category: 'Pastoral Notice', body: 'Saturday', display: 'lower', style: null });
  notes.save({ title: 'Novena', category: 'Novena', body: 'Day one', display: 'full', style: null });
  const bySection = Object.groupBy(notes.list(), (n) => sectionOfCategory(n.category));
  assert.deepEqual(bySection.massFlow.map((n) => n.title), ['Nicene Creed']);
  assert.deepEqual(bySection.announcements.map((n) => n.title), ['Parish Fiesta']);
  assert.deepEqual(bySection.prayers.map((n) => n.title), ['Novena']);
});

test('a private operator note can be filed under an announcement category', () => {
  const saved = createNotesService(notesDb()).save({ title: 'Check the fiesta date with Father', category: 'Pastoral Notice', body: '', display: 'operator', style: null });
  assert.equal(saved.display, 'operator');
  assert.equal(sectionOfCategory(saved.category), 'announcements');
});

test('a lower-third entry keeps the slide breaks typed with ---, for when it is taken full screen', () => {
  const { body, split } = dividedNote('Line one\n---\nLine two');
  const saved = createNotesService(notesDb()).save({ title: 'Reminder', category: 'Event Reminder', body, display: 'lower', style: null, split });
  assert.equal(saved.body, 'Line one\nLine two');
  assert.equal(saved.split?.mode, 'manual');
  assert.deepEqual(saved.split?.at, [0]);
});

test('a category that does not exist is still refused', () => {
  assert.throws(() => createNotesService(notesDb()).save({ title: 'X', category: 'Homily', body: '', display: 'full', style: null }), /category/);
});

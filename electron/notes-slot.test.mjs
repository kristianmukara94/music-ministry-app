// Tests the Holy Mass slot a note is written for in Go Live: it is stored and read back, an edit that does not say the slot (the Notes &
// Prayers editor) keeps it, null unlinks it, and a note from before the column has none. Every save and delete tells the windows.
// Run with: node --test electron/notes-slot.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { NOTES_SLOT_MIGRATIONS, PRAYER_NOTES_MIGRATIONS, PRAYER_NOTES_SPLIT_MIGRATIONS, createNotesService, setupNotes } = await import('./notes.js');
const { ipcMain } = await import('electron');
const { SLOT_IDS } = await import('../shared/mass-slots.js');

const SLOT = SLOT_IDS[4];

function notesDb() {
  const db = new DatabaseSync(':memory:');
  for (const sqlText of [...PRAYER_NOTES_MIGRATIONS, ...PRAYER_NOTES_SPLIT_MIGRATIONS, ...NOTES_SLOT_MIGRATIONS]) db.exec(sqlText);
  return db;
}
const prayer = (extra = {}) => ({ title: 'Mass Intentions', category: 'Mass Intention', body: 'For the souls of the faithful departed.', display: 'full', style: null, ...extra });

test('a note written for a slot keeps it through a save and a reload', () => {
  const db = notesDb();
  const saved = createNotesService(db).save(prayer({ slot: SLOT }));
  assert.equal(saved.slot, SLOT);
  assert.equal(createNotesService(db).get(saved.id).slot, SLOT);
  assert.equal(createNotesService(db).list()[0].slot, SLOT);
});

test('an edit that does not say the slot keeps it; null unlinks it', () => {
  const notes = createNotesService(notesDb());
  const saved = notes.save(prayer({ slot: SLOT }));
  // The Notes & Prayers editor sends no slot.
  const edited = notes.save({ ...prayer({ body: 'Edited.' }), id: saved.id });
  assert.equal(edited.body, 'Edited.');
  assert.equal(edited.slot, SLOT);
  assert.equal(notes.save({ ...prayer(), id: saved.id, slot: null }).slot, null);
});

test('anything that is not a slot id is stored as no slot', () => {
  const notes = createNotesService(notesDb());
  assert.equal(notes.save(prayer({ slot: 'not-a-slot' })).slot, null);
  assert.equal(notes.save(prayer()).slot, null);
});

test('a note saved before the slot column existed reads with no slot', () => {
  const db = new DatabaseSync(':memory:');
  for (const sqlText of [...PRAYER_NOTES_MIGRATIONS, ...PRAYER_NOTES_SPLIT_MIGRATIONS]) db.exec(sqlText);
  db.prepare("INSERT INTO notes (title, category, body, display) VALUES ('Old', 'Liturgical Cue', 'Ring the bell', 'operator')").run();
  for (const sqlText of NOTES_SLOT_MIGRATIONS) db.exec(sqlText);
  const [note] = createNotesService(db).list();
  assert.equal(note.slot, null);
  assert.equal(note.display, 'operator');
});

test('every save and delete over IPC tells the windows which note changed', async () => {
  const handlers = {};
  const original = ipcMain.handle;
  ipcMain.handle = (channel, fn) => (handlers[channel] = fn);
  const changes = [];
  try {
    setupNotes(notesDb(), { onChanged: (change) => changes.push(change) });
  } finally {
    ipcMain.handle = original;
  }
  const saved = await handlers['notes:save'](null, prayer({ slot: SLOT }));
  await handlers['notes:save'](null, { ...prayer({ title: 'Renamed' }), id: saved.id });
  assert.equal(await handlers['notes:delete'](null, saved.id), true);
  // Deleting a note that is already gone changes nothing, so nothing is sent.
  assert.equal(await handlers['notes:delete'](null, saved.id), false);
  assert.deepEqual(changes, [
    { id: saved.id, removed: false },
    { id: saved.id, removed: false },
    { id: saved.id, removed: true },
  ]);
});

test('a save that fails sends no change', async () => {
  const handlers = {};
  const original = ipcMain.handle;
  ipcMain.handle = (channel, fn) => (handlers[channel] = fn);
  const changes = [];
  try {
    setupNotes(notesDb(), { onChanged: (change) => changes.push(change) });
  } finally {
    ipcMain.handle = original;
  }
  await assert.rejects(async () => handlers['notes:save'](null, prayer({ title: '' })), /Title/);
  assert.deepEqual(changes, []);
});

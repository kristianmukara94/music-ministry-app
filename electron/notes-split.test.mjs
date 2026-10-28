// Tests that a prayer's split is stored with the prayer: it survives a save and a reload, a save that omits it stores none, and a
// stored split is cleaned against the text. The notes table is real and in memory. Run with: node --test electron/notes-split.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { PRAYER_NOTES_MIGRATIONS, PRAYER_NOTES_SPLIT_MIGRATIONS, createNotesService } = await import('./notes.js');
const { splitFingerprint } = await import('../shared/prayer-split.js');

const BODY = 'Lord, hear our prayer.\nGrant us your peace.\nAmen.\n\nHoly Spirit, fill this place.';

function notesDb() {
  const db = new DatabaseSync(':memory:');
  for (const sqlText of [...PRAYER_NOTES_MIGRATIONS, ...PRAYER_NOTES_SPLIT_MIGRATIONS]) db.exec(sqlText);
  return db;
}

test('a split is stored with the prayer, and reads back the same after a reload', () => {
  const db = notesDb();
  const notes = createNotesService(db);
  const saved = notes.save({ title: 'Prayer to Take Authority', category: 'Community Prayer', body: BODY, display: 'full', style: { fontSize: 80 }, split: { mode: 'manual', at: [1, 2] } });
  assert.deepEqual(saved.split, { mode: 'manual', at: [1, 2], of: splitFingerprint(BODY) });

  // A fresh service on the same database stands in for a restart.
  const reloaded = createNotesService(db).get(saved.id);
  assert.deepEqual(reloaded.split, { mode: 'manual', at: [1, 2], of: splitFingerprint(BODY) });
  assert.equal(reloaded.body, BODY, 'the saved text is unchanged');
  assert.deepEqual(createNotesService(db).list().find((n) => n.id === saved.id).split, { mode: 'manual', at: [1, 2], of: splitFingerprint(BODY) });
});

test('an automatic split is stored and read back too', () => {
  const notes = createNotesService(notesDb());
  const saved = notes.save({ title: 'Prayer', category: 'Community Prayer', body: BODY, display: 'full', split: { mode: 'auto' } });
  assert.deepEqual(notes.get(saved.id).split, { mode: 'auto', of: splitFingerprint(BODY) });
});

test('a save that omits the split stores none, so the prayer is one slide again', () => {
  const notes = createNotesService(notesDb());
  const saved = notes.save({ title: 'Prayer', category: 'Community Prayer', body: BODY, display: 'full', split: { mode: 'auto' } });
  const updated = notes.save({ id: saved.id, title: 'Prayer', category: 'Community Prayer', body: BODY, display: 'full' });
  assert.equal(updated.split, null);
});

test('a stored split is cleaned against the text when it is read', () => {
  const db = notesDb();
  const notes = createNotesService(db);
  const saved = notes.save({ title: 'Prayer', category: 'Community Prayer', body: BODY, display: 'full' });
  db.prepare('UPDATE notes SET split = ? WHERE id = ?').run(JSON.stringify({ mode: 'manual', at: [1, 99, -1] }), saved.id);
  assert.deepEqual(notes.get(saved.id).split, { mode: 'manual', at: [1] });
});

test('a note saved before the split column existed reads as one slide', () => {
  const db = new DatabaseSync(':memory:');
  for (const sqlText of PRAYER_NOTES_MIGRATIONS) db.exec(sqlText);
  db.prepare("INSERT INTO notes (title, category, body, display) VALUES ('Old prayer', 'Community Prayer', ?, 'full')").run(BODY);
  for (const sqlText of PRAYER_NOTES_SPLIT_MIGRATIONS) db.exec(sqlText);
  const [note] = createNotesService(db).list();
  assert.equal(note.split, null);
  assert.equal(note.body, BODY);
});

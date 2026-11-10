// Tests Go Live's copy-on-write channel for Notes & Prayers (notes:saveCopy): Edit slide on air, Add slide and Delete slide make a copy owned
// by the plan or lineup card, change only that copy afterwards, and can never change a Liturgical Content Hub entry or another plan's copy.
// Run with: node --test electron/notes-copy.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { NOTES_COPY_MIGRATIONS, NOTES_SLOT_MIGRATIONS, PRAYER_NOTES_MIGRATIONS, PRAYER_NOTES_SPLIT_MIGRATIONS, createNotesService } = await import('./notes.js');

function notesDb() {
  const db = new DatabaseSync(':memory:');
  for (const sqlText of [...PRAYER_NOTES_MIGRATIONS, ...PRAYER_NOTES_SPLIT_MIGRATIONS, ...NOTES_SLOT_MIGRATIONS, ...NOTES_COPY_MIGRATIONS]) db.exec(sqlText);
  return db;
}
const prayer = (extra = {}) => ({ title: 'Opening Prayer', category: 'Community Prayer', body: 'Lord, we gather.\nHear us.', display: 'full', style: null, ...extra });

test('a Hub entry has no owner; the first live edit makes a separate copy and the entry is left exactly as it was', () => {
  const db = notesDb();
  const notes = createNotesService(db);
  const hub = notes.save(prayer());
  assert.equal(hub.copyOwner, null);
  const before = db.prepare('SELECT * FROM notes WHERE id = ?').get(hub.id);

  const copy = notes.saveCopy(prayer({ body: 'Lord, we gather.' }), 'mass:7');
  assert.notEqual(copy.id, hub.id);
  assert.equal(copy.copyOwner, 'mass:7');
  assert.deepEqual(db.prepare('SELECT * FROM notes WHERE id = ?').get(hub.id), before, 'the Hub entry is untouched');
  assert.equal(notes.list().length, 2, 'the copy is its own row; nothing was deleted');
});

test('the copy channel refuses to write a Hub entry, even when asked by id', () => {
  const db = notesDb();
  const notes = createNotesService(db);
  const hub = notes.save(prayer());
  assert.throws(() => notes.saveCopy(prayer({ id: hub.id, body: 'changed' }), 'mass:7'), /own copy/);
  assert.equal(notes.get(hub.id).body, prayer().body);
});

test('a plan changes its own copy in place, but never another plan’s or lineup card’s', () => {
  const notes = createNotesService(notesDb());
  const copy = notes.saveCopy(prayer(), 'mass:7');
  const again = notes.saveCopy(prayer({ id: copy.id, body: 'Edited on air.' }), 'mass:7');
  assert.equal(again.id, copy.id);
  assert.equal(again.body, 'Edited on air.');
  assert.throws(() => notes.saveCopy(prayer({ id: copy.id, body: 'x' }), 'mass:8'), /own copy/);
  assert.throws(() => notes.saveCopy(prayer({ id: copy.id, body: 'x' }), 'pw:3:opening'), /own copy/);
  assert.equal(notes.get(copy.id).body, 'Edited on air.');
});

test('a copy needs an owner', () => {
  const notes = createNotesService(notesDb());
  assert.throws(() => notes.saveCopy(prayer(), ''), /belongs to/);
  assert.throws(() => notes.saveCopy(prayer(), null), /belongs to/);
  assert.equal(notes.list().length, 0);
});

test('the Hub editor’s own save leaves a note’s owner as it is', () => {
  const notes = createNotesService(notesDb());
  const hub = notes.save(prayer());
  assert.equal(notes.save(prayer({ id: hub.id, body: 'Edited in the Hub.' })).copyOwner, null);
  const copy = notes.saveCopy(prayer(), 'pw:3:opening');
  assert.equal(notes.save(prayer({ id: copy.id })).copyOwner, 'pw:3:opening');
});

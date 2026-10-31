// Tests that an imported PowerPoint slide is kept as a picture of the slide (not as text), carries its speaker notes, and drops out of
// the Whiteboard when its picture is deleted. The whiteboard service is the real one, on a real in-memory schema.
// Run with: node --test electron/whiteboard-powerpoint.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { WHITEBOARD_MIGRATIONS, WHITEBOARD_POWERPOINT_MIGRATIONS, createWhiteboardService } = await import('./whiteboard.js');

function setup(pictures) {
  const db = new DatabaseSync(':memory:');
  // Only the part of Announcements the Whiteboard reads: the image slides, and their notes.
  db.exec('CREATE TABLE announcement_slides (id INTEGER PRIMARY KEY, notes TEXT)');
  for (const sql of [...WHITEBOARD_MIGRATIONS, ...WHITEBOARD_POWERPOINT_MIGRATIONS]) db.exec(sql);
  for (const p of pictures) db.prepare('INSERT INTO announcement_slides (id, notes) VALUES (?, ?)').run(p.id, p.notes ?? null);
  // node:sqlite has no .transaction(); the service only needs it for the import.
  db.transaction = (fn) => () => fn();
  const service = createWhiteboardService(db, { importDeck: async () => pictures });
  return { db, service };
}

test('a PowerPoint slide is imported as a picture with its notes', async () => {
  const { service } = setup([
    { id: 7, name: 'Deck - Slide 1', notes: 'Say hello' },
    { id: 8, name: 'Deck - Slide 2' },
  ]);
  assert.equal(await service.importFile('deck.pptx'), 2);
  const [first, second] = service.list();
  assert.equal(first.title, 'Deck - Slide 1');
  assert.equal(first.slideId, 7);
  assert.match(first.image, /^apcc-media:\/\/slide\/7$/);
  assert.equal(first.notes, 'Say hello');
  assert.equal(second.notes, null);
});

test('a text slide has no picture', () => {
  const { service } = setup([]);
  const saved = service.save({ title: 'Sermon', content: '- one', design: {} });
  assert.equal(saved.image, null);
  assert.equal(saved.slideId, null);
});

test('a slide whose picture was deleted is left out', async () => {
  const { db, service } = setup([{ id: 7, name: 'A' }, { id: 8, name: 'B' }]);
  await service.importFile('deck.pptx');
  db.prepare('DELETE FROM announcement_slides WHERE id = 7').run();
  assert.deepEqual(service.list().map((s) => s.slideId), [8]);
});

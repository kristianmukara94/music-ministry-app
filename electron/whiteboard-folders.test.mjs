// Tests the Whiteboard's folders: creating, renaming and deleting them, moving slides in and out, importing a PowerPoint into one, and that
// deleting a folder never deletes its slides. The service is the real one, on a real in-memory schema.
// Run with: node --test electron/whiteboard-folders.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { WHITEBOARD_MIGRATIONS, WHITEBOARD_POWERPOINT_MIGRATIONS, WHITEBOARD_FOLDER_MIGRATIONS, WHITEBOARD_RESTORE_MIGRATIONS, WHITEBOARD_LAYER_MIGRATIONS, WHITEBOARD_NOTES_MIGRATIONS, createWhiteboardService } = await import('./whiteboard.js');

function setup(pictures = []) {
  const db = new DatabaseSync(':memory:');
  // Only the part of Announcements the Whiteboard reads: the image slides, and their notes.
  db.exec('CREATE TABLE announcement_slides (id INTEGER PRIMARY KEY, notes TEXT)');
  for (const sql of [...WHITEBOARD_MIGRATIONS, ...WHITEBOARD_POWERPOINT_MIGRATIONS, ...WHITEBOARD_FOLDER_MIGRATIONS, ...WHITEBOARD_RESTORE_MIGRATIONS, ...WHITEBOARD_LAYER_MIGRATIONS, ...WHITEBOARD_NOTES_MIGRATIONS]) db.exec(sql);
  for (const p of pictures) db.prepare('INSERT INTO announcement_slides (id) VALUES (?)').run(p.id);
  // node:sqlite has no .transaction(); the service only needs it to group writes.
  db.transaction = (fn) => () => fn();
  const service = createWhiteboardService(db, { importDeck: async () => pictures, showOpenDialog: async () => ({ canceled: false, filePaths: ['a.pptx'] }) });
  return { db, service };
}

const text = (title, folderId) => ({ title, content: '- one', design: {}, ...(folderId === undefined ? {} : { folderId }) });

test('a folder is created with a trimmed name and starts empty', () => {
  const { service } = setup();
  const folder = service.createFolder('  Sunday   Mass  ');
  assert.deepEqual(folder, { id: folder.id, name: 'Sunday Mass', count: 0 });
  assert.deepEqual(service.listFolders().map((f) => f.name), ['Sunday Mass']);
});

test('a folder name must be given, short enough, and not already used', () => {
  const { service } = setup();
  assert.throws(() => service.createFolder('   '), /Give the folder a name/);
  assert.throws(() => service.createFolder('x'.repeat(61)), /at most 60/);
  service.createFolder('Retreat');
  assert.throws(() => service.createFolder('RETREAT'), /already a folder called "RETREAT"/);
  const other = service.createFolder('Advent');
  assert.throws(() => service.renameFolder(other.id, 'retreat'), /already a folder/);
  assert.equal(service.renameFolder(other.id, 'Christmas'), true);
  assert.deepEqual(service.listFolders().map((f) => f.name), ['Retreat', 'Christmas']);
});

test('a new slide goes into the folder it is made in; existing slides stay Unfiled', () => {
  const { service } = setup();
  const folder = service.createFolder('Sermons');
  const inFolder = service.save(text('In folder', folder.id));
  const loose = service.save(text('Loose'));
  assert.equal(inFolder.folderId, folder.id);
  assert.equal(loose.folderId, null);
  assert.equal(service.listFolders()[0].count, 1);
  // Saving an existing slide never moves it.
  assert.equal(service.save({ ...text('In folder renamed'), id: inFolder.id }).folderId, folder.id);
  assert.throws(() => service.save(text('Nowhere', 999)), /no longer exists/);
});

test('slides move between folders and back to Unfiled', () => {
  const { service } = setup();
  const a = service.createFolder('A');
  const b = service.createFolder('B');
  const one = service.save(text('One', a.id));
  const two = service.save(text('Two', a.id));
  assert.equal(service.moveSlides([one.id, two.id], b.id), 2);
  assert.deepEqual(service.listFolders().map((f) => f.count), [0, 2]);
  service.moveSlides([one.id], null);
  assert.equal(service.get(one.id).folderId, null);
  assert.throws(() => service.moveSlides([two.id], 999), /no longer exists/);
});

test('moving the selection files every picked slide in one step and counts only slides that still exist', () => {
  const { service } = setup();
  const pr = service.createFolder('PR');
  const one = service.save(text('One'));
  const two = service.save(text('Two'));
  const three = service.save(text('Three'));
  assert.equal(service.moveSelectedToFolder({ slideIds: [one.id, two.id, two.id, 9999], targetFolderId: pr.id }), 2);
  assert.deepEqual([one, two, three].map((s) => service.get(s.id).folderId), [pr.id, pr.id, null]);
  // A null target is Unfiled.
  assert.equal(service.moveSelectedToFolder({ slideIds: [one.id], targetFolderId: null }), 1);
  assert.equal(service.get(one.id).folderId, null);
  // A folder that is gone moves nothing.
  assert.throws(() => service.moveSelectedToFolder({ slideIds: [two.id, three.id], targetFolderId: 999 }), /no longer exists/);
  assert.deepEqual([two, three].map((s) => service.get(s.id).folderId), [pr.id, null]);
  assert.equal(service.moveSelectedToFolder({ slideIds: [], targetFolderId: pr.id }), 0);
});

test('deleting a folder keeps its slides, which become Unfiled', () => {
  const { service } = setup();
  const folder = service.createFolder('Old');
  const slide = service.save(text('Keep me', folder.id));
  assert.equal(service.deleteFolder(folder.id), 1);
  assert.deepEqual(service.listFolders(), []);
  assert.equal(service.get(slide.id).folderId, null);
  assert.throws(() => service.deleteFolder(folder.id), /no longer exists/);
});

test('a PowerPoint is imported into the chosen folder, or Unfiled', async () => {
  const { service } = setup([{ id: 7, name: 'Deck - Slide 1' }, { id: 8, name: 'Deck - Slide 2' }]);
  const folder = service.createFolder('Python talk');
  assert.equal(await service.importFile('deck.pptx', folder.id), 2);
  assert.deepEqual(service.list().map((s) => s.folderId), [folder.id, folder.id]);
  assert.equal(service.listFolders()[0].count, 2);
  assert.equal(await service.importPowerPoint(null, folder.id), 2);
  assert.equal(service.listFolders()[0].count, 4);
  await assert.rejects(() => service.importPowerPoint(null, 999), /no longer exists/);
});

test('a slide whose picture was deleted is not counted in its folder', async () => {
  const { db, service } = setup([{ id: 7, name: 'A' }, { id: 8, name: 'B' }]);
  const folder = service.createFolder('Deck');
  await service.importFile('deck.pptx', folder.id);
  db.prepare('DELETE FROM announcement_slides WHERE id = 7').run();
  assert.equal(service.listFolders()[0].count, 1);
});

test('Clear Unfiled deletes every Unfiled slide and keeps slides in folders', () => {
  const { db, service } = setup();
  const folder = service.createFolder('Keep');
  const kept = service.save(text('In folder', folder.id));
  service.save(text('Loose one'));
  service.save(text('Loose two'));
  // An Unfiled picture slide whose Announcements image is gone is hidden: it is cleared too, but not counted.
  db.prepare("INSERT INTO whiteboard_slides (title, slide_id) VALUES ('Orphan', 999)").run();
  assert.equal(service.clearUnfiled(), 2);
  assert.deepEqual(service.list().map((s) => s.id), [kept.id]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM whiteboard_slides WHERE folder_id IS NULL').get().n, 0);
  assert.equal(service.listFolders()[0].count, 1);
  // Nothing left to clear.
  assert.equal(service.clearUnfiled(), 0);
});

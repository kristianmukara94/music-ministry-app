// Media Library folders against the real schema. Run with: node --test electron/media-folders.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { MEDIA_MIGRATIONS, MEDIA_AUDIO_MIGRATIONS, MEDIA_FOLDER_MIGRATIONS, createMediaService } = await import('./media.js');

function open() {
  const db = new DatabaseSync(':memory:');
  for (const sql of [...MEDIA_MIGRATIONS, ...MEDIA_AUDIO_MIGRATIONS]) db.exec(sql);
  // A library from before folders: its rows must survive the migration unfiled.
  db.exec(`INSERT INTO media_assets (filename, file_path, media_type) VALUES ('Advent candles.mp4', 'media/a.mp4', 'video'), ('Choir.mp3', 'media/b.mp3', 'audio')`);
  for (const sql of MEDIA_FOLDER_MIGRATIONS) db.exec(sql);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apcc-media-folders-'));
  return { db, root, service: createMediaService(db, root, { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }) };
}

test('the liturgical folders are built in, and existing media starts unfiled', () => {
  const { service } = open();
  assert.deepEqual(
    service.listFolders().map((f) => [f.name, f.builtin]),
    [
      ['Advent', true],
      ['Lent', true],
      ['Ordinary Time', true],
      ['Feasts & Solemnities', true],
      ['Praise & Worship', true],
      ['Off-Plan Media', true],
    ],
  );
  assert.deepEqual(
    service.list().map((m) => m.folderId),
    [null, null],
  );
});

test('an item moves into a folder and back out, and only its folder changes', () => {
  const { service } = open();
  const advent = service.listFolders().find((f) => f.name === 'Advent').id;
  const [first] = service.list();
  service.moveToFolder(first.id, advent);
  const moved = service.list().find((m) => m.id === first.id);
  assert.equal(moved.folderId, advent);
  assert.equal(moved.filename, first.filename, 'the name is untouched');
  assert.equal(moved.src, first.src, 'and so is the file');

  service.moveToFolder(first.id, null);
  assert.equal(service.list().find((m) => m.id === first.id).folderId, null);
  assert.throws(() => service.moveToFolder(first.id, 9999), /no longer exists/);
});

test('the operator adds folders with unique names; deleting one unfiles its items and keeps them', () => {
  const { service } = open();
  const id = service.createFolder('  Weddings  ');
  assert.equal(service.listFolders().at(-1).name, 'Weddings', 'trimmed and listed last');
  assert.throws(() => service.createFolder('weddings'), /already a folder/, 'names are unique, ignoring case');
  assert.throws(() => service.createFolder('   '), /1 to 80/);

  const [item] = service.list();
  service.moveToFolder(item.id, id);
  assert.equal(service.deleteFolder(id), true);
  assert.equal(service.listFolders().some((f) => f.id === id), false);
  assert.equal(service.list().length, 2, 'the media stays in the library');
  assert.equal(service.list().find((m) => m.id === item.id).folderId, null);
});

test('built-in folders cannot be deleted', () => {
  const { service } = open();
  const lent = service.listFolders().find((f) => f.name === 'Lent').id;
  assert.throws(() => service.deleteFolder(lent), /Built-in/);
  assert.ok(service.listFolders().some((f) => f.id === lent));
});

test('dropped files that are not absolute paths are ignored, and nothing is imported', async () => {
  const { service } = open();
  assert.deepEqual(await service.importMedia(null, ['relative/file.mp4', 42], null), { imported: 0, failed: [] });
  assert.equal(service.list().length, 2);
});

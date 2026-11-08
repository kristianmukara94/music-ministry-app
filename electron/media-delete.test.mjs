// Deleting a library item that is on the projector: the screen lets go first, and the wait is on the real file, not the path kept in the
// database, which is relative to the asset folder and names nothing from where the app runs. Run with: node --test electron/media-delete.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import path from 'node:path';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { deleteMediaWhenFree } = await import('./media.js');

const ROOT = path.resolve('apccmma_assets');
const REL = 'media/12345678-1234-1234-1234-123456789abc.mp4';
const service = { filePath: () => REL, deleteMedia: (id) => `deleted ${id}` };

test('a file on the projector is waited for by its real path, and then deleted', async () => {
  const waited = [];
  const result = await deleteMediaWhenFree(service, ROOT, 7, {
    releaseBackground: (url) => url === 'apcc-media://media/7',
    waitForRelease: async (file) => waited.push(file),
  });
  assert.deepEqual(waited, [path.join(ROOT, 'media', '12345678-1234-1234-1234-123456789abc.mp4')]);
  assert.ok(path.isAbsolute(waited[0]));
  assert.equal(result, 'deleted 7');
});

test('a file not on the projector is deleted without waiting', async () => {
  let waits = 0;
  await deleteMediaWhenFree(service, ROOT, 7, { releaseBackground: () => false, waitForRelease: async () => (waits += 1) });
  assert.equal(waits, 0);
});

test('a path that is not one of ours is never waited on', async () => {
  let waits = 0;
  const odd = { filePath: () => '../../secret.txt', deleteMedia: () => true };
  await deleteMediaWhenFree(odd, ROOT, 7, { releaseBackground: () => true, waitForRelease: async () => (waits += 1) });
  assert.equal(waits, 0);
});

// The Secondary port serves Media Library pictures and videos to the TV screen: by library id only, behind the PIN, with byte ranges. The control
// (primary) port never serves them, and no path can be requested. Run with: node --test electron/media-route.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRemoteViewServer } from './remote-view-server.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apccmma-media-route-'));
const VIDEO = path.join(dir, 'clip.mp4');
const PICTURE = path.join(dir, 'still.png');
const bytes = Buffer.from(Array.from({ length: 600 }, (_, i) => i % 251));
fs.writeFileSync(VIDEO, bytes);
fs.writeFileSync(PICTURE, Buffer.from([137, 80, 78, 71]));
const LIBRARY = { 7: VIDEO, 8: PICTURE };
const mediaFile = (id) => LIBRARY[id] ?? null;

const DIST = fs.mkdtempSync(path.join(os.tmpdir(), 'apccmma-media-dist-'));
fs.mkdirSync(path.join(DIST, 'remote'));

async function start(role, pin = null) {
  const server = createRemoteViewServer({ distDir: DIST, role, mediaFile });
  const result = await server.start({ host: '127.0.0.1', port: 0, pin });
  assert.equal(result.ok, true);
  return { server, base: `http://127.0.0.1:${result.port}` };
}

test('a library video is served on the Secondary port, with its type', async () => {
  const { server, base } = await start('secondary');
  try {
    const response = await fetch(`${base}/api/remote/media/7`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'video/mp4');
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  } finally {
    await server.stop();
  }
});

test('a byte range is answered with 206, so the video can seek and loop', async () => {
  const { server, base } = await start('secondary');
  try {
    const response = await fetch(`${base}/api/remote/media/7`, { headers: { Range: 'bytes=500-' } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), `bytes 500-599/${bytes.length}`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(500));
  } finally {
    await server.stop();
  }
});

test('a picture is served with its type, and HEAD answers without a body', async () => {
  const { server, base } = await start('secondary');
  try {
    const picture = await fetch(`${base}/api/remote/media/8`);
    assert.equal(picture.status, 200);
    assert.equal(picture.headers.get('content-type'), 'image/png');
    const head = await fetch(`${base}/api/remote/media/7`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String(bytes.length));
  } finally {
    await server.stop();
  }
});

test('only a library id is accepted: no path, no unknown id, and no unknown or traversal request reaches a file', async () => {
  const { server, base } = await start('secondary');
  try {
    for (const bad of ['../remote-view-server.js', '7%2F..%2Fx', 'abc', '99', '7.mp4']) {
      const response = await fetch(`${base}/api/remote/media/${bad}`);
      assert.equal(response.status, 404, `"${bad}" is refused`);
    }
  } finally {
    await server.stop();
  }
});

test('the control (primary) port never serves Media Library files', async () => {
  const { server, base } = await start('primary');
  try {
    assert.equal((await fetch(`${base}/api/remote/media/7`)).status, 404);
  } finally {
    await server.stop();
  }
});

test('with a PIN set, the media is refused until the viewer has unlocked the page', async () => {
  const { server, base } = await start('secondary', '4821');
  try {
    assert.equal((await fetch(`${base}/api/remote/media/7`)).status, 401);
  } finally {
    await server.stop();
  }
});

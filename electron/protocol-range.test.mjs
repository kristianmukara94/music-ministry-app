// The media route answers a byte-range request from the file itself: a video that keeps its index at the end of the file (as many phone and camera
// exports do) can be sought and played. Each range is the exact bytes asked for, with 206 Partial Content; a range that cannot be met is 416.
// Run with: node --test electron/protocol-range.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { rangeResponse, MIME_BY_EXT } = await import('./protocol.js');

const SIZE = 1000;
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'apccmma-range-')), 'clip.mp4');
const bytes = Buffer.from(Array.from({ length: SIZE }, (_, i) => i % 251));
fs.writeFileSync(file, bytes);

const body = async (response) => Buffer.from(await response.arrayBuffer());

test('the first bytes are answered with 206 and exactly the bytes asked for', async () => {
  const response = rangeResponse(file, 'bytes=0-99');
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Range'), `bytes 0-99/${SIZE}`);
  assert.equal(response.headers.get('Content-Length'), '100');
  assert.deepEqual(await body(response), bytes.subarray(0, 100));
});

test('an open range is answered to the end of the file', async () => {
  const response = rangeResponse(file, 'bytes=900-');
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Range'), `bytes 900-${SIZE - 1}/${SIZE}`);
  assert.deepEqual(await body(response), bytes.subarray(900));
});

test('a suffix range is answered with the last bytes of the file (where a video keeps its index)', async () => {
  const response = rangeResponse(file, 'bytes=-50');
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Range'), `bytes ${SIZE - 50}-${SIZE - 1}/${SIZE}`);
  assert.deepEqual(await body(response), bytes.subarray(SIZE - 50));
});

test('a range that starts past the end, or is not a range, is answered with 416', () => {
  assert.equal(rangeResponse(file, 'bytes=1500-').status, 416);
  assert.equal(rangeResponse(file, 'bytes=-0').status, 416);
  assert.equal(rangeResponse(file, 'pages=1-2').status, 416);
});

test('the content type follows the file, so the browser reads the container', () => {
  assert.equal(MIME_BY_EXT['.mp4'], 'video/mp4');
  assert.equal(rangeResponse(file, 'bytes=0-9').headers.get('Content-Type'), 'video/mp4');
  assert.equal(MIME_BY_EXT['.png'], 'image/png');
});

// The phone and TV pages work with no internet: every file they load is served from the laptop's own build, and nothing is fetched from outside.
// The control port answers a TV address with a helper page that points to the Secondary port. Unknown paths get a 404, and the TV page itself is
// only on the Secondary port. Run with: node --test shared/remote-server.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRemoteViewServer, guidancePage } from '../electron/remote-view-server.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC_REMOTE = path.join(ROOT, 'public', 'remote');

// A build folder with the remote pages in it, as the app's build writes them.
const DIST = fs.mkdtempSync(path.join(os.tmpdir(), 'apccmma-remote-offline-'));
fs.mkdirSync(path.join(DIST, 'remote'));
for (const file of fs.readdirSync(PUBLIC_REMOTE)) fs.copyFileSync(path.join(PUBLIC_REMOTE, file), path.join(DIST, 'remote', file));

async function start(role, options = {}) {
  const server = createRemoteViewServer({ distDir: DIST, role, tvPort: () => 8788, ...options });
  const result = await server.start({ host: '127.0.0.1', port: 0, pin: null });
  assert.equal(result.ok, true);
  return { server, base: `http://127.0.0.1:${result.port}` };
}

test('the remote pages reference nothing outside the laptop: no CDN, no outside font, no outside script', () => {
  for (const file of fs.readdirSync(PUBLIC_REMOTE)) {
    const text = fs.readFileSync(path.join(PUBLIC_REMOTE, file), 'utf8');
    assert.doesNotMatch(text, /https?:\/\//, `${file} has no outside address`);
    assert.doesNotMatch(text, /(src|href)=["']\/\//, `${file} has no protocol-relative address`);
  }
});

test('the phone page and its files are served with no internet, from the laptop', async () => {
  const { server, base } = await start('primary');
  try {
    for (const url of ['/', '/remote', '/remote/', '/remote/remote.css', '/remote/common.js', '/remote/remote.js', '/remote/guide.css']) {
      assert.equal((await fetch(`${base}${url}`)).status, 200, `${url} is served`);
    }
  } finally {
    await server.stop();
  }
});

test('a TV address typed on the control port gets the helper page, which links to the TV page on the Secondary port', async () => {
  const { server, base } = await start('primary');
  try {
    for (const url of ['/tv', '/remote-view']) {
      const response = await fetch(`${base}${url}`);
      assert.equal(response.status, 200, `${url} answers with the helper page, not a blank 404`);
      assert.match(response.headers.get('content-type'), /^text\/html/);
      const html = await response.text();
      assert.match(html, /Looking for the TV Display\?/);
      const port = new URL(base).port;
      assert.match(html, new RegExp(`http://127\\.0\\.0\\.1:8788/tv`), 'the link goes to the TV page on port 8788');
      assert.match(html, /<a class="button" href="http:\/\/127\.0\.0\.1:8788\/tv">/, 'a button launches it');
      assert.doesNotMatch(html, new RegExp(`:${port}/tv`), 'the helper never points back to the control port');
    }
  } finally {
    await server.stop();
  }
});

test('the helper page has no outside assets, so it loads on a router with no internet', () => {
  const html = guidancePage('http://10.1.16.224:8788/tv', 8788);
  assert.doesNotMatch(html, /https?:\/\/(?!10\.1\.16\.224)/, 'no outside address');
  assert.doesNotMatch(html, /googleapis|unpkg|cdn/i);
  assert.match(html, /<link rel="stylesheet" href="\/remote\/guide\.css">/, 'its stylesheet is the laptop\'s own');
});

test('the helper page escapes what it is given, so a crafted host cannot inject markup', () => {
  const html = guidancePage('http://<script>x</script>/tv', '<b>8788</b>');
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('the TV page itself is served only on the Secondary port', async () => {
  fs.writeFileSync(path.join(DIST, 'tv.html'), '<!doctype html><title>TV</title>');
  const secondary = await start('secondary');
  try {
    assert.equal((await fetch(`${secondary.base}/tv`)).status, 200, 'the TV page answers on the Secondary port');
    assert.equal((await fetch(`${secondary.base}/remote/viewer.html`)).status, 200, 'the viewer page answers on the Secondary port');
  } finally {
    await secondary.server.stop();
  }
});

test('an unknown path is still a 404, not a fallback page', async () => {
  const { server, base } = await start('primary');
  try {
    for (const url of ['/no-such-page', '/remote/not-a-file.js', '/tv/extra']) {
      assert.equal((await fetch(`${base}${url}`)).status, 404, `${url} is a 404`);
    }
  } finally {
    await server.stop();
  }
});

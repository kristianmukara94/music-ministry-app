// The TV screen is the built React page, served at /tv with its assets from /assets, on the read-only (Secondary) port only. The page has no
// controls beyond the PIN form, draws the live screen as text (never as HTML), and fetches media by library id. Run with:
// node --test electron/tv-route.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRemoteViewServer } from './remote-view-server.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PUBLIC = path.join(ROOT, 'public', 'remote');
const TV_PAGE = '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="./assets/tv-abc.css"></head><body><div id="root"></div><script type="module" src="./assets/tv-abc.js"></script></body></html>';

const DIST = fs.mkdtempSync(path.join(os.tmpdir(), 'apccmma-tv-dist-'));
fs.mkdirSync(path.join(DIST, 'remote'));
fs.mkdirSync(path.join(DIST, 'assets'));
fs.writeFileSync(path.join(DIST, 'tv.html'), TV_PAGE);
fs.writeFileSync(path.join(DIST, 'assets', 'tv-abc.js'), 'console.log("tv");');
fs.writeFileSync(path.join(DIST, 'assets', 'tv-abc.css'), 'body{margin:0}');
fs.writeFileSync(path.join(DIST, 'remote', 'tv.js'), 'old vanilla script');
fs.writeFileSync(path.join(DIST, 'remote', 'viewer.html'), '<!doctype html><title>viewer</title>');
// A file beside the build folder, which no request may reach.
fs.writeFileSync(path.join(DIST, 'secret.txt'), 'not for the TV');

async function start(role) {
  const server = createRemoteViewServer({ distDir: DIST, role });
  const result = await server.start({ host: '127.0.0.1', port: 0, pin: null });
  assert.equal(result.ok, true);
  return { server, base: `http://127.0.0.1:${result.port}` };
}

test('the TV page is served at /tv on the read-only port, with its assets, and the control port serves neither', async () => {
  const secondary = await start('secondary');
  const primary = await start('primary');
  try {
    const tv = await fetch(`${secondary.base}/tv`);
    assert.equal(tv.status, 200);
    assert.match(tv.headers.get('content-type'), /^text\/html/);
    assert.equal(await tv.text(), TV_PAGE);

    const script = await fetch(`${secondary.base}/assets/tv-abc.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /^text\/javascript/);
    const style = await fetch(`${secondary.base}/assets/tv-abc.css`);
    assert.match(style.headers.get('content-type'), /^text\/css/);

    assert.equal((await fetch(`${primary.base}/tv`)).status, 404, 'the control port does not serve the TV page');
    assert.equal((await fetch(`${primary.base}/assets/tv-abc.js`)).status, 404, 'nor its assets');
  } finally {
    await secondary.server.stop();
    await primary.server.stop();
  }
});

test('only a file inside the build assets folder is served: no traversal, no folder, no other file', async () => {
  const { server, base } = await start('secondary');
  try {
    for (const bad of ['..%2Fsecret.txt', '..%2F..%2Fsecret.txt', 'sub%2Ftv-abc.js', 'tv-abc.js%2F', '%2e%2e%2fsecret.txt', '']) {
      const response = await fetch(`${base}/assets/${bad}`);
      assert.equal(response.status, 404, `"${bad}" is refused`);
    }
    assert.equal((await fetch(`${base}/secret.txt`)).status, 404, 'a file beside the build is not served');
  } finally {
    await server.stop();
  }
});

test('the old vanilla TV files are no longer served, on either port', async () => {
  const secondary = await start('secondary');
  try {
    assert.equal((await fetch(`${secondary.base}/remote/tv.js`)).status, 404);
    assert.equal((await fetch(`${secondary.base}/remote/tv.html`)).status, 404);
  } finally {
    await secondary.server.stop();
  }
  for (const file of ['tv.html', 'tv.js', 'tv.css']) {
    assert.equal(fs.existsSync(path.join(PUBLIC, file)), false, `public/remote/${file} is removed`);
  }
});

test('the TV page has no controls: its only buttons and inputs are the PIN form', () => {
  const page = fs.readFileSync(path.join(ROOT, 'src', 'tv', 'TvView.tsx'), 'utf8');
  assert.equal([...page.matchAll(/<button\b/g)].length, 1, 'one button: Open, on the PIN form');
  assert.equal([...page.matchAll(/<input\b/g)].length, 1, 'one input: the PIN');
  assert.doesNotMatch(page, /<(select|textarea)\b/);
  assert.match(page, /if \(phase === 'pin'\) \{/, 'the form is shown only while the PIN is needed');
});

test('the TV page follows the Secondary stream and unlocks with the PIN, from its own origin only', () => {
  const page = fs.readFileSync(path.join(ROOT, 'src', 'tv', 'TvView.tsx'), 'utf8');
  assert.match(page, /new EventSource\('\/api\/remote\/stream'\)/);
  assert.match(page, /fetch\('\/api\/remote\/status'/);
  assert.match(page, /fetch\('\/api\/remote\/unlock'/);
  assert.doesNotMatch(page, /https?:\/\//, 'no outside address is used');
  assert.doesNotMatch(page, /innerHTML|dangerouslySetInnerHTML/, 'no HTML from the stream');
});

test('the TV screen draws the stream as text, and takes its media by library id', () => {
  const screen = fs.readFileSync(path.join(ROOT, 'src', 'tv', 'LargeScreen.tsx'), 'utf8');
  assert.doesNotMatch(screen, /innerHTML|dangerouslySetInnerHTML/, 'no HTML from the stream');
  assert.match(screen, /\{line \|\| ' '\}/, 'each line is written as text');
  assert.match(screen, /resolveMediaUrl\(frame\.mediaId, mediaBase\)/, 'media comes by library id');
  assert.match(screen, /useEffect\(\(\) => setFailed\(false\), \[src\]\);/, 'a failed picture does not mark the next one');
});

test('the library address is built from the id alone', () => {
  const resolver = fs.readFileSync(path.join(ROOT, 'src', 'tv', 'resolveMediaUrl.ts'), 'utf8');
  assert.match(resolver, /`\$\{base\}\/api\/remote\/media\/\$\{mediaId\}`/);
  assert.doesNotMatch(resolver, /src|path|file/i, 'no path is taken');
});

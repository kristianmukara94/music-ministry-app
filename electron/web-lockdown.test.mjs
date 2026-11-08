// Every window stays on the app's own page, opens no other windows, and is given only the permissions the app uses.
// Run with: node --test electron/web-lockdown.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ALLOWED_PERMISSIONS, isOwnPage, lockDownContents, restrictPermissions } from './web-lockdown.js';

const ENTRY = path.resolve('C:/Program Files/APCCMMA/resources/app.asar/dist/index.html');
const ENTRY_URL = pathToFileURL(ENTRY).href;
const packaged = (url, platform) => isOwnPage(url, { entryFile: ENTRY, platform });
const quiet = { warn() {} };

test("the installed app's own page is its own at any route", () => {
  assert.equal(packaged(ENTRY_URL), true);
  assert.equal(packaged(`${ENTRY_URL}#/operator`), true);
  assert.equal(packaged(`${ENTRY_URL}?x=1#/projector`), true);
});

test('a dropped file, another built page, or any web address is not', () => {
  assert.equal(packaged(pathToFileURL(path.resolve('C:/Users/me/Downloads/evil.html')).href), false);
  assert.equal(packaged(pathToFileURL(path.resolve('C:/Program Files/APCCMMA/resources/app.asar/dist/remote/index.html')).href), false);
  assert.equal(packaged('https://example.com/'), false);
  assert.equal(packaged('http://localhost:5173/'), false, 'the dev server is not the installed app');
  assert.equal(packaged('data:text/html,<script>1</script>'), false);
  assert.equal(packaged('not a url'), false);
});

test('on Windows the drive letter may be written in either case', () => {
  const lower = ENTRY_URL.replace(/\/([A-Z]):/, (_m, d) => `/${d.toLowerCase()}:`);
  assert.equal(packaged(lower, 'win32'), true);
});

test('in development, the dev server is the app and nothing else is', () => {
  const dev = (url) => isOwnPage(url, { devUrl: 'http://localhost:5173', entryFile: ENTRY });
  assert.equal(dev('http://localhost:5173/#/operator'), true);
  assert.equal(dev('http://localhost:5174/'), false);
  assert.equal(dev('https://example.com/'), false);
  assert.equal(dev(ENTRY_URL), false);
});

function fakeContents() {
  const contents = new EventEmitter();
  contents.setWindowOpenHandler = (fn) => {
    contents.openHandler = fn;
  };
  return contents;
}

const navigate = (contents, url) => {
  let prevented = false;
  contents.emit('will-navigate', { url, preventDefault: () => (prevented = true) });
  return prevented;
};

test('a page cannot navigate away, and can move within the app', () => {
  const contents = fakeContents();
  lockDownContents(contents, { isAllowed: (url) => url === 'app://own', log: quiet });
  assert.equal(navigate(contents, 'https://example.com/'), true);
  assert.equal(navigate(contents, 'file:///C:/evil.html'), true);
  assert.equal(navigate(contents, 'app://own'), false);
});

test('the older event shape, with the address as an argument, is guarded too', () => {
  const contents = fakeContents();
  lockDownContents(contents, { isAllowed: () => false, log: quiet });
  let prevented = false;
  contents.emit('will-navigate', { preventDefault: () => (prevented = true) }, 'https://example.com/');
  assert.equal(prevented, true);
});

test('a page cannot open a window', () => {
  const contents = fakeContents();
  lockDownContents(contents, { isAllowed: () => true, log: quiet });
  assert.deepEqual(contents.openHandler({ url: 'https://example.com/' }), { action: 'deny' });
});

test('only full screen and clipboard writing are granted', () => {
  let handler;
  restrictPermissions({ setPermissionRequestHandler: (fn) => (handler = fn) });
  const ask = (permission) => {
    let answer;
    handler({}, permission, (granted) => (answer = granted));
    return answer;
  };
  assert.deepEqual([...ALLOWED_PERMISSIONS].sort(), ['clipboard-sanitized-write', 'fullscreen']);
  assert.equal(ask('fullscreen'), true);
  assert.equal(ask('clipboard-sanitized-write'), true);
  for (const permission of ['media', 'geolocation', 'notifications', 'midi', 'pointerLock', 'openExternal', 'display-capture', 'clipboard-read', 'unknown']) {
    assert.equal(ask(permission), false, permission);
  }
});

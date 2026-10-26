// Tests for Remote view. Run with: node --test electron/remote-view.test.mjs
// Uses only Node's built-ins, so no Electron is needed. The server tests run on 127.0.0.1 with a free port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRemoteViewServer, pickLocalAddress } from './remote-view-server.js';
import { REMOTE_VIEW_DEFAULTS, remoteViewSnapshot, sanitizeRemoteView, validateRemoteViewPatch } from '../shared/remote-view.js';
import { initialLiveState, liveReducer } from '../shared/live.js';

const queued = (labels) => labels.map((label, i) => ({ id: `${i}`, label, block: 'word', module: 'lyrics', sourceId: `${i}` }));

test('a phone sees the live text, the item title, and the next item', () => {
  let state = { ...initialLiveState(), queue: queued(['Amazing Grace', 'How Great Thou Art']), queueCursor: 0 };
  state = liveReducer(state, { type: 'output/set', output: 'projector', on: true });
  state = liveReducer(state, {
    type: 'projector/show',
    source: 'MASS_QUEUE',
    frame: { kind: 'lyrics', title: 'Amazing Grace', label: 'Verse 1', text: 'Amazing grace\nhow sweet the sound  ' },
  });
  assert.deepEqual(remoteViewSnapshot(state, 5), {
    screen: 'live',
    title: 'Amazing Grace',
    next: 'How Great Thou Art',
    position: 'Verse 1',
    lines: ['Amazing grace', 'how sweet the sound'],
    updatedAt: 5,
  });
});

test('a psalm keeps its response on screen with the verse', () => {
  const base = initialLiveState();
  const state = {
    ...base,
    outputs: { projector: true, lowerThird: false, preview: false },
    projector: {
      ...base.projector,
      live: { kind: 'psalm', title: 'Psalm 23', response: 'The Lord is my shepherd.', pages: ['Verse one.', 'Verse two.'], index: 1 },
    },
  };
  const snapshot = remoteViewSnapshot(state);
  assert.equal(snapshot.position, '2 of 2');
  assert.deepEqual(snapshot.lines, ['The Lord is my shepherd.', '', 'Verse two.']);
});

test('the screen state says when the projector is off, idle, or blacked out', () => {
  const base = initialLiveState();
  assert.equal(remoteViewSnapshot({ ...base, queue: queued(['Opening Song']), queueCursor: 0 }).screen, 'off');
  assert.equal(remoteViewSnapshot({ ...base, outputs: { ...base.outputs, projector: true } }).screen, 'idle');
  const dark = { ...base, outputs: { ...base.outputs, projector: true }, projector: { ...base.projector, live: { kind: 'blackout' } } };
  assert.equal(remoteViewSnapshot(dark).screen, 'blackout');
});

test('with no item selected, the next item is the first in the queue', () => {
  const state = { ...initialLiveState(), queue: queued(['Gloria', 'Alleluia']), queueCursor: -1 };
  const snapshot = remoteViewSnapshot(state);
  assert.equal(snapshot.title, '');
  assert.equal(snapshot.next, 'Gloria');
});

test('the welcome screen shows its message only when it is text', () => {
  const base = initialLiveState();
  const welcome = { welcomeType: 'TEXT', message: 'Welcome to Church' };
  const state = {
    ...base,
    welcome,
    outputs: { projector: true, lowerThird: false, preview: false },
    projector: { ...base.projector, live: { kind: 'welcome', lang: 'en' } },
  };
  assert.deepEqual(remoteViewSnapshot(state).lines, ['Welcome to Church']);
  assert.deepEqual(remoteViewSnapshot({ ...state, welcome: { ...welcome, welcomeType: 'IMAGE' } }).lines, []);
});

test('settings fall back to the defaults when a value is wrong', () => {
  assert.deepEqual(sanitizeRemoteView(null), REMOTE_VIEW_DEFAULTS);
  assert.deepEqual(sanitizeRemoteView({ enabled: 'yes', port: 80, pin: '12a4' }), { enabled: false, port: 3003, pin: null });
  assert.deepEqual(sanitizeRemoteView({ enabled: true, port: 4000, pin: '2468' }), { enabled: true, port: 4000, pin: '2468' });
});

test('a bad port or PIN is refused with a message; no PIN is allowed', () => {
  assert.throws(() => validateRemoteViewPatch({ port: 80 }), /port/);
  assert.throws(() => validateRemoteViewPatch({ pin: '123' }), /4 to 8 digits/);
  assert.throws(() => validateRemoteViewPatch({ pin: '123456789' }), /4 to 8 digits/);
  assert.doesNotThrow(() => validateRemoteViewPatch({ pin: null }));
  assert.doesNotThrow(() => validateRemoteViewPatch({ pin: '' }));
  assert.doesNotThrow(() => validateRemoteViewPatch({ pin: '123456' }));
});

test('the phone address is a private Wi-Fi or wired address, never a virtual adapter or a public one', () => {
  const entries = [
    { name: 'vEthernet (Default Switch)', family: 'IPv4', internal: false, address: '192.168.56.1' },
    { name: 'Wi-Fi', family: 'IPv4', internal: false, address: '192.168.1.20' },
    { name: 'Loopback', family: 'IPv4', internal: true, address: '127.0.0.1' },
    { name: 'Ethernet', family: 'IPv6', internal: false, address: 'fe80::1' },
  ];
  assert.equal(pickLocalAddress(entries), '192.168.1.20');
  assert.equal(pickLocalAddress([{ name: 'Ethernet', family: 'IPv4', internal: false, address: '172.20.4.9' }]), '172.20.4.9');
  assert.equal(pickLocalAddress([{ name: 'Ethernet', family: 'IPv4', internal: false, address: '8.8.8.8' }]), null);
  assert.equal(pickLocalAddress([]), null);
});

// ---- The server, over real HTTP on 127.0.0.1 ----

function makeDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-view-test-'));
  fs.mkdirSync(path.join(dir, 'remote'));
  fs.writeFileSync(path.join(dir, 'remote', 'index.html'), '<!doctype html>phone page');
  fs.writeFileSync(path.join(dir, 'remote', 'remote.js'), 'void 0;');
  fs.writeFileSync(path.join(dir, 'index.html'), 'the laptop app');
  return dir;
}

function request(port, { method = 'GET', path: target = '/', body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const req = http.request({ host: '127.0.0.1', port, method, path: target, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

/** Opens the live stream. Resolves with the status, and the response and request when it opened. */
function openStream(port, cookie) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/remote/stream', headers: cookie ? { Cookie: cookie } : {} }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return resolve({ status: res.statusCode, req });
      }
      res.setEncoding('utf8');
      resolve({ status: 200, req, res });
    });
    req.on('error', reject);
  });
}

/** The next message the stream sends. */
const nextMessage = (res) => new Promise((resolve) => res.once('data', resolve));

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startOn(server, pin = null) {
  const result = await server.start({ host: '127.0.0.1', port: 0, pin });
  assert.equal(result.ok, true);
  return result.port;
}

test('the page and live screen are served on the local network with no outside links', async () => {
  const server = createRemoteViewServer({ distDir: makeDist() });
  const port = await startOn(server);
  try {
    const page = await request(port, { path: '/' });
    assert.equal(page.status, 200);
    assert.match(page.text, /phone page/);
    assert.match(page.headers['content-security-policy'], /default-src 'self'/);

    assert.equal((await request(port, { path: '/remote/remote.js' })).status, 200);
    assert.equal((await request(port, { path: '/remote/%2e%2e/index.html' })).status, 404, 'the page cannot read outside its folder');
    assert.equal((await request(port, { path: '/index.html' })).status, 404, 'the laptop app is not served');
    assert.equal((await request(port, { path: '/lower-third' })).status, 404);

    const status = JSON.parse((await request(port, { path: '/api/remote/status' })).text);
    assert.deepEqual(status, { pinRequired: false, unlocked: true });
  } finally {
    await server.stop();
  }
});

test('the page is read-only: it accepts no change except the PIN', async () => {
  const server = createRemoteViewServer({ distDir: makeDist() });
  const port = await startOn(server);
  try {
    assert.equal((await request(port, { method: 'POST', path: '/api/remote/stream', body: {} })).status, 405);
    assert.equal((await request(port, { method: 'POST', path: '/remote/remote.js', body: {} })).status, 405);
    assert.equal((await request(port, { method: 'POST', path: '/api/remote/status', body: {} })).status, 405);
  } finally {
    await server.stop();
  }
});

test('phones receive the latest live screen, then each update, and a closed phone is no longer counted', async () => {
  const server = createRemoteViewServer({ distDir: makeDist() });
  const port = await startOn(server);
  try {
    server.push({ screen: 'live', title: 'First' });
    const opened = await openStream(port);
    assert.equal(opened.status, 200);
    assert.match(await nextMessage(opened.res), /"title":"First"/);
    assert.equal(server.devices(), 1);

    const update = nextMessage(opened.res);
    server.push({ screen: 'live', title: 'Second' });
    assert.match(await update, /"title":"Second"/);

    opened.req.destroy();
    await pause(50);
    assert.equal(server.devices(), 0);
  } finally {
    await server.stop();
  }
});

test('with a PIN, nothing is sent until the right PIN is given', async () => {
  const server = createRemoteViewServer({ distDir: makeDist() });
  const port = await startOn(server, '4821');
  try {
    server.push({ screen: 'live', title: 'Secret lyrics' });
    assert.deepEqual(JSON.parse((await request(port, { path: '/api/remote/status' })).text), { pinRequired: true, unlocked: false });

    const locked = await openStream(port);
    assert.equal(locked.status, 401);
    assert.equal(locked.res, undefined);
    locked.req.destroy();

    const wrong = await request(port, { method: 'POST', path: '/api/remote/unlock', body: { pin: '0000' } });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers['set-cookie'], undefined);

    const right = await request(port, { method: 'POST', path: '/api/remote/unlock', body: { pin: '4821' } });
    assert.equal(right.status, 200);
    assert.match(right.headers['set-cookie'][0], /^apccmma_remote=[0-9a-f]{48}; Path=\/; HttpOnly; SameSite=Strict$/);
    const cookie = right.headers['set-cookie'][0].split(';')[0];

    const unlocked = await openStream(port, cookie);
    assert.equal(unlocked.status, 200);
    assert.match(await nextMessage(unlocked.res), /Secret lyrics/);
    unlocked.req.destroy();
  } finally {
    await server.stop();
  }
});

test('wrong PINs pause the unlock after five tries', async () => {
  const server = createRemoteViewServer({ distDir: makeDist() });
  const port = await startOn(server, '4821');
  try {
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await request(port, { method: 'POST', path: '/api/remote/unlock', body: { pin: '0000' } })).status, 401);
    }
    const paused = await request(port, { method: 'POST', path: '/api/remote/unlock', body: { pin: '4821' } });
    assert.equal(paused.status, 429, 'the right PIN is refused while the pause lasts');
  } finally {
    await server.stop();
  }
});

test('stopping the page ends the connections and frees the port', async () => {
  const server = createRemoteViewServer({ distDir: makeDist() });
  const port = await startOn(server);
  const opened = await openStream(port);
  assert.equal(opened.status, 200);
  await server.stop();
  assert.equal(server.running(), false);
  await assert.rejects(request(port, { path: '/' }), { code: 'ECONNREFUSED' });
});

test('a taken port moves to the next free one, and the address says which', async () => {
  const first = createRemoteViewServer({ distDir: makeDist() });
  const taken = await startOn(first);
  const second = createRemoteViewServer({ distDir: makeDist() });
  try {
    const result = await second.start({ host: '127.0.0.1', port: taken, pin: null });
    assert.equal(result.ok, true);
    assert.equal(result.port, taken + 1);
    assert.equal(second.port(), taken + 1);
  } finally {
    await second.stop();
    await first.stop();
  }
});

test('the page does not start on an address the laptop does not have', async () => {
  const server = createRemoteViewServer({ distDir: makeDist() });
  const result = await server.start({ host: '203.0.113.1', port: 0, pin: null });
  assert.equal(result.ok, false);
  assert.equal(server.running(), false);
});

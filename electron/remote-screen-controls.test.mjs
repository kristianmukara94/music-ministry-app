// Tests for Welcome Screen and Blackout from the Primary viewer. Run with: node --test electron/remote-screen-controls.test.mjs
// Node built-ins only. The servers run on 127.0.0.1 with a free port, and the live state is the real shared reducer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRemoteViewServer } from './remote-view-server.js';
import { initialLiveState, liveReducer } from '../shared/live.js';
import { controlAction, remoteViewSnapshot, secondaryViewSnapshot, snapshotForRole } from '../shared/remote-view.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DECK = {
  kind: 'deck',
  title: 'Sample Item Title',
  slides: [[{ role: 'reader', text: 'Sample Slide Line' }], [{ role: 'reader', text: 'Sample Next Line' }]],
  index: 0,
};

function liveState() {
  let s = initialLiveState();
  s = liveReducer(s, { type: 'output/toggle', output: 'projector' });
  return liveReducer(s, { type: 'projector/show', frame: DECK, source: 'DIRECT_DECK' });
}

function fixtureDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apccmma-screen-'));
  fs.mkdirSync(path.join(dir, 'remote'));
  for (const file of ['index.html', 'viewer.html', 'common.js', 'remote.js', 'viewer.js', 'remote.css', 'guide.css']) fs.writeFileSync(path.join(dir, 'remote', file), 'x');
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

/** Opens the live stream and collects every snapshot it sends. */
function watch(port, cookie) {
  const messages = [];
  const req = http.get({ host: '127.0.0.1', port, path: '/api/remote/stream', headers: cookie ? { Cookie: cookie } : {} }, (res) => {
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      for (const line of chunk.split('\n')) if (line.startsWith('data: ')) messages.push(JSON.parse(line.slice(6)));
    });
  });
  req.on('error', () => undefined);
  return { messages, close: () => req.destroy() };
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A Primary viewer wired the way the main process wires it: its control requests go through controlAction and the reducer, and each state is pushed. */
async function primaryFixture(pin = null) {
  const box = { state: liveState(), actions: [] };
  let viewer;
  const apply = (action) => {
    box.actions.push(action);
    box.state = liveReducer(box.state, action);
    viewer.push(remoteViewSnapshot(box.state));
  };
  viewer = createRemoteViewServer({
    distDir: fixtureDir(),
    role: 'primary',
    onControl: (request) => {
      const result = controlAction(box.state, request, { now: 1000, lang: 'en' });
      if (result.ok && result.action) apply(result.action);
      return result;
    },
  });
  const started = await viewer.start({ host: '127.0.0.1', port: 0, pin });
  assert.equal(started.ok, true);
  viewer.push(remoteViewSnapshot(box.state));
  return { box, viewer, port: viewer.port(), apply };
}

test('the Primary snapshot carries the screen flags, and they follow the desktop buttons', () => {
  let s = liveState();
  assert.deepEqual(
    ['blackoutActive', 'welcomeActive', 'projectorPaused', 'projectorLive'].map((k) => remoteViewSnapshot(s)[k]),
    [false, false, false, true],
  );
  s = liveReducer(s, { type: 'projector/blackout' });
  assert.equal(remoteViewSnapshot(s).blackoutActive, true);
  assert.equal(remoteViewSnapshot(s).screen, 'blackout');
  s = liveReducer(s, { type: 'projector/blackout' });
  s = liveReducer(s, { type: 'projector/welcome', on: true, frame: { kind: 'welcome', lang: 'en' } });
  assert.equal(remoteViewSnapshot(s).welcomeActive, true);
  assert.equal(remoteViewSnapshot(s).blackoutActive, false);
  s = liveReducer(s, { type: 'projector/pause' });
  assert.equal(remoteViewSnapshot(s).projectorPaused, true);
  s = liveReducer(s, { type: 'output/toggle', output: 'projector' });
  assert.equal(remoteViewSnapshot(s).projectorLive, false);
});

test('the Secondary snapshot never carries the screen flags', () => {
  const s = liveReducer(liveState(), { type: 'projector/blackout' });
  const full = { ...remoteViewSnapshot(s) };
  for (const key of ['blackoutActive', 'welcomeActive', 'projectorPaused', 'projectorLive']) {
    assert.ok(key in full);
    assert.equal(key in snapshotForRole(full, 'secondary'), false);
    assert.equal(key in secondaryViewSnapshot(s), false);
  }
});

test('blackout and welcome toggle, or take an explicit on or off, through the desktop reducer actions', () => {
  let s = liveState();
  assert.deepEqual(controlAction(s, { action: 'blackout' }), { ok: true, action: { type: 'projector/blackout' } });
  assert.deepEqual(controlAction(s, { action: 'blackout', on: true }).action, { type: 'projector/blackout' });
  assert.equal(controlAction(s, { action: 'blackout', on: false }).action, null, 'already off: nothing to do');
  const welcome = controlAction(s, { action: 'welcome' }, { now: 42, lang: 'tl' });
  assert.deepEqual(welcome.action, { type: 'projector/welcome', on: true, frame: { kind: 'welcome', lang: 'tl', shownAt: 42, slide: 0, slideAt: 42 } });

  s = liveReducer(s, welcome.action);
  assert.equal(s.projector.live.kind, 'welcome');
  assert.equal(controlAction(s, { action: 'welcome', on: true }).action, null, 'a double tap cannot flip it off');
  assert.deepEqual(controlAction(s, { action: 'welcome' }).action, { type: 'projector/welcome', on: false });
  s = liveReducer(s, controlAction(s, { action: 'blackout' }).action);
  assert.equal(s.projector.live.kind, 'blackout');
  s = liveReducer(s, controlAction(s, { action: 'blackout', on: false }).action);
  assert.notEqual(s.projector.live.kind, 'blackout');
  assert.equal(controlAction(s, { action: 'blackout', on: 'yes' }).status, 400);
});

test('blackout and welcome work while paused, like the desktop buttons; slide steps do not', () => {
  const paused = liveReducer(liveState(), { type: 'projector/pause' });
  assert.equal(controlAction(paused, { action: 'next' }).ok, false);
  assert.equal(controlAction(paused, { action: 'blackout' }).ok, true);
  assert.equal(controlAction(paused, { action: 'welcome' }).ok, true);
  const out = liveReducer(paused, controlAction(paused, { action: 'blackout' }).action);
  assert.equal(out.projector.live.kind, 'blackout');
});

test('a Primary phone press reaches the reducer and is pushed to every Primary phone at once', async () => {
  const { box, viewer, port } = await primaryFixture();
  const phone = watch(port);
  await pause(50);
  assert.equal(phone.messages.at(-1).blackoutActive, false);

  const reply = await request(port, { method: 'POST', path: '/api/remote/control', body: { action: 'blackout', on: true } });
  assert.equal(reply.status, 200);
  assert.equal(box.state.projector.live.kind, 'blackout', 'the desktop projector state changed');
  await pause(50);
  assert.equal(phone.messages.at(-1).blackoutActive, true);
  assert.equal(phone.messages.at(-1).screen, 'blackout');

  // The desktop top bar's own action is mirrored to the phone too.
  box.state = liveReducer(box.state, { type: 'projector/blackout' });
  viewer.push(remoteViewSnapshot(box.state));
  await pause(50);
  assert.equal(phone.messages.at(-1).blackoutActive, false);

  const welcome = await request(port, { method: 'POST', path: '/api/remote/control', body: { action: 'welcome' } });
  assert.equal(welcome.status, 200);
  await pause(50);
  assert.equal(phone.messages.at(-1).welcomeActive, true);
  assert.equal(box.state.projector.live.kind, 'welcome');
  phone.close();
  await viewer.stop();
});

test('the Primary commands need the PIN session', async () => {
  const { box, viewer, port } = await primaryFixture('4821');
  const body = { action: 'blackout', on: true };
  const locked = await request(port, { method: 'POST', path: '/api/remote/control', body });
  assert.equal(locked.status, 401);
  assert.equal(box.actions.length, 0, 'nothing reached the projector');
  const unlock = await request(port, { method: 'POST', path: '/api/remote/unlock', body: { pin: '4821' } });
  const cookie = unlock.headers['set-cookie'][0].split(';')[0];
  assert.equal((await request(port, { method: 'POST', path: '/api/remote/control', body, cookie })).status, 200);
  assert.equal(box.state.projector.live.kind, 'blackout');
  // Only a JSON body is accepted.
  const form = await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/remote/control', headers: { Cookie: cookie, 'Content-Type': 'text/plain' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.end('action=welcome');
  });
  assert.equal(form, 415);
  await viewer.stop();
});

test('the read-only Secondary viewer refuses blackout and welcome with 403 and changes nothing', async () => {
  const calls = [];
  const secondary = createRemoteViewServer({ distDir: fixtureDir(), role: 'secondary', onControl: (request) => (calls.push(request), { ok: true }) });
  assert.equal((await secondary.start({ host: '127.0.0.1', port: 0, pin: null })).ok, true);
  for (const body of [{ action: 'blackout' }, { action: 'welcome', on: true }]) {
    const reply = await request(secondary.port(), { method: 'POST', path: '/api/remote/control', body });
    assert.equal(reply.status, 403);
  }
  assert.deepEqual(calls, []);
  await secondary.stop();
});

test('the phone page has both buttons, big touch targets, and no fixed width that could overflow a narrow screen', () => {
  const html = fs.readFileSync(path.join(root, 'public/remote/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public/remote/remote.css'), 'utf8');
  assert.match(html, /id="welcome"[^>]*aria-pressed="false"/);
  assert.match(html, /id="blackout"[^>]*aria-pressed="false"/);
  assert.match(html, /<span>Welcome Screen<\/span>/);
  assert.match(html, /<span>Blackout<\/span>/);
  assert.match(html, /id="screen-banner"/);
  // The buttons come after Previous and Next, so they are not under the thumb while stepping.
  assert.ok(html.indexOf('id="next"') < html.indexOf('id="welcome"'));
  const block = (selector) => new RegExp(`${selector.replace(/[.[\]()]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  assert.match(block('.screen-button'), /min-height:\s*(4[4-9]|[5-9]\d)px/);
  assert.match(block('.screen-button'), /min-width:\s*0/);
  assert.match(block('.screen-buttons'), /repeat\(2, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(block('.screen-button') + block('.screen-buttons') + block('.screen-controls'), /(^|[;\s])width:\s*\d+px/);
  assert.match(block(".screen-button.welcome[aria-pressed='true']"), /var\(--gold\)/);
  assert.match(block(".screen-button.blackout[aria-pressed='true']"), /#c62828/);
});

/** A small stand-in for the page, enough to run remote.js and read what it draws. */
function runPhonePage() {
  const nodes = new Map();
  const makeNode = (id) => {
    const node = {
      id,
      hidden: false,
      disabled: false,
      textContent: '',
      dataset: {},
      children: [],
      attrs: {},
      listeners: {},
      classes: new Set(),
      classList: { toggle: (name, on) => (on ? node.classes.add(name) : node.classes.delete(name)) },
      setAttribute(name, value) {
        node.attrs[name] = value;
      },
      getAttribute: (name) => node.attrs[name] ?? null,
      addEventListener(type, fn) {
        node.listeners[type] = fn;
      },
      replaceChildren(...kids) {
        node.children = kids;
      },
    };
    return node;
  };
  const document = {
    getElementById: (id) => nodes.get(id) ?? (nodes.set(id, makeNode(id)), nodes.get(id)),
    querySelector: () => makeNode('x'),
    createElement: () => makeNode('made'),
  };
  const sent = [];
  let render;
  const window = { ApccmmaRemote: { SCREEN_TEXT: { live: 'On screen' }, showSlideImage() {}, start: (fn) => (render = fn) } };
  const fetch = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({}) };
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/remote/remote.js'), 'utf8'), { document, window, fetch });
  const snapshot = (flags) => ({ screen: 'live', title: 'Sample Item Title', next: null, position: null, lines: ['Sample Slide Line'], nextLines: ['Sample Next Line'], sections: null, lineup: null, paused: false, ...flags });
  return { nodes, sent, render: (flags) => render(snapshot(flags)), snapshot };
}

test('the phone page lights each button and shows a banner when Welcome Screen or Blackout is on', () => {
  const page = runPhonePage();
  page.render({ blackoutActive: false, welcomeActive: false });
  assert.equal(page.nodes.get('blackout').attrs['aria-pressed'], 'false');
  assert.equal(page.nodes.get('screen-banner').hidden, true);

  page.render({ blackoutActive: true, welcomeActive: false });
  assert.equal(page.nodes.get('blackout').attrs['aria-pressed'], 'true');
  assert.equal(page.nodes.get('welcome').attrs['aria-pressed'], 'false');
  assert.equal(page.nodes.get('screen-banner').hidden, false);
  assert.match(page.nodes.get('screen-banner').textContent, /Blackout is on/);
  assert.ok(page.nodes.get('screen-banner').classes.has('blackout'));

  page.render({ blackoutActive: false, welcomeActive: true });
  assert.equal(page.nodes.get('welcome').attrs['aria-pressed'], 'true');
  assert.match(page.nodes.get('screen-banner').textContent, /Welcome Screen is on/);
  assert.equal(page.nodes.get('screen-banner').classes.has('blackout'), false);
});

test('tapping a screen button changes it at once and sends an explicit on or off', async () => {
  const page = runPhonePage();
  page.render({ blackoutActive: false, welcomeActive: false });
  const tap = page.nodes.get('blackout').listeners.click();
  assert.equal(page.nodes.get('blackout').attrs['aria-pressed'], 'true', 'optimistic, before the laptop answers');
  await tap;
  assert.deepEqual(page.sent, [{ action: 'blackout', on: true }]);

  page.render({ blackoutActive: true, welcomeActive: false });
  await page.nodes.get('blackout').listeners.click();
  assert.deepEqual(page.sent.at(-1), { action: 'blackout', on: false });
  await page.nodes.get('welcome').listeners.click();
  assert.deepEqual(page.sent.at(-1), { action: 'welcome', on: true });
});

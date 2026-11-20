// Tests for the desktop colour theme sync: a theme change becomes one debounced push with theme and themeUpdatedAt, an offline change is
// kept dirty and retried, and a laptop that is not linked sends it when the cloud sync resumes. Also the cloud client's pushTheme, the
// config.json state, the ?theme= website links and the main-process wiring. Run with: node --test electron/theme-sync.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createThemeSync, THEME_PUSH_DEBOUNCE_MS, THEME_RETRY_MS } from './theme-sync.js';
import { createCloudDevice } from './cloud-device.js';
import { readConfig, writeConfig } from './config.js';
import { paintedTheme, withThemeParam } from '../shared/theme-catalog.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const T0 = Date.parse('2026-11-20T09:00:00.000Z');

/** Fake timers: each scheduled callback waits until the test runs it. */
function fakeTimers() {
  let next = 1;
  const pending = new Map();
  return {
    setTimer: (fn, ms) => {
      const id = next++;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimer: (id) => pending.delete(id),
    delays: () => [...pending.values()].map((t) => t.ms),
    async fireAll() {
      const due = [...pending.entries()];
      pending.clear();
      for (const [, timer] of due) timer.fn();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

/** A theme sync over an in-memory config, a fake clock and a push the test controls. */
function harness({ initial = null, fail = null } = {}) {
  const timers = fakeTimers();
  let saved = initial;
  let clock = T0;
  const sent = [];
  const control = { fail };
  const sync = createThemeSync({
    readState: () => saved,
    writeState: (state) => {
      saved = state;
    },
    push: async (change) => {
      sent.push(change);
      if (control.fail) throw control.fail;
      return { applied: true, ...change };
    },
    now: () => clock,
    ...timers,
  });
  return {
    sync,
    timers,
    sent,
    control,
    saved: () => saved,
    tick: (ms) => {
      clock += ms;
    },
  };
}

const offline = () => Object.assign(new Error('offline'), { retry: true });
const notLinked = () => Object.assign(new Error('not linked'), { revoked: true });

test('a theme change is saved dirty with its time and pushed once, 300 ms later', async () => {
  const h = harness();
  h.sync.themeChanged('black-gold');
  assert.deepEqual(h.saved(), { theme: 'black-gold', updatedAt: '2026-11-20T09:00:00.000Z', dirty: true });
  assert.deepEqual(h.timers.delays(), [THEME_PUSH_DEBOUNCE_MS]);
  assert.equal(THEME_PUSH_DEBOUNCE_MS, 300);
  assert.equal(h.sent.length, 0, 'nothing is sent before the debounce');
  await h.timers.fireAll();
  assert.deepEqual(h.sent, [{ theme: 'black-gold', themeUpdatedAt: '2026-11-20T09:00:00.000Z' }]);
  assert.equal(h.saved().dirty, false);
  assert.equal(h.sync.status().themeDirty, false);
});

test('rapid toggling sends only the final theme', async () => {
  const h = harness();
  for (const theme of ['mint', 'sage', 'linen', 'wine']) {
    h.sync.themeChanged(theme);
    h.tick(100);
  }
  assert.equal(h.timers.delays().length, 1, 'each change restarts the one debounce');
  await h.timers.fireAll();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].theme, 'wine');
  assert.equal(h.sent[0].themeUpdatedAt, new Date(T0 + 300).toISOString());
});

test('the same theme again sends nothing, and season-auto or unknown ids are never sent', async () => {
  const h = harness({ initial: { theme: 'lent', updatedAt: '2026-11-01T00:00:00.000Z', dirty: false } });
  h.sync.themeChanged('lent');
  h.sync.themeChanged('season-auto');
  h.sync.themeChanged('blue');
  assert.deepEqual(h.timers.delays(), []);
  assert.equal(h.saved().updatedAt, '2026-11-01T00:00:00.000Z');
});

test('offline: the change stays dirty, retries with backoff, and is cleared once the cloud takes it', async () => {
  const h = harness({ fail: offline() });
  h.sync.themeChanged('deep-teal');
  await h.timers.fireAll();
  assert.equal(h.saved().dirty, true);
  assert.equal(h.sync.status().status, 'offline');
  assert.deepEqual(h.timers.delays(), [THEME_RETRY_MS[0]]);
  await h.timers.fireAll();
  assert.deepEqual(h.timers.delays(), [THEME_RETRY_MS[1]], 'the wait grows');
  h.control.fail = null;
  await h.timers.fireAll();
  assert.equal(h.sent.length, 3);
  assert.ok(h.sent.every((s) => s.theme === 'deep-teal' && s.themeUpdatedAt === '2026-11-20T09:00:00.000Z'), 'the original time is kept');
  assert.equal(h.saved().dirty, false);
  assert.deepEqual(h.timers.delays(), []);
});

test('not linked: kept dirty with no timer, and sent as soon as the cloud sync resumes', async () => {
  const h = harness({ fail: notLinked() });
  h.sync.themeChanged('slate');
  await h.timers.fireAll();
  assert.equal(h.saved().dirty, true);
  assert.deepEqual(h.timers.delays(), []);
  assert.equal(h.sync.status().status, 'waiting');
  h.control.fail = null;
  h.sync.resume();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.sent.at(-1).theme, 'slate');
  assert.equal(h.saved().dirty, false);
});

test('a dirty theme left from the last run is sent at start-up', async () => {
  const h = harness({ initial: { theme: 'burgundy', updatedAt: '2026-11-19T20:00:00.000Z', dirty: true } });
  h.sync.themeChanged('burgundy');
  h.sync.resume();
  await h.timers.fireAll();
  assert.deepEqual(h.sent, [{ theme: 'burgundy', themeUpdatedAt: '2026-11-19T20:00:00.000Z' }]);
  assert.equal(h.saved().dirty, false);
  // Nothing dirty: resume does nothing.
  h.sync.resume();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.sent.length, 1);
});

test('a change made while a push is in flight is sent after it, not lost', async () => {
  const timers = fakeTimers();
  let saved = null;
  const sent = [];
  let release;
  const sync = createThemeSync({
    readState: () => saved,
    writeState: (s) => {
      saved = s;
    },
    push: (change) => {
      sent.push(change.theme);
      return sent.length === 1 ? new Promise((r) => (release = r)) : Promise.resolve();
    },
    now: () => T0 + sent.length,
    ...timers,
  });
  sync.themeChanged('mint');
  await timers.fireAll();
  sync.themeChanged('sage');
  release();
  await new Promise((resolve) => setImmediate(resolve));
  await timers.fireAll();
  assert.deepEqual(sent, ['mint', 'sage']);
  assert.equal(saved.theme, 'sage');
  assert.equal(saved.dirty, false);
});

test('a theme the server refuses for good is not retried for ever', async () => {
  const h = harness({ fail: new Error('That theme is not one the planner knows.') });
  h.sync.themeChanged('olive');
  await h.timers.fireAll();
  assert.equal(h.saved().dirty, false);
  assert.equal(h.sync.status().status, 'error');
  assert.deepEqual(h.timers.delays(), []);
});

// ---- The cloud client ----

function cloudWith(reply) {
  const calls = [];
  const storage = { encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() };
  let file = Buffer.from(JSON.stringify({ token: 'sample-token', churchName: 'Sample Parish' }));
  const device = createCloudDevice({
    storage,
    file: { read: () => file, write: (b) => (file = b), remove: () => (file = null) },
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      if (reply === 'network') throw new TypeError('fetch failed');
      return { ok: reply.status < 300, status: reply.status, headers: new Map(), text: async () => reply.text ?? JSON.stringify(reply.body ?? {}) };
    },
    baseUrl: 'https://planner.example.org/',
  });
  return { device, calls, linked: () => file !== null };
}

test('pushTheme posts theme and themeUpdatedAt to theme-sync with the laptop token', async () => {
  const { device, calls } = cloudWith({ status: 200, body: { applied: true, theme: 'mint', themeUpdatedAt: '2026-11-20T09:00:00.000Z' } });
  const result = await device.pushTheme({ theme: 'mint', themeUpdatedAt: '2026-11-20T09:00:00.000Z' });
  assert.deepEqual(result, { applied: true, theme: 'mint', themeUpdatedAt: '2026-11-20T09:00:00.000Z' });
  assert.equal(calls[0].url, 'https://planner.example.org/api/theme-sync');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sample-token');
  assert.deepEqual(JSON.parse(calls[0].init.body), { theme: 'mint', themeUpdatedAt: '2026-11-20T09:00:00.000Z' });
});

test('pushTheme marks passing failures for retry, unlinks on 401, and leaves a plain refusal unmarked', async () => {
  for (const reply of ['network', { status: 404, body: { error: 'Not found.' } }, { status: 503, body: { error: 'later' } }, { status: 429, body: {} }, { status: 200, text: '<html>' }]) {
    await assert.rejects(cloudWith(reply).device.pushTheme({ theme: 'mint', themeUpdatedAt: '2026-11-20T09:00:00.000Z' }), (err) => err.retry === true);
  }
  const revoked = cloudWith({ status: 401, body: { error: 'This laptop is not linked to a church.' } });
  await assert.rejects(revoked.device.pushTheme({ theme: 'mint', themeUpdatedAt: '2026-11-20T09:00:00.000Z' }), (err) => err.revoked === true);
  assert.equal(revoked.linked(), false);
  await assert.rejects(cloudWith({ status: 400, body: { error: 'Bad theme.' } }).device.pushTheme({ theme: 'mint', themeUpdatedAt: 'x' }), (err) => !err.retry && !err.revoked);
});

// ---- Config, links and wiring ----

test('config.json keeps the theme sync state and drops a bad one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apcc-theme-'));
  try {
    writeConfig(dir, { theme_sync: { theme: 'wine', updatedAt: '2026-11-20T09:00:00.000Z', dirty: true } });
    assert.deepEqual(readConfig(dir).theme_sync, { theme: 'wine', updatedAt: '2026-11-20T09:00:00.000Z', dirty: true });
    writeConfig(dir, { theme_sync: { theme: 'season-auto', updatedAt: '2026-11-20T09:00:00.000Z', dirty: true } });
    assert.equal(readConfig(dir).theme_sync, null);
    writeConfig(dir, { theme_sync: { theme: 'wine', updatedAt: 'soon' } });
    assert.equal(readConfig(dir).theme_sync, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Automatic is sent as the season it paints', () => {
  assert.equal(paintedTheme('season-auto', new Date('2026-12-01T12:00:00')), 'advent');
  assert.equal(paintedTheme('wine'), 'wine');
  assert.equal(paintedTheme('nonsense'), 'obsidian');
});

test('website links from the laptop carry ?theme=, other addresses do not change', () => {
  const site = 'https://planner.example.org';
  assert.equal(withThemeParam('https://planner.example.org/plan/mass.html?id=1#top', 'lent', site), 'https://planner.example.org/plan/mass.html?id=1&theme=lent#top');
  assert.equal(withThemeParam('https://planner.example.org/?theme=mint', 'sage', site), 'https://planner.example.org/?theme=sage');
  assert.equal(withThemeParam('https://elsewhere.example.com/', 'lent', site), 'https://elsewhere.example.com/');
  assert.equal(withThemeParam('https://planner.example.org/', 'season-auto', site), 'https://planner.example.org/');
  assert.equal(withThemeParam('not a url', 'lent', site), 'not a url');
});

test('the main process sends every saved theme, resumes after song sync and linking, and opens the website with ?theme=', () => {
  const main = fs.readFileSync(path.join(here, 'main.js'), 'utf8');
  const settings = fs.readFileSync(path.join(here, 'settings.js'), 'utf8');
  assert.match(main, /onThemeSaved: \(id\) => themeSync\.themeChanged\(paintedTheme\(id\)\)/);
  assert.match(settings, /deps\.onThemeSaved\?\.\(saved\)/);
  assert.match(main, /const counts = await cloud\(\)\.pushSongs\(songs\);\s*\/\/[^\n]*\n\s*themeSync\.resume\(\);/);
  assert.match(main, /if \(result\?\.linked\) themeSync\.resume\(\);/);
  assert.match(main, /shell\.openExternal\(withThemeParam\(launch\.url, currentPaintedTheme\(\), cloudUrl\(\)\)\)/);
  assert.match(main, /ipcMain\.handle\('cloud:open-website'/);
  assert.match(main, /themeSync\.themeChanged\(currentPaintedTheme\(\)\);\s*themeSync\.resume\(\);/);
});

// The website's colour theme: the laptop's own themes (web/css/theme-tokens.css), set before first paint by web/js/theme-init.js from
// ?theme=, localStorage or the default, and kept live by web/js/theme-sync.js polling /api/theme. Synthetic fixtures only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { startThemeSync, THEME_POLL_MS, THEME_POLL_MAX_MS } from '../../web/js/theme-sync.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '..', '..', 'web');
const read = (file) => fs.readFileSync(path.join(web, file), 'utf8');
const initSource = read('js/theme-init.js');
const css = read('css/planner.css');

const PAGES = ['index.html', 'login.html', 'songs.html', 'users.html', 'devices.html', 'plan/mass.html', 'plan/praise.html', 'plan/new.html'];

/**
 * Runs theme-init.js against a stand-in page. `saved` seeds localStorage; `search` is the address's query string. The returned page
 * keeps the same document, so receive() and choose() can be called on it as js/theme-sync.js and shell.js do.
 */
function runInit({ saved = {}, search = '', storageThrows = false } = {}) {
  const attrs = {};
  const classes = new Set();
  const store = new Map(Object.entries(saved));
  const windowListeners = {};
  const events = [];
  const replaced = [];
  let meta = null;
  const guard = (fn) => (...args) => {
    if (storageThrows) throw new Error('SecurityError');
    return fn(...args);
  };
  const context = {
    URL,
    localStorage: {
      getItem: guard((k) => (store.has(k) ? store.get(k) : null)),
      setItem: guard((k, v) => store.set(k, String(v))),
      removeItem: guard((k) => store.delete(k)),
    },
    document: {
      documentElement: {
        setAttribute: (k, v) => (attrs[k] = v),
        classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
      },
      head: { appendChild: (el) => (meta = el) },
      querySelector: () => meta,
      createElement: () => ({}),
      dispatchEvent: (event) => events.push(event.detail),
    },
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = init.detail;
      }
    },
  };
  context.window = {
    location: { search, href: `https://planner.example.org/plan/mass.html${search}#top` },
    history: { state: null, replaceState: (_state, _title, url) => replaced.push(url) },
    addEventListener: (type, fn) => (windowListeners[type] = fn),
    setTimeout: () => 1,
    clearTimeout: () => {},
  };
  vm.createContext(context);
  vm.runInContext(initSource, context);
  return {
    attrs,
    classes,
    store,
    events,
    replaced,
    meta: () => meta,
    api: context.window.apccmmaTheme,
    otherTab: (key, value) => {
      if (value === null) store.delete(key);
      else store.set(key, value);
      windowListeners.storage({ key });
    },
  };
}

// ---- First paint ----

test('with nothing saved the page paints the laptop default, Obsidian Console, and its canvas colour', () => {
  const page = runInit();
  assert.equal(page.attrs['data-theme'], 'obsidian');
  assert.equal(page.meta().content, '#0c0d10');
});

test('?theme= from a laptop link paints that theme on first paint, is remembered, and comes off the address', () => {
  const page = runInit({ search: '?id=sample-plan&theme=lent' });
  assert.equal(page.attrs['data-theme'], 'lent');
  assert.equal(page.store.get('apccmma.theme'), 'lent');
  assert.ok(!Number.isNaN(Date.parse(page.store.get('apccmma.themeUpdatedAt'))));
  assert.deepEqual(page.replaced, ['/plan/mass.html?id=sample-plan#top']);
});

test('an unknown ?theme= is ignored, and a saved theme or the default is used', () => {
  assert.equal(runInit({ search: '?theme=blue' }).attrs['data-theme'], 'obsidian');
  assert.equal(runInit({ search: '?theme=season-auto', saved: { 'apccmma.theme': 'wine' } }).attrs['data-theme'], 'wine');
});

test('the saved laptop theme is used, and a value left by the old Light / Dark switch falls back sensibly', () => {
  assert.equal(runInit({ saved: { 'apccmma.theme': 'deep-teal' } }).attrs['data-theme'], 'deep-teal');
  assert.equal(runInit({ saved: { 'apccmma.theme': 'dark' } }).attrs['data-theme'], 'obsidian');
  assert.equal(runInit({ saved: { 'apccmma.theme': 'light' } }).attrs['data-theme'], 'light');
});

test('a theme this browser chose in the sidebar wins over the laptop, and "Match the laptop" clears it', () => {
  const page = runInit({ saved: { 'apccmma.theme': 'wine', 'apccmma.themeOverride': 'mint' } });
  assert.equal(page.attrs['data-theme'], 'mint');
  page.api.choose('');
  assert.equal(page.attrs['data-theme'], 'wine');
  assert.equal(page.store.has('apccmma.themeOverride'), false);
  page.api.choose('sage');
  assert.equal(page.attrs['data-theme'], 'sage');
  assert.ok(page.classes.has('theme-switching'), 'colours fade while switching');
  assert.equal(page.events.at(-1).override, 'sage');
});

test('a private window whose storage throws still paints and can switch', () => {
  const page = runInit({ storageThrows: true, search: '?theme=easter' });
  assert.equal(page.attrs['data-theme'], 'obsidian');
  assert.doesNotThrow(() => page.api.choose('mint'));
  assert.doesNotThrow(() => page.api.receive('mint', '2026-11-20T09:00:00.000Z'));
});

// ---- Live updates ----

test('receive() repaints the page live when the laptop chose a newer theme, and ignores an older or unknown one', () => {
  const page = runInit({ saved: { 'apccmma.theme': 'wine', 'apccmma.themeUpdatedAt': '2026-11-20T08:00:00.000Z' } });
  assert.equal(page.api.receive('lent', '2026-11-20T09:00:00.000Z'), true);
  assert.equal(page.attrs['data-theme'], 'lent');
  assert.equal(page.store.get('apccmma.theme'), 'lent');
  assert.equal(page.store.get('apccmma.themeUpdatedAt'), '2026-11-20T09:00:00.000Z');
  assert.ok(page.classes.has('theme-switching'));

  assert.equal(page.api.receive('mint', '2026-11-20T07:00:00.000Z'), false, 'older');
  assert.equal(page.api.receive('lent', '2026-11-20T09:00:00.000Z'), false, 'the same');
  assert.equal(page.api.receive('season-auto', '2026-11-20T10:00:00.000Z'), false, 'never painted');
  assert.equal(page.api.receive('mint', 'not a time'), false);
  assert.equal(page.attrs['data-theme'], 'lent');
});

test('a theme the laptop chose before a ?theme= link was opened does not undo the link', () => {
  const page = runInit({ search: '?theme=lent' });
  assert.equal(page.api.receive('wine', '2000-01-01T00:00:00.000Z'), false);
  assert.equal(page.attrs['data-theme'], 'lent');
});

test('with a sidebar choice in place, a new laptop theme is remembered but the chosen theme stays painted', () => {
  const page = runInit({ saved: { 'apccmma.themeOverride': 'mint' } });
  assert.equal(page.api.receive('lent', '2026-11-20T09:00:00.000Z'), true);
  assert.equal(page.attrs['data-theme'], 'mint');
  page.api.choose('');
  assert.equal(page.attrs['data-theme'], 'lent');
});

test('a theme received or chosen in another tab applies here', () => {
  const page = runInit();
  page.otherTab('apccmma.theme', 'slate');
  assert.equal(page.attrs['data-theme'], 'slate');
  page.otherTab('apccmma.themeOverride', 'linen');
  assert.equal(page.attrs['data-theme'], 'linen');
});

/** A stand-in document and window for the watcher, with timers the test runs by hand. */
function watcherHarness(replies) {
  const timers = new Map();
  let nextTimer = 1;
  const listeners = { doc: {}, win: {} };
  const requests = [];
  const received = [];
  const doc = {
    visibilityState: 'visible',
    addEventListener: (type, fn) => (listeners.doc[type] = fn),
    removeEventListener: (type) => delete listeners.doc[type],
  };
  const win = {
    setTimeout: (fn, ms) => {
      timers.set(nextTimer, { fn, ms });
      return nextTimer++;
    },
    clearTimeout: (id) => timers.delete(id),
    addEventListener: (type, fn) => (listeners.win[type] = fn),
    removeEventListener: (type) => delete listeners.win[type],
  };
  const fetchFn = async (url, init) => {
    requests.push({ url, init });
    const reply = replies.length > 1 ? replies.shift() : replies[0];
    if (reply === 'offline') throw new TypeError('Failed to fetch');
    return { ok: reply.status === 200, status: reply.status, json: async () => reply.body };
  };
  const theme = { receive: (t, at) => received.push([t, at]) };
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return {
    requests,
    received,
    doc,
    delays: () => [...timers.values()].map((t) => t.ms),
    async fire() {
      const due = [...timers.entries()];
      timers.clear();
      for (const [, t] of due) t.fn();
      await settle();
    },
    settle,
    listeners,
    start: () => startThemeSync({ fetchFn, doc, win, theme: () => theme }),
  };
}

test('the watcher asks /api/theme on load and every 5 s while visible, and hands a theme to theme-init', async () => {
  const h = watcherHarness([{ status: 200, body: { theme: 'black-gold', themeUpdatedAt: '2026-11-20T09:00:00.000Z' } }]);
  h.start();
  await h.settle();
  assert.equal(h.requests[0].url, '/api/theme');
  assert.deepEqual(h.requests[0].init, { credentials: 'same-origin', cache: 'no-store' });
  assert.deepEqual(h.received, [['black-gold', '2026-11-20T09:00:00.000Z']]);
  assert.equal(THEME_POLL_MS, 5000);
  assert.deepEqual(h.delays(), [THEME_POLL_MS]);
  await h.fire();
  assert.equal(h.requests.length, 2);
});

test('the watcher pauses while the tab is hidden and checks at once when it comes back or gains focus', async () => {
  const h = watcherHarness([{ status: 200, body: { theme: null, themeUpdatedAt: null } }]);
  h.start();
  await h.settle();
  h.doc.visibilityState = 'hidden';
  h.listeners.doc.visibilitychange();
  assert.deepEqual(h.delays(), [], 'no poll while hidden');
  h.doc.visibilityState = 'visible';
  h.listeners.doc.visibilitychange();
  await h.settle();
  assert.equal(h.requests.length, 2);
  h.listeners.win.focus();
  await h.settle();
  assert.equal(h.requests.length, 3);
  assert.deepEqual(h.received, [], 'a church with no theme yet changes nothing');
});

test('the watcher backs off when offline, and stops for good once signed out', async () => {
  const h = watcherHarness(['offline', 'offline', { status: 401, body: {} }]);
  h.start();
  await h.settle();
  assert.deepEqual(h.delays(), [THEME_POLL_MS * 2]);
  await h.fire();
  assert.deepEqual(h.delays(), [THEME_POLL_MS * 4]);
  await h.fire();
  assert.deepEqual(h.delays(), [], 'signed out: no more polls');
  assert.equal(h.listeners.doc.visibilitychange, undefined);
  assert.ok(THEME_POLL_MAX_MS >= THEME_POLL_MS * 4);
});

// ---- Pages and styles ----

test('every page loads theme-init.js in <head> as a blocking classic script, then theme-tokens.css before planner.css', () => {
  for (const page of PAGES) {
    const html = read(page);
    const head = html.slice(0, html.indexOf('</head>'));
    const tag = head.match(/<script src="(?:\.\.\/)?js\/theme-init\.js"><\/script>/);
    assert.ok(tag, `${page} loads theme-init.js as a plain script`);
    const tokens = head.search(/<link rel="stylesheet" href="(?:\.\.\/)?css\/theme-tokens\.css">/);
    const planner = head.search(/<link rel="stylesheet" href="(?:\.\.\/)?css\/planner\.css">/);
    assert.ok(tag.index < head.indexOf('rel="stylesheet"'), `${page} runs theme-init before the first stylesheet`);
    assert.ok(tokens >= 0 && tokens < planner, `${page} loads the theme tokens before planner.css`);
  }
});

test('every web colour token is taken from the laptop theme tokens', () => {
  const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('\n}', css.indexOf(':root {')));
  const declared = [...rootBlock.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)];
  const colours = declared.filter(([, name]) => !/^--(font|radius|ease|brand-tile|shadow-strong|card-shadow)/.test(name));
  assert.ok(colours.length > 40);
  for (const [, name, value] of colours) assert.match(value, /var\(--color-[\w-]+\)/, `${name} comes from a theme token`);
  for (const role of ['--app-bg: var(--color-canvas)', '--surface: var(--color-surface)', '--primary: var(--color-accent)', '--on-primary: var(--color-on-accent)', '--text: var(--color-fg)', '--muted: var(--color-muted)']) {
    assert.ok(rootBlock.includes(role), role);
  }
});

test('the sidebar draws the theme picker with "Match the laptop" and every theme, and starts the live watcher', () => {
  const shell = read('js/shell.js');
  assert.match(shell, /<select data-theme-select aria-label="Colour theme">\$\{themeOptions\(\)\}<\/select>/);
  assert.match(shell, /Match the laptop/);
  assert.match(shell, /window\.apccmmaTheme\?\.choose\(select\.value\)/);
  assert.match(shell, /themeWatcher \?\?= startThemeSync\(\);/);
  assert.match(shell, /background: var\(--sidebar-bg\)/);
  const page = runInit();
  assert.equal(page.api.themes.length, 22);
});

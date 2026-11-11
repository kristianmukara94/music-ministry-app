// The web planner's Light / Dark / System theme: web/js/theme-init.js, the light tokens in planner.css and the sidebar switch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '..', '..', 'web');
const read = (file) => fs.readFileSync(path.join(web, file), 'utf8');
const initSource = read('js/theme-init.js');
const css = read('css/planner.css');

const PAGES = ['index.html', 'login.html', 'songs.html', 'users.html', 'devices.html', 'plan/mass.html', 'plan/praise.html', 'plan/new.html'];

/** Runs theme-init.js against a stand-in page. `saved` is localStorage's value; `prefersLight` is the browser's setting. */
function runInit({ saved = null, prefersLight = false, storageThrows = false } = {}) {
  const attrs = {};
  const classes = new Set();
  const store = new Map(saved === null ? [] : [['apccmma.theme', saved]]);
  const mediaListeners = [];
  const windowListeners = {};
  const events = [];
  let meta = null;
  const media = {
    get matches() {
      return context.prefersLight;
    },
    addEventListener: (type, fn) => mediaListeners.push(fn),
  };
  const guard = (fn) => (...args) => {
    if (storageThrows) throw new Error('SecurityError');
    return fn(...args);
  };
  const context = {
    prefersLight,
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
    matchMedia: (query) => {
      assert.equal(query, '(prefers-color-scheme: light)');
      return media;
    },
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
    meta: () => meta,
    api: context.window.apccmmaTheme,
    setDevice(light) {
      context.prefersLight = light;
      for (const fn of mediaListeners) fn();
    },
    otherTab: (value) => {
      if (value === null) store.delete('apccmma.theme');
      else store.set('apccmma.theme', value);
      windowListeners.storage({ key: 'apccmma.theme' });
    },
  };
}

test('with nothing saved the page follows the browser, and a browser that asks for neither stays dark', () => {
  assert.equal(runInit({ prefersLight: true }).attrs['data-theme'], 'light');
  assert.equal(runInit({ prefersLight: false }).attrs['data-theme'], 'dark');
  const page = runInit({ prefersLight: true });
  assert.equal(page.attrs['data-theme-pref'], 'system');
  assert.equal(page.meta().content, '#f8fafc');
});

test('a saved Light or Dark choice beats the browser, and anything else counts as System', () => {
  assert.equal(runInit({ saved: 'dark', prefersLight: true }).attrs['data-theme'], 'dark');
  assert.equal(runInit({ saved: 'light', prefersLight: false }).attrs['data-theme'], 'light');
  assert.equal(runInit({ saved: 'purple', prefersLight: true }).attrs['data-theme-pref'], 'system');
});

test('choosing saves Light and Dark, and System removes the saved choice', () => {
  const page = runInit({ prefersLight: false });
  page.api.set('light');
  assert.equal(page.store.get('apccmma.theme'), 'light');
  assert.equal(page.attrs['data-theme'], 'light');
  assert.ok(page.classes.has('theme-switching'), 'colours fade while switching');
  page.api.set('system');
  assert.equal(page.store.has('apccmma.theme'), false);
  assert.equal(page.attrs['data-theme'], 'dark');
  assert.equal(page.api.preference(), 'system');
  const last = page.events.at(-1);
  assert.equal(last.preference, 'system');
  assert.equal(last.theme, 'dark');
});

test('on System the page follows the device as it changes, and an explicit choice ignores it', () => {
  const page = runInit({ prefersLight: false });
  page.setDevice(true);
  assert.equal(page.attrs['data-theme'], 'light');
  page.api.set('dark');
  page.setDevice(false);
  page.setDevice(true);
  assert.equal(page.attrs['data-theme'], 'dark');
});

test('a choice made in another tab applies here', () => {
  const page = runInit({ prefersLight: false });
  page.otherTab('light');
  assert.equal(page.attrs['data-theme'], 'light');
  page.otherTab(null);
  assert.equal(page.attrs['data-theme'], 'dark');
});

test('a private window whose storage throws still gets a theme and can switch', () => {
  const page = runInit({ prefersLight: true, storageThrows: true });
  assert.equal(page.attrs['data-theme'], 'light');
  assert.doesNotThrow(() => page.api.set('dark'));
});

test('every page loads theme-init.js in <head> as a blocking classic script before its stylesheets, so it never flashes', () => {
  for (const page of PAGES) {
    const html = read(page);
    const head = html.slice(0, html.indexOf('</head>'));
    const tag = head.match(/<script src="(?:\.\.\/)?js\/theme-init\.js"><\/script>/);
    assert.ok(tag, `${page} loads theme-init.js as a plain script`);
    const firstStylesheet = head.indexOf('rel="stylesheet"');
    assert.ok(tag.index < firstStylesheet, `${page} runs it before the first stylesheet`);
  }
});

test('every colour the dark theme sets has a light value', () => {
  const block = (selector) => {
    const start = css.indexOf(`${selector} {`);
    assert.ok(start >= 0, selector);
    return css.slice(start, css.indexOf('\n}', start));
  };
  // Fonts, corner radii and easing are the same in both themes; everything else is a colour or shadow.
  const colours = (text) =>
    new Set([...text.matchAll(/^\s*(--[\w-]+):/gm)].map(([, name]) => name).filter((name) => !/^--(font|radius|ease)/.test(name)));
  const dark = colours(block(':root'));
  const light = colours(block(":root[data-theme='light']"));
  for (const name of dark) assert.ok(light.has(name), `${name} has a light value`);
  assert.match(block(":root[data-theme='light']"), /color-scheme: light;/);
});

test('the light theme uses the brief\'s palette', () => {
  const light = css.slice(css.indexOf(":root[data-theme='light'] {"));
  for (const pair of ['--app-bg: #f8fafc', '--sidebar-bg: #ffffff', '--surface: #ffffff', '--border: #e2e8f0', '--text: #0f172a', '--muted: #64748b', '--primary-hover: #1d4ed8', '--gold-wash: #fef3c7', '--gold-edge: #fcd34d', '--eyebrow: #92400e']) {
    assert.ok(light.includes(`${pair};`), pair);
  }
});

test('the sidebar draws a Light / Dark / System switch and uses the sidebar colour', () => {
  const shell = read('js/shell.js');
  assert.match(shell, /class="theme-toggle" role="group" aria-label="Colour theme"/);
  assert.match(shell, /data-theme-choice="\$\{choice\.key\}" aria-pressed="false"/);
  for (const key of ['light', 'dark', 'system']) assert.match(shell, new RegExp(`key: '${key}'`));
  assert.match(shell, /background: var\(--sidebar-bg\)/);
  assert.match(shell, /window\.apccmmaTheme\?\.set\(/);
});

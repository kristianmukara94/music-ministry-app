// The launch: its timeline, the order the operator window and the background work come up in, the database tuning, and what the packaged app
// carries. Run with: node --test electron/startup.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire, register } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { applyMainDbPragmas, MAIN_DB_PRAGMAS } from './db-pragmas.js';
import { lazyPackage } from './lazy-package.js';
import { createStartupMetrics, MILESTONES, metricsMode, METRICS_ENV, processStart, RENDERER_MILESTONES, REPORT_FILE } from './startup-metrics.js';
import { createStartupQueue, once, SHOW_FALLBACK_MS, showWhenPainted } from './startup-tasks.js';

register('./test-support/electron-hook.mjs', import.meta.url);

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

/** A temporary folder, removed after the test. */
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apccmma-startup-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Timers a test moves by hand. */
function fakeTimers() {
  let clock = 0;
  let next = 0;
  const waiting = new Map();
  return {
    setTimer: (callback, ms) => {
      waiting.set((next += 1), { callback, at: clock + ms });
      return next;
    },
    clearTimer: (id) => waiting.delete(id),
    async advance(ms) {
      clock += ms;
      for (const [id, timer] of [...waiting].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at > clock || !waiting.delete(id)) continue;
        timer.callback();
      }
      await new Promise((resolve) => setImmediate(resolve));
    },
    pending: () => waiting.size,
  };
}

// ── The timeline ──────────────────────────────────────────────────────────

test('the timeline counts every step from process creation, in the order they happened', () => {
  let clock = 1000;
  const metrics = createStartupMetrics({ origin: 1000, now: () => clock });
  clock = 1200.04;
  metrics.mark('main:entry');
  clock = 1500;
  metrics.mark('app:whenReady');
  clock = 1600;
  metrics.mark('main:core-requires', 1300);
  assert.deepEqual(metrics.report().marks, [
    { name: 'main:entry', ms: 200, delta: 200 },
    { name: 'main:core-requires', ms: 300, delta: 100 },
    { name: 'app:whenReady', ms: 500, delta: 200 },
  ]);
});

test('a mark is refused when its name is unknown, repeated, or its time is impossible', () => {
  const metrics = createStartupMetrics({ origin: 1000, now: () => 2000 });
  assert.equal(metrics.mark('db:open', 1500), true);
  assert.equal(metrics.mark('db:open', 1600), false, 'the first mark counts');
  assert.equal(metrics.mark('sample:step'), false);
  assert.equal(metrics.mark('window:created', 999), false, 'before the process existed');
  assert.equal(metrics.mark('window:created', 9999), false, 'in the future');
  assert.equal(metrics.mark('window:created', Number.NaN), false);
  assert.equal(metrics.mark('window:created', 'Sample Title'), false);
  assert.equal(metrics.report().marks.length, 1);
});

test('the report is delivered once, when the console is interactive and the services are up', () => {
  const reports = [];
  const metrics = createStartupMetrics({ origin: 0, now: () => 10 });
  metrics.mark('renderer:interactive', 5);
  metrics.whenComplete((report) => reports.push(report));
  assert.equal(reports.length, 0);
  metrics.mark('background:services-ready', 8);
  metrics.mark('window:ready-to-show', 3);
  assert.equal(reports.length, 1);
});

test('a timeline already complete is delivered as soon as someone asks', () => {
  const reports = [];
  const metrics = createStartupMetrics({ origin: 0, now: () => 10 });
  metrics.mark('renderer:interactive', 5);
  metrics.mark('background:services-ready', 8);
  metrics.whenComplete((report) => reports.push(report));
  assert.equal(reports.length, 1);
});

test('a report is written only when the environment asks for one', () => {
  assert.equal(metricsMode({}), 'off');
  assert.equal(metricsMode({ [METRICS_ENV]: '0' }), 'off');
  assert.equal(metricsMode({ [METRICS_ENV]: 'C:\\sample\\path.json' }), 'off', 'a path is not accepted: the report goes to userData');
  assert.equal(metricsMode({ [METRICS_ENV]: '1' }), 'report');
  assert.equal(metricsMode({ [METRICS_ENV]: ' EXIT ' }), 'exit');
  assert.equal(REPORT_FILE, 'startup-metrics.json');
});

test('the start of the process is Electron\'s creation time, or counted back from uptime', () => {
  assert.equal(processStart({ getCreationTime: () => 5000, uptime: () => 1 }, () => 9000), 5000);
  assert.equal(processStart({ getCreationTime: () => null, uptime: () => 1.5 }, () => 9000), 7500);
  assert.equal(processStart({ uptime: () => 2 }, () => 9000), 7000);
});

test('the page may report only its own two steps, through the preload, and only the operator window is heard', () => {
  assert.deepEqual(RENDERER_MILESTONES, ['renderer:first-paint', 'renderer:interactive']);
  for (const name of RENDERER_MILESTONES) assert.ok(MILESTONES.includes(name));
  const main = read('electron/main.js');
  assert.match(main, /event\.sender !== windows\.operator\?\.webContents \|\| !RENDERER_MILESTONES\.includes\(name\)\) return;/);
  assert.match(read('electron/preload.cjs'), /mark: \(name, at\) => ipcRenderer\.send\('startup:mark', name, at\)/);
});

test('main.js records every step of the main process', () => {
  const main = read('electron/main.js');
  for (const name of MILESTONES.filter((n) => n !== 'main:entry' && !RENDERER_MILESTONES.includes(n))) {
    assert.ok(main.includes(`startupMetrics.mark('${name}')`), name);
  }
  assert.match(read('electron/startup-metrics.js'), /startupMetrics\.mark\('main:entry'\);/);
});

// ── The operator window ───────────────────────────────────────────────────

function fakeWindow() {
  const listeners = new Map();
  return {
    shows: 0,
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    show() {
      this.shows += 1;
    },
    once(name, fn) {
      listeners.set(name, fn);
    },
    emit(name) {
      const fn = listeners.get(name);
      listeners.delete(name);
      fn?.();
    },
  };
}

test('a hidden window is shown when it can be painted, once', async () => {
  const timers = fakeTimers();
  const win = fakeWindow();
  let shown = 0;
  showWhenPainted(win, { onShown: () => (shown += 1), ...timers });
  assert.equal(win.shows, 0);
  win.emit('ready-to-show');
  await timers.advance(SHOW_FALLBACK_MS * 2);
  assert.equal(win.shows, 1);
  assert.equal(shown, 1);
  assert.equal(timers.pending(), 0);
});

test('a page that never paints still gets its window, after the fallback', async () => {
  const timers = fakeTimers();
  const win = fakeWindow();
  let shown = 0;
  showWhenPainted(win, { onShown: () => (shown += 1), ...timers });
  await timers.advance(SHOW_FALLBACK_MS - 1);
  assert.equal(win.shows, 0);
  await timers.advance(1);
  win.emit('ready-to-show');
  assert.equal(win.shows, 1);
  assert.equal(shown, 1);
});

test('a window closed before it was shown is left alone', async () => {
  const timers = fakeTimers();
  const win = fakeWindow();
  showWhenPainted(win, timers);
  win.destroyed = true;
  win.emit('closed');
  await timers.advance(SHOW_FALLBACK_MS);
  assert.equal(win.shows, 0);
  assert.equal(timers.pending(), 0);
});

test('the operator window starts hidden, keeps its security settings, and is painted in the theme\'s colour', () => {
  const create = /function createOperator\([\s\S]*?\n}\n/.exec(read('electron/main.js'))[0];
  assert.match(create, /show: false,/);
  assert.match(create, /backgroundColor: caption\.color,/);
  assert.match(create, /titleBarOverlay: caption,/);
  assert.match(create, /showWhenPainted\(win, \{ onShown \}\);/);
  assert.match(create, /webPreferences,\n/);
});

// ── Background work ───────────────────────────────────────────────────────

test('background tasks wait for the start, then run in their order of delay', async () => {
  const timers = fakeTimers();
  const queue = createStartupQueue(timers);
  const ran = [];
  queue.add('second', 100, () => ran.push('second'));
  queue.add('first', 0, () => ran.push('first'));
  await timers.advance(1000);
  assert.deepEqual(ran, [], 'nothing runs before the first paint');
  queue.start();
  queue.start();
  await timers.advance(0);
  assert.deepEqual(ran, ['first']);
  await timers.advance(100);
  assert.deepEqual(ran, ['first', 'second']);
  assert.equal(await queue.done, true);
});

test('a task that fails is logged and the others still run', async () => {
  const timers = fakeTimers();
  const errors = [];
  const queue = createStartupQueue({ ...timers, log: { error: (line) => errors.push(line) } });
  let ran = false;
  queue.add('Sample Item', 0, () => Promise.reject(new Error('Sample failure')));
  queue.add('Sample Title', 0, () => {
    throw new Error('Sample failure');
  });
  queue.add('after', 10, () => (ran = true));
  queue.start();
  await timers.advance(10);
  assert.equal(await queue.done, true);
  assert.equal(ran, true);
  assert.equal(errors.length, 2);
});

test('quitting drops the waiting tasks and does not report the services as ready', async () => {
  const timers = fakeTimers();
  const queue = createStartupQueue(timers);
  let ran = false;
  queue.add('later', 500, () => (ran = true));
  queue.start();
  queue.cancel();
  await timers.advance(1000);
  queue.start();
  assert.equal(ran, false);
  assert.equal(await queue.done, false);
});

test('adding a task after the start is a mistake that says so', () => {
  const queue = createStartupQueue(fakeTimers());
  queue.start();
  assert.throws(() => queue.add('Sample Item', 0, () => {}), /already started/);
});

test('once runs a starter a single time and gives every caller the same result', () => {
  let calls = 0;
  const start = once(() => ({ call: (calls += 1) }));
  assert.equal(start(), start());
  assert.equal(calls, 1);
});

test('the servers start with the first paint, at once after a crash, and every IPC handler is registered before the window', () => {
  const main = read('electron/main.js');
  assert.match(main, /background\.add\('lower-third-server', 0, startLowerThirdServer\);\n\s+background\.add\('remote-view', 0, startRemoteView\);/);
  assert.match(main, /if \(recovered\) \{[\s\S]*?void startLowerThirdServer\(\);\n\s+void startRemoteView\(\);[\s\S]*?reconcileWindows\(\);/);
  const ready = main.slice(main.indexOf('app.whenReady()'));
  assert.ok(ready.indexOf('createOperator({') > ready.indexOf('setupUpdater('));
  // Work that registers handlers is never queued.
  assert.doesNotMatch(main, /background\.add\([^\n]*setup[A-Z]/);
});

test('saved output windows open after the console is interactive, and never over a recovered session', () => {
  const main = read('electron/main.js');
  assert.match(main, /if \(name === 'renderer:interactive'\) restoreSecondaryWindows\(\);/);
  assert.match(main, /if \(!recovered && state\.lowerStyle\.target != null\) placeLowerThirdWindow\(\);/);
});

// ── The database ──────────────────────────────────────────────────────────

test('the main database keeps its rollback journal and full sync, with temporary data and a 16 MB cache in memory', (t) => {
  // In memory would not do: the journal mode of a file database is what is checked.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apccmma-startup-db-'));
  const db = new DatabaseSync(path.join(dir, 'sample.db'));
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  db.exec('PRAGMA journal_mode = DELETE');
  applyMainDbPragmas(db);
  const value = (name) => Object.values(db.prepare(`PRAGMA ${name}`).get())[0];
  assert.equal(value('journal_mode'), 'delete');
  assert.equal(value('synchronous'), 2, 'FULL');
  assert.equal(value('temp_store'), 2, 'MEMORY');
  assert.equal(value('cache_size'), -16000);
  db.exec("CREATE TABLE sample (title TEXT); INSERT INTO sample VALUES ('Sample Title')");
  assert.equal(value('integrity_check'), 'ok');
});

test('openDatabase applies them, and neither they nor it ever turns on WAL', () => {
  const source = read('electron/announcements.js');
  const open = /export function openDatabase\([\s\S]*?\n}\n/.exec(source)[0];
  assert.match(open, /journal_mode = DELETE/);
  assert.match(open, /applyMainDbPragmas\(db\);/);
  assert.doesNotMatch(open, /journal_mode = WAL/i);
  assert.ok(MAIN_DB_PRAGMAS.every((pragma) => !/journal_mode|synchronous = (NORMAL|OFF)/i.test(pragma)));
});

// ── Loading on demand ─────────────────────────────────────────────────────

test('a package is loaded on the first call only, and a failed load is tried again', () => {
  let attempts = 0;
  const get = lazyPackage('sample-package', (name) => {
    attempts += 1;
    if (attempts === 1) throw new Error('Sample failure');
    return { name };
  });
  assert.equal(attempts, 0);
  assert.throws(get, /Sample failure/);
  assert.equal(get(), get());
  assert.equal(get().name, 'sample-package');
  assert.equal(attempts, 2);
});

test('the packages the main process loads on demand are real ones', () => {
  const load = createRequire(import.meta.url);
  for (const name of ['mammoth', 'jszip', 'electron-updater']) assert.doesNotThrow(() => load.resolve(name), name);
});

test('no module of the main process loads the heavy packages at launch', () => {
  for (const file of fs.readdirSync(import.meta.dirname).filter((name) => name.endsWith('.js'))) {
    assert.doesNotMatch(read(`electron/${file}`), /^import [^\n]*from '(mammoth|jszip|electron-updater)';/m, file);
  }
  assert.doesNotMatch(read('electron/main.js'), /^import [^\n]*'\.\/full-backup\.js';/m);
  assert.doesNotMatch(read('electron/settings.js'), /^import [^\n]*'\.\/full-backup\.js';/m);
  assert.match(read('tools/compile-bytecode.mjs'), /supported: \{ 'dynamic-import': false \}/);
});

test('the updater is not loaded until a check or a download needs it', async (t) => {
  const { setupUpdater } = await import('./updater.js');
  const userData = tempDir(t);
  const handlers = new Map();
  const scheduled = [];
  let loads = 0;
  const autoUpdater = { on() {}, checkForUpdates: async () => {} };
  setupUpdater({
    userData,
    ipc: { handle: (channel, fn) => handlers.set(channel, fn) },
    electronApp: { isPackaged: true },
    load: () => {
      loads += 1;
      return { autoUpdater };
    },
    schedule: (fn, ms) => scheduled.push({ fn, ms }),
  });
  handlers.get('updater:set-channel')(null, 'beta');
  handlers.get('UPDATES_GET_STATE')();
  assert.equal(loads, 0);
  assert.ok(scheduled[0].ms >= 10_000, 'the launch check waits');
  await handlers.get('CHECK_FOR_UPDATES')();
  assert.equal(loads, 1);
  assert.equal(autoUpdater.autoDownload, false);
  assert.equal(autoUpdater.autoInstallOnAppQuit, true);
  assert.equal(autoUpdater.allowPrerelease, true, 'the channel saved before it was loaded');
  handlers.get('updater:set-channel')(null, 'stable');
  assert.equal(autoUpdater.allowPrerelease, false);
});

// ── The packaged app ──────────────────────────────────────────────────────

test('the packaged app leaves out nothing the main process needs', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.build.asar, true);
  // en-GB too: Chromium formats dates with it for British, Australian and New Zealand Windows, and with only en-US they would turn American.
  assert.deepEqual(pkg.build.electronLanguages, ['en-US', 'en-GB', 'fil']);
  // Whole packages left out: "!node_modules/name/**/*" or "!node_modules/{a,b}/**/*".
  const left = pkg.build.files.flatMap((pattern) => {
    const match = /^!node_modules\/(\{[^}]+\}|[^/*{]+)\/\*\*\/\*$/.exec(pattern);
    return match ? match[1].replace(/[{}]/g, '').split(',') : [];
  });
  assert.ok(left.includes('lucide-react'));
  // Everything the main process imports, and everything those packages need in turn.
  const needed = new Set(['bytenode']);
  for (const dir of ['electron', 'shared']) {
    for (const file of fs.readdirSync(path.join(root, dir)).filter((name) => name.endsWith('.js') && !name.includes('.test.'))) {
      const source = read(`${dir}/${file}`);
      for (const [, name] of source.matchAll(/(?:^import [^;]*?from |\bimport\(|\brequire\(|lazyPackage\()'([^'./][^']*)'/gm)) {
        if (!name.startsWith('node:') && name !== 'electron') needed.add(name);
      }
    }
  }
  for (const name of needed) {
    const manifest = path.join(root, 'node_modules', name, 'package.json');
    if (!fs.existsSync(manifest)) continue;
    const { dependencies = {}, optionalDependencies = {} } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    for (const next of Object.keys({ ...dependencies, ...optionalDependencies })) needed.add(next);
  }
  for (const name of ['better-sqlite3', 'mammoth', 'jszip', 'electron-updater']) assert.ok(needed.has(name), name);
  for (const name of needed) {
    const scope = name.split('/')[0];
    assert.ok(!left.includes(name) && !left.includes(scope), `${name} is needed but left out of the packaged app`);
  }
});

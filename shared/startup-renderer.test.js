// The console's launch: pages read on demand, what every window still loads, and the status reads on timers.
// Run with: node --test shared/startup-renderer.test.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { prefetchWhenIdle } from './idle-prefetch.js';
import { createSharedPoll, pollWhileVisible } from './polling.js';
import { createSecondClock } from './second-clock.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fakeInterval() {
  let next = 0;
  const timers = new Map();
  return {
    setTimer: (fn, ms) => {
      timers.set((next += 1), { fn, ms });
      return next;
    },
    clearTimer: (id) => timers.delete(id),
    fire: () => [...timers.values()].forEach((t) => t.fn()),
    count: () => timers.size,
  };
}

function fakeDocument() {
  const listeners = new Set();
  return {
    hidden: false,
    addEventListener: (_name, fn) => listeners.add(fn),
    removeEventListener: (_name, fn) => listeners.delete(fn),
    set(hidden) {
      this.hidden = hidden;
      for (const fn of listeners) fn();
    },
    listening: () => listeners.size,
  };
}

test('a visible-only poll rests while hidden and reads again on return', () => {
  const doc = fakeDocument();
  const timers = fakeInterval();
  let reads = 0;
  const stop = pollWhileVisible(() => (reads += 1), 3000, { doc, ...timers });
  assert.equal(reads, 1);
  timers.fire();
  assert.equal(reads, 2);
  doc.set(true);
  assert.equal(timers.count(), 0, 'no timer while hidden');
  doc.set(false);
  assert.equal(reads, 3);
  assert.equal(timers.count(), 1);
  stop();
  assert.equal(timers.count(), 0);
  assert.equal(doc.listening(), 0);
});

test('a poll started while hidden waits to be seen', () => {
  const doc = fakeDocument();
  doc.hidden = true;
  let reads = 0;
  const stop = pollWhileVisible(() => (reads += 1), 1000, { doc, ...fakeInterval() });
  assert.equal(reads, 0);
  doc.set(false);
  assert.equal(reads, 1);
  stop();
});

test('readers of a shared poll share one timer and one read, and the timer stops with the last of them', async () => {
  const timers = fakeInterval();
  let reads = 0;
  const poll = createSharedPoll({ read: async () => `Sample ${(reads += 1)}`, intervalMs: 3000, ...timers });
  const first = [];
  const second = [];
  const leaveFirst = poll.subscribe((v) => first.push(v));
  await tick();
  const leaveSecond = poll.subscribe((v) => second.push(v));
  assert.equal(reads, 1);
  assert.equal(timers.count(), 1);
  assert.deepEqual(second, ['Sample 1'], 'a later reader has the latest answer at once');
  timers.fire();
  await tick();
  assert.deepEqual(first, ['Sample 1', 'Sample 2']);
  leaveFirst();
  assert.equal(timers.count(), 1);
  leaveSecond();
  assert.equal(timers.count(), 0);
});

test('a failed read answers null, and an old reply never replaces a newer one', async () => {
  const replies = [];
  const poll = createSharedPoll({
    read: () => new Promise((resolve, reject) => replies.push({ resolve, reject })),
    intervalMs: 1000,
    ...fakeInterval(),
  });
  const seen = [];
  const leave = poll.subscribe((v) => seen.push(v));
  const second = poll.refresh();
  replies[1].resolve('Sample New');
  await second;
  replies[0].resolve('Sample Old');
  await tick();
  assert.deepEqual(seen, ['Sample New']);
  const third = poll.refresh();
  replies[2].reject(new Error('Sample failure'));
  await third;
  assert.deepEqual(seen, ['Sample New', null]);
  leave();
});

test('every readout of the time shares one timer, aimed at the next second, which stops with the last of them', () => {
  let time = 10_400;
  const waits = new Map();
  let next = 0;
  const clock = createSecondClock({
    now: () => time,
    setTimer: (fn, ms) => {
      waits.set((next += 1), { fn, ms });
      return next;
    },
    clearTimer: (id) => waits.delete(id),
  });
  assert.equal(clock.read(), 10_400);
  time = 10_700;
  assert.equal(clock.read(), 10_400, 'steady within a second, as React needs');
  const ticks = [];
  const leaveA = clock.subscribe(() => ticks.push('Sample A'));
  const leaveB = clock.subscribe(() => ticks.push('Sample B'));
  assert.equal(waits.size, 1);
  const [[id, wait]] = waits;
  assert.equal(wait.ms, 300);
  time = 11_000;
  waits.delete(id);
  wait.fn();
  assert.deepEqual(ticks, ['Sample A', 'Sample B']);
  assert.equal(clock.read(), 11_000);
  leaveA();
  assert.equal(waits.size, 1);
  leaveB();
  assert.equal(waits.size, 0);
  time = 15_000;
  assert.equal(clock.read(), 15_000);
});

test('the Remote view status is read even while hidden, so a viewer comes back with the network', () => {
  const shared = read('src/system/remoteStatus.ts');
  assert.match(shared, /createSharedPoll/);
  assert.doesNotMatch(shared, /pollWhileVisible|visibility/);
  for (const file of ['src/operator/TopBar.tsx', 'src/operator/PreServiceWidget.tsx']) assert.match(read(file), /remoteStatusPoll\.subscribe/, file);
});

test('nothing on a live output rests when hidden', () => {
  for (const file of ['src/output/WelcomeScreen.tsx', 'src/output/ProjectorView.tsx', 'src/output/LowerThirdView.tsx', 'src/state/region.ts']) {
    assert.doesNotMatch(read(file), /pollWhileVisible/, file);
  }
});

test('idle prefetch waits, then loads one at a time, and a failure does not stop the rest', async () => {
  const idles = [];
  const delays = [];
  const loaded = [];
  prefetchWhenIdle(
    [async () => loaded.push('Sample A'), () => Promise.reject(new Error('Sample failure')), async () => loaded.push('Sample C')],
    {
      delayMs: 1500,
      idle: (fn) => idles.push(fn),
      setTimer: (fn, ms) => delays.push({ fn, ms }),
    },
  );
  assert.equal(delays[0].ms, 1500);
  assert.equal(idles.length, 0);
  delays[0].fn();
  for (let i = 0; i < 3; i += 1) {
    assert.equal(idles.length, i + 1, 'the next waits for the one before');
    idles[i]();
    await tick();
  }
  assert.deepEqual(loaded, ['Sample A', 'Sample C']);
  assert.equal(idles.length, 3);
});

test('stopping the prefetch cancels what has not loaded', async () => {
  const cancelled = [];
  const idles = [];
  let loads = 0;
  const stop = prefetchWhenIdle([async () => (loads += 1)], {
    idle: (fn) => idles.push(fn),
    cancelIdle: (handle) => cancelled.push(handle),
    setTimer: (fn) => fn(),
  });
  stop();
  assert.deepEqual(cancelled, [1]);
  assert.equal(loads, 0);
});

test('every page but the Service Console is read on demand', () => {
  const app = read('src/operator/OperatorApp.tsx');
  const views = read('src/operator/views.ts');
  const pages = ['GoLiveConsole', 'PlannerView', 'SongLyrics', 'LectionaryDeck', 'BibleDeck', 'NotesPrayersView', 'MediaView', 'UnifiedDeckView', 'RosaryDeck', 'Settings'];
  for (const page of pages) {
    assert.match(views, new RegExp(`export const ${page} = lazyView\\(\\(\\) => import\\(`), page);
    assert.match(views, new RegExp(`const ALL = \\[[^\\]]*\\b${page}\\b`), `${page} is prefetched`);
    assert.doesNotMatch(app, new RegExp(`import \\{ ${page} \\} from '\\.\\./`), page);
  }
  assert.match(app, /import \{ Dashboard \} from '\.\/Dashboard';/);
  assert.match(app, /<Suspense fallback=\{<ViewLoading \/>\}>/);
});

test('the output windows are in the first file, and every window still loads the modules that listen at import', () => {
  const app = read('src/App.tsx');
  assert.match(app, /^import '\.\/system\/everyWindow';/m);
  for (const view of ['ProjectorView', 'LowerThirdView', 'MirrorWindow', 'FailoverOverlay', 'CastStageView', 'PdfConverter', 'VideoThumbnailer']) {
    assert.match(app, new RegExp(`^import \\{ ${view} \\} from`, 'm'), view);
  }
  const every = read('src/system/everyWindow.ts');
  for (const module of ['live/store', 'theme/store', 'state/region', 'liturgy/massOrderStore', 'live/liveSongs', 'praise-worship/store']) {
    assert.ok(every.includes(`import '../${module}';`), module);
  }
});

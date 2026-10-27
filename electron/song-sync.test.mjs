// Tests for the desktop song list sync: what is built from the laptop's songs, the retry when the connection returns, and what the
// screen may see. Run with: node --test electron/song-sync.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYNC_INTERVAL_MS, SONG_ROWS_SQL, buildSongList, createSongSync } from './song-sync.js';
import { songsStatusText } from '../shared/cloud-device.js';

const TOKEN = 'device-token-value-that-must-never-leak-0123456789';
const LYRIC_WORDS = 'These lyric words must never be sent to the cloud';

const row = (over = {}) => ({
  uuid: '6f1c2b3a-0000-4000-8000-000000000001',
  title: '  Praise to the Lord  ',
  song_category: 'Entrance Procession',
  language: 'EN',
  musical_key: 'D',
  ...over,
});

/** A fake timer: scheduled callbacks wait until the test fires them. */
function fakeTimers() {
  let next = 1;
  const pending = new Map();
  return {
    setTimer: (fn, ms) => {
      const id = next;
      next += 1;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimer: (id) => pending.delete(id),
    pending: () => [...pending.values()].map((t) => t.ms),
    fireNext: () => {
      const [id, timer] = [...pending.entries()][0] ?? [];
      if (id === undefined) return false;
      pending.delete(id);
      timer.fn();
      return true;
    },
  };
}

const offlineError = () => Object.assign(new Error('Cannot reach the cloud. Check the internet connection and try again.'), { offline: true });

test('the list holds only the fields the server takes: id, title, category, language and key', () => {
  const { songs, skipped } = buildSongList([row({ lyrics: LYRIC_WORDS, composer: 'A Composer', style: 'Slow', media_path: 'x.mp4' })]);
  assert.equal(skipped, 0);
  assert.deepEqual(songs, [{ id: '6f1c2b3a-0000-4000-8000-000000000001', title: 'Praise to the Lord', category: 'Entrance Procession', language: 'English', key: 'D' }]);
  assert.equal(JSON.stringify(songs).includes(LYRIC_WORDS), false, 'lyrics are never sent');
});

test('the laptop\'s language codes are sent as the names the server stores', () => {
  const { songs } = buildSongList([row({ language: 'EN' }), row({ uuid: 'b', language: 'TL' }), row({ uuid: 'c', language: 'CEB' })]);
  assert.deepEqual(songs.map((s) => s.language), ['English', 'Tagalog', 'Cebuano']);
});

test('a song with an unknown language or no title is left out and counted, not sent', () => {
  const { songs, skipped } = buildSongList([row({ language: 'FR' }), row({ uuid: 'b', title: '   ' }), row({ uuid: 'c' })]);
  assert.equal(songs.length, 1);
  assert.equal(skipped, 2);
});

test('the song query reads only the columns it may send, and never the lyrics table', () => {
  assert.match(SONG_ROWS_SQL, /SELECT uuid, title, song_category, language, musical_key/);
  assert.equal(/hymn_stanzas|lyrics_text|composer|style/.test(SONG_ROWS_SQL), false);
});

test('a successful run sends the whole list once and shows when it synced', async () => {
  const pushed = [];
  const sync = createSongSync({
    readRows: () => [row(), row({ uuid: 'b', title: 'Be Thou My Vision', musical_key: 'Eb' })],
    push: async (songs) => {
      pushed.push(songs);
      return { created: 2, updated: 0, unchanged: 0, removed: 0 };
    },
    now: () => Date.parse('2026-10-27T12:00:00Z'),
  });
  await sync.runOnce();
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].length, 2);
  assert.equal(sync.status().status, 'synced');
  assert.equal(sync.status().lastSyncedAt, '2026-10-27T12:00:00.000Z');
});

test('when the connection is down, the changes wait and are sent when it returns, with a growing wait', async () => {
  const timers = fakeTimers();
  let online = false;
  const pushes = [];
  const sync = createSongSync({
    readRows: () => [row()],
    push: async (songs) => {
      if (!online) throw offlineError();
      pushes.push(songs);
      return { created: 1, updated: 0, unchanged: 0, removed: 0 };
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  await sync.runOnce();
  assert.equal(sync.status().status, 'offline');
  assert.deepEqual(timers.pending(), [30000], 'the first retry waits 30 seconds');
  timers.fireNext();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(timers.pending(), [60000], 'the next wait is longer');
  online = true;
  timers.fireNext();
  await new Promise((r) => setImmediate(r));
  assert.equal(pushes.length, 1, 'the list is sent when the connection returns');
  assert.equal(sync.status().status, 'synced');
});

test('a revoked link stops the retries and shows the plain message', async () => {
  const timers = fakeTimers();
  const sync = createSongSync({
    readRows: () => [row()],
    push: async () => {
      throw Object.assign(new Error('This laptop was unlinked from the website. Link it again.'), { revoked: true });
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  await sync.runOnce();
  assert.equal(sync.status().status, 'error');
  assert.equal(sync.status().message, 'This laptop was unlinked from the website. Link it again.');
  assert.deepEqual(timers.pending(), [], 'no retry is scheduled for a revoked link');
});

test('start runs once and then on the interval; stop leaves nothing scheduled', async () => {
  const timers = fakeTimers();
  let runs = 0;
  const sync = createSongSync({
    readRows: () => [row()],
    push: async () => {
      runs += 1;
      return { created: 0, updated: 0, unchanged: 1, removed: 0 };
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  sync.start();
  await new Promise((r) => setImmediate(r));
  assert.equal(runs, 1);
  assert.deepEqual(timers.pending(), [SYNC_INTERVAL_MS], 'the next run is one interval away');
  sync.stop();
  assert.deepEqual(timers.pending(), [], 'stop cancels the timer');
});

test('only one timer is ever pending, even when an offline retry and the interval are both due', async () => {
  const timers = fakeTimers();
  const sync = createSongSync({
    readRows: () => [row()],
    push: async () => {
      throw offlineError();
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  sync.start();
  await new Promise((r) => setImmediate(r));
  assert.equal(timers.pending().length, 1);
  timers.fireNext();
  await new Promise((r) => setImmediate(r));
  assert.equal(timers.pending().length, 1, 'still one timer after the retry');
  sync.stop();
});

test('the status the screen gets has no token, and nothing is logged while the list is sent', async () => {
  const logged = [];
  const saved = ['log', 'info', 'warn', 'error'].map((m) => {
    const original = console[m];
    console[m] = (...args) => logged.push(args.join(' '));
    return [m, original];
  });
  let sync;
  try {
    sync = createSongSync({
      readRows: () => [row()],
      push: async () => {
        throw Object.assign(new Error('This laptop was unlinked from the website. Link it again.'), { revoked: true });
      },
      setTimer: () => 0,
      clearTimer: () => {},
    });
    await sync.runOnce();
  } finally {
    for (const [m, original] of saved) console[m] = original;
  }
  assert.equal(JSON.stringify(sync.status()).includes(TOKEN), false);
  assert.deepEqual(Object.keys(sync.status()).sort(), ['lastSyncedAt', 'message', 'status', 'unsent']);
  assert.equal(logged.join('\n').includes(TOKEN), false);
});

test('the screen\'s song line reads plainly in each state', () => {
  const now = Date.parse('2026-10-27T12:00:00Z');
  assert.equal(songsStatusText(null, now), 'Songs not synced yet');
  assert.equal(songsStatusText({ status: 'synced', lastSyncedAt: '2026-10-27T11:59:50Z' }, now), 'Songs synced just now');
  assert.equal(songsStatusText({ status: 'synced', lastSyncedAt: '2026-10-27T11:58:00Z' }, now), 'Songs synced 2 minutes ago');
  assert.equal(songsStatusText({ status: 'syncing' }, now), 'Syncing…');
  assert.equal(songsStatusText({ status: 'offline' }, now), "Offline. Changes will send when you're back online.");
  assert.equal(songsStatusText({ status: 'error', message: 'Too many song syncs from this laptop. Wait ten minutes and try again.' }, now), 'Too many song syncs from this laptop. Wait ten minutes and try again.');
});

test('the desktop song code never reads or mentions the browser storage', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.join(here, 'song-sync.js'), 'utf8');
  const code = source.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*\*)/.test(line)).join('\n');
  assert.equal(/localStorage|sessionStorage/.test(code), false);
});

// ---- A hymn saved triggers one send, and the timer keeps the send going (point 4) ----

/** A fake clock: timers are kept until the test runs them, and each run is let finish before the next. */
function fakeClock() {
  const timers = new Map();
  let next = 1;
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return {
    setTimer: (fn, ms) => {
      const id = next;
      next += 1;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    pending: () => [...timers.values()].map((t) => t.ms),
    async fireAll() {
      for (const [id, t] of [...timers]) {
        if (!timers.has(id)) continue;
        timers.delete(id);
        t.fn();
        await flush();
        await flush();
      }
    },
  };
}

test('five quick saves send the list once, about two seconds after the last save', async () => {
  const clock = fakeClock();
  const sent = [];
  const sync = createSongSync({ readRows: () => [row({ uuid: 'a'.repeat(8) + '-0000-4000-8000-000000000001', title: 'Edited' })], push: async (songs) => { sent.push(songs); return { created: 0, updated: 1, unchanged: 0, removed: 0 }; }, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  for (let i = 0; i < 5; i += 1) sync.notify();
  assert.deepEqual(clock.pending(), [2000], 'one wait is pending, not five');
  assert.equal(sync.status().unsent, true, 'the list is marked unsent while the wait runs');
  await clock.fireAll();
  assert.equal(sent.length, 1, 'one send for five saves');
  assert.equal(sync.status().unsent, false, 'the send cleared the unsent mark');
});

test('a failed send, with no connection problem, is retried on the timer, and stays unsent until it succeeds', async () => {
  const clock = fakeClock();
  let calls = 0;
  const sync = createSongSync({
    readRows: () => [row()],
    push: async () => {
      calls += 1;
      if (calls === 1) throw new Error('The server could not save the song list.');
      return { created: 1, updated: 0, unchanged: 0, removed: 0 };
    },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  sync.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sync.status().status, 'error');
  assert.equal(sync.status().unsent, true, 'the failed list is still unsent');
  assert.ok(clock.pending().includes(SYNC_INTERVAL_MS), 'the timer is set for the next try');
  await clock.fireAll();
  assert.equal(calls, 2, 'the timer sent it again');
  assert.equal(sync.status().status, 'synced');
  assert.equal(sync.status().unsent, false);
  sync.stop();
});

test('a list saved while offline is sent when the connection returns, on the backoff timer', async () => {
  const clock = fakeClock();
  let online = false;
  const sent = [];
  const sync = createSongSync({
    readRows: () => [row({ uuid: 'b'.repeat(8) + '-0000-4000-8000-000000000002', title: 'Saved offline' })],
    push: async (songs) => {
      if (!online) throw offlineError();
      sent.push(songs);
      return { created: 1, updated: 0, unchanged: 0, removed: 0 };
    },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  sync.notify();
  await clock.fireAll();
  assert.equal(sync.status().status, 'offline');
  assert.equal(sync.status().unsent, true, 'still unsent while offline');
  assert.ok(clock.pending().includes(30 * 1000), 'the first retry is 30 seconds away');
  online = true;
  await clock.fireAll();
  assert.equal(sent.length, 1, 'sent when the connection returned');
  assert.equal(sent[0][0].title, 'Saved offline');
  assert.equal(sync.status().unsent, false);
});

test('a save made while a send is running is sent again afterwards, not lost', async () => {
  const clock = fakeClock();
  const sent = [];
  let release;
  const sync = createSongSync({
    readRows: () => [row()],
    push: (songs) => new Promise((resolve) => {
      sent.push(songs);
      release = () => resolve({ created: 0, updated: 0, unchanged: 1, removed: 0 });
    }),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  const running = sync.runOnce();
  sync.notify();
  release();
  await running;
  await clock.fireAll();
  assert.equal(sent.length, 2, 'the second save is sent once the first send is done');
});

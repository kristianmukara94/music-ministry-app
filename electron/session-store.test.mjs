// The live session's recovery database: WAL mode, the single row, and a crash (the writer never closes) that a new process reads back.
// Run with: node --test electron/session-store.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LIVE_SESSION_FILE, createSessionStore, openSessionStore } from './session-store.js';
import { initialLiveState, liveReducer } from '../shared/live.js';
import { createSessionWriter, restoreSession } from '../shared/session-recovery.js';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'apccmma-session-'));
const open = (file) => new DatabaseSync(file);
const quiet = { error: () => {} };

const queue = [{ id: '0:mass-order:1', label: 'Gloria', block: 'intro', module: 'mass-order', sourceId: 1, slot: 'gloria', stale: false }];
const deck = { kind: 'deck', title: 'Gloria', slides: [[{ role: 'all', text: 'a' }], [{ role: 'all', text: 'b' }], [{ role: 'all', text: 'c' }]], index: 0 };

function liveMass() {
  return [
    { type: 'queue/set', items: queue, planId: 4 },
    { type: 'output/set', output: 'projector', on: true },
    { type: 'queue/cursor', index: 0 },
    { type: 'projector/stage', frame: { ...deck, index: 2 } },
    { type: 'projector/take', source: 'MASS_QUEUE' },
  ].reduce(liveReducer, initialLiveState());
}

test('the recovery database runs in WAL mode with synchronous NORMAL', () => {
  const dir = tempDir();
  const store = openSessionStore(dir, open, quiet);
  assert.equal(store.journalMode(), 'wal');
  const db = open(path.join(dir, LIVE_SESSION_FILE));
  // synchronous is per connection, so this checks a fresh store's own setting.
  const fresh = createSessionStore(db);
  assert.equal(db.prepare('PRAGMA synchronous').get().synchronous, 1, 'NORMAL');
  fresh.close();
  store.close();
});

test('the table keeps one row, which a save replaces', () => {
  const store = openSessionStore(tempDir(), open, quiet);
  assert.equal(store.load(), null);
  store.save({ active_plan_id: '1', queue_cursor_index: 0, snapshot: '{"v":1}' });
  store.save({ active_plan_id: '2', queue_cursor_index: 3, snapshot: '{"v":1}' });
  const row = store.load();
  assert.equal(row.active_plan_id, '2');
  assert.equal(row.queue_cursor_index, 3);
  assert.deepEqual(row.snapshot, { v: 1 });
  assert.match(row.updated_at, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  store.clear();
  assert.equal(store.load(), null);
  store.close();
});

test('a crash mid-service: the next launch reads back the slide that was on screen', () => {
  const dir = tempDir();
  // The first run never closes its connection, as when the app is killed.
  const crashed = openSessionStore(dir, open, quiet);
  const writer = createSessionWriter({ save: crashed.save, clear: crashed.clear, schedule: (fn) => fn() });
  const before = liveMass();
  writer.push(before);

  const relaunched = openSessionStore(dir, open, quiet);
  const saved = relaunched.load();
  assert.equal(saved.active_slot_id, 'gloria');
  assert.equal(saved.active_slide_index, 2);
  const fresh = liveReducer(initialLiveState(), { type: 'queue/set', items: queue, planId: 4 });
  const after = restoreSession(fresh, saved.snapshot, { queue, pwExists: false, now: Date.now() });
  assert.deepEqual(after.projector.live, before.projector.live);
  assert.equal(after.queueCursor, 0);
  assert.equal(after.outputs.projector, true);
  relaunched.close();
  crashed.close();
});

test('a damaged file is moved aside and a new one made, so the app still starts', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, LIVE_SESSION_FILE), 'this is not a database, it is long enough to fail the header check......');
  const store = openSessionStore(dir, open, quiet);
  assert.ok(store, 'a store is returned');
  assert.equal(store.load(), null);
  assert.ok(fs.existsSync(path.join(dir, `${LIVE_SESSION_FILE}.broken`)));
  store.close();
});

test('a row whose snapshot cannot be read is treated as no row', () => {
  const store = openSessionStore(tempDir(), open, quiet);
  store.save({ snapshot: '{not json' });
  assert.equal(store.load(), null);
  store.close();
});

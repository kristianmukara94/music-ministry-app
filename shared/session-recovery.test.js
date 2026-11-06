// Live session crash recovery: what is saved, what a relaunch puts back, and when it writes. Run with: node --test shared/session-recovery.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialLiveState, liveReducer } from './live.js';
import { RECOVERY_MAX_AGE_MS, createSessionWriter, restoreSession, sessionRow, sessionSnapshot } from './session-recovery.js';

const NOW = 1_800_000_000_000;
const queue = [
  { id: '0:mass-order:1', label: 'Entrance', block: 'intro', module: 'mass-order', sourceId: 1, slot: 'entrance', stale: false },
  { id: '1:lectionary:2', label: 'Gloria', block: 'intro', module: 'lectionary', sourceId: 2, slot: 'gloria', stale: false },
];
const deck = { kind: 'deck', title: 'Gloria', slides: [[{ role: 'all', text: 'Glory to God' }], [{ role: 'all', text: 'and on earth' }]], index: 0 };

const run = (...actions) => actions.reduce(liveReducer, initialLiveState());

/** A Mass in progress: the projector on, the Gloria's second slide live from the queue, a lower third up. */
function massLive() {
  return run(
    { type: 'queue/set', items: queue, planId: 12 },
    { type: 'output/set', output: 'projector', on: true },
    { type: 'queue/cursor', index: 1 },
    // As the Mass Queue does it (src/golive/massLive.ts): stage the slide, then take it.
    { type: 'projector/stage', frame: { ...deck, index: 1 } },
    { type: 'projector/take', source: 'MASS_QUEUE' },
    { type: 'lowerThird/show', value: { line1: 'Gloria', line2: 'Mass of Creation' } },
  );
}

/** A fresh launch: the queue rebuilt from the plan, nothing selected (what restoreQueue leaves). */
const freshLaunch = () => run({ type: 'queue/set', items: queue, planId: 12 });

test('nothing on air is nothing to recover', () => {
  assert.equal(sessionSnapshot(initialLiveState(), NOW), null);
  // A loaded plan with nothing selected and the projector off is what queue-state.json already brings back.
  assert.equal(sessionSnapshot(freshLaunch(), NOW), null);
});

test('the row names the plan, the slot, the slide and the overlays', () => {
  const s = massLive();
  const row = sessionRow(sessionSnapshot(s, NOW), s.queue);
  assert.equal(row.active_plan_id, '12');
  assert.equal(row.active_slot_id, 'gloria');
  assert.equal(row.active_slide_index, 1);
  assert.equal(row.queue_cursor_index, 1);
  assert.equal(row.lower_third_enabled, 1);
  assert.equal(row.lower_third_text, 'Gloria\nMass of Creation');
  assert.equal(row.blackout_enabled, 0);
  assert.equal(row.clear_text_enabled, 0);
  assert.equal(row.presentation_mode, 'MASS_QUEUE');
  assert.equal(JSON.parse(row.snapshot).savedAt, NOW);
});

test('a relaunch puts back the exact slide, the CURRENT row and the lower third', () => {
  const before = massLive();
  const snap = JSON.parse(sessionRow(sessionSnapshot(before, NOW), before.queue).snapshot);
  const after = restoreSession(freshLaunch(), snap, { queue, pwExists: false, now: NOW + 5000 });
  assert.deepEqual(after.projector.live, before.projector.live);
  assert.equal(after.projector.live.index, 1);
  assert.equal(after.projector.source, 'MASS_QUEUE');
  assert.equal(after.queueCursor, 1);
  assert.equal(after.queuePlanId, 12);
  assert.equal(after.outputs.projector, true);
  assert.deepEqual(after.lowerThird.live, { line1: 'Gloria', line2: 'Mass of Creation' });
  // Next steps on from the restored slide, as it would have before the crash.
  assert.equal(liveReducer(after, { type: 'projector/step', delta: -1 }).projector.live.index, 0);
});

test('Blackout over a Mass slide comes back as Blackout, and lifting it shows the covered slide', () => {
  const before = liveReducer(massLive(), { type: 'projector/blackout' });
  const row = sessionRow(sessionSnapshot(before, NOW), before.queue);
  assert.equal(row.blackout_enabled, 1);
  assert.equal(row.active_slide_index, 1);
  const after = restoreSession(freshLaunch(), JSON.parse(row.snapshot), { queue, pwExists: false, now: NOW });
  assert.equal(after.projector.live.kind, 'blackout');
  assert.equal(after.queueCursor, 1);
  const lifted = liveReducer(after, { type: 'projector/blackout' });
  assert.equal(lifted.projector.live.index, 1);
});

test('Clear Text is recorded, and the background keeps playing after recovery', () => {
  const bg = { kind: 'video', src: 'media://loop.mp4', title: 'Loop' };
  const before = run(
    { type: 'output/set', output: 'projector', on: true },
    { type: 'background/stage', media: bg },
    { type: 'background/take' },
    { type: 'projector/clear' },
  );
  const row = sessionRow(sessionSnapshot(before, NOW), before.queue);
  assert.equal(row.clear_text_enabled, 1);
  const after = restoreSession(initialLiveState(), JSON.parse(row.snapshot), { queue: null, pwExists: false, now: NOW });
  assert.deepEqual(after.projector.background.live, bg);
  assert.equal(after.projector.live.kind, 'idle');
});

test('Praise & Worship comes back on air at its segment and slide', () => {
  const pwFrame = { kind: 'pw', slide: { kind: 'lyrics', text: 'Here I am' } };
  const before = run(
    { type: 'pw/load', sessionId: 7 },
    { type: 'output/set', output: 'projector', on: true },
    { type: 'pw/cursor', segmentKey: 'seg-2', slide: 3, now: NOW - 60_000 },
    { type: 'projector/show', frame: pwFrame, source: 'PW_SESSION' },
  );
  const row = sessionRow(sessionSnapshot(before, NOW), before.queue);
  assert.equal(row.active_pw_session_id, '7');
  assert.equal(row.active_slide_index, 3);
  assert.equal(row.presentation_mode, 'PW_SESSION');
  const after = restoreSession(initialLiveState(), JSON.parse(row.snapshot), { queue: null, pwExists: true, now: NOW });
  assert.deepEqual(after.pw, before.pw);
  assert.equal(after.pw.onAir, true);
  assert.equal(after.projector.source, 'PW_SESSION');
  assert.deepEqual(after.projector.live, pwFrame);
});

test('a plan or session deleted since keeps the slide on screen as a direct projection', () => {
  const before = massLive();
  const snap = sessionSnapshot(before, NOW);
  const after = restoreSession(initialLiveState(), snap, { queue: null, pwExists: false, now: NOW });
  assert.equal(after.queueCursor, -1);
  assert.equal(after.queuePlanId, null);
  assert.equal(after.projector.source, 'DIRECT_DECK');
  assert.deepEqual(after.projector.live, before.projector.live);
});

test('a cursor past the end of a plan that got shorter selects nothing', () => {
  const snap = sessionSnapshot(massLive(), NOW);
  const after = restoreSession(initialLiveState(), snap, { queue: queue.slice(0, 1), pwExists: false, now: NOW });
  assert.equal(after.queueCursor, -1);
  assert.equal(after.projector.source, 'DIRECT_DECK');
});

test('a paused projector comes back paused, with the look it froze', () => {
  const before = liveReducer(massLive(), { type: 'projector/pause', paused: true });
  const after = restoreSession(freshLaunch(), sessionSnapshot(before, NOW), { queue, pwExists: false, now: NOW });
  assert.equal(after.projector.paused, true);
  assert.deepEqual(after.projector.look, before.projector.look);
});

test('a stale, future, newer or damaged snapshot is not restored', () => {
  const snap = sessionSnapshot(massLive(), NOW);
  const opts = { queue, pwExists: false };
  assert.equal(restoreSession(freshLaunch(), snap, { ...opts, now: NOW + RECOVERY_MAX_AGE_MS + 1 }), null);
  assert.equal(restoreSession(freshLaunch(), snap, { ...opts, now: NOW - 10 * 60_000 }), null);
  assert.equal(restoreSession(freshLaunch(), { ...snap, v: 2 }, { ...opts, now: NOW }), null);
  assert.equal(restoreSession(freshLaunch(), null, { ...opts, now: NOW }), null);
  assert.equal(restoreSession(freshLaunch(), { v: 1, savedAt: NOW }, { ...opts, now: NOW }), null);
  // A frame that is not a frame falls back to the idle screen rather than reaching the projector.
  const odd = { ...snap, projector: { ...snap.projector, live: 'junk' } };
  assert.equal(restoreSession(freshLaunch(), odd, { ...opts, now: NOW }).projector.live.kind, 'idle');
});

test('the writer saves once per turn, with the newest state, and skips a write that changes nothing', () => {
  const saved = [];
  let cleared = 0;
  const pending = [];
  const writer = createSessionWriter({ save: (r) => saved.push(r), clear: () => cleared++, now: () => NOW, schedule: (fn) => pending.push(fn) });
  const s1 = massLive();
  const s2 = liveReducer(s1, { type: 'projector/step', delta: -1 });
  writer.push(s1);
  writer.push(s2);
  assert.equal(pending.length, 1, 'one write is scheduled for the burst');
  pending.shift()();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].active_slide_index, 0, 'the newest state is the one written');
  // A change the snapshot does not hold (a phone's panel) writes nothing.
  writer.push(liveReducer(s2, { type: 'remote/panel', panel: { panel: 'deck', title: 'x', step: { index: 0, count: 1 }, sections: [] } }));
  pending.shift()();
  assert.equal(saved.length, 1);
  // Going off air clears the row, once.
  const off = liveReducer(s2, { type: 'stop' });
  const offAll = liveReducer(liveReducer(off, { type: 'output/set', output: 'projector', on: false }), { type: 'lowerThird/clear' });
  writer.push(offAll);
  pending.shift()();
  writer.push(offAll);
  pending.shift()();
  assert.equal(cleared, 1);
});

test('a failed write is retried on the next change', () => {
  let fail = true;
  const saved = [];
  const errors = [];
  const writer = createSessionWriter({
    save: (r) => {
      if (fail) throw new Error('disk full');
      saved.push(r);
    },
    clear: () => {},
    schedule: (fn) => fn(),
    onError: (e) => errors.push(e.message),
  });
  const s = massLive();
  writer.push(s);
  fail = false;
  writer.push(s);
  assert.deepEqual(errors, ['disk full']);
  assert.equal(saved.length, 1);
});

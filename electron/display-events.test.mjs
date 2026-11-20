// Content switches never move or re-create output windows, and bursts of display events (a wireless display beside an HDMI one) settle before
// the display layout is looked at. Run with: node --test electron/display-events.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initialLiveState, liveReducer } from '../shared/live.js';
import { createDisplayEventGate, displaySignature, METRICS_SETTLE_MS, outputsChanged, sameBounds } from './display-events.js';

const HDMI = { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, scaleFactor: 1, rotation: 0 };
const WIRELESS = { id: 3, bounds: { x: 3840, y: 0, width: 1920, height: 1080 }, scaleFactor: 1, rotation: 0 };
const LAPTOP = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1.25, rotation: 0 };

/** A clock the test moves by hand. */
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const pending = new Map();
  return {
    setTimer(fn, ms) {
      const id = ++seq;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer(id) {
      pending.delete(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now) {
          pending.delete(id);
          t.fn();
        }
      }
    },
    get size() {
      return pending.size;
    },
  };
}

function gate(displays) {
  const clock = fakeTimers();
  const calls = [];
  const g = createDisplayEventGate({
    getDisplays: () => displays.current,
    reconcile: (event) => calls.push(event),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { g, clock, calls };
}

test('the settle time is 350 ms', () => {
  assert.equal(METRICS_SETTLE_MS, 350);
});

test('a burst of display-metrics-changed with nothing moved never reconciles the projector', () => {
  const displays = { current: [LAPTOP, HDMI, WIRELESS] };
  const { g, clock, calls } = gate(displays);
  for (let i = 0; i < 40; i++) {
    g.handle('display-metrics-changed');
    clock.advance(50);
  }
  clock.advance(METRICS_SETTLE_MS);
  assert.deepEqual(calls, [], 'the same ids, bounds, scale and rotation: nothing to do');
});

test('a burst that really changes the layout reconciles once, after it settles', () => {
  const displays = { current: [LAPTOP, HDMI, WIRELESS] };
  const { g, clock, calls } = gate(displays);
  for (let i = 0; i < 10; i++) {
    g.handle('display-metrics-changed');
    clock.advance(100);
  }
  assert.deepEqual(calls, [], 'still settling');
  displays.current = [LAPTOP, HDMI, { ...WIRELESS, bounds: { ...WIRELESS.bounds, width: 1280, height: 720 } }];
  g.handle('display-metrics-changed');
  clock.advance(METRICS_SETTLE_MS - 1);
  assert.deepEqual(calls, []);
  clock.advance(1);
  assert.deepEqual(calls, ['display-metrics-changed']);
  // Settled there: more of the same is nothing new.
  g.handle('display-metrics-changed');
  clock.advance(METRICS_SETTLE_MS);
  assert.equal(calls.length, 1);
});

test('plugging a display in or out is acted on at once, and replaces a metrics check still waiting', () => {
  const displays = { current: [LAPTOP, HDMI, WIRELESS] };
  const { g, clock, calls } = gate(displays);
  g.handle('display-metrics-changed');
  displays.current = [LAPTOP, HDMI];
  g.handle('display-removed');
  assert.deepEqual(calls, ['display-removed'], 'no wait: an unplugged projector must hide before it shows on the laptop');
  assert.equal(clock.size, 0, 'the waiting metrics check was dropped');
  displays.current = [LAPTOP, HDMI, WIRELESS];
  g.handle('display-added');
  assert.deepEqual(calls, ['display-removed', 'display-added']);
});

test('dispose drops a check still waiting', () => {
  const displays = { current: [LAPTOP, HDMI] };
  const { g, clock, calls } = gate(displays);
  g.handle('display-metrics-changed');
  displays.current = [LAPTOP];
  g.dispose();
  clock.advance(1000);
  assert.deepEqual(calls, []);
});

test('the layout signature ignores order and the work area, and sees id, bounds, scale and rotation', () => {
  const sig = displaySignature([LAPTOP, HDMI]);
  assert.equal(displaySignature([HDMI, LAPTOP]), sig);
  assert.equal(displaySignature([LAPTOP, { ...HDMI, workArea: { x: 1920, y: 0, width: 1920, height: 1040 } }]), sig);
  assert.notEqual(displaySignature([LAPTOP, { ...HDMI, id: 9 }]), sig);
  assert.notEqual(displaySignature([LAPTOP, { ...HDMI, scaleFactor: 1.5 }]), sig);
  assert.notEqual(displaySignature([LAPTOP, { ...HDMI, rotation: 90 }]), sig);
  assert.notEqual(displaySignature([LAPTOP, { ...HDMI, bounds: { ...HDMI.bounds, x: 0 } }]), sig);
});

test('sameBounds: a window already in place is not moved again', () => {
  assert.equal(sameBounds(HDMI.bounds, { ...HDMI.bounds }), true);
  assert.equal(sameBounds(HDMI.bounds, WIRELESS.bounds), false);
  assert.equal(sameBounds(null, HDMI.bounds), false);
});

test('content switches (Welcome, a service slide, Blackout, the lower third) never ask for window work', () => {
  const run = (s, a) => liveReducer(s, a);
  let s = run(initialLiveState(), { type: 'output/set', output: 'projector', on: true });
  s = run(s, { type: 'pw/load', sessionId: 4 });
  const slide = { kind: 'pw', slide: { kind: 'lyrics', text: 'Sample Slide Line' }, segmentName: 'Sample Segment', type: 'praise', index: 0, total: 2 };
  const content = [
    { type: 'projector/show', frame: slide, source: 'PW_SESSION', lift: true },
    { type: 'projector/welcome', on: true, frame: { kind: 'welcome', lang: 'en', shownAt: 1, slide: 0, slideAt: 1 } },
    { type: 'projector/show', frame: slide, source: 'PW_SESSION' },
    { type: 'projector/welcome', on: false },
    { type: 'projector/blackout' },
    { type: 'projector/blackout' },
    { type: 'lowerThird/show', value: { template: 'segment', tag: 'Sample Segment', line1: 'Sample Welcome Title' } },
    { type: 'lowerThird/clear' },
  ];
  for (const action of content) {
    const next = run(s, action);
    assert.equal(outputsChanged(s, next), false, `${action.type} is content only`);
    s = next;
  }
  // Switching an output is what opens or closes a window.
  assert.equal(outputsChanged(s, run(s, { type: 'output/set', output: 'preview', on: true })), true);
  assert.equal(outputsChanged(s, run(s, { type: 'output/set', output: 'projector', on: false })), true);
  assert.equal(outputsChanged(s, { ...s, outputs: { ...s.outputs } }), false, 'a copied outputs object with the same switches is no change');
});

test('main.js reconciles windows only when an output changes, and routes display events through the gate', () => {
  const main = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  const apply = main.slice(main.indexOf('function apply(action)'), main.indexOf('function restoreQueue('));
  assert.match(apply, /if \(outputsChanged\(prev, next\)\) reconcileWindows\(\);/);
  assert.doesNotMatch(apply, /^\s+reconcileWindows\(\);/m, 'never on every change');
  assert.match(main, /screen\.on\(event, \(\) => displayEvents\.handle\(event\)\);/);
  assert.match(main, /if \(!sameBounds\(win\.getBounds\(\), display\.bounds\)\) win\.setBounds\(display\.bounds\);/);
});

// The Sanctuary Alert in the main process: the Ctrl+Shift+A hotkey on every window, and the timer that takes a timed alert down.
// Run with: node --test electron/sanctuary-alert.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { ALERT_TOGGLE_CHANNEL, attachAppHotkeys, isSanctuaryAlertHotkey } from './hotkeys.js';
import { createAlertExpiry } from './sanctuary-alert.js';
import { initialLiveState, liveReducer } from '../shared/live.js';

const key = (over) => ({ type: 'keyDown', key: 'A', control: false, meta: false, shift: false, alt: false, isAutoRepeat: false, ...over });

// ---- Hotkey ----

test('Ctrl+Shift+A on Windows and Cmd+Shift+A on a Mac are the alert hotkey', () => {
  assert.equal(isSanctuaryAlertHotkey(key({ control: true, shift: true }), 'win32'), true);
  assert.equal(isSanctuaryAlertHotkey(key({ control: true, shift: true, key: 'a' }), 'win32'), true);
  assert.equal(isSanctuaryAlertHotkey(key({ meta: true, shift: true }), 'darwin'), true);
});

test('other keys, Alt (AltGr), key-up and held-key repeats are not', () => {
  assert.equal(isSanctuaryAlertHotkey(key({ control: true }), 'win32'), false);
  assert.equal(isSanctuaryAlertHotkey(key({ shift: true }), 'win32'), false);
  assert.equal(isSanctuaryAlertHotkey(key({ control: true, shift: true, alt: true }), 'win32'), false);
  assert.equal(isSanctuaryAlertHotkey(key({ control: true, shift: true, key: 'S' }), 'win32'), false);
  assert.equal(isSanctuaryAlertHotkey(key({ control: true, shift: true, type: 'keyUp' }), 'win32'), false);
  assert.equal(isSanctuaryAlertHotkey(key({ control: true, shift: true, isAutoRepeat: true }), 'win32'), false);
  assert.equal(isSanctuaryAlertHotkey(key({ meta: true, shift: true }), 'win32'), false);
  assert.equal(isSanctuaryAlertHotkey(key({ control: true, shift: true }), 'darwin'), false);
  assert.equal(isSanctuaryAlertHotkey(null), false);
});

test('a window with the hotkeys attached swallows the alert key and reports it; other keys pass through to the page', () => {
  const webContents = new EventEmitter();
  const win = { webContents };
  const calls = [];
  attachAppHotkeys(win, { onAlert: (w) => calls.push(w), platform: 'win32' });
  const press = (input) => {
    let prevented = false;
    webContents.emit('before-input-event', { preventDefault: () => (prevented = true) }, input);
    return prevented;
  };
  assert.equal(press(key({ control: true, shift: true })), true);
  assert.deepEqual(calls, [win]);
  assert.equal(press(key({ key: 'ArrowRight' })), false);
  assert.equal(press(key({ key: ' ' })), false);
  assert.equal(calls.length, 1);
});

// ---- Expiry ----

function harness() {
  let clock = 1_000;
  const timers = new Map();
  let nextId = 1;
  const cleared = [];
  let state = initialLiveState();
  const expiry = createAlertExpiry({
    clear: (id) => {
      cleared.push(id);
      dispatch({ type: 'sanctuaryAlert/clear', id });
    },
    now: () => clock,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, at: clock + ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });
  function dispatch(action) {
    const prev = state;
    state = liveReducer(state, action);
    if (state !== prev) expiry.watch(prev, state);
  }
  const advance = (ms) => {
    clock += ms;
    for (const [id, t] of [...timers]) {
      if (t.at <= clock) {
        timers.delete(id);
        t.fn();
      }
    }
  };
  return { dispatch, advance, cleared, timers, get state() { return state; }, get clock() { return clock; } };
}

test('a timed alert comes down when its time runs out', () => {
  const h = harness();
  h.dispatch({ type: 'sanctuaryAlert/show', value: { id: 'a', text: 'Car', durationSeconds: 10 }, now: h.clock });
  h.advance(9_999);
  assert.equal(h.state.sanctuaryAlert.id, 'a');
  h.advance(1);
  assert.equal(h.state.sanctuaryAlert, null);
  assert.deepEqual(h.cleared, ['a']);
});

test('Until Dismissed starts no timer', () => {
  const h = harness();
  h.dispatch({ type: 'sanctuaryAlert/show', value: { id: 'a', text: 'Tag', durationSeconds: null }, now: h.clock });
  assert.equal(h.timers.size, 0);
  h.advance(10 * 60_000);
  assert.equal(h.state.sanctuaryAlert.id, 'a');
});

test("a replacement alert stops the old one's timer and runs its own", () => {
  const h = harness();
  h.dispatch({ type: 'sanctuaryAlert/show', value: { id: 'a', text: 'Old', durationSeconds: 10 }, now: h.clock });
  h.advance(5_000);
  h.dispatch({ type: 'sanctuaryAlert/show', value: { id: 'b', text: 'New', durationSeconds: 30 }, now: h.clock });
  assert.equal(h.timers.size, 1);
  h.advance(10_000);
  assert.equal(h.state.sanctuaryAlert.id, 'b');
  h.advance(20_000);
  assert.equal(h.state.sanctuaryAlert, null);
  assert.deepEqual(h.cleared, ['b']);
});

test('clearing by hand stops the timer, and unrelated changes (slide steps) leave it running', () => {
  const h = harness();
  h.dispatch({ type: 'sanctuaryAlert/show', value: { id: 'a', text: 'Car', durationSeconds: 20 }, now: h.clock });
  h.dispatch({ type: 'calibration/toggle' });
  assert.equal(h.timers.size, 1);
  h.dispatch({ type: 'sanctuaryAlert/clear', id: 'a' });
  assert.equal(h.timers.size, 0);
  h.advance(60_000);
  assert.deepEqual(h.cleared, []);
});

// ---- Wiring ----

test('main attaches the hotkey to every window, stamps the alert clock, and watches every live change for expiry', () => {
  const main = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(main, /app\.on\('browser-window-created', \(_event, win\) => attachAppHotkeys\(win, \{ onAlert: openSanctuaryAlert \}\)\)/);
  assert.match(main, /if \(action\?\.type === 'sanctuaryAlert\/show'\) action = \{ \.\.\.action, now: Date\.now\(\) \};/);
  assert.match(main, /alertExpiry\.watch\(prev, next\);/);
  assert.match(main, /win\.webContents\.send\(ALERT_TOGGLE_CHANNEL/);
  // Not a system-wide shortcut: it must not take the key away from other programs on the booth PC.
  assert.doesNotMatch(main, /globalShortcut/);
  const preload = fs.readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8');
  assert.ok(preload.includes(`'${ALERT_TOGGLE_CHANNEL}'`));
});

// The sanctuary display watchdog: heartbeat, crash and freeze failover, revival, Force Failover, display unplug, and the failover surface.
// Run with: env -u ELECTRON_RUN_AS_NODE node --test electron/watchdog.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createHeartbeat,
  createSanctuaryWatchdog,
  isGpuCrash,
  planProjectorDisplay,
  sanitizeFailoverMode,
  PING_CHANNEL,
} from './watchdog.js';
import { createFailoverSurface, FAILOVER_MODE_CHANNEL, FAILOVER_ROUTE } from './windows.js';
import { attachFailoverHotkey, isFailoverHotkey, isSanctuaryAlertHotkey } from './hotkeys.js';
import { readConfig, writeConfig } from './config.js';
import { RESERVED_COMBOS } from '../shared/shortcuts.js';
import { fakeClock, fakeSurface, fakeWindow, quiet } from './test-support/watchdog-fakes.mjs';

const LAPTOP = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
const SANCTUARY = { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } };
const SIDE = { id: 3, bounds: { x: -1280, y: 0, width: 1280, height: 720 } };

function setup({ mode = 'emblem', displays = [LAPTOP, SANCTUARY], preferred = null } = {}) {
  const log = [];
  const clock = fakeClock();
  const statuses = [];
  const screenState = { displays };
  const screen = { getAllDisplays: () => screenState.displays, getPrimaryDisplay: () => LAPTOP };
  const dog = createSanctuaryWatchdog({
    failover: fakeSurface(log),
    screen,
    preferredDisplayId: () => preferred,
    onStatus: (s) => statuses.push(s),
    mode,
    log: quiet,
    ...clock,
  });
  const win = fakeWindow(log);
  dog.attachProjector(win, { displayId: SANCTUARY.id, fullscreen: true });
  /** The projector page answers every ping sent so far, as the preload does. */
  const answer = () => {
    for (const [channel, seq] of win.webContents.sent.splice(0)) if (channel === PING_CHANNEL) dog.pong(win.webContents, seq);
  };
  return { log, clock, statuses, screenState, dog, win, answer };
}

// ---- Heartbeat ----

function heartbeat({ missLimit = 2 } = {}) {
  const clock = fakeClock();
  const sent = [];
  const freezes = [];
  const hb = createHeartbeat({ send: (n) => sent.push(n), onFreeze: (d) => freezes.push({ ...d, at: clock.now() }), intervalMs: 1000, missLimit, ...clock });
  return { clock, sent, freezes, hb };
}

test('the heartbeat pings at once and then every second', () => {
  const { clock, sent, hb } = heartbeat();
  hb.start();
  assert.deepEqual(sent, [1]);
  clock.advance(3000);
  assert.deepEqual(sent, [1, 2, 3, 4]);
});

test('a page that has never answered is still loading, not frozen', () => {
  const { clock, freezes, hb } = heartbeat();
  hb.start();
  clock.advance(20_000);
  assert.equal(freezes.length, 0);
});

test('a page that answers every ping is never taken for frozen', () => {
  const { clock, sent, freezes, hb } = heartbeat();
  hb.start();
  for (let i = 0; i < 30; i += 1) {
    hb.pong(sent.at(-1));
    clock.advance(1000);
  }
  assert.equal(freezes.length, 0);
});

test('two unanswered pings in a row (2000 ms) trip the freeze, once', () => {
  const { clock, sent, freezes, hb } = heartbeat();
  hb.start();
  hb.pong(sent.at(-1)); // armed at t=0 with ping 1 answered
  clock.advance(1000); // ping 2 sent, not answered from here on
  clock.advance(1000); // ping 2 missed: 1
  assert.equal(freezes.length, 0);
  clock.advance(1000); // ping 3 missed: 2
  assert.equal(freezes.length, 1);
  assert.equal(freezes[0].at - 1000, 2000, 'two full intervals after the first unanswered ping');
  clock.advance(10_000);
  assert.equal(freezes.length, 1, 'reported once until re-armed');
});

test('one late answer resets the count', () => {
  const { clock, sent, freezes, hb } = heartbeat();
  hb.start();
  hb.pong(1);
  clock.advance(2000); // ping 2 missed once
  hb.pong(sent.at(-1));
  clock.advance(1000);
  hb.pong(sent.at(-1));
  clock.advance(1000);
  assert.equal(freezes.length, 0);
});

test('an answer to a ping never sent is ignored', () => {
  const { hb } = heartbeat();
  hb.start();
  assert.equal(hb.pong(99), false);
  assert.equal(hb.pong('1'), false);
  assert.equal(hb.state().armed, false);
  assert.equal(hb.pong(1), true);
  assert.equal(hb.state().armed, true);
});

test('rearm waits for a fresh answer before counting again', () => {
  const { clock, freezes, hb } = heartbeat();
  hb.start();
  hb.pong(1);
  clock.advance(3000);
  assert.equal(freezes.length, 1);
  hb.rearm();
  clock.advance(10_000);
  assert.equal(freezes.length, 1, 'not armed again until the page answers');
});

// ---- Display planning ----

test('a projector whose display is still connected stays', () => {
  assert.deepEqual(planProjectorDisplay({ displays: [LAPTOP, SANCTUARY], primaryId: 1, currentId: 2 }), { action: 'stay' });
});

test('an unplugged projector display with only the laptop left parks the projector', () => {
  assert.deepEqual(planProjectorDisplay({ displays: [LAPTOP], primaryId: 1, currentId: 2 }), { action: 'park' });
});

test('an unplugged projector display moves the projector to another external display, the Settings choice first', () => {
  assert.deepEqual(planProjectorDisplay({ displays: [LAPTOP, SIDE], primaryId: 1, currentId: 2 }), { action: 'move', displayId: 3 });
  const four = { id: 4, bounds: SIDE.bounds };
  assert.deepEqual(planProjectorDisplay({ displays: [LAPTOP, SIDE, four], primaryId: 1, currentId: 2, preferredId: 4 }), { action: 'move', displayId: 4 });
});

test('a parked projector returns to its own display when it is plugged back in, and never to the laptop', () => {
  assert.deepEqual(planProjectorDisplay({ displays: [LAPTOP, SIDE, SANCTUARY], primaryId: 1, currentId: 2, parked: true }), { action: 'move', displayId: 2 });
  assert.deepEqual(planProjectorDisplay({ displays: [LAPTOP], primaryId: 1, currentId: 2, parked: true }), { action: 'stay' });
  assert.deepEqual(planProjectorDisplay({ displays: [LAPTOP], primaryId: 1, currentId: 2, preferredId: 1, parked: true }), { action: 'stay' });
});

test('a windowed projector on the laptop is never parked', () => {
  assert.deepEqual(planProjectorDisplay({ displays: [LAPTOP], primaryId: 1, currentId: 1 }), { action: 'stay' });
});

// ---- Crash failover ----

test('a crashed projector page is covered before anything else happens, then restarted behind the surface', () => {
  const { log, win, dog } = setup();
  log.length = 0;
  win.webContents.crash('crashed');
  assert.equal(log[0], 'surface.show emblem', 'the surface goes up first: no wallpaper, no dialog');
  assert.equal(log[1], 'projector.reload', 'a crashed page is reloaded into a new process, not killed again');
  const s = dog.status();
  assert.equal(s.engaged, true);
  assert.equal(s.fault, 'crash');
  assert.equal(s.lastFault.details, 'crashed');
  assert.ok(s.lastFault.coverMs < 15);
});

test('the projector comes back once the reloaded page has loaded and keeps answering', () => {
  const { log, clock, win, dog, answer } = setup();
  win.webContents.crash();
  log.length = 0;
  // The preload answers before the page has loaded: not yet a recovery.
  clock.advance(1000);
  answer();
  clock.advance(1000);
  assert.ok(!log.includes('surface.hide emblem'));
  win.webContents.emit('did-finish-load');
  clock.advance(1000);
  answer();
  clock.advance(599);
  assert.ok(!log.includes('surface.hide emblem'), 'the new page gets time to draw its slide');
  clock.advance(1);
  assert.ok(log.includes('surface.hide emblem'));
  const s = dog.status();
  assert.equal(s.engaged, false);
  assert.equal(s.fault, null);
  assert.equal(s.recoveries, 1);
});

test('a page that will not come back is restarted again, waiting longer each time', () => {
  const { log, clock, win } = setup();
  win.webContents.crash();
  const reloads = () => log.filter((l) => l === 'projector.reload').length;
  const kills = () => log.filter((l) => l === 'projector.kill').length;
  assert.equal(reloads(), 1);
  clock.advance(5000);
  assert.equal(kills(), 1, 'the retry kills whatever is there first');
  assert.equal(reloads(), 1, 'and reloads only once it is gone');
  clock.advance(1000);
  assert.equal(reloads(), 2, 'or after a second, if the process never reports gone');
  clock.advance(8999); // the next try is 10 s after the first retry
  assert.equal(kills(), 1);
  clock.advance(1);
  assert.equal(kills(), 2);
  clock.advance(60_000);
  assert.ok(reloads() <= 6, 'capped at one try every 30 s');
  assert.equal(win.webContents.sent.length > 0, true, 'still pinging');
});

test('a normal close is not a crash', () => {
  const { log, win } = setup();
  log.length = 0;
  win.webContents.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 });
  assert.deepEqual(log, []);
});

test('a killed page is reloaded once its process is gone, and only once', () => {
  const { log, clock, win, dog, answer } = setup();
  answer();
  clock.advance(3000); // freeze
  clock.advance(3000); // grace over: killed
  const reloads = () => log.filter((l) => l === 'projector.reload').length;
  assert.equal(reloads(), 0, 'a reload in the same instant as the kill goes to the dying process');
  win.webContents.crash('killed');
  assert.equal(reloads(), 1);
  clock.advance(1000);
  assert.equal(reloads(), 1, 'the fallback was cancelled');
  assert.equal(dog.status().fault, 'freeze', 'the first fault is the one reported');
  assert.equal(log.filter((l) => l === 'projector.kill').length, 1, 'our own kill does not start a second restart');
});

// ---- Freeze failover ----

test('a frozen projector page is covered after two missed heartbeats, given a grace, then killed and reloaded', () => {
  const { log, clock, dog, answer, win } = setup();
  answer(); // armed
  log.length = 0;
  clock.advance(2000);
  assert.deepEqual(log, [], 'one miss is not a freeze');
  clock.advance(1000);
  assert.deepEqual(log, ['surface.show emblem']);
  assert.equal(dog.status().fault, 'freeze');
  clock.advance(2999);
  assert.ok(!log.includes('projector.kill'));
  clock.advance(1);
  assert.deepEqual(log.slice(1), ['projector.kill']);
  win.webContents.crash('killed');
  assert.deepEqual(log.slice(1), ['projector.kill', 'surface.show emblem', 'projector.reload'], 'still covered, then reloaded');
});

test('a page that unfreezes during the grace is uncovered without a restart', () => {
  const { log, clock, dog, answer } = setup();
  answer();
  clock.advance(3000);
  assert.equal(dog.status().fault, 'freeze');
  clock.advance(1000);
  answer(); // the page came back by itself
  clock.advance(600);
  assert.ok(log.includes('surface.hide emblem'));
  assert.ok(!log.includes('projector.reload'));
  for (let i = 0; i < 10; i += 1) {
    clock.advance(1000);
    answer();
  }
  assert.ok(!log.includes('projector.kill'), 'the grace timer was cancelled');
  assert.equal(dog.status().engaged, false);
});

test('Electron\'s own unresponsive signal engages the failover too', () => {
  const { log, win, dog } = setup();
  log.length = 0;
  win.emit('unresponsive');
  assert.deepEqual(log, ['surface.show emblem']);
  assert.equal(dog.status().fault, 'unresponsive');
});

test('only the projector\'s own page counts as an answer', () => {
  const { clock, dog, win } = setup();
  const other = fakeWindow([], 'mirror');
  dog.pong(other.webContents, 1);
  assert.equal(dog.status().armed, false);
  dog.pong(win.webContents, 1);
  assert.equal(dog.status().armed, true);
  clock.advance(0);
});

// ---- GPU ----

test('a GPU process crash engages the failover; other child processes do not', () => {
  assert.equal(isGpuCrash({ type: 'GPU', reason: 'crashed' }), true);
  assert.equal(isGpuCrash({ type: 'GPU', reason: 'clean-exit' }), false);
  assert.equal(isGpuCrash({ type: 'Utility', reason: 'crashed' }), false);
  const { log, dog } = setup();
  log.length = 0;
  dog.childProcessGone({ type: 'Utility', reason: 'crashed' });
  assert.deepEqual(log, []);
  dog.childProcessGone({ type: 'GPU', reason: 'crashed' });
  assert.deepEqual(log, ['surface.show emblem', 'projector.reload']);
  assert.equal(dog.status().fault, 'gpu');
});

// ---- Force Failover and mode ----

test('Force Failover is always pure black and holds until released', () => {
  const { log, dog } = setup({ mode: 'emblem' });
  log.length = 0;
  const on = dog.force(true);
  assert.deepEqual(log, ['surface.show blackout']);
  assert.equal(on.manual, true);
  assert.equal(on.engaged, true);
  const off = dog.force(false);
  assert.deepEqual(log, ['surface.show blackout', 'surface.hide emblem']);
  assert.equal(off.engaged, false);
});

test('a crash during a forced blackout stays black after the projector recovers', () => {
  const { log, clock, win, dog, answer } = setup();
  dog.force(true);
  win.webContents.crash();
  assert.equal(log.filter((l) => l.startsWith('surface.show')).at(-1), 'surface.show blackout');
  win.webContents.emit('did-finish-load');
  clock.advance(1000);
  answer();
  clock.advance(600);
  assert.equal(dog.status().fault, null);
  assert.equal(dog.status().engaged, true);
  assert.ok(!log.some((l) => l.startsWith('surface.hide')), 'still held by the operator');
  dog.force(false);
  assert.equal(log.at(-1), 'surface.hide emblem');
});

test('releasing a forced blackout while a fault is still being handled keeps the surface up', () => {
  const { log, win, dog } = setup();
  dog.force(true);
  win.webContents.crash();
  log.length = 0;
  dog.force(false);
  assert.deepEqual(log, ['surface.show emblem']);
  assert.equal(dog.status().engaged, true);
});

test('the failover mode readies the hidden surface, and switches one that is up for a fault', () => {
  const { log, win, dog } = setup({ mode: 'emblem' });
  log.length = 0;
  dog.setMode('blackout');
  assert.deepEqual(log, ['surface.prime blackout']);
  win.webContents.crash();
  dog.setMode('emblem');
  assert.equal(log.at(-1), 'surface.show emblem');
  assert.equal(sanitizeFailoverMode('neon'), 'emblem');
  assert.equal(dog.setMode('neon').mode, 'emblem');
});

test('Force Failover with no projector window does nothing', () => {
  const { dog, win } = setup();
  win.destroy();
  assert.equal(dog.force(true).engaged, false);
});

// ---- Display unplug ----

test('unplugging the sanctuary display hides the projector, and plugging it back in restores it fullscreen', () => {
  const { log, screenState, dog, win } = setup();
  win.setFullScreen(true);
  log.length = 0;
  screenState.displays = [LAPTOP];
  dog.displaysChanged();
  assert.deepEqual(log.slice(0, 2), ['projector.opacity 0', 'projector.hide'], 'hidden before anything else: it is on the operator\'s laptop by now');
  assert.ok(log.includes('projector.fullscreen false'));
  assert.equal(win.isVisible(), false, 'leaving fullscreen must not show it again on the operator screen');
  assert.equal(dog.status().parked, true);
  log.length = 0;
  screenState.displays = [LAPTOP, SANCTUARY];
  dog.displaysChanged();
  assert.deepEqual(log, [
    'projector.setBounds 1920,0 1920x1080',
    'projector.fullscreen true',
    'projector.showInactive',
    'surface.setBounds 1920,0',
  ]);
  const s = dog.status();
  assert.equal(s.parked, false);
  assert.equal(s.displayId, SANCTUARY.id);
});

test('metrics changes on a connected display leave the projector alone', () => {
  const { log, dog } = setup();
  log.length = 0;
  dog.displaysChanged();
  assert.deepEqual(log, []);
});

test('an unplugged projector moves to another external display when there is one', () => {
  const { log, screenState, dog } = setup();
  log.length = 0;
  screenState.displays = [LAPTOP, SIDE];
  dog.displaysChanged();
  assert.ok(log.includes('projector.setBounds -1280,0 1280x720'));
  assert.equal(dog.status().displayId, SIDE.id);
  assert.equal(dog.status().parked, false);
});

test('a failover that was up when the display came back is shown again over the restored projector', () => {
  const { log, screenState, dog } = setup();
  dog.force(true);
  screenState.displays = [LAPTOP];
  dog.displaysChanged();
  assert.equal(log.filter((l) => l.startsWith('surface.')).at(-1), 'surface.hide blackout');
  screenState.displays = [LAPTOP, SANCTUARY];
  dog.displaysChanged();
  assert.equal(log.at(-1), 'surface.show blackout');
});

// ---- Lifecycle ----

test('closing the projector closes the surface and puts the watchdog on standby', () => {
  const { log, clock, dog, win } = setup();
  win.webContents.crash();
  win.destroy();
  assert.ok(log.includes('surface.close'));
  const s = dog.status();
  assert.equal(s.projectorOpen, false);
  assert.equal(s.engaged, false);
  assert.equal(clock.pending(), 0, 'no heartbeat or restart timer left running');
});

test('the status listener hears every change', () => {
  const { statuses, win, answer } = setup();
  const n = statuses.length;
  answer();
  assert.equal(statuses.at(-1).armed, true);
  win.webContents.crash();
  assert.equal(statuses.at(-1).engaged, true);
  assert.ok(statuses.length > n);
});

test('a crashed lower-third window is hidden, reloaded, and shown again when it has loaded', () => {
  const { dog } = setup();
  const log = [];
  const lower = fakeWindow(log, 'lower');
  dog.attachLowerThird(lower);
  lower.webContents.crash();
  assert.deepEqual(log, ['lower.hide', 'lower.reload']);
  lower.webContents.emit('did-finish-load');
  assert.deepEqual(log, ['lower.hide', 'lower.reload', 'lower.showInactive']);
  lower.emit('unresponsive');
  assert.deepEqual(log.slice(3), ['lower.hide', 'lower.kill']);
  lower.webContents.crash('killed'); // our own kill: reloaded, not handled as a second crash
  assert.deepEqual(log.slice(3), ['lower.hide', 'lower.kill', 'lower.reload']);
});

// ---- Failover surface (electron/windows.js) ----

function surfaceSetup() {
  const log = [];
  const clock = fakeClock();
  const made = [];
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      const w = fakeWindow(log, 'surface');
      Object.assign(this, w);
      this.options = options;
      this.on = w.on.bind(w);
      this.emit = w.emit.bind(w);
      this.setAlwaysOnTop = (...args) => log.push(`surface.alwaysOnTop ${args.join(' ')}`);
      made.push(this);
    }
  }
  const loads = [];
  const surface = createFailoverSurface({ BrowserWindow, webPreferences: { sandbox: true }, load: (w, route) => loads.push(route), log: quiet, ...clock });
  return { log, clock, made, loads, surface };
}

test('the surface window is hidden, black, never focusable, above the projector, and loads the failover page', () => {
  const { log, made, loads, surface } = surfaceSetup();
  surface.open({ x: 1920, y: 0, width: 1920, height: 1080 }, 'emblem');
  const o = made[0].options;
  assert.equal(o.show, false);
  assert.equal(o.focusable, false);
  assert.equal(o.frame, false);
  assert.equal(o.skipTaskbar, true);
  assert.equal(o.backgroundColor, '#000000');
  assert.equal(o.webPreferences.backgroundThrottling, false);
  assert.equal(o.webPreferences.sandbox, true);
  assert.deepEqual([o.x, o.y, o.width, o.height], [1920, 0, 1920, 1080]);
  assert.ok(log.includes('surface.alwaysOnTop true screen-saver 1'));
  assert.deepEqual(loads, [FAILOVER_ROUTE]);
});

test('the surface shows at once when its page has the right mode up, or has drawn nothing yet', () => {
  const { log, surface } = surfaceSetup();
  surface.open({ x: 0, y: 0, width: 10, height: 10 }, 'emblem');
  log.length = 0;
  surface.show('emblem'); // nothing drawn yet: the black window background shows
  assert.deepEqual(log, ['surface.showInactive', 'surface.moveTop']);
  surface.hide();
  surface.painted('emblem');
  log.length = 0;
  surface.show('emblem');
  assert.deepEqual(log, ['surface.showInactive', 'surface.moveTop']);
});

test('switching modes waits for the page to draw the new one, or for the time limit', () => {
  const { log, clock, made, surface } = surfaceSetup();
  surface.open({ x: 0, y: 0, width: 10, height: 10 }, 'emblem');
  surface.painted('emblem');
  log.length = 0;
  surface.show('blackout');
  assert.deepEqual(log, [], 'not shown with the emblem still on it');
  assert.deepEqual(made[0].webContents.sent.at(-1), [FAILOVER_MODE_CHANNEL, 'blackout']);
  surface.painted('blackout');
  assert.deepEqual(log, ['surface.showInactive', 'surface.moveTop']);
  surface.hide('emblem');
  surface.painted('emblem');
  log.length = 0;
  surface.show('blackout');
  clock.advance(120);
  assert.deepEqual(log, ['surface.showInactive', 'surface.moveTop'], 'a page that never answers still gets covered');
});

test('hiding readies the next mode, and the page is sent its mode when it loads', () => {
  const { made, surface } = surfaceSetup();
  surface.open({ x: 0, y: 0, width: 10, height: 10 }, 'emblem');
  surface.show('blackout');
  surface.hide('emblem');
  assert.deepEqual(made[0].webContents.sent.at(-1), [FAILOVER_MODE_CHANNEL, 'emblem']);
  made[0].webContents.sent.length = 0;
  made[0].webContents.emit('did-finish-load');
  assert.deepEqual(made[0].webContents.sent, [[FAILOVER_MODE_CHANNEL, 'emblem']]);
  assert.equal(surface.wantedMode(), 'emblem');
});

test('the surface reloads its own page if it crashes, and close destroys it', () => {
  const { log, made, surface } = surfaceSetup();
  surface.open({ x: 0, y: 0, width: 10, height: 10 }, 'emblem');
  made[0].webContents.crash();
  assert.ok(log.includes('surface.reload'));
  surface.close();
  assert.equal(made[0].isDestroyed(), true);
  assert.equal(surface.window(), null);
  assert.equal(surface.show('emblem'), false);
});

// ---- Hotkey ----

const key = (over) => ({ type: 'keyDown', key: 'B', control: false, meta: false, shift: false, alt: false, isAutoRepeat: false, ...over });

test('Ctrl+Shift+B (Cmd+Shift+B on a Mac) is the Force Failover hotkey; Ctrl+Shift+F stays fullscreen', () => {
  assert.equal(isFailoverHotkey(key({ control: true, shift: true }), 'win32'), true);
  assert.equal(isFailoverHotkey(key({ control: true, shift: true, key: 'b' }), 'win32'), true);
  assert.equal(isFailoverHotkey(key({ meta: true, shift: true }), 'darwin'), true);
  assert.equal(isFailoverHotkey(key({ control: true, shift: true, key: 'F' }), 'win32'), false);
  assert.equal(isFailoverHotkey(key({}), 'win32'), false, 'plain B is Black Screen');
  assert.equal(isFailoverHotkey(key({ control: true }), 'win32'), false);
  assert.equal(isFailoverHotkey(key({ control: true, shift: true, alt: true }), 'win32'), false);
  assert.equal(isFailoverHotkey(key({ control: true, shift: true, isAutoRepeat: true }), 'win32'), false, 'holding it cannot flicker the screen');
  assert.equal(isFailoverHotkey(key({ control: true, shift: true, type: 'keyUp' }), 'win32'), false);
  assert.equal(isSanctuaryAlertHotkey(key({ control: true, shift: true }), 'win32'), false);
  assert.ok(RESERVED_COMBOS.includes('Ctrl+Shift+B'));
  assert.ok(RESERVED_COMBOS.includes('Shift+Meta+B'));
});

test('the Force Failover hotkey is caught before the page sees it', () => {
  const webContents = new EventEmitter();
  const win = { webContents };
  const calls = [];
  attachFailoverHotkey(win, { onFailover: (w) => calls.push(w), platform: 'win32' });
  let prevented = false;
  webContents.emit('before-input-event', { preventDefault: () => (prevented = true) }, key({ control: true, shift: true }));
  assert.equal(prevented, true);
  assert.deepEqual(calls, [win]);
  prevented = false;
  webContents.emit('before-input-event', { preventDefault: () => (prevented = true) }, key({}));
  assert.equal(prevented, false);
});

// ---- Config and wiring ----

test('the failover mode is saved in config.json and defaults to the parish emblem', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apcc-watchdog-'));
  try {
    assert.equal(readConfig(dir).failover_mode, 'emblem');
    writeConfig(dir, { failover_mode: 'blackout' });
    assert.equal(readConfig(dir).failover_mode, 'blackout');
    writeConfig(dir, { failover_mode: 'disco' });
    assert.equal(readConfig(dir).failover_mode, 'emblem');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('main.js and the preload wire the watchdog in', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Git may check the files out with CRLF line ends on Windows; the checks below are written with \n.
  const main = fs.readFileSync(path.join(here, 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  const preload = fs.readFileSync(path.join(here, 'preload.cjs'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(main.includes('watchdog.attachProjector(win, { displayId: target?.id ?? null, fullscreen: parked ? state.settings.fullscreen : fullscreen, parked });'));
  assert.match(main, /watchdog\.attachLowerThird\(win\)/);
  assert.match(main, /app\.on\('child-process-gone', \(_event, details\) => watchdog\.childProcessGone\(details\)\)/);
  assert.match(main, /watchdog\.displaysChanged\(\);\n\s*if \(state\.lowerStyle\.target != null\) placeLowerThirdWindow\(\);/);
  assert.match(main, /attachFailoverHotkey\(win, \{ onFailover: \(\) => watchdog\.force\(!watchdog\.status\(\)\.manual\) \}\)/);
  assert.match(preload, /ipcRenderer\.on\('watchdog:ping', \(_event, seq\) => ipcRenderer\.send\('watchdog:pong', seq\)\)/);
});

// The sanctuary EDID lock: EDID parsing, stable hardware keys, lock resolution, topology shifts, and the projector following its pinned
// monitor through re-indexing, unplugging and duplicate mode.
// Run with: env -u ELECTRON_RUN_AS_NODE node --test electron/edid-watchdog.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createEdidWatchdog,
  electronDisplayFor,
  normalizeMonitor,
  outputTechnologyName,
  parseEdid,
  pnpIdFromWord,
  resolveLock,
  sanitizeDisplayLock,
  sanitizeDisplayLocks,
} from './edid-watchdog.js';
import { createSanctuaryWatchdog } from './watchdog.js';
import { readConfig, writeConfig } from './config.js';
import { fakeClock, fakeSurface, fakeWindow, quiet } from './test-support/watchdog-fakes.mjs';

// ---- Fixtures ----

/** A valid 128-byte EDID base block. */
function makeEdid({ mfg = 'EPS', product = 0x0a21, serial = 0, serialString = '', name = 'EPSON PJ' } = {}) {
  const b = new Uint8Array(128);
  b.set([0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00], 0);
  const word = ((mfg.charCodeAt(0) - 64) << 10) | ((mfg.charCodeAt(1) - 64) << 5) | (mfg.charCodeAt(2) - 64);
  b[8] = word >> 8;
  b[9] = word & 0xff;
  b[10] = product & 0xff;
  b[11] = product >> 8;
  b[12] = serial & 0xff;
  b[13] = (serial >> 8) & 0xff;
  b[14] = (serial >> 16) & 0xff;
  b[15] = (serial >>> 24) & 0xff;
  b[16] = 12; // week
  b[17] = 2021 - 1990;
  b[18] = 1;
  b[19] = 4;
  b[54] = 0x02; // a detailed timing descriptor: non-zero pixel clock
  b[55] = 0x3a;
  const text = (at, tag, s) => {
    b.set([0, 0, 0, tag, 0], at);
    const bytes = [...s.slice(0, 13)].map((c) => c.charCodeAt(0));
    if (bytes.length < 13) bytes.push(0x0a);
    while (bytes.length < 13) bytes.push(0x20);
    b.set(bytes, at + 5);
  };
  if (serialString) text(72, 0xff, serialString);
  text(90, 0xfc, name);
  b.set([0, 0, 0, 0x10, 0], 108); // dummy descriptor
  b[127] = (256 - (b.subarray(0, 127).reduce((a, v) => a + v, 0) % 256)) % 256;
  return Buffer.from(b);
}

const NVIDIA = '\\\\?\\PCI#VEN_10DE&DEV_25A2&SUBSYS_14371462&REV_A1#4&2c1e3d&0&0008#{5b45201d-f2f2-4f3b-85bb-30ff1f953599}';
const AMD = '\\\\?\\PCI#VEN_1002&DEV_1681&SUBSYS_14371462&REV_C1#4&1a2b3c&0&0041#{5b45201d-f2f2-4f3b-85bb-30ff1f953599}';

/** One monitor as the addon reports it. */
function raw({ gdi, x, y, width = 1920, height = 1080, adapter = NVIDIA, luid = '00000000:000144a6', target = 4354, tech = 5, edid = makeEdid() }) {
  return {
    gdiDeviceName: gdi,
    adapterLuid: luid,
    adapterDevicePath: adapter,
    sourceId: 0,
    targetId: target,
    outputTechnology: tech,
    connectorInstance: 0,
    friendlyName: '',
    monitorDevicePath: '',
    edidManufactureId: null,
    edidProductCodeId: null,
    refreshHz: 60,
    physicalBounds: { x, y, width, height },
    gpuName: adapter === NVIDIA ? 'NVIDIA GeForce RTX 3050' : 'AMD Radeon 660M',
    edid,
  };
}

// The booth laptop's panel and the sanctuary projector, as plugged in today.
const PANEL = () => raw({ gdi: '\\\\.\\DISPLAY1', x: 0, y: 0, adapter: AMD, luid: '00000000:000126f2', target: 256, tech: -2147483648, edid: makeEdid({ mfg: 'CMN', product: 0x1521, name: '' }) });
const PROJECTOR = (over = {}) =>
  raw({ gdi: '\\\\.\\DISPLAY2', x: 1920, y: 0, edid: makeEdid({ serial: 4242, serialString: 'X7PL001234' }), ...over });

/**
 * The Electron displays for a set of raw monitors: ids from the GDI name (as Chromium does), and DIP bounds. A monitor with `scale` is
 * scaled the way Electron 33 does it on this booth laptop, `nativeOrigin` included: in scaled units, so it does not match the hardware.
 */
function displaysFor(monitors) {
  return monitors.map((m) => {
    const p = m.physicalBounds;
    const s = m.scale ?? 1;
    return {
      id: 1000 + Number(m.gdiDeviceName.replace(/\D/g, '')),
      bounds: { x: p.x / s, y: p.y / s, width: p.width / s, height: p.height / s },
      nativeOrigin: { x: p.x / s, y: p.y / s },
      physical: { ...p },
    };
  });
}

/** The world: what is plugged in, what Electron sees, and the lock store. */
function world(initial = [PANEL(), PROJECTOR()]) {
  const hw = { monitors: initial, electronLags: false, fail: null };
  let electronView = displaysFor(initial);
  const screen = {
    getAllDisplays: () => (hw.electronLags ? electronView : (electronView = displaysFor(hw.monitors))),
    getPrimaryDisplay() {
      const all = this.getAllDisplays();
      return all.find((d) => d.physical.x === 0 && d.physical.y === 0) ?? all[0];
    },
    dipToScreenRect(_win, rect) {
      const d = this.getAllDisplays().find((x) => x.bounds.x === rect.x && x.bounds.y === rect.y);
      return d ? { ...d.physical } : { ...rect };
    },
  };
  const native = {
    getHardwareDisplayTopology() {
      if (hw.fail) throw new Error(hw.fail);
      return { monitors: hw.monitors, adapters: [] };
    },
  };
  const locks = { projector: null };
  return { hw, screen, native, locks };
}

function edidSetup(w = world(), { withNative = true } = {}) {
  const clock = fakeClock();
  const statuses = [];
  const settled = [];
  const edid = createEdidWatchdog({
    native: withNative ? w.native : null,
    screen: w.screen,
    getLock: (role) => w.locks[role],
    saveLock: (role, lock) => (w.locks[role] = lock),
    onSettled: (source) => settled.push([source, clock.now()]),
    onStatus: (s) => statuses.push(s),
    log: quiet,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  const projectorDisplayId = () => w.screen.getAllDisplays().find((d) => d.physical.x !== 0 || d.physical.y !== 0)?.id;
  return { w, clock, edid, statuses, settled, projectorDisplayId };
}

// ---- EDID parsing ----

test('an EDID block gives the manufacturer, product, serials, name and date', () => {
  const e = parseEdid(makeEdid({ mfg: 'LEN', product: 0x62c6, serial: 0x01020304, serialString: 'V5A1234', name: 'S22e-20' }));
  assert.deepEqual(
    { ...e },
    { manufacturer: 'LEN', productCode: 0x62c6, serialNumber: 0x01020304, serialString: 'V5A1234', name: 'S22e-20', week: 12, year: 2021, version: '1.4', checksumValid: true },
  );
});

test('anything that is not an EDID is refused', () => {
  assert.equal(parseEdid(null), null);
  assert.equal(parseEdid(Buffer.alloc(64)), null);
  const bad = makeEdid();
  bad[1] = 0;
  assert.equal(parseEdid(bad), null);
  const corrupt = makeEdid();
  corrupt[20] ^= 0xff;
  assert.equal(parseEdid(corrupt).checksumValid, false, 'still read, but flagged');
});

test('connector types and manufacturer ids decode, including the negative "internal" value from the addon', () => {
  assert.equal(outputTechnologyName(5), 'HDMI');
  assert.equal(outputTechnologyName(10), 'DisplayPort');
  assert.equal(outputTechnologyName(-2147483648), 'Internal');
  assert.equal(outputTechnologyName(-1), 'Other');
  assert.equal(pnpIdFromWord(0x30ae), 'LEN');
  assert.equal(pnpIdFromWord(0), null);
});

// ---- Stable identity ----

test('a monitor keeps its keys when Windows renames it or renews the adapter LUID', () => {
  const a = normalizeMonitor(PROJECTOR());
  const b = normalizeMonitor(PROJECTOR({ gdi: '\\\\.\\DISPLAY7', luid: '00000000:0009ffff', x: -1920 }));
  assert.equal(a.fingerprint, b.fingerprint);
  assert.match(a.fingerprint, /^[0-9a-f]{16}\.[0-9a-f]{16}$/);
});

test('moving the monitor to another port keeps its monitor key and changes its port key', () => {
  const a = normalizeMonitor(PROJECTOR());
  const b = normalizeMonitor(PROJECTOR({ target: 4355, tech: 10 }));
  assert.equal(a.monitor.key, b.monitor.key);
  assert.notEqual(a.port.key, b.port.key);
  assert.equal(b.port.label, 'DisplayPort on NVIDIA GeForce RTX 3050');
});

test('without a readable EDID, the DisplayConfig ids stand in (manufacturer word arrives byte-swapped)', () => {
  const m = normalizeMonitor({ ...PROJECTOR(), edid: null, edidManufactureId: 44592, edidProductCodeId: 25286, friendlyName: 'S22e-20' });
  assert.equal(m.monitor.manufacturer, 'LEN');
  assert.equal(m.monitor.productCode, 25286);
  assert.equal(m.monitor.name, 'S22e-20');
  assert.equal(m.monitor.uniqueSerial, false);
  assert.equal(m.monitor.edidRead, false);
});

// ---- Resolving a lock ----

const lockOf = (m) => ({ fingerprint: m.fingerprint, monitorKey: m.monitor.key, portKey: m.port.key });

test('the locked monitor is found on its port, on another port, or replaced on its port', () => {
  const pinned = normalizeMonitor(PROJECTOR());
  const lock = lockOf(pinned);
  assert.equal(resolveLock(lock, [normalizeMonitor(PANEL()), pinned]).match, 'exact');
  assert.equal(resolveLock(lock, [normalizeMonitor(PROJECTOR({ target: 4355 }))]).match, 'monitor');
  const replacement = normalizeMonitor(PROJECTOR({ edid: makeEdid({ serial: 9999, serialString: 'NEWUNIT' }) }));
  assert.equal(resolveLock(lock, [replacement]).match, 'port');
  assert.deepEqual(resolveLock(lock, [normalizeMonitor(PANEL())]), { monitor: null, match: null, ambiguous: false });
  assert.deepEqual(resolveLock(null, []), { monitor: null, match: null });
});

test('two identical projectors without serials are told apart by port, and never guessed', () => {
  const twin = (target) => normalizeMonitor(PROJECTOR({ target, edid: makeEdid() }));
  const lock = lockOf(twin(4354));
  assert.equal(resolveLock(lock, [twin(4355), twin(4354)]).monitor.port.targetId, 4354);
  const neither = resolveLock(lock, [twin(4356), twin(4357)]);
  assert.equal(neither.monitor, null, 'both moved: no way to know which is the sanctuary one');
  assert.equal(neither.ambiguous, true);
});

test('a monitor is matched to its Electron display by physical origin', () => {
  const m = normalizeMonitor(PROJECTOR());
  const displays = [
    { id: 1, nativeOrigin: { x: 0, y: 0 } },
    { id: 2, nativeOrigin: { x: 1920, y: 0 } },
  ];
  assert.equal(electronDisplayFor(m, displays).id, 2);
  assert.equal(electronDisplayFor(m, [displays[0]]), null);
});

test('a saved lock is checked before use', () => {
  const good = { ...lockOf(normalizeMonitor(PROJECTOR())), name: 'EPSON PJ', serial: 'X7PL001234', uniqueSerial: true, portLabel: 'HDMI', pinnedAt: '2026-11-08T00:00:00.000Z' };
  assert.equal(sanitizeDisplayLock(good).fingerprint, good.fingerprint);
  assert.equal(sanitizeDisplayLock({ ...good, fingerprint: 'DISPLAY2' }), null);
  assert.equal(sanitizeDisplayLock('x'), null);
  assert.deepEqual(sanitizeDisplayLocks(undefined), { projector: null });
});

// ---- The lock watchdog ----

test('without the addon the lock is unavailable and the projector keeps its Settings display', () => {
  const { edid } = edidSetup(world(), { withNative: false });
  assert.deepEqual(edid.target('projector'), { locked: false });
  assert.equal(edid.status().roles.projector.state, 'unavailable');
  assert.throws(() => edid.pin('projector', 1002), /not available/);
});

test('not pinned: the projector keeps its Settings display', () => {
  const { edid } = edidSetup();
  assert.deepEqual(edid.target('projector'), { locked: false });
  assert.equal(edid.status().roles.projector.state, 'unpinned');
});

test('pinning refuses the operator screen, and locks the sanctuary monitor with its serial and port', () => {
  const { edid, w, projectorDisplayId } = edidSetup();
  assert.throws(() => edid.pin('projector', w.screen.getPrimaryDisplay().id), /operator screen/);
  assert.throws(() => edid.pin('projector', null), /operator screen/);
  const s = edid.pin('projector', projectorDisplayId());
  assert.equal(w.locks.projector.serial, 'X7PL001234');
  assert.equal(w.locks.projector.portLabel, 'HDMI on NVIDIA GeForce RTX 3050');
  assert.equal(s.roles.projector.state, 'matched');
  assert.equal(edid.target('projector').display.id, projectorDisplayId());
});

test('a scaled display is matched by its physical rectangle, not by Electron\'s nativeOrigin (125% panel at -1920,0 reads -1536,0)', () => {
  // This PC's own layout: the external monitor is primary, the laptop panel at 125% sits to its left and plays the sanctuary screen.
  const panel = { ...raw({ gdi: '\\\\.\\DISPLAY1', x: -1920, y: 0, adapter: AMD, target: 256, tech: -2147483648, edid: makeEdid({ mfg: 'CMN', product: 0x1521 }) }), scale: 1.25 };
  const external = raw({ gdi: '\\\\.\\DISPLAY6', x: 0, y: 0, edid: makeEdid({ mfg: 'LEN', product: 0x62c6, serialString: 'V5DMZ521' }) });
  const w = world([panel, external]);
  const { edid } = edidSetup(w);
  const panelDisplay = w.screen.getAllDisplays().find((d) => d.physical.x === -1920);
  assert.equal(panelDisplay.nativeOrigin.x, -1536, 'the misleading value Electron reports');
  edid.pin('projector', panelDisplay.id);
  assert.equal(w.locks.projector.portLabel, 'Internal on AMD Radeon 660M');
  assert.equal(edid.target('projector').display.id, panelDisplay.id);
  // The old nativeOrigin matching would have found nothing here.
  assert.equal(electronDisplayFor(normalizeMonitor(panel), [panelDisplay]), null);
});

test('pinning refuses a display duplicated on two monitors', () => {
  const w = world([PANEL(), PROJECTOR(), PROJECTOR({ target: 4355, edid: makeEdid({ serial: 7 }) })]);
  const { edid } = edidSetup(w);
  assert.throws(() => edid.pin('projector', 1002), /duplicated/);
});

test('Windows re-indexing the displays is detected, and the lock still points at the same physical monitor', () => {
  const { edid, w, clock } = edidSetup();
  edid.pin('projector', 1002);
  const before = edid.target('projector').display;
  // A driver restart: the projector is now \\.\DISPLAY1 and the panel \\.\DISPLAY3. Nothing moved physically.
  w.hw.monitors = [{ ...PANEL(), gdiDeviceName: '\\\\.\\DISPLAY3' }, PROJECTOR({ gdi: '\\\\.\\DISPLAY1' })];
  edid.topologyChanged('WM_DISPLAYCHANGE');
  const after = edid.target('projector').display;
  assert.notEqual(after.id, before.id, 'Electron gave the projector a new id');
  assert.deepEqual(after.bounds, before.bounds, 'but it is the same screen');
  const s = edid.status();
  assert.equal(s.roles.projector.state, 'shifted');
  assert.equal(s.shiftReason, 'reindex');
  assert.equal(s.roles.projector.connected.gdiDeviceName, '\\\\.\\DISPLAY1');
  clock.advance(10_000);
  assert.equal(edid.status().roles.projector.state, 'matched', 'the notice goes back to matched by itself');
});

test('a rearranged desktop moves the lock target to wherever the monitor now is', () => {
  const { edid, w } = edidSetup();
  edid.pin('projector', 1002);
  w.hw.monitors = [PANEL(), PROJECTOR({ gdi: '\\\\.\\DISPLAY4', x: -1920 })];
  edid.topologyChanged('display-metrics-changed');
  assert.deepEqual(edid.target('projector').display.bounds, { x: -1920, y: 0, width: 1920, height: 1080 });
});

test('an unplugged sanctuary monitor gives no display at all, never another one', () => {
  const side = raw({ gdi: '\\\\.\\DISPLAY5', x: -1280, width: 1280, height: 720, target: 4400, edid: makeEdid({ mfg: 'DEL', serial: 55 }) });
  const { edid, w } = edidSetup(world([PANEL(), PROJECTOR(), side]));
  edid.pin('projector', 1002);
  w.hw.monitors = [PANEL(), side];
  edid.topologyChanged('display-removed');
  const t = edid.target('projector');
  assert.equal(t.display, null);
  assert.equal(t.reason, 'missing');
  assert.equal(edid.status().roles.projector.state, 'missing');
});

test('the pinned monitor turned into the booth screen (duplicate mode or made primary) is refused', () => {
  const { edid, w } = edidSetup();
  edid.pin('projector', 1002);
  w.hw.monitors = [PANEL(), PROJECTOR({ x: 0 })]; // duplicate: both show the desktop at 0,0
  edid.topologyChanged('display-metrics-changed');
  const t = edid.target('projector');
  assert.equal(t.display, null);
  assert.equal(t.reason, 'primary');
  assert.equal(edid.status().roles.projector.state, 'booth');
});

test('a monitor Windows reports before Electron does is left alone, not parked', () => {
  const { edid, w } = edidSetup();
  edid.pin('projector', 1002);
  w.hw.electronLags = true;
  w.hw.monitors = [PANEL(), PROJECTOR({ x: 3840 })];
  edid.topologyChanged('WM_DISPLAYCHANGE');
  assert.equal(edid.target('projector').pending, true);
});

test('a topology event re-checks as Windows settles, and a new event starts the checks again', () => {
  const { edid, clock, settled } = edidSetup();
  edid.topologyChanged('WM_DISPLAYCHANGE');
  clock.advance(100);
  edid.topologyChanged('display-added');
  clock.advance(2000);
  assert.deepEqual(settled, [
    ['display-added', 250],
    ['display-added', 1600],
  ]);
});

test('a failed hardware query makes the lock unavailable instead of hiding the projector', () => {
  const { edid, w } = edidSetup();
  edid.pin('projector', 1002);
  w.hw.fail = 'QueryDisplayConfig failed (Win32 error 87)';
  edid.refresh();
  assert.deepEqual(edid.target('projector'), { locked: false });
  assert.equal(edid.status().roles.projector.state, 'unavailable');
  w.hw.fail = null;
  edid.refresh();
  assert.equal(edid.status().roles.projector.state, 'matched');
});

test('unpinning returns the projector to its Settings display', () => {
  const { edid, w } = edidSetup();
  edid.pin('projector', 1002);
  edid.unpin('projector');
  assert.equal(w.locks.projector, null);
  assert.deepEqual(edid.target('projector'), { locked: false });
});

// ---- The projector following its lock (electron/watchdog.js) ----

function lockedProjector(w = world()) {
  const s = edidSetup(w);
  s.edid.pin('projector', s.projectorDisplayId());
  const log = [];
  const reanchors = [];
  const dog = createSanctuaryWatchdog({
    failover: fakeSurface(log),
    screen: w.screen,
    lockedTarget: () => s.edid.target('projector'),
    onReanchor: (id) => reanchors.push(id),
    log: quiet,
    ...fakeClock(),
  });
  const win = fakeWindow(log, 'projector', { x: 1920, y: 0, width: 1920, height: 1080 });
  win.setFullScreen(true);
  dog.attachProjector(win, { displayId: s.projectorDisplayId(), fullscreen: true });
  const changed = (monitors, source = 'display-metrics-changed') => {
    w.hw.monitors = monitors;
    s.edid.topologyChanged(source);
    log.length = 0;
    dog.displaysChanged();
  };
  return { ...s, log, reanchors, dog, win, changed };
}

test('a re-index with the projector still on its monitor changes nothing on the sanctuary screen', () => {
  const { log, reanchors, changed, dog } = lockedProjector();
  changed([{ ...PANEL(), gdiDeviceName: '\\\\.\\DISPLAY3' }, PROJECTOR({ gdi: '\\\\.\\DISPLAY1' })]);
  assert.deepEqual(log, [], 'no move, no fullscreen toggle, no flicker');
  assert.deepEqual(reanchors, []);
  assert.equal(dog.status().displayId, 1001, 'its new id is remembered');
});

test('a projector Windows dragged onto the wrong screen snaps back onto its locked monitor', () => {
  const { log, reanchors, changed, win, edid } = lockedProjector();
  // Windows renumbered and threw the window onto the laptop panel at 0,0.
  win.setBounds({ x: 0, y: 0, width: 1920, height: 1080 });
  changed([{ ...PANEL(), gdiDeviceName: '\\\\.\\DISPLAY2' }, PROJECTOR({ gdi: '\\\\.\\DISPLAY1' })]);
  assert.ok(log.includes('projector.setBounds 1920,0 1920x1080'), log.join(' | '));
  assert.ok(log.includes('projector.fullscreen true'));
  assert.deepEqual(reanchors, [1001]);
  edid.reanchored(1001);
  assert.equal(edid.status().roles.projector.state, 'shifted');
});

test('an unplugged sanctuary monitor hides the projector even when another external screen is there', () => {
  const side = raw({ gdi: '\\\\.\\DISPLAY5', x: -1280, width: 1280, height: 720, target: 4400, edid: makeEdid({ mfg: 'DEL', serial: 55 }) });
  const { log, changed, dog, win } = lockedProjector(world([PANEL(), PROJECTOR(), side]));
  changed([PANEL(), side], 'display-removed');
  assert.deepEqual(log.slice(0, 2), ['projector.opacity 0', 'projector.hide'], 'hidden first');
  assert.equal(win.isVisible(), false);
  assert.ok(!log.some((l) => l.includes('-1280')), 'never moved to the side monitor');
  assert.equal(dog.status().parked, true);
  changed([PANEL(), side, PROJECTOR({ gdi: '\\\\.\\DISPLAY9' })], 'display-added');
  assert.ok(log.includes('projector.showInactive'));
  assert.equal(dog.status().parked, false);
  assert.equal(dog.status().displayId, 1009);
});

test('the pinned monitor duplicated onto the booth screen hides the projector', () => {
  const { changed, dog } = lockedProjector();
  changed([PANEL(), PROJECTOR({ x: 0 })]);
  assert.equal(dog.status().parked, true);
});

test('while Electron lags behind Windows the projector is left where it is', () => {
  const { log, changed, w, dog } = lockedProjector();
  w.hw.electronLags = true;
  changed([PANEL(), PROJECTOR({ x: 3840 })], 'WM_DISPLAYCHANGE');
  assert.deepEqual(log, []);
  assert.equal(dog.status().parked, false);
});

test('a projector opened while its monitor is away stays hidden and appears when it is plugged in', () => {
  const w = world([PANEL()]);
  const s = edidSetup(w);
  w.locks.projector = sanitizeDisplayLock({ ...lockOf(normalizeMonitor(PROJECTOR())), name: 'EPSON PJ' });
  s.edid.refresh();
  const log = [];
  const dog = createSanctuaryWatchdog({ failover: fakeSurface(log), screen: w.screen, lockedTarget: () => s.edid.target('projector'), log: quiet, ...fakeClock() });
  const win = fakeWindow(log, 'projector', { x: 80, y: 80, width: 1280, height: 720 });
  win.hide(); // created with show: false
  dog.attachProjector(win, { displayId: null, fullscreen: true, parked: true });
  assert.equal(dog.status().parked, true);
  w.hw.monitors = [PANEL(), PROJECTOR()];
  s.edid.topologyChanged('display-added');
  dog.displaysChanged();
  assert.ok(log.includes('projector.setBounds 1920,0 1920x1080'));
  assert.ok(log.includes('projector.fullscreen true'));
  assert.ok(log.includes('projector.showInactive'));
});

// ---- Config and wiring ----

test('locks are saved in config.json, and a damaged one is dropped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apcc-edid-'));
  try {
    assert.deepEqual(readConfig(dir).display_locks, { projector: null });
    const lock = sanitizeDisplayLock({ ...lockOf(normalizeMonitor(PROJECTOR())), name: 'EPSON PJ', serial: 'X7PL001234', uniqueSerial: true });
    writeConfig(dir, { display_locks: { projector: lock } });
    assert.equal(readConfig(dir).display_locks.projector.serial, 'X7PL001234');
    writeConfig(dir, { display_locks: { projector: { fingerprint: 'nope' } } });
    assert.equal(readConfig(dir).display_locks.projector, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('main.js reads the hardware on every topology event, hooks WM_DISPLAYCHANGE, and packages the addon unpacked', () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).replace(/%20/g, ' '), '..');
  // Git may check the file out with CRLF line ends on Windows; the checks below are written with \n.
  const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(main.includes("edid?.topologyChanged(event);\n      watchdog.displaysChanged();"));
  assert.ok(main.includes("win.hookWindowMessage(WM_DISPLAYCHANGE, () => edid?.topologyChanged('WM_DISPLAYCHANGE'))"));
  assert.ok(main.includes("lockedTarget: () => edid?.target('projector') ?? { locked: false }"));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.build.asarUnpack.includes('electron/display-matrix.node'));
  assert.match(pkg.scripts.release, /node tools\/build-native\.mjs && electron-builder/);
  assert.match(pkg.scripts.postinstall, /build-native\.mjs --optional/);
});

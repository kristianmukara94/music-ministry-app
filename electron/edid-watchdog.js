// The sanctuary EDID lock. The projector is pinned to a physical monitor on a physical GPU output, not to a Windows display number.
//
// Why: Electron's display ids on Windows come from the GDI device name (\\.\DISPLAY2). Windows hands those names out again after a driver
// restart, a hot-plug or a change of primary display, so "display 2" can become the operator's laptop. The native addon
// (src/native/edid_reader.cc → electron/display-matrix.node) reports what is really connected: the GPU output each monitor leaves from and
// the EDID of the monitor itself. This module turns that into stable keys, resolves a saved lock to today's Electron display, and notices
// when Windows shuffles the topology.
//
// Identity:
//   monitorKey  the monitor itself: EDID manufacturer, product code and serial (number and text). Survives a move to another port.
//   portKey     the GPU output: the adapter's device path and the target id. NOT the adapter LUID, which Windows renews at every boot and
//               driver restart, the very events this lock is for.
//   fingerprint portKey + monitorKey.
//
// Nothing here imports Electron. The addon, the screen and the timers come in as arguments.

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

export const LOCK_ROLES = ['projector'];
/** How long the console shows "Topology shift detected" after Windows re-indexed or the window was re-anchored. */
export const SHIFT_NOTICE_MS = 10_000;
/** Re-checks after a topology event. Windows and the graphics driver keep adjusting for a moment after the first message. */
export const SETTLE_CHECKS_MS = [150, 1500];
/** WM_DISPLAYCHANGE, for BrowserWindow.hookWindowMessage. */
export const WM_DISPLAYCHANGE = 0x007e;

// DISPLAYCONFIG_VIDEO_OUTPUT_TECHNOLOGY (wingdi.h).
const TECHNOLOGY = new Map([
  [0, 'VGA'],
  [1, 'S-Video'],
  [2, 'Composite'],
  [3, 'Component'],
  [4, 'DVI'],
  [5, 'HDMI'],
  [6, 'LVDS'],
  [8, 'D-Jpn'],
  [9, 'SDI'],
  [10, 'DisplayPort'],
  [11, 'Embedded DisplayPort'],
  [12, 'UDI'],
  [13, 'Embedded UDI'],
  [14, 'SDTV dongle'],
  [15, 'Miracast'],
  [16, 'Wired indirect'],
  [17, 'Virtual indirect'],
  [18, 'DisplayPort over USB'],
  [0x80000000, 'Internal'],
]);

/** The connector's name. The addon passes the enum through a signed int, so 0x80000000 (internal) arrives negative. */
export function outputTechnologyName(value) {
  if (!Number.isFinite(value)) return 'Unknown';
  return TECHNOLOGY.get(value >>> 0) ?? (value === -1 ? 'Other' : 'Unknown');
}

/** Three letters from EDID's packed manufacturer word (bytes 8-9, big-endian, five bits a letter, 1 = A). */
export function pnpIdFromWord(word) {
  if (!Number.isInteger(word) || word <= 0) return null;
  const letters = [(word >> 10) & 31, (word >> 5) & 31, word & 31];
  if (letters.some((n) => n < 1 || n > 26)) return null;
  return String.fromCharCode(...letters.map((n) => n + 64));
}

/**
 * Reads the base block of an EDID. Returns null for anything that is not one (wrong header or too short).
 * `{ manufacturer, productCode, serialNumber, serialString, name, week, year, version, checksumValid }`.
 */
export function parseEdid(bytes) {
  if (!bytes || bytes.length < 128) return null;
  const b = Uint8Array.from(bytes.subarray ? bytes.subarray(0, 128) : bytes.slice(0, 128));
  const HEADER = [0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00];
  if (HEADER.some((v, i) => b[i] !== v)) return null;
  const text = (at) => {
    let s = '';
    for (let i = at + 5; i < at + 18; i += 1) {
      if (b[i] === 0x0a) break;
      s += String.fromCharCode(b[i]);
    }
    return s.replace(/[^\x20-\x7e]/g, '').trim();
  };
  let serialString = '';
  let name = '';
  for (const at of [54, 72, 90, 108]) {
    if (b[at] !== 0 || b[at + 1] !== 0 || b[at + 2] !== 0) continue; // a detailed timing, not a text descriptor
    if (b[at + 3] === 0xff) serialString = text(at);
    else if (b[at + 3] === 0xfc) name = text(at);
  }
  const sum = b.reduce((acc, v) => acc + v, 0);
  return {
    manufacturer: pnpIdFromWord((b[8] << 8) | b[9]),
    productCode: b[10] | (b[11] << 8),
    serialNumber: (b[12] | (b[13] << 8) | (b[14] << 16) | (b[15] << 24)) >>> 0,
    serialString,
    name,
    week: b[16],
    year: b[17] + 1990,
    version: `${b[18]}.${b[19]}`,
    checksumValid: sum % 256 === 0,
  };
}

const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/**
 * One monitor from the addon, made stable: `{ gdiDeviceName, physicalBounds, primary, fingerprint, monitor: {...}, port: {...} }`.
 * The EDID block is preferred for identity; DisplayConfig's EDID ids stand in when it could not be read.
 */
export function normalizeMonitor(raw) {
  const edid = parseEdid(raw.edid);
  // DisplayConfig hands the manufacturer word over byte-swapped (LEN arrives as 0xAE30, not 0x30AE).
  const word = Number.isInteger(raw.edidManufactureId) ? ((raw.edidManufactureId & 0xff) << 8) | (raw.edidManufactureId >> 8) : null;
  const manufacturer = edid?.manufacturer ?? pnpIdFromWord(word) ?? '???';
  const productCode = edid?.productCode ?? raw.edidProductCodeId ?? 0;
  const serialNumber = edid?.serialNumber ?? 0;
  const serialString = edid?.serialString ?? '';
  const name = edid?.name || raw.friendlyName || `${manufacturer} ${productCode.toString(16).toUpperCase().padStart(4, '0')}`;
  const monitorKey = hash(`edid|${manufacturer}|${productCode}|${serialNumber}|${serialString}`);
  const adapterPath = String(raw.adapterDevicePath ?? '').toLowerCase();
  const portKey = hash(`port|${adapterPath}|${raw.targetId}`);
  const technology = outputTechnologyName(raw.outputTechnology);
  const b = raw.physicalBounds ?? null;
  return {
    gdiDeviceName: raw.gdiDeviceName ?? '',
    physicalBounds: b,
    primary: Boolean(b && b.x === 0 && b.y === 0),
    fingerprint: `${portKey}.${monitorKey}`,
    monitor: {
      key: monitorKey,
      name,
      manufacturer,
      productCode,
      serialNumber,
      serialString,
      // Without a serial, two monitors of the same model look alike. The port then has to settle which is which.
      uniqueSerial: serialNumber !== 0 || serialString !== '',
      edidRead: Boolean(edid),
    },
    port: {
      key: portKey,
      technology,
      targetId: raw.targetId,
      connector: raw.connectorInstance ?? null,
      gpuName: raw.gpuName ?? '',
      label: `${technology}${raw.gpuName ? ` on ${raw.gpuName}` : ''}`,
    },
  };
}

export function normalizeTopology(raw) {
  return (raw?.monitors ?? []).map(normalizeMonitor);
}

/**
 * Finds the locked monitor among those connected. `match` says how sure the answer is:
 *   'exact'    same monitor on the same GPU output
 *   'monitor'  the same monitor, moved to another output
 *   'port'     another monitor on the locked output (the projector was replaced): used, but the console asks for a re-pin
 *   null       not connected, or two look-alike monitors and nothing to tell them apart
 */
export function resolveLock(lock, monitors) {
  if (!lock) return { monitor: null, match: null };
  const exact = monitors.filter((m) => m.fingerprint === lock.fingerprint);
  if (exact.length >= 1) return { monitor: exact[0], match: 'exact' };
  const same = monitors.filter((m) => m.monitor.key === lock.monitorKey);
  if (same.length === 1) return { monitor: same[0], match: 'monitor' };
  const onPort = monitors.filter((m) => m.port.key === lock.portKey);
  if (onPort.length >= 1) return { monitor: onPort[0], match: 'port', ambiguous: same.length > 1 };
  return { monitor: null, match: null, ambiguous: same.length > 1 };
}

/**
 * The Electron display showing this monitor: the one whose physical rectangle starts at the monitor's desktop position.
 * `toPhysical(display)` gives a display's physical rectangle; in the app it is screen.dipToScreenRect. Not `display.nativeOrigin`: on mixed
 * DPI desktops Electron 33 reports it in scaled units (a 125% panel at physical -1920,0 comes back as -1536,0; seen on the booth laptop).
 */
export function electronDisplayFor(monitor, displays, toPhysical = (d) => d.nativeOrigin) {
  const b = monitor?.physicalBounds;
  if (!b) return null;
  // A pixel or two of rounding in the DIP-to-physical conversion is not a different screen.
  const near = (p) => p && Math.abs(p.x - b.x) <= 2 && Math.abs(p.y - b.y) <= 2;
  return displays.find((d) => near(toPhysical(d))) ?? null;
}

/** A saved lock, as config.json keeps it. Anything malformed is dropped. */
export function sanitizeDisplayLock(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const str = (v) => (typeof v === 'string' ? v.slice(0, 200) : '');
  const fingerprint = str(raw.fingerprint);
  const monitorKey = str(raw.monitorKey);
  const portKey = str(raw.portKey);
  if (!/^[0-9a-f]{16}\.[0-9a-f]{16}$/.test(fingerprint) || !/^[0-9a-f]{16}$/.test(monitorKey) || !/^[0-9a-f]{16}$/.test(portKey)) return null;
  return {
    fingerprint,
    monitorKey,
    portKey,
    name: str(raw.name),
    manufacturer: str(raw.manufacturer),
    productCode: Number.isInteger(raw.productCode) ? raw.productCode : 0,
    serial: str(raw.serial),
    uniqueSerial: raw.uniqueSerial === true,
    portLabel: str(raw.portLabel),
    pinnedAt: typeof raw.pinnedAt === 'string' ? raw.pinnedAt : null,
  };
}

export function sanitizeDisplayLocks(raw) {
  const out = {};
  for (const role of LOCK_ROLES) out[role] = sanitizeDisplayLock(raw?.[role]);
  return out;
}

const serialText = (m) => m.monitor.serialString || (m.monitor.serialNumber ? String(m.monitor.serialNumber) : '');

/** Loads electron/display-matrix.node. Null when it is not built, or not on Windows: the lock is then unavailable and nothing else changes. */
export function loadDisplayMatrix({ log = console, platform = process.platform } = {}) {
  if (platform !== 'win32') return null;
  try {
    return createRequire(import.meta.url)('./display-matrix.node');
  } catch (err) {
    log.warn?.(`[edid] display-matrix addon not loaded (${err?.message ?? err}). The EDID lock is unavailable.`);
    return null;
  }
}

/**
 * The lock and the topology monitor.
 * - `native`: the addon (or null). `screen`: Electron's screen.
 * - `getLock(role)` / `saveLock(role, lock|null)`: where locks are kept (config.json).
 * - `onSettled()`: runs after each settle re-check, so the caller can re-anchor windows once Windows has finished re-arranging.
 * - `onStatus(status)`: runs after every change, for the console.
 */
export function createEdidWatchdog({
  native,
  screen,
  getLock,
  saveLock,
  onSettled = () => {},
  onStatus = () => {},
  log = console,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  settleChecksMs = SETTLE_CHECKS_MS,
  shiftNoticeMs = SHIFT_NOTICE_MS,
}) {
  let monitors = [];
  let error = null;
  let queryMs = null;
  let shiftAt = null;
  let shiftReason = null;
  // Where the locked monitor was last seen: its GDI name and Electron display id. A change with the monitor still there is a re-index.
  const lastSeen = new Map();
  let timers = [];
  let noticeTimer = null;

  const available = () => Boolean(native) && error === null;
  // Each Electron display's rectangle in physical pixels, to line it up with what the hardware reports.
  const toPhysical = (d) => (typeof screen.dipToScreenRect === 'function' ? screen.dipToScreenRect(null, d.bounds) : d.nativeOrigin);

  function refresh() {
    if (!native) return monitors;
    const started = performance.now();
    try {
      monitors = normalizeTopology(native.getHardwareDisplayTopology());
      error = null;
    } catch (err) {
      error = err?.message ?? String(err);
      log.error?.('[edid] topology query failed:', error);
    }
    queryMs = Math.round((performance.now() - started) * 100) / 100;
    return monitors;
  }

  function noteShift(reason) {
    shiftAt = now();
    shiftReason = reason;
    if (noticeTimer !== null) clearTimer(noticeTimer);
    // The badge goes back to "matched" by itself once the notice has been up long enough.
    noticeTimer = setTimer(() => {
      noticeTimer = null;
      emit();
    }, shiftNoticeMs);
  }

  /**
   * Where a locked role should be now, from the last refresh.
   * `{ locked: false }` with no lock (or no addon): the caller keeps its own display choice.
   * `{ locked: true, display }`: show it there. `display: null`: the locked monitor is not connected, or it is the primary (booth) display,
   * so the window must be hidden. `pending: true`: the monitor is connected but Electron has not caught up yet; leave the window as it is.
   */
  function target(role = 'projector') {
    const lock = getLock(role);
    if (!lock || !available()) return { locked: false };
    const { monitor, match } = resolveLock(lock, monitors);
    if (!monitor) return { locked: true, display: null, match: null, reason: 'missing' };
    const displays = screen.getAllDisplays();
    const display = electronDisplayFor(monitor, displays, toPhysical);
    if (!display) return { locked: true, display: undefined, pending: true, match, monitor };
    // Duplicate mode, or the projector made the primary: the sanctuary monitor is the booth desktop. Slides never go there.
    if (monitor.primary || display.id === screen.getPrimaryDisplay().id) return { locked: true, display: null, match, monitor, reason: 'primary' };
    return { locked: true, display, match, monitor };
  }

  function track() {
    for (const role of LOCK_ROLES) {
      const t = target(role);
      if (!t.locked || !t.monitor || !t.display) continue;
      const seen = { gdi: t.monitor.gdiDeviceName, displayId: t.display.id };
      const before = lastSeen.get(role);
      if (before && (before.gdi !== seen.gdi || before.displayId !== seen.displayId)) {
        log.warn?.(`[edid] topology shift: the ${role} monitor is now ${seen.gdi} (display ${seen.displayId}), was ${before.gdi} (display ${before.displayId})`);
        noteShift('reindex');
      }
      lastSeen.set(role, seen);
    }
  }

  function lockSummary(role) {
    const lock = getLock(role);
    if (!lock) return null;
    return { name: lock.name, manufacturer: lock.manufacturer, serial: lock.serial, portLabel: lock.portLabel, pinnedAt: lock.pinnedAt };
  }

  function roleStatus(role) {
    const lock = lockSummary(role);
    if (!native || error) return { state: 'unavailable', lock, connected: null };
    if (!lock) return { state: 'unpinned', lock, connected: null };
    const t = target(role);
    const connected = t.monitor
      ? { name: t.monitor.monitor.name, serial: serialText(t.monitor), portLabel: t.monitor.port.label, gdiDeviceName: t.monitor.gdiDeviceName }
      : null;
    let state;
    if (!t.monitor) state = 'missing';
    else if (t.reason === 'primary') state = 'booth';
    else if (shiftAt !== null && now() - shiftAt < shiftNoticeMs) state = 'shifted';
    else if (t.match === 'port') state = 'port';
    else state = 'matched';
    return { state, lock, connected, match: t.match ?? null };
  }

  function status() {
    return {
      available: available(),
      error: native ? error : 'The display-matrix addon is not loaded.',
      queryMs,
      shiftAt,
      shiftReason,
      roles: Object.fromEntries(LOCK_ROLES.map((role) => [role, roleStatus(role)])),
      monitors: monitors.map((m) => ({
        name: m.monitor.name,
        serial: serialText(m),
        portLabel: m.port.label,
        gdiDeviceName: m.gdiDeviceName,
        primary: m.primary,
      })),
    };
  }

  function emit() {
    try {
      onStatus(status());
    } catch (err) {
      log.error?.('[edid] status listener failed:', err);
    }
  }

  function check() {
    refresh();
    track();
    emit();
  }

  refresh();
  track();

  return {
    status,
    target,
    /** Re-reads the hardware now. Call before acting on a topology event. */
    refresh: check,

    /**
     * A topology event: an Electron screen event or WM_DISPLAYCHANGE. Re-reads now, and again as Windows settles, calling `onSettled` each
     * time. A new event restarts the settle checks.
     */
    topologyChanged(source) {
      check();
      for (const t of timers) clearTimer(t);
      timers = settleChecksMs.map((ms) =>
        setTimer(() => {
          check();
          try {
            onSettled(source);
          } catch (err) {
            log.error?.('[edid] settle handler failed:', err);
          }
        }, ms),
      );
    },

    /** The projector window was moved back onto its locked monitor. */
    reanchored(displayId) {
      log.warn?.(`[edid] projector re-anchored to its locked monitor (display ${displayId})`);
      noteShift('reanchor');
      emit();
    },

    /**
     * Pins `role` to the monitor showing Electron display `displayId`. Refuses the primary (booth) display, a display with no monitor found
     * on it, and a display shown on two monitors at once (duplicate mode).
     */
    pin(role, displayId) {
      if (!LOCK_ROLES.includes(role)) throw new Error('Unknown output.');
      if (!available()) throw new Error('The hardware display reader is not available on this PC.');
      refresh();
      const primaryId = screen.getPrimaryDisplay().id;
      if (displayId == null || displayId === primaryId) {
        throw new Error('The projector is on the operator screen. Put it on the sanctuary display first, then pin it.');
      }
      const display = screen.getAllDisplays().find((d) => d.id === displayId);
      const on = display ? monitors.filter((m) => electronDisplayFor(m, [display], toPhysical)) : [];
      if (on.length === 0) throw new Error('No physical monitor was found for that display. Check the cable and try again.');
      if (on.length > 1) throw new Error('That display is duplicated on two monitors. Set Windows to "Extend these displays" first.');
      const m = on[0];
      const lock = sanitizeDisplayLock({
        fingerprint: m.fingerprint,
        monitorKey: m.monitor.key,
        portKey: m.port.key,
        name: m.monitor.name,
        manufacturer: m.monitor.manufacturer,
        productCode: m.monitor.productCode,
        serial: serialText(m),
        uniqueSerial: m.monitor.uniqueSerial,
        portLabel: m.port.label,
        pinnedAt: new Date(now()).toISOString(),
      });
      saveLock(role, lock);
      lastSeen.set(role, { gdi: m.gdiDeviceName, displayId });
      shiftAt = null;
      log.info?.(`[edid] ${role} pinned to ${lock.name} (${lock.serial || 'no serial'}) on ${lock.portLabel}`);
      emit();
      return status();
    },

    unpin(role) {
      if (!LOCK_ROLES.includes(role)) throw new Error('Unknown output.');
      saveLock(role, null);
      lastSeen.delete(role);
      emit();
      return status();
    },

    dispose() {
      for (const t of timers) clearTimer(t);
      timers = [];
      if (noticeTimer !== null) clearTimer(noticeTimer);
      noticeTimer = null;
    },
  };
}

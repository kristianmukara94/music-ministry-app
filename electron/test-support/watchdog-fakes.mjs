// Fakes shared by the watchdog and EDID lock tests: a clock that only moves when told, a BrowserWindow stand-in, and a failover surface.
import { EventEmitter } from 'node:events';

/** A clock with timeouts and intervals that only move when `advance` is called. */
export function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  const add = (fn, ms, every) => {
    const id = nextId++;
    timers.set(id, { fn, at: now + ms, every });
    return id;
  };
  const clock = {
    now: () => now,
    setTimer: (fn, ms) => add(fn, ms, null),
    clearTimer: (id) => timers.delete(id),
    setRepeat: (fn, ms) => add(fn, ms, ms),
    clearRepeat: (id) => timers.delete(id),
    pending: () => timers.size,
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        const [id, t] = next;
        now = t.at;
        if (t.every) t.at += t.every;
        else timers.delete(id);
        t.fn();
      }
      now = end;
    },
  };
  return clock;
}

/** A BrowserWindow stand-in. Every call that matters goes to `log`, in order. */
export function fakeWindow(log = [], name = 'projector', bounds = { x: 1920, y: 0, width: 1920, height: 1080 }) {
  const win = new EventEmitter();
  const wc = new EventEmitter();
  let destroyed = false;
  let crashed = false;
  let visible = true;
  let full = false;
  let b = { ...bounds };
  wc.sent = [];
  wc.send = (channel, ...args) => wc.sent.push([channel, ...args]);
  wc.reload = () => {
    crashed = false;
    log.push(`${name}.reload`);
  };
  wc.forcefullyCrashRenderer = () => {
    crashed = true;
    log.push(`${name}.kill`);
  };
  wc.isCrashed = () => crashed;
  wc.crash = (reason = 'crashed') => {
    crashed = true;
    wc.emit('render-process-gone', {}, { reason, exitCode: 1 });
  };
  wc.isDestroyed = () => destroyed;
  win.webContents = wc;
  win.isDestroyed = () => destroyed;
  win.destroy = () => {
    destroyed = true;
    win.emit('closed');
  };
  win.hide = () => {
    visible = false;
    log.push(`${name}.hide`);
  };
  win.showInactive = () => {
    visible = true;
    log.push(`${name}.showInactive`);
  };
  win.isVisible = () => visible;
  win.moveTop = () => log.push(`${name}.moveTop`);
  win.getBounds = () => ({ ...b });
  win.setBounds = (next) => {
    b = { ...next };
    log.push(`${name}.setBounds ${next.x},${next.y} ${next.width}x${next.height}`);
  };
  win.isFullScreen = () => full;
  win.setFullScreen = (on) => {
    // As Electron 33 does on Windows: leaving fullscreen shows a hidden window again.
    if (full && !on && !visible) visible = true;
    full = on;
    log.push(`${name}.fullscreen ${on}`);
  };
  win.setOpacity = (o) => log.push(`${name}.opacity ${o}`);
  return win;
}

/** The failover surface stand-in for the watchdog tests. */
export function fakeSurface(log) {
  return {
    open: (bounds, mode) => log.push(`surface.open ${mode}`),
    close: () => log.push('surface.close'),
    setBounds: (b) => log.push(`surface.setBounds ${b.x},${b.y}`),
    show: (mode) => log.push(`surface.show ${mode}`),
    hide: (mode) => log.push(`surface.hide ${mode}`),
    prime: (mode) => log.push(`surface.prime ${mode}`),
  };
}

export const quiet = { warn() {}, info() {}, error() {} };

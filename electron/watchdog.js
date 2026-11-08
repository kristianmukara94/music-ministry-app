// The sanctuary display watchdog. It keeps a broken projector page off the congregation's screen.
//
// - Heartbeat: once a second the main process pings the projector page, and the page's preload answers. Two pings in a row with no answer
//   (about two seconds of a frozen page) count as a freeze.
// - Crashes: the projector page's process going away, a GPU process crash, or Electron's own "unresponsive" signal.
// - Display unplugged: the projector is hidden, or moved to another external screen, instead of being dragged onto the operator's laptop.
//
// On any fault the failover surface (electron/windows.js), a window kept loaded and hidden over the projector, is shown at once. The
// projector page is then reloaded behind it, as often as it takes. Once the new page answers the heartbeat it has read the live state again,
// and the failover surface is hidden.
//
// Nothing here imports Electron. Windows, screens and timers come in as arguments, so the tests can drive every path with fakes.

export const HEARTBEAT_MS = 1000;
/** Unanswered pings in a row that count as a frozen page. */
export const MISSED_BEATS_LIMIT = 2;
/** A frozen page gets this long to come back by itself before it is restarted. The failover surface covers it meanwhile. */
export const FREEZE_GRACE_MS = 3000;
/** How long a revived page must keep answering before the failover surface is taken down, so its slide has drawn. */
export const RECOVERY_SETTLE_MS = 600;
/** The first wait before another restart is tried. It doubles each time, up to the maximum. */
export const REVIVE_RETRY_MS = 5000;
export const REVIVE_RETRY_MAX_MS = 30000;
/** A killed page is reloaded when its process is reported gone, or after this long if that report never comes. */
export const KILL_RELOAD_FALLBACK_MS = 1000;

export const PING_CHANNEL = 'watchdog:ping';
export const PONG_CHANNEL = 'watchdog:pong';
export const STATUS_CHANNEL = 'watchdog:status';

/** What the failover surface draws: the parish emblem on near-black, or pure black. */
export const FAILOVER_MODES = ['emblem', 'blackout'];
export const DEFAULT_FAILOVER_MODE = 'emblem';

export function sanitizeFailoverMode(value) {
  return FAILOVER_MODES.includes(value) ? value : DEFAULT_FAILOVER_MODE;
}

/** Process exits that are not faults: a window closing normally. */
const CLEAN_EXITS = new Set(['clean-exit']);

/** True for a GPU process that went away abnormally (an `app` `child-process-gone` event's details). */
export function isGpuCrash(details) {
  return details?.type === 'GPU' && !CLEAN_EXITS.has(details?.reason);
}

/**
 * The ping/pong counter. `start()` pings at once and then every `intervalMs`. It is armed by the first answer, so a page still loading is
 * never taken for a frozen one. Once armed, `missLimit` unanswered pings in a row call `onFreeze` once; `rearm()` starts the count again.
 */
export function createHeartbeat({
  send,
  onFreeze,
  onArm = () => {},
  intervalMs = HEARTBEAT_MS,
  missLimit = MISSED_BEATS_LIMIT,
  setRepeat = setInterval,
  clearRepeat = clearInterval,
}) {
  let timer = null;
  let seq = 0;
  let answered = 0;
  let armed = false;
  let missed = 0;
  let tripped = false;

  function tick() {
    if (armed && !tripped) {
      if (answered < seq) {
        missed += 1;
        if (missed >= missLimit) {
          tripped = true;
          onFreeze({ missed, seq });
        }
      } else {
        missed = 0;
      }
    }
    seq += 1;
    send(seq);
  }

  return {
    start() {
      if (timer !== null) return;
      tick();
      timer = setRepeat(tick, intervalMs);
    },
    stop() {
      if (timer !== null) clearRepeat(timer);
      timer = null;
      armed = false;
      tripped = false;
      missed = 0;
    },
    /** An answer to ping `n`. Returns false for a number never sent. */
    pong(n) {
      if (!Number.isInteger(n) || n < 1 || n > seq) return false;
      if (n > answered) answered = n;
      if (!armed) {
        armed = true;
        missed = 0;
        onArm();
      }
      return true;
    },
    /** Forgets the misses so far and waits for a fresh answer before counting again. */
    rearm() {
      armed = false;
      tripped = false;
      missed = 0;
      answered = seq;
    },
    state: () => ({ running: timer !== null, armed, tripped, missed, seq, answered }),
  };
}

/**
 * Where the projector should be after the displays changed.
 * - `stay`: its display is still connected (or it is parked and no external display is back yet).
 * - `move`: to `displayId`, an external display. A parked projector prefers the display it was on, then the one chosen in Settings.
 * - `park`: its display is gone and only the primary (the operator's screen) is left, so it is hidden.
 */
export function planProjectorDisplay({ displays, primaryId, currentId, preferredId = null, parked = false }) {
  const ids = new Set((displays ?? []).map((d) => d.id));
  const external = (id) => id != null && id !== primaryId && ids.has(id);
  if (!parked && ids.has(currentId)) return { action: 'stay' };
  const pick = [parked ? currentId : null, preferredId].find(external) ?? (displays ?? []).find((d) => d.id !== primaryId)?.id ?? null;
  if (pick != null) return { action: 'move', displayId: pick };
  return parked ? { action: 'stay' } : { action: 'park' };
}

const alive = (win) => Boolean(win && !win.isDestroyed());

/**
 * Restarts one page. A crashed page is reloaded at once, into a new process. A hung page is killed first, and reloaded only once its process
 * is reported gone: a reload issued in the same instant as the kill went to the dying process and loaded nothing (seen in Electron 33).
 * Call `gone()` from the page's `render-process-gone`; it returns true when that was the kill being waited on.
 */
function createRestarter(wc, { setTimer, clearTimer, fallbackMs }) {
  let waiting = null;
  const reload = () => {
    if (waiting !== null) clearTimer(waiting);
    waiting = null;
    if (!wc.isDestroyed()) wc.reload();
  };
  return {
    restart(hard) {
      if (hard && !wc.isCrashed()) {
        wc.forcefullyCrashRenderer();
        if (waiting === null) waiting = setTimer(reload, fallbackMs);
      } else {
        reload();
      }
    },
    gone() {
      if (waiting === null) return false;
      reload();
      return true;
    },
    cancel() {
      if (waiting !== null) clearTimer(waiting);
      waiting = null;
    },
  };
}

/**
 * The watchdog for the projector and lower-third windows.
 *
 * `failover` is the surface from electron/windows.js: `{ open(bounds, mode), close(), setBounds(bounds), show(mode), hide(nextMode), prime(mode) }`.
 * `screen` is Electron's screen module (only read when the displays change). `onStatus(status)` runs after every change, for the console badge.
 */
export function createSanctuaryWatchdog({
  failover,
  screen,
  preferredDisplayId = () => null,
  // The EDID lock (electron/edid-watchdog.js): `{ locked: false }`, or `{ locked: true, display }` with the Electron display of the pinned
  // monitor, `display: null` when it must not be shown anywhere, or `pending: true` while Electron catches up with Windows.
  lockedTarget = () => ({ locked: false }),
  onReanchor = () => {},
  onStatus = () => {},
  mode: initialMode = DEFAULT_FAILOVER_MODE,
  log = console,
  now = () => performance.now(),
  wallClock = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  setRepeat = setInterval,
  clearRepeat = clearInterval,
  heartbeatMs = HEARTBEAT_MS,
  missLimit = MISSED_BEATS_LIMIT,
  freezeGraceMs = FREEZE_GRACE_MS,
  settleMs = RECOVERY_SETTLE_MS,
  reviveRetryMs = REVIVE_RETRY_MS,
  reviveRetryMaxMs = REVIVE_RETRY_MAX_MS,
  killReloadFallbackMs = KILL_RELOAD_FALLBACK_MS,
}) {
  let mode = sanitizeFailoverMode(initialMode);
  let projector = null;
  let restarter = null;
  const restarterFor = (wc) => createRestarter(wc, { setTimer, clearTimer, fallbackMs: killReloadFallbackMs });
  let displayId = null;
  let fullscreen = false;
  let parked = false;
  // The operator's Force Failover: held until they release it, whatever the projector does.
  let manual = false;
  // The automatic fault being handled ('crash' | 'freeze' | 'unresponsive' | 'gpu'), or null when the projector is healthy.
  let fault = null;
  let faultSince = null;
  let lastFault = null;
  // A reload was started and the new page has not finished loading. Answers before that come from the preload, ahead of the page.
  let awaitingLoad = false;
  let reviveAttempts = 0;
  let recoveries = 0;
  let reviveTimer = null;
  let graceTimer = null;
  let settleTimer = null;

  const heartbeat = createHeartbeat({
    send: (seq) => {
      if (alive(projector)) projector.webContents.send(PING_CHANNEL, seq);
    },
    onFreeze: () => engage('freeze'),
    onArm: () => emit(),
    intervalMs: heartbeatMs,
    missLimit,
    setRepeat,
    clearRepeat,
  });

  const stopTimer = (t) => {
    if (t !== null) clearTimer(t);
    return null;
  };
  const clearFaultTimers = () => {
    reviveTimer = stopTimer(reviveTimer);
    graceTimer = stopTimer(graceTimer);
    settleTimer = stopTimer(settleTimer);
  };
  /** What the surface should draw now. A forced failover is always pure black. */
  const shownMode = () => (manual ? 'blackout' : mode);
  const engaged = () => manual || fault !== null;

  function status() {
    return {
      projectorOpen: alive(projector),
      armed: alive(projector) && heartbeat.state().armed,
      engaged: alive(projector) && engaged(),
      manual,
      fault,
      faultSince,
      lastFault,
      parked,
      displayId,
      mode,
      reviveAttempts,
      recoveries,
    };
  }

  function emit() {
    try {
      onStatus(status());
    } catch (err) {
      log.error?.('[watchdog] status listener failed:', err);
    }
  }

  /** Covers the projector. Runs first, before anything is logged or restarted, so the congregation sees the failover surface soonest. */
  function engage(reason, details = null) {
    if (!alive(projector)) return false;
    const started = now();
    if (!parked) failover.show(shownMode());
    const coverMs = now() - started;
    const first = fault === null;
    if (first) {
      fault = reason;
      faultSince = wallClock();
    }
    settleTimer = stopTimer(settleTimer);
    heartbeat.rearm();
    lastFault = { reason, at: wallClock(), coverMs: Math.round(coverMs * 100) / 100, details: details?.reason ?? null };
    log.warn?.(`[watchdog] ${reason}${details?.reason ? ` (${details.reason})` : ''}: failover ${parked ? 'held (display parked)' : 'shown'} in ${lastFault.coverMs} ms`);
    // A restart already under way is left to finish. Its own retry timer tries again if it fails.
    if (!awaitingLoad && reviveTimer === null && graceTimer === null) {
      if (reason === 'freeze' || reason === 'unresponsive') {
        // A frozen page may come back by itself (a long image decode). It gets a moment, behind the failover surface, before it is killed.
        graceTimer = setTimer(() => {
          graceTimer = null;
          if (fault) revive(true);
        }, freezeGraceMs);
      } else {
        revive(false);
      }
    }
    emit();
    return true;
  }

  /** Reloads the projector page. `hard` kills a hung page first; a crashed page is reloaded into a new process as it is. */
  function revive(hard) {
    if (!alive(projector) || !fault) return;
    reviveTimer = stopTimer(reviveTimer);
    reviveAttempts += 1;
    awaitingLoad = true;
    heartbeat.rearm();
    try {
      restarter.restart(hard);
      log.warn?.(`[watchdog] restarting the projector page (attempt ${reviveAttempts}${hard ? ', killed first' : ''})`);
    } catch (err) {
      log.error?.('[watchdog] could not restart the projector page:', err);
    }
    const wait = Math.min(reviveRetryMs * 2 ** (reviveAttempts - 1), reviveRetryMaxMs);
    reviveTimer = setTimer(() => {
      reviveTimer = null;
      // Still faulted: the reload did not bring back a page that answers. Kill whatever is there and try again.
      if (fault) revive(true);
    }, wait);
    emit();
  }

  function recovered() {
    settleTimer = null;
    if (!fault) return;
    log.info?.(`[watchdog] projector recovered from ${fault} after ${reviveAttempts} restart(s)`);
    fault = null;
    faultSince = null;
    reviveAttempts = 0;
    clearFaultTimers();
    recoveries += 1;
    if (!manual && !parked) failover.hide(mode);
    emit();
  }

  function onPong(seq) {
    if (!heartbeat.pong(seq)) return;
    if (fault && !awaitingLoad && settleTimer === null) settleTimer = setTimer(recovered, settleMs);
  }

  function detachProjector() {
    heartbeat.stop();
    clearFaultTimers();
    restarter?.cancel();
    restarter = null;
    failover.close();
    projector = null;
    fault = null;
    faultSince = null;
    manual = false;
    parked = false;
    awaitingLoad = false;
    reviveAttempts = 0;
    emit();
  }

  function park() {
    parked = true;
    // Hidden first: the system has already moved the window onto the remaining screen, so every millisecond it shows is on the operator's laptop.
    // Leaving fullscreen re-shows a hidden window on Windows (Electron 33, verified on the booth laptop), so the window is made transparent
    // around it and hidden again after.
    projector.setOpacity?.(0);
    projector.hide();
    if (projector.isFullScreen()) {
      projector.setFullScreen(false);
      projector.hide();
    }
    projector.setOpacity?.(1);
    failover.hide(shownMode());
    log.warn?.(`[watchdog] projector display ${displayId} disconnected; projector hidden until an external display returns`);
    emit();
  }

  /** Whether the projector is where it belongs on `display`: covering it when fullscreen, its centre on it when windowed. */
  function onDisplay(display) {
    const w = projector.getBounds();
    const d = display.bounds;
    if (fullscreen) return w.x === d.x && w.y === d.y && w.width === d.width && w.height === d.height;
    const cx = w.x + w.width / 2;
    const cy = w.y + w.height / 2;
    return cx >= d.x && cx < d.x + d.width && cy >= d.y && cy < d.y + d.height;
  }

  function moveTo(display) {
    const wasParked = parked;
    parked = false;
    displayId = display.id;
    const b = display.bounds;
    const bounds = fullscreen ? { ...b } : { x: b.x + 80, y: b.y + 80, width: 1280, height: 720 };
    if (projector.isFullScreen()) projector.setFullScreen(false);
    projector.setBounds(bounds);
    if (fullscreen) projector.setFullScreen(true);
    if (!projector.isVisible()) projector.showInactive();
    failover.setBounds(projector.getBounds());
    if (engaged()) failover.show(shownMode());
    log.warn?.(`[watchdog] projector ${wasParked ? 'restored' : 'moved'} to display ${display.id}`);
    emit();
  }

  return {
    status,

    /**
     * Watches a new projector window. `displayId` and `fullscreen` are where and how it was opened. `parked`: it was opened hidden, because
     * its locked monitor is not connected; it is shown when that monitor returns.
     */
    attachProjector(win, { displayId: id = null, fullscreen: full = false, parked: startParked = false } = {}) {
      if (alive(projector) && projector !== win) detachProjector();
      projector = win;
      displayId = id;
      fullscreen = full;
      parked = startParked;
      manual = false;
      fault = null;
      awaitingLoad = false;
      failover.open(win.getBounds(), mode);
      const wc = win.webContents;
      restarter = restarterFor(wc);
      const own = restarter;
      wc.on('render-process-gone', (_event, details) => {
        if (projector !== win || win.isDestroyed() || CLEAN_EXITS.has(details?.reason)) return;
        // Covered first. A kill of our own is only the restart going ahead; any other crash starts one.
        engage('crash', details);
        own.gone();
      });
      win.on('unresponsive', () => {
        if (projector === win) engage('unresponsive');
      });
      wc.on('did-finish-load', () => {
        if (projector === win) awaitingLoad = false;
      });
      // The surface follows the projector: a resize, a move, and going in or out of fullscreen.
      const follow = () => {
        if (projector === win && !win.isDestroyed() && !parked) failover.setBounds(win.getBounds());
      };
      for (const event of ['move', 'resize', 'enter-full-screen', 'leave-full-screen']) win.on(event, follow);
      win.on('closed', () => {
        if (projector === win) detachProjector();
      });
      heartbeat.start();
      emit();
    },

    /**
     * Watches the lower-third window. It is a transparent overlay, so a black canvas would be wrong there: a crashed or hung one is hidden at
     * once, reloaded, and shown again when its page has loaded.
     */
    attachLowerThird(win) {
      const wc = win.webContents;
      const restarter = restarterFor(wc);
      let down = false;
      const restart = (hard, why) => {
        if (win.isDestroyed()) return;
        win.hide();
        down = true;
        log.warn?.(`[watchdog] lower-third window ${why}; hidden and restarting`);
        try {
          restarter.restart(hard);
        } catch (err) {
          log.error?.('[watchdog] could not restart the lower-third page:', err);
        }
      };
      wc.on('render-process-gone', (_event, details) => {
        if (CLEAN_EXITS.has(details?.reason) || win.isDestroyed()) return;
        // Our own kill of a hung page: reload it now. Anything else is a crash of its own.
        if (!restarter.gone()) restart(false, `renderer gone (${details?.reason})`);
      });
      win.on('closed', () => restarter.cancel());
      win.on('unresponsive', () => restart(true, 'unresponsive'));
      wc.on('did-finish-load', () => {
        if (!down || win.isDestroyed()) return;
        down = false;
        win.showInactive();
      });
    },

    /** An `app` `child-process-gone` event. A GPU crash can leave the projector black or frozen, so it is treated as a projector fault. */
    childProcessGone(details) {
      if (isGpuCrash(details)) engage('gpu', details);
    },

    /** An answer on PONG_CHANNEL. Only the projector's own page counts. */
    pong(sender, seq) {
      if (!alive(projector) || sender !== projector.webContents) return;
      onPong(seq);
    },

    /** The operator's Force Failover (Blackout). Off again only when they release it. Returns the new status. */
    force(on) {
      if (!alive(projector)) return status();
      manual = on === true;
      if (manual) {
        if (!parked) failover.show('blackout');
        log.warn?.('[watchdog] failover forced by the operator');
      } else if (fault) {
        // A fault still being handled keeps the surface up, now in the chosen mode.
        if (!parked) failover.show(mode);
      } else {
        failover.hide(mode);
      }
      emit();
      return status();
    },

    setMode(next) {
      mode = sanitizeFailoverMode(next);
      if (alive(projector) && fault && !manual && !parked) failover.show(mode);
      else if (!engaged()) failover.prime(mode);
      emit();
      return status();
    },

    /** Call on every `screen` display-added, display-removed and display-metrics-changed event. */
    displaysChanged() {
      if (!alive(projector)) return;
      const lock = lockedTarget();
      if (lock?.locked) {
        // Pinned to a physical monitor: Windows' display numbers no longer count, only where that monitor is.
        if (lock.pending) return;
        if (!lock.display) {
          if (!parked) park();
          return;
        }
        if (parked || !onDisplay(lock.display)) {
          moveTo(lock.display);
          onReanchor(lock.display.id);
        } else {
          // Already on it. Windows may have renamed it, so remember its new id, but leave a window that is in the right place alone.
          displayId = lock.display.id;
        }
        return;
      }
      const displays = screen.getAllDisplays();
      const plan = planProjectorDisplay({
        displays,
        primaryId: screen.getPrimaryDisplay().id,
        currentId: displayId,
        preferredId: preferredDisplayId(),
        parked,
      });
      if (plan.action === 'park') park();
      else if (plan.action === 'move') moveTo(displays.find((d) => d.id === plan.displayId));
    },

    /** For tests and the verification script: start a fault by hand. */
    engage,
  };
}

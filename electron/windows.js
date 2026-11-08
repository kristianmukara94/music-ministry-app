// The failover surface: a window of its own, kept loaded and hidden exactly over the projector window. When the projector page crashes or
// freezes, showing this window is all it takes to cover it, with no page to load and no process to start. It is a separate window with its
// own renderer process, so whatever brought the projector page down does not take this one with it.
//
// Its page (src/output/FailoverOverlay.tsx, route `#/failover`) draws the parish emblem on near-black, or pure black. The page says which one
// it has drawn, so the window is shown only once the right one is on it.

export const FAILOVER_ROUTE = 'failover';
/** Main to page: the mode to draw. */
export const FAILOVER_MODE_CHANNEL = 'watchdog:failover-mode';
/** Page to main: the mode it has drawn. */
export const FAILOVER_PAINTED_CHANNEL = 'watchdog:failover-painted';
/** The longest a switch between modes may hold up showing the surface. A first show never waits. */
export const PAINT_WAIT_MS = 120;

/**
 * `BrowserWindow` is Electron's class (a fake in the tests). `load(win, route)` loads an app route into a window, as main.js does.
 * The window is created by `open()` and destroyed by `close()`, with the projector window.
 */
export function createFailoverSurface({
  BrowserWindow,
  webPreferences,
  load,
  icon,
  log = console,
  paintWaitMs = PAINT_WAIT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let win = null;
  // The mode the page last said it drew, and the one it should draw.
  let painted = null;
  let wanted = 'emblem';
  let visible = false;
  let waiter = null;

  const alive = () => Boolean(win && !win.isDestroyed());
  const send = (mode) => {
    if (alive()) win.webContents.send(FAILOVER_MODE_CHANNEL, mode);
  };
  const cancelWait = () => {
    if (waiter !== null) clearTimer(waiter);
    waiter = null;
  };

  function reveal() {
    cancelWait();
    if (!alive() || !visible) return;
    // Shown without taking focus from the operator's console, and raised above the projector, which sits on the same top-most level.
    win.showInactive();
    win.moveTop();
  }

  return {
    window: () => (alive() ? win : null),
    isVisible: () => alive() && visible,
    wantedMode: () => wanted,

    open(bounds, mode = wanted) {
      wanted = mode;
      if (alive()) {
        win.setBounds(bounds);
        send(mode);
        return win;
      }
      painted = null;
      visible = false;
      win = new BrowserWindow({
        ...bounds,
        show: false,
        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        // Never takes focus: the operator keeps typing in the console while it is up.
        focusable: false,
        hasShadow: false,
        // Black from the first frame, before the page has drawn anything, so even a show in the first instant shows no light.
        backgroundColor: '#000000',
        title: 'APCCMMA — Failover',
        icon,
        // Kept drawing while hidden, so a show puts the current mode up at once instead of a stale frame.
        webPreferences: { ...webPreferences, backgroundThrottling: false },
      });
      // One level above the projector's 'screen-saver' level, so it covers the projector and the taskbar.
      win.setAlwaysOnTop(true, 'screen-saver', 1);
      const own = win;
      own.webContents.on('did-finish-load', () => send(wanted));
      // The surface's own page crashing must not leave a hole: it reloads, and the window's black background shows meanwhile.
      own.webContents.on('render-process-gone', (_event, details) => {
        if (own.isDestroyed() || details?.reason === 'clean-exit') return;
        log.error?.(`[failover] surface page stopped (${details?.reason}); reloading`);
        painted = null;
        own.webContents.reload();
      });
      own.on('closed', () => {
        if (win !== own) return;
        cancelWait();
        win = null;
        painted = null;
        visible = false;
      });
      load(own, FAILOVER_ROUTE);
      return own;
    },

    close() {
      cancelWait();
      visible = false;
      if (alive()) win.destroy();
      win = null;
      painted = null;
    },

    setBounds(bounds) {
      if (alive()) win.setBounds(bounds);
    },

    /**
     * Covers the projector in `mode`. Shown at once when the page has that mode up, or has drawn nothing yet (the black background shows).
     * When it has the other mode up, it is first told to switch, and shown when it says so, or after `paintWaitMs`.
     */
    show(mode) {
      if (!alive()) return false;
      visible = true;
      if (mode !== wanted) {
        wanted = mode;
        send(mode);
      }
      if (painted === null || painted === mode) reveal();
      else if (waiter === null) waiter = setTimer(reveal, paintWaitMs);
      return true;
    },

    /** Takes the surface down and readies `nextMode` for the next time. */
    hide(nextMode = wanted) {
      cancelWait();
      visible = false;
      if (alive()) win.hide();
      if (nextMode !== wanted) {
        wanted = nextMode;
        send(nextMode);
      }
    },

    /** Readies `mode` while the surface is hidden. */
    prime(mode) {
      if (visible) return;
      wanted = mode;
      send(mode);
    },

    /** The page says it has drawn `mode`. A show waiting on that mode goes ahead. */
    painted(mode) {
      painted = mode;
      if (waiter !== null && mode === wanted) reveal();
    },
  };
}

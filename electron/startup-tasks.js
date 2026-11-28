// What keeps a launch from competing with itself: the operator window is shown once it has something to show, and the work nobody is
// waiting for (servers, cloud sync, snapshots) starts after that, a little apart.

/** The longest the operator window stays hidden. A page that never paints must not leave the booth with no window at all. */
export const SHOW_FALLBACK_MS = 4000;

/**
 * Shows a window created with `show: false` as soon as it can be painted, or after `fallbackMs` at the latest. `onShown` runs once, when
 * the window is shown either way.
 */
export function showWhenPainted(win, { fallbackMs = SHOW_FALLBACK_MS, onShown = () => {}, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let done = false;
  let timer = null;
  const reveal = () => {
    if (done) return;
    done = true;
    clearTimer(timer);
    if (win.isDestroyed()) return;
    win.show();
    onShown();
  };
  timer = setTimer(reveal, fallbackMs);
  win.once('ready-to-show', reveal);
  win.once('closed', () => {
    done = true;
    clearTimer(timer);
  });
}

/** Runs `fn` the first time only. Later calls get the first call's result, so two triggers never start a thing twice. */
export function once(fn) {
  let called = false;
  let result;
  return (...args) => {
    if (!called) {
      called = true;
      result = fn(...args);
    }
    return result;
  };
}

/**
 * Background tasks that wait for the first paint. Each is added with a delay counted from `start()`. A task that throws or rejects is
 * logged and the others run on. `done` resolves true when every task has finished, or false after `cancel()` (the app is quitting),
 * which drops the tasks still waiting.
 */
export function createStartupQueue({ setTimer = setTimeout, clearTimer = clearTimeout, log = console } = {}) {
  const tasks = [];
  const timers = new Set();
  let started = false;
  let cancelled = false;
  let remaining = 0;
  let finish;
  const done = new Promise((resolve) => {
    finish = resolve;
  });

  const settle = () => {
    remaining -= 1;
    if (remaining === 0) finish(true);
  };

  const run = async ({ name, task }) => {
    try {
      await task();
    } catch (err) {
      log.error(`[startup] ${name} failed: ${err?.message ?? err}`);
    } finally {
      settle();
    }
  };

  return {
    done,
    add(name, delayMs, task) {
      if (started) throw new Error(`The startup queue has already started: ${name} was added too late.`);
      tasks.push({ name, delayMs, task });
    },
    start() {
      if (started || cancelled) return;
      started = true;
      remaining = tasks.length;
      if (remaining === 0) finish(true);
      for (const entry of tasks) {
        const timer = setTimer(() => {
          timers.delete(timer);
          void run(entry);
        }, entry.delayMs);
        timers.add(timer);
      }
    },
    cancel() {
      cancelled = true;
      for (const timer of timers) clearTimer(timer);
      timers.clear();
      finish(false);
    },
  };
}

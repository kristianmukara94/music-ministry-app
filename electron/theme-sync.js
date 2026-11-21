// Sends the laptop's colour theme to the church's cloud, so the website paints the same theme. A theme change asks for a send 300 ms
// later, so clicking through the theme cards sends only the last one. What is sent is the theme the window is painted with (Automatic
// becomes today's season) and when it was chosen (themeUpdatedAt); the server keeps the newest choice from any of the church's laptops.
//
// The choice is written to config.json (theme_sync) before anything is sent, marked dirty until the cloud has it. A send that fails for a
// reason that passes (offline, the server busy or not updated yet) retries with backoff; a laptop that is not linked keeps the change
// dirty and sends it when the cloud sync resumes (resume(), called after a song sync succeeds, after linking, and at start-up).
//
// Pure apart from the injected state, push, clock and timers, so the tests run in Node with fakes.
import { isPaintedTheme } from '../shared/theme-catalog.js';

export const THEME_PUSH_DEBOUNCE_MS = 300;
export const THEME_RETRY_MS = [15 * 1000, 30 * 1000, 60 * 1000, 2 * 60 * 1000, 5 * 60 * 1000];

/**
 * `readState()` returns { theme, updatedAt, dirty } or null; `writeState(state)` saves it. `push({ theme, themeUpdatedAt })` sends it and
 * resolves on success (the server stored it, or already has a newer one). It rejects with an Error marked `retry` for a failure that will
 * pass, `revoked` when the laptop is not linked, and otherwise the change is not one the server will ever take, so it stops being dirty.
 */
export function createThemeSync({
  readState,
  writeState,
  push,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  debounceMs = THEME_PUSH_DEBOUNCE_MS,
  retryMs = THEME_RETRY_MS,
}) {
  let debounceTimer = null;
  let retryTimer = null;
  let attempts = 0;
  let running = null;
  let last = { status: 'idle', message: null };
  // The latest change in memory as well as on disk, so a config.json that could not be written still has its change sent.
  let pending = null;

  const state = () => {
    try {
      const saved = readState();
      return saved && isPaintedTheme(saved.theme) ? saved : null;
    } catch {
      return null;
    }
  };

  const cancelRetry = () => {
    if (retryTimer) clearTimer(retryTimer);
    retryTimer = null;
  };

  const scheduleRetry = () => {
    cancelRetry();
    const delay = retryMs[Math.min(attempts - 1, retryMs.length - 1)];
    retryTimer = setTimer(() => {
      retryTimer = null;
      void flush();
    }, delay);
  };

  const debounce = () => {
    if (debounceTimer) clearTimer(debounceTimer);
    debounceTimer = setTimer(() => {
      debounceTimer = null;
      void flush();
    }, debounceMs);
  };

  /**
   * The window is now painted with `painted`. A new theme is saved as dirty with the time it was chosen, and a send is asked for after the
   * debounce. The same theme again (Automatic saving itself on a day the season did not change) changes nothing.
   */
  function themeChanged(painted) {
    if (!isPaintedTheme(painted)) return;
    const current = state();
    if (current?.theme === painted) {
      if (current.dirty) debounce();
      return;
    }
    const change = { theme: painted, updatedAt: new Date(now()).toISOString() };
    pending = change;
    try {
      writeState({ ...change, dirty: true });
    } catch {
      // Not saved: `pending` still carries it while the app runs.
    }
    attempts = 0;
    cancelRetry();
    debounce();
  }

  /** Sends the dirty theme now. A second call while one is running joins it. Never throws. */
  function flush() {
    if (running) return running;
    running = (async () => {
      const saved = state();
      const change = pending ?? (saved?.dirty ? { theme: saved.theme, updatedAt: saved.updatedAt } : null);
      if (!change) {
        last = { status: 'synced', message: null };
        return last;
      }
      last = { status: 'syncing', message: null };
      try {
        await push({ theme: change.theme, themeUpdatedAt: change.updatedAt });
        attempts = 0;
        markSent(change);
        last = { status: 'synced', message: null };
      } catch (err) {
        if (err?.revoked) {
          // Kept dirty, with no timer: the next resume() after linking sends it.
          last = { status: 'waiting', message: err.message ?? null };
        } else if (err?.retry) {
          attempts += 1;
          last = { status: 'offline', message: err.message ?? null };
          scheduleRetry();
        } else {
          // The server refused this theme for good (an id it does not know). Sending it again would only be refused again.
          markSent(change);
          last = { status: 'error', message: err?.message ?? null };
        }
      }
      return last;
    })().finally(() => {
      running = null;
    });
    return running;
  }

  /** Clears the dirty mark, unless a newer change arrived while this one was being sent. */
  function markSent(change) {
    if (pending && pending.theme === change.theme && pending.updatedAt === change.updatedAt) pending = null;
    const saved = state();
    if (!saved || saved.theme !== change.theme || saved.updatedAt !== change.updatedAt) {
      // A newer change is waiting: send it too.
      if (saved?.dirty || pending) debounce();
      return;
    }
    try {
      writeState({ ...saved, dirty: false });
    } catch {
      // Stays dirty on disk; the next start sends it again, which the server answers as already stored.
    }
  }

  /**
   * Push Theme Now: sends `painted` straight away, stamped now, even when nothing is waiting, so the website takes this laptop's theme
   * over one chosen elsewhere. Resolves to the outcome, like flush().
   */
  function pushNow(painted) {
    if (!isPaintedTheme(painted)) return Promise.resolve({ status: 'error', message: 'This theme cannot be shown on the website.' });
    if (debounceTimer) clearTimer(debounceTimer);
    debounceTimer = null;
    const change = { theme: painted, updatedAt: new Date(now()).toISOString() };
    pending = change;
    try {
      writeState({ ...change, dirty: true });
    } catch {
      // Not saved: `pending` still carries it while the app runs.
    }
    attempts = 0;
    cancelRetry();
    return running ? running.then(() => flush()) : flush();
  }

  /** The cloud is reachable again (a song sync succeeded, the laptop was linked, the app started): sends a dirty theme now. */
  function resume() {
    if (debounceTimer) return;
    if (!state()?.dirty && !pending) return;
    cancelRetry();
    void flush();
  }

  function stop() {
    if (debounceTimer) clearTimer(debounceTimer);
    debounceTimer = null;
    cancelRetry();
  }

  /** For the Cloud sync screen and the tests: the saved theme, whether it is still unsent, and how the last send went. */
  const status = () => {
    const saved = state();
    return { theme: saved?.theme ?? null, themeUpdatedAt: saved?.updatedAt ?? null, themeDirty: Boolean(saved?.dirty || pending), ...last };
  };

  return { themeChanged, flush, resume, stop, status, pushNow };
}

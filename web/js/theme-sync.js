// The live theme watcher on signed-in pages. It asks the server for the theme the church laptop last sent (GET /api/theme) when the page
// loads, when the tab comes back into view or gains focus, and every 5 seconds while the tab is visible. A newer theme goes to
// window.apccmmaTheme.receive() (js/theme-init.js), which repaints the page in place: no reload, so nothing typed on the page is lost.
//
// Polling stops while the tab is hidden, waits longer after a failed request, and stops for good once the session has ended.

export const THEME_POLL_MS = 5000;
export const THEME_POLL_MAX_MS = 60000;

/** Starts the watcher. Everything it touches is passed in, so the tests run it without a browser. Returns { check, stop }. */
export function startThemeSync({
  fetchFn = (...args) => window.fetch(...args),
  doc = document,
  win = window,
  theme = () => window.apccmmaTheme,
  pollMs = THEME_POLL_MS,
  maxPollMs = THEME_POLL_MAX_MS,
} = {}) {
  let timer = null;
  let running = null;
  let stopped = false;
  let delay = pollMs;

  const visible = () => doc.visibilityState !== 'hidden';

  const clear = () => {
    if (timer !== null) win.clearTimeout(timer);
    timer = null;
  };

  const schedule = () => {
    clear();
    if (stopped || !visible()) return;
    timer = win.setTimeout(() => {
      timer = null;
      void check();
    }, delay);
  };

  /** Asks the server once (a second call while one is out joins it), then waits for the next poll. Never throws. */
  function check() {
    if (stopped) return Promise.resolve();
    if (running) return running;
    running = (async () => {
      try {
        const res = await fetchFn('/api/theme', { credentials: 'same-origin', cache: 'no-store' });
        if (res.status === 401) {
          // Signed out: auth.js takes the page to the sign-in screen. Nothing more to watch.
          stop();
          return;
        }
        if (!res.ok) throw new Error(`theme ${res.status}`);
        const body = await res.json();
        if (body && typeof body.theme === 'string') theme()?.receive(body.theme, body.themeUpdatedAt);
        delay = pollMs;
      } catch {
        // Offline or the server busy: try again later, waiting longer each time.
        delay = Math.min(delay * 2, maxPollMs);
      } finally {
        running = null;
        schedule();
      }
    })();
    return running;
  }

  const onVisibility = () => {
    if (visible()) {
      delay = pollMs;
      void check();
    } else {
      clear();
    }
  };
  const onFocus = () => {
    if (!running) void check();
  };

  function stop() {
    stopped = true;
    clear();
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('focus', onFocus);
  }

  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('focus', onFocus);
  void check();
  return { check, stop };
}

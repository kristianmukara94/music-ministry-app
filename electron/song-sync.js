// Sends the church's song list to the cloud: title, category, language, key and the laptop's own song id. Never the lyrics, the
// composer, the style, media or Bible text. The list is the full list each time, so a song the laptop no longer has is marked
// removed on the server. A hymn saved here asks for a send a moment later (notify), and the timer keeps retrying a send that failed,
// with backoff, so a save made while offline is sent when the connection returns.
//
// Pure apart from the injected database read, push, clock and timer, so the tests run in Node with fakes.

/** The laptop's language codes, as the server stores them. */
export const LANGUAGE_NAMES = { EN: 'English', TL: 'Tagalog', CEB: 'Cebuano' };
export const SYNC_INTERVAL_MS = 60 * 1000;
// A save asks for a send this long after the last save, so several quick saves make one send.
export const NOTIFY_DELAY_MS = 2 * 1000;
const BACKOFF_MS = [30 * 1000, 60 * 1000, 2 * 60 * 1000, 5 * 60 * 1000, 10 * 60 * 1000];

/**
 * The query that reads the songs. It names only the columns that may be sent. Lyrics live in another table and are never read.
 * A song with no uuid is left out until the laptop gives it one; the database trigger does that on insert.
 */
export const SONG_ROWS_SQL = `
  SELECT uuid, title, song_category, language, musical_key
  FROM hymns WHERE uuid IS NOT NULL AND deleted_at IS NULL ORDER BY id`;

/**
 * Turns the laptop's song rows into the list the server takes. Only the fields the server accepts are copied, so nothing else can
 * be sent. A row with an unknown language, or no title, is left out and counted, so the sync says how many were not sent.
 */
export function buildSongList(rows) {
  const songs = [];
  let skipped = 0;
  for (const row of rows) {
    const language = LANGUAGE_NAMES[row.language];
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    if (!language || title === '' || typeof row.uuid !== 'string') {
      skipped += 1;
      continue;
    }
    songs.push({
      id: row.uuid,
      title,
      category: typeof row.song_category === 'string' ? row.song_category.trim() : '',
      language,
      key: typeof row.musical_key === 'string' ? row.musical_key.trim() : '',
    });
  }
  return { songs, skipped };
}

/**
 * The sync. `readRows()` returns the song rows, and `push(songs)` sends the list and resolves to the server's counts. `push` rejects
 * with an Error whose `offline` flag is set when the connection is down, and whose `revoked` flag is set when the laptop was unlinked
 * on the website. Only one timer is ever pending for the regular run: the interval, or a retry after a failure. A save's send waits
 * on its own short timer, so a save never delays the regular retry.
 */
export function createSongSync({ readRows, push, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, intervalMs = SYNC_INTERVAL_MS, notifyDelayMs = NOTIFY_DELAY_MS }) {
  let state = { status: 'idle', lastSyncedAt: null, message: null };
  let attempts = 0;
  let timer = null;
  let running = null;
  let keepRunning = false;
  // True from a hymn save until the list that holds it has been sent. A failed send leaves it true, so the timer keeps trying.
  let unsent = false;
  let notifyTimer = null;

  const set = (next) => {
    state = { ...state, ...next };
  };

  const clear = () => {
    if (timer) clearTimer(timer);
    timer = null;
  };

  /** Puts the next run on the timer, unless one is already waiting. */
  const later = (delayMs) => {
    if (timer) return;
    timer = setTimer(() => {
      timer = null;
      void runOnce();
    }, delayMs);
  };

  /** Sends the list now. A second call while one is running joins the first. Never throws: the outcome is in `status()`. */
  function runOnce() {
    if (running) return running;
    running = (async () => {
      set({ status: 'syncing', message: null });
      // The list read below holds every save made so far, so nothing saved before this point is still unsent after a successful send.
      unsent = false;
      let sent = false;
      try {
        const { songs, skipped } = buildSongList(readRows());
        const counts = await push(songs);
        attempts = 0;
        sent = true;
        set({ status: 'synced', lastSyncedAt: new Date(now()).toISOString(), message: null, counts, skipped });
      } catch (err) {
        unsent = true;
        if (err?.revoked) {
          set({ status: 'error', message: err.message });
        } else if (err?.offline) {
          attempts += 1;
          set({ status: 'offline', message: err.message });
          if (timer) clearTimer(timer);
          timer = null;
          later(BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]);
        } else {
          set({ status: 'error', message: err?.message || 'Songs could not be synced. Try again.' });
        }
      } finally {
        running = null;
        // A hymn saved while this send was running is not in it, so it is asked for again.
        if (sent && unsent) notify();
        if (keepRunning) later(intervalMs);
      }
      return state;
    })();
    return running;
  }

  /**
   * A hymn was created or edited. Marks the list unsent and asks for a send after a short wait. Several calls in that wait make one
   * send, because each call restarts the wait. Returns at once, so the hymn editor is never held up.
   */
  function notify() {
    unsent = true;
    if (notifyTimer) clearTimer(notifyTimer);
    notifyTimer = setTimer(() => {
      notifyTimer = null;
      void runOnce();
    }, notifyDelayMs);
  }

  /** Starts the sync: a run now, then one every interval. */
  function start() {
    clear();
    keepRunning = true;
    void runOnce();
  }

  /** Stops the timers. A run already in flight finishes, and then nothing more is scheduled. */
  function stop() {
    keepRunning = false;
    clear();
    if (notifyTimer) clearTimer(notifyTimer);
    notifyTimer = null;
  }

  /** What the Cloud sync screen may show: status, the last time it synced, a plain message, and whether a save is still unsent. */
  const status = () => ({ status: state.status, lastSyncedAt: state.lastSyncedAt, message: state.message, unsent });

  return { runOnce, start, stop, status, notify };
}

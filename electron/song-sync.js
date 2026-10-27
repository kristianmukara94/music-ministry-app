// Sends the church's song list to the cloud: title, category, language, key and the laptop's own song id. Never the lyrics, the
// composer, the style, media or Bible text. The list is the full list each time, so a song the laptop no longer has is marked
// removed on the server. Runs on a timer in the main process, and retries with backoff when the connection is down.
//
// Pure apart from the injected database read, push, clock and timer, so the tests run in Node with fakes.

/** The laptop's language codes, as the server stores them. */
export const LANGUAGE_NAMES = { EN: 'English', TL: 'Tagalog', CEB: 'Cebuano' };
export const SYNC_INTERVAL_MS = 60 * 1000;
const BACKOFF_MS = [30 * 1000, 60 * 1000, 2 * 60 * 1000, 5 * 60 * 1000, 10 * 60 * 1000];

/**
 * The query that reads the songs. It names only the columns that may be sent. Lyrics live in another table and are never read.
 * A song with no uuid is left out until the laptop gives it one; the database trigger does that on insert.
 */
export const SONG_ROWS_SQL = `
  SELECT uuid, title, song_category, language, musical_key
  FROM hymns WHERE uuid IS NOT NULL ORDER BY id`;

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
 * on the website. Only one timer is ever pending: the regular interval, or a retry after a failure.
 */
export function createSongSync({ readRows, push, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, intervalMs = SYNC_INTERVAL_MS }) {
  let state = { status: 'idle', lastSyncedAt: null, message: null };
  let attempts = 0;
  let timer = null;
  let running = null;
  let keepRunning = false;

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
      try {
        const { songs, skipped } = buildSongList(readRows());
        const counts = await push(songs);
        attempts = 0;
        set({ status: 'synced', lastSyncedAt: new Date(now()).toISOString(), message: null, counts, skipped });
      } catch (err) {
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
        if (keepRunning) later(intervalMs);
      }
      return state;
    })();
    return running;
  }

  /** Starts the sync: a run now, then one every interval. */
  function start() {
    clear();
    keepRunning = true;
    void runOnce();
  }

  /** Stops the timer. A run already in flight finishes, and then nothing more is scheduled. */
  function stop() {
    keepRunning = false;
    clear();
  }

  /** What the Cloud sync screen may show: status, the last time it synced, and a plain message. Never a token or an address. */
  const status = () => ({ status: state.status, lastSyncedAt: state.lastSyncedAt, message: state.message });

  return { runOnce, start, stop, status };
}

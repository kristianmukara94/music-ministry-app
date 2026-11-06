import fs from 'node:fs';
import path from 'node:path';

// The live session's crash-recovery row, in its own small database in userData. It is kept apart from the main database on purpose:
// the main database can sit on a network share, where WAL is unsafe (it needs shared memory on one machine), and its rollback journal
// stays as it is. This file is always local, so it runs in WAL mode, where a commit is one append to the log and never waits on readers.
// It is also per laptop: two laptops sharing one main database each keep their own live session.

export const LIVE_SESSION_FILE = 'live-session.db';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS live_session_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    active_plan_id TEXT,
    active_slot_id TEXT,
    active_slide_index INTEGER DEFAULT 0,
    lower_third_enabled INTEGER DEFAULT 0,
    lower_third_text TEXT,
    blackout_enabled INTEGER DEFAULT 0,
    clear_text_enabled INTEGER DEFAULT 0,
    queue_cursor_index INTEGER DEFAULT 0,
    presentation_mode TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    active_pw_session_id TEXT,
    snapshot TEXT NOT NULL
  );`;

const COLUMNS = [
  'active_plan_id',
  'active_slot_id',
  'active_slide_index',
  'lower_third_enabled',
  'lower_third_text',
  'blackout_enabled',
  'clear_text_enabled',
  'queue_cursor_index',
  'presentation_mode',
  'active_pw_session_id',
  'snapshot',
];

const UPSERT = `
  INSERT INTO live_session_state (id, ${COLUMNS.join(', ')}, updated_at)
  VALUES (1, ${COLUMNS.map((c) => `@${c}`).join(', ')}, CURRENT_TIMESTAMP)
  ON CONFLICT (id) DO UPDATE SET ${COLUMNS.map((c) => `${c} = excluded.${c}`).join(', ')}, updated_at = CURRENT_TIMESTAMP`;

/**
 * Sets up the recovery table on an open database handle (better-sqlite3 in the app, node:sqlite in tests) and returns its store.
 * WAL with synchronous = NORMAL: a commit survives the app crashing at once. A power cut can lose the last few commits since the
 * last checkpoint, but never leaves the file damaged.
 */
export function createSessionStore(db) {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA busy_timeout = 2000;');
  db.exec(SCHEMA);

  const upsert = db.prepare(UPSERT);
  const select = db.prepare('SELECT * FROM live_session_state WHERE id = 1');
  const remove = db.prepare('DELETE FROM live_session_state WHERE id = 1');

  return {
    /** Writes the row. One statement, so it is atomic: a crash leaves the old row or the new one, never a mix. */
    save(row) {
      const params = {};
      for (const c of COLUMNS) params[c] = row[c] ?? null;
      upsert.run(params);
    },
    /** The saved row with its snapshot parsed, or null when there is none or it cannot be read. */
    load() {
      const row = select.get();
      if (!row) return null;
      try {
        return { ...row, snapshot: JSON.parse(row.snapshot) };
      } catch {
        return null;
      }
    },
    clear() {
      remove.run();
    },
    journalMode() {
      return Object.values(db.prepare('PRAGMA journal_mode').get())[0];
    },
    close() {
      db.close();
    },
  };
}

/**
 * Opens the recovery database in `dir` with `open` (a function from a path to a database handle). A file that cannot be opened (damaged
 * by a crash during a disk failure) is moved aside and a new one is made, so recovery never stops the app from starting. Returns null
 * if even a new file cannot be made: the app then runs without crash recovery.
 */
export function openSessionStore(dir, open, log = console) {
  const file = path.join(dir, LIVE_SESSION_FILE);
  let db = null;
  try {
    db = open(file);
    return createSessionStore(db);
  } catch (err) {
    // Windows will not rename a file that is still open.
    try {
      db?.close();
    } catch {
      // Already closed or never opened.
    }
    log.error(`[session] could not open ${file}: ${err?.message ?? err}. Starting a new one.`);
  }
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(file + suffix)) fs.renameSync(file + suffix, `${file}${suffix}.broken`);
    }
    return createSessionStore(open(file));
  } catch (err) {
    log.error(`[session] crash recovery is off: ${err?.message ?? err}`);
    return null;
  }
}

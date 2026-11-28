// How the main database connection is tuned.
//
// What is deliberately not here: WAL and synchronous = NORMAL. The database can be on a network share, where WAL corrupts files, so it keeps
// a rollback journal; and with a rollback journal, anything below synchronous = FULL can corrupt the file on a power cut. The crash-recovery
// database, which is always on this laptop, uses WAL with NORMAL (session-store.js).

/** In order. Each holds for the connection only; nothing is written to the file. */
export const MAIN_DB_PRAGMAS = Object.freeze([
  // Every commit reaches the disk before it returns.
  'synchronous = FULL',
  // Sorts and temporary indexes stay in memory instead of going through temp files, which a virus scanner would open.
  'temp_store = MEMORY',
  // Up to 16 MB of pages kept in memory (a negative size is in KiB).
  'cache_size = -16000',
]);

/** `db` is better-sqlite3 in the app, node:sqlite in the tests. Both have `exec`. */
export function applyMainDbPragmas(db) {
  for (const pragma of MAIN_DB_PRAGMAS) db.exec(`PRAGMA ${pragma}`);
}

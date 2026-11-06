// Automatic local protection for the app database: a start-up integrity check that recovers a damaged file from the newest good snapshot,
// an immutable copy before every migration run, one rotating snapshot per day, and incremental vacuum to give back free pages.
//
// Every snapshot lives in userData/backups on this machine, even when the database itself is on a network share. Database handles are passed
// in (better-sqlite3 in the app, node:sqlite in the tests), and only `prepare().get()/all()/run()`, `exec()` and `close()` are used.
import fs from 'node:fs';
import path from 'node:path';
import { checkBackupFile } from './database-backup.js';

export const BACKUP_DIR_NAME = 'backups';
export const BACKUP_EXT = '.sqlite.bak';
/** Daily snapshots older than this many days are removed at start-up. Pre-migration copies are never removed. */
export const RETENTION_DAYS = 7;
/** The newest daily snapshots kept regardless of age, so a laptop used once a fortnight still has more than today's copy. */
export const MIN_DAILY_KEPT = 3;
/** Free pages one maintenance pass gives back. Small enough that a pass takes milliseconds on the main thread. */
export const VACUUM_PAGES_PER_PASS = 512;

const DAILY = /^apccmma-backup-(\d{4})-(\d{2})-(\d{2})\.sqlite\.bak$/;
const PRE_MIGRATION = /^apccmma-pre-migration-v\d+-[\d-]+(?:-\d+)?\.sqlite\.bak$/;
const PARTIAL = /\.sqlite\.bak\.partial$/;

const pad = (n) => String(n).padStart(2, '0');
/** YYYY-MM-DD in local time. */
export const dateStamp = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
/** YYYY-MM-DD-HHmmss in local time. */
export const timeStamp = (now = new Date()) => `${dateStamp(now)}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

export const backupsDirFor = (userData) => path.join(userData, BACKUP_DIR_NAME);
export const dailyBackupName = (now = new Date()) => `apccmma-backup-${dateStamp(now)}${BACKUP_EXT}`;
export const preMigrationBackupName = (version, now = new Date()) => `apccmma-pre-migration-v${version}-${timeStamp(now)}${BACKUP_EXT}`;
export const isPreMigrationBackup = (name) => PRE_MIGRATION.test(name);

/**
 * True for an error that means the file itself is damaged (SQLITE_CORRUPT, SQLITE_NOTADB), not that it could not be reached.
 * A locked file or an unplugged network drive must never be treated as corrupt, or a healthy database would be set aside.
 */
export function isCorruptionError(err) {
  if (!err) return false;
  if (typeof err.code === 'string' && /^SQLITE_(CORRUPT|NOTADB)/.test(err.code)) return true; // better-sqlite3
  if (err.errcode === 11 || err.errcode === 26) return true; // node:sqlite (primary result codes)
  if ((err.errcode & 0xff) === 11 || (err.errcode & 0xff) === 26) return true; // node:sqlite extended codes
  return /database disk image is malformed|file is not a database/i.test(String(err.message));
}

/** Runs PRAGMA integrity_check on an open handle. Returns [] when the database is sound, or the problems SQLite reported. */
export function integrityProblems(db) {
  const rows = db.prepare('PRAGMA integrity_check').all();
  const messages = rows.map((row) => String(Object.values(row)[0]));
  return messages.length === 1 && messages[0] === 'ok' ? [] : messages;
}

/**
 * Checks the database file at `file`. `open(file)` must return a read-write handle on an existing file: read-write, so SQLite can roll back
 * a journal left by a crash before it checks (a read-only handle would report that as an error, and an interrupted save is not damage).
 * Returns { state: 'missing' | 'ok' | 'corrupt' | 'unchecked', problems, error }. 'unchecked' means the file could not be opened for a
 * reason other than damage, so nothing should be done to it.
 */
export function checkDatabaseFile(file, { open }) {
  if (!fs.existsSync(file)) return { state: 'missing', problems: [] };
  let db = null;
  try {
    db = open(file);
    const problems = integrityProblems(db);
    return problems.length ? { state: 'corrupt', problems } : { state: 'ok', problems: [] };
  } catch (err) {
    if (isCorruptionError(err)) return { state: 'corrupt', problems: [err.message] };
    return { state: 'unchecked', problems: [], error: err.message };
  } finally {
    try {
      db?.close();
    } catch {
      // Closing a handle on a damaged file can fail too. The check result stands.
    }
  }
}

/** Every finished snapshot in `dir` (daily and pre-migration), newest first by modification time. */
export function listBackups(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => DAILY.test(name) || PRE_MIGRATION.test(name))
    .map((name) => {
      const file = path.join(dir, name);
      return { name, file, mtimeMs: fs.statSync(file).mtimeMs, preMigration: PRE_MIGRATION.test(name) };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
}

/** The newest snapshot that passes the same checks a manual restore uses (integrity, app tables, schema not newer than this app). */
export function findLatestValidBackup(dir, { schemaVersion, openReadonly }) {
  for (const candidate of listBackups(dir)) {
    try {
      checkBackupFile(candidate.file, { schemaVersion, open: openReadonly });
      return candidate;
    } catch {
      // A damaged or foreign snapshot is skipped; the next older one is tried.
    }
  }
  return null;
}

/** Moves a file aside if it exists. Returns the new path, or null when there was nothing to move. */
function moveAside(file, target) {
  if (!fs.existsSync(file)) return null;
  fs.renameSync(file, target);
  return target;
}

/**
 * The start-up guard. Run it before the database is opened for use. When the integrity check fails and a good snapshot exists:
 *  1. the damaged file (and any rollback journal beside it, which belongs to the damaged file) is renamed to `<file>.corrupt-<timestamp>`;
 *  2. the newest good snapshot is copied in its place, through a temporary file so a half-written copy is never left as the database.
 * When no good snapshot exists the damaged file is left where it is, so the app can still read what it can, and the caller warns the
 * operator. Returns { status, problems, restoredFrom, quarantined, error }, where status is one of 'missing', 'ok', 'unchecked',
 * 'restored', 'corrupt-no-backup' or 'restore-failed'.
 */
export function recoverDatabase({ dbPath, backupsDir, open, openReadonly, schemaVersion, now = new Date(), log = console }) {
  const check = checkDatabaseFile(dbPath, { open });
  if (check.state !== 'corrupt') return { status: check.state, problems: [], error: check.error ?? null };

  log.error(`[db-integrity] CRITICAL: ${dbPath} failed its integrity check: ${check.problems.slice(0, 5).join('; ')}`);
  const backup = findLatestValidBackup(backupsDir, { schemaVersion, openReadonly });
  if (!backup) {
    log.error('[db-integrity] No valid snapshot was found in', backupsDir, '- the damaged database was left in place.');
    return { status: 'corrupt-no-backup', problems: check.problems, restoredFrom: null, quarantined: null, error: null };
  }

  const quarantined = `${dbPath}.corrupt-${timeStamp(now)}`;
  try {
    moveAside(dbPath, quarantined);
    moveAside(`${dbPath}-journal`, `${quarantined}-journal`);
  } catch (err) {
    // Usually another program (or another laptop on the share) holds the file open. Nothing has been replaced.
    log.error(`[db-integrity] The damaged database could not be set aside (${err.message}). It was not replaced.`);
    return { status: 'restore-failed', problems: check.problems, restoredFrom: null, quarantined: null, error: err.message };
  }

  const staging = `${dbPath}.restoring`;
  try {
    fs.copyFileSync(backup.file, staging);
    // Pre-migration snapshots are read-only, and Windows copies that attribute. The restored database must be writable.
    fs.chmodSync(staging, 0o666);
    fs.renameSync(staging, dbPath);
  } catch (err) {
    fs.rmSync(staging, { force: true });
    log.error(`[db-integrity] Restoring ${backup.file} failed (${err.message}). The damaged file is kept at ${quarantined}.`);
    return { status: 'restore-failed', problems: check.problems, restoredFrom: null, quarantined, error: err.message };
  }
  log.error(`[db-integrity] Restored ${dbPath} from ${backup.file}. The damaged file is kept at ${quarantined}.`);
  return { status: 'restored', problems: check.problems, restoredFrom: backup.file, quarantined, error: null };
}

/** Writes a consistent copy of an open database with VACUUM INTO. Synchronous; fails if `target` already exists. */
function vacuumInto(db, target) {
  db.prepare('VACUUM INTO ?').run(target);
}

/**
 * Called by openDatabase when migrations are about to run on a database that already holds data. Copies it, as it is now, to
 * backups/apccmma-pre-migration-v<version>-<timestamp>.sqlite.bak and marks the copy read-only. Throws if the copy cannot be made,
 * so the caller does not migrate without one.
 */
export function preMigrationBackup(db, { backupsDir, version, now = new Date() }) {
  fs.mkdirSync(backupsDir, { recursive: true });
  let target = path.join(backupsDir, preMigrationBackupName(version, now));
  // Two runs in one second (a restore trial, a relaunch) get distinct names rather than failing.
  for (let n = 2; fs.existsSync(target); n += 1) {
    target = path.join(backupsDir, preMigrationBackupName(version, now).replace(BACKUP_EXT, `-${n}${BACKUP_EXT}`));
  }
  try {
    vacuumInto(db, target);
    fs.chmodSync(target, 0o444);
  } catch (err) {
    fs.rmSync(target, { force: true });
    throw new Error(`The database could not be backed up before its upgrade (${err.message}), so the upgrade was not run.`);
  }
  return target;
}

/**
 * Removes daily snapshots dated more than `keepDays` days before `now`, always keeping the newest `minKeep`. Pre-migration copies are
 * never touched. Left-over `.partial` files from an interrupted snapshot are removed. Returns the names removed.
 */
export function pruneBackups(dir, { now = new Date(), keepDays = RETENTION_DAYS, minKeep = MIN_DAILY_KEPT } = {}) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - keepDays);
  const daily = names
    .map((name) => ({ name, m: DAILY.exec(name) }))
    .filter((entry) => entry.m)
    .map(({ name, m }) => ({ name, day: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) }))
    .sort((a, b) => b.day - a.day);
  const removed = [];
  daily.slice(minKeep).forEach(({ name, day }) => {
    if (day >= cutoff) return;
    fs.rmSync(path.join(dir, name), { force: true });
    removed.push(name);
  });
  names.filter((name) => PARTIAL.test(name)).forEach((name) => {
    fs.rmSync(path.join(dir, name), { force: true });
    removed.push(name);
  });
  return removed;
}

/**
 * Makes today's snapshot if there is none yet, then prunes old ones. `backup(target)` writes a consistent copy of the open database
 * (better-sqlite3's online backup, which does not block the app). The copy is written as `.partial`, checked, and only then given its
 * final name, so a failed or damaged copy never counts as today's snapshot. Returns { status: 'created' | 'exists', file, pruned }.
 */
export async function takeDailyBackup({ backup, backupsDir, schemaVersion, openReadonly, now = new Date() }) {
  fs.mkdirSync(backupsDir, { recursive: true });
  const file = path.join(backupsDir, dailyBackupName(now));
  if (fs.existsSync(file)) return { status: 'exists', file, pruned: pruneBackups(backupsDir, { now }) };
  const partial = `${file}.partial`;
  fs.rmSync(partial, { force: true });
  try {
    await backup(partial);
    checkBackupFile(partial, { schemaVersion, open: openReadonly });
    fs.renameSync(partial, file);
  } catch (err) {
    fs.rmSync(partial, { force: true });
    throw err;
  }
  return { status: 'created', file, pruned: pruneBackups(backupsDir, { now }) };
}

/** PRAGMA auto_vacuum: 0 none, 1 full, 2 incremental. */
const autoVacuumMode = (db) => Number(Object.values(db.prepare('PRAGMA auto_vacuum').get())[0]);

/**
 * Switches the database to incremental auto-vacuum. On a new database the pragma alone is enough. An existing one needs a single full
 * VACUUM to take the new mode, which needs a moment of exclusive access: if another connection holds the file (a second laptop on the
 * share) it is skipped and tried on the next start. Returns 'already', 'converted' or 'deferred'.
 */
export function ensureIncrementalAutoVacuum(db, { log = console } = {}) {
  if (autoVacuumMode(db) === 2) return 'already';
  try {
    db.exec('PRAGMA auto_vacuum = INCREMENTAL');
    db.exec('VACUUM');
  } catch (err) {
    log.warn?.(`[db-maintenance] Incremental auto-vacuum will be set up on a later start (${err.message}).`);
    return 'deferred';
  }
  return autoVacuumMode(db) === 2 ? 'converted' : 'deferred';
}

/**
 * One maintenance pass: gives back up to `pages` free pages to the file system. Does nothing until the database is in incremental mode,
 * or when there are no free pages. Returns the number of pages that were free before the pass (0 when nothing was done).
 */
export function incrementalVacuum(db, pages = VACUUM_PAGES_PER_PASS) {
  if (autoVacuumMode(db) !== 2) return 0;
  const free = Number(Object.values(db.prepare('PRAGMA freelist_count').get())[0]);
  if (free === 0) return 0;
  db.exec(`PRAGMA incremental_vacuum(${Math.max(1, Math.floor(pages))})`);
  return free;
}

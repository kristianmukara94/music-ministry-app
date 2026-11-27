// Export and restore of the app's database file. The live database is never copied while it is open: an export uses SQLite's online backup,
// and a restore closes the database before the file is replaced. The database handles, dialogs and relaunch are passed in, so the checks
// can be tested without Electron. Only the file system is used here directly.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compactTimestamp } from '../shared/backup-format.js';

export const DB_FILTERS = [{ name: 'SQLite Database', extensions: ['db', 'sqlite'] }];

/** The table every app database has. A SQLite file without it is some other database. */
const APP_TABLE = 'hymns';

/** apccmma-backup-YYYY-MM-DD.db, from the local date. */
export function backupFileName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `apccmma-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.db`;
}

/**
 * Checks a backup file without changing it: SQLite must read it, its integrity check must pass, it must be an app database, and its
 * schema must be one this app knows. Throws with a sentence the operator can read. `open(file)` returns a read-only handle with
 * prepare().get() and close().
 */
export function checkBackupFile(file, { schemaVersion, open }) {
  let integrity;
  let version;
  let appTable;
  let db = null;
  try {
    db = open(file);
    integrity = Object.values(db.prepare('PRAGMA integrity_check').get())[0];
    version = db.prepare('PRAGMA user_version').get().user_version;
    appTable = db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").get(APP_TABLE);
  } catch {
    throw new Error('This file is not a database the app can read.');
  } finally {
    db?.close();
  }
  if (integrity !== 'ok') throw new Error('The file failed its integrity check, so it may be damaged.');
  if (version > schemaVersion) {
    throw new Error(`This backup is from a newer version of the app (database version ${version}). This app reads version ${schemaVersion}.`);
  }
  if (!appTable) throw new Error('This file is a SQLite database, but not an APCCMMA database.');
  return { version };
}

/**
 * Writes the live database to `target` with SQLite's online backup, which copies a consistent snapshot while the app is open, then checks
 * the copy. A copy that fails the check is removed, so no bad backup is left behind.
 */
export async function exportBackup({ target, backup, schemaVersion, open }) {
  await backup(target);
  try {
    checkBackupFile(target, { schemaVersion, open });
  } catch (err) {
    fs.rmSync(target, { force: true });
    throw err;
  }
  return target;
}

/** Safety copies made before a restore, kept in `backups/` next to the database. Only the newest PRE_RESTORE_KEEP are kept. */
export const PRE_RESTORE_KEEP = 5;
export const PRE_RESTORE_DIR_NAME = 'backups';
const PRE_RESTORE = /^apccmma-pre-restore-(\d{8}-\d{6})(?:-(\d+))?\.db$/;

/** apccmma-pre-restore-YYYYMMDD-HHMMSS.db in local time; `n` > 0 adds -n for a second restore in the same second. */
export const preRestoreSnapshotName = (now = new Date(), n = 0) => `apccmma-pre-restore-${compactTimestamp(now)}${n > 0 ? `-${n}` : ''}.db`;

/** The `backups/` folder next to the database file. */
export const restoreBackupsDirFor = (activePath) => path.join(path.dirname(activePath), PRE_RESTORE_DIR_NAME);

/** The pre-restore safety copies in `dir`, newest first (by the time in the name, then the same-second counter). */
export function listPreRestoreSnapshots(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((name) => ({ name, match: PRE_RESTORE.exec(name) }))
    .filter(({ match }) => match)
    .map(({ name, match }) => ({ name, file: path.join(dir, name), stamp: match[1], n: Number(match[2] ?? 0) }))
    .sort((a, b) => b.stamp.localeCompare(a.stamp) || b.n - a.n)
    .map(({ name, file }) => ({ name, file }));
}

/** Removes all but the newest `keep` pre-restore copies. Returns the names removed. Other files in the folder are never touched. */
export function prunePreRestoreSnapshots(dir, keep = PRE_RESTORE_KEEP) {
  const removed = [];
  for (const old of listPreRestoreSnapshots(dir).slice(Math.max(0, keep))) {
    try {
      fs.rmSync(old.file, { force: true });
      removed.push(old.name);
    } catch {
      // A copy that cannot be removed now is removed after a later restore.
    }
  }
  return removed;
}

/**
 * Copies the (closed) database at `activePath` to `backupsDir/apccmma-pre-restore-<time>.db`, then keeps only the newest `keep` copies.
 * The copy is written as `.partial` and renamed once its size matches, so a full disk never leaves a broken file under a snapshot name.
 * Returns the copy's path, or throws.
 */
export function createPreRestoreSnapshot({ activePath, backupsDir, now = new Date(), keep = PRE_RESTORE_KEEP }) {
  fs.mkdirSync(backupsDir, { recursive: true });
  let file = null;
  for (let n = 0; n < 100 && !file; n += 1) {
    const candidate = path.join(backupsDir, preRestoreSnapshotName(now, n));
    if (!fs.existsSync(candidate)) file = candidate;
  }
  if (!file) throw new Error('too many restores in the same second');
  const partial = `${file}.partial`;
  try {
    fs.copyFileSync(activePath, partial);
    if (fs.statSync(partial).size !== fs.statSync(activePath).size) throw new Error('the copy is incomplete');
    fs.renameSync(partial, file);
  } catch (err) {
    fs.rmSync(partial, { force: true });
    throw err;
  }
  prunePreRestoreSnapshots(backupsDir, keep);
  return file;
}

/**
 * The checks a restore makes while the live database is still open: not the live file itself, a sound APCCMMA database no newer than this
 * app, and its migrations run cleanly on a throwaway copy. Returns { ok: true } or { ok: false, closed: false, error }.
 */
export function checkRestoreSource({ source, activePath, schemaVersion, open, openForMigration }) {
  if (path.resolve(source) === path.resolve(activePath)) {
    return { ok: false, closed: false, error: 'Choose a backup file. The live database cannot be restored onto itself.' };
  }
  try {
    checkBackupFile(source, { schemaVersion, open });
  } catch (err) {
    return { ok: false, closed: false, error: err.message };
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apccmma-restore-'));
  try {
    const trial = path.join(workDir, 'trial.db');
    fs.copyFileSync(source, trial);
    openForMigration(trial).close();
  } catch (err) {
    return { ok: false, closed: false, error: `This backup could not be upgraded to this version of the app (${err.message}).` };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
  return { ok: true };
}

/**
 * Swaps a checked backup in for the live database:
 *  1. The live database is closed.
 *  2. A timestamped safety copy of it goes to `backupsDir` (apccmma-pre-restore-YYYYMMDD-HHMMSS.db; the newest five are kept). If that copy
 *     cannot be made, nothing is replaced.
 *  3. The backup is copied beside the live file and renamed over it, so the live file is never half-written.
 * Returns { ok: true, safetyCopy } or { ok: false, closed: true, error }: once closed, the caller must restart the app to reopen it.
 */
export function replaceLiveDatabase({ source, activePath, backupsDir = restoreBackupsDirFor(activePath), closeDatabase, now = new Date(), keep = PRE_RESTORE_KEEP }) {
  closeDatabase();
  let safetyCopy;
  try {
    safetyCopy = createPreRestoreSnapshot({ activePath, backupsDir, now, keep });
  } catch (err) {
    return { ok: false, closed: true, error: `A safety copy of the current database could not be saved in ${backupsDir} (${err.message}). Nothing was replaced.` };
  }
  const incoming = `${activePath}.restoring`;
  try {
    fs.copyFileSync(source, incoming);
    try {
      fs.renameSync(incoming, activePath);
    } catch {
      // Windows can refuse a rename over a file a virus scanner still holds; copying over it works then. A copy that fails part-way is
      // undone from the safety copy below.
      fs.copyFileSync(incoming, activePath);
      fs.rmSync(incoming, { force: true });
    }
  } catch (err) {
    fs.rmSync(incoming, { force: true });
    try {
      if (fs.statSync(activePath).size !== fs.statSync(safetyCopy).size) fs.copyFileSync(safetyCopy, activePath);
    } catch {
      // The safety copy stays at its own path, so nothing is lost even when this fails.
    }
    return {
      ok: false,
      closed: true,
      error: `The database could not be replaced (${err.message}). The previous database is still in place, and a safety copy is at ${safetyCopy}.`,
    };
  }
  return { ok: true, safetyCopy };
}

/**
 * Replaces the live database with a .db backup: checkRestoreSource while the live database is open (a refused file changes nothing), then
 * replaceLiveDatabase. The next start runs the backup's migrations, as it does for any file.
 */
export function importBackup({ source, activePath, schemaVersion, open, openForMigration, closeDatabase, backupsDir, now }) {
  const checked = checkRestoreSource({ source, activePath, schemaVersion, open, openForMigration });
  if (!checked.ok) return checked;
  return replaceLiveDatabase({ source, activePath, backupsDir, closeDatabase, now });
}

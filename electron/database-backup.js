// Export and restore of the app's database file. The live database is never copied while it is open: an export uses SQLite's online backup,
// and a restore closes the database before the file is replaced. The database handles, dialogs and relaunch are passed in, so the checks
// can be tested without Electron. Only the file system is used here directly.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

/**
 * Replaces the live database with a backup. The order keeps the app safe at every step:
 *  1. The backup is checked, and its migrations run on a copy while the live database is still open. A refused file changes nothing.
 *  2. The live database is closed, and its file is kept as `<name>.pre-import-bak`.
 *  3. The backup is copied over the live file. The next start runs its migrations, as it does for any file.
 * Returns `{ ok: true, fallback }`, or `{ ok: false, closed, error }`. `closed` says the live database was already closed, so the caller
 * must restart the app to reopen it.
 */
export function importBackup({ source, activePath, schemaVersion, open, openForMigration, closeDatabase }) {
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

  const fallback = `${activePath}.pre-import-bak`;
  closeDatabase();
  try {
    fs.copyFileSync(activePath, fallback);
  } catch (err) {
    return { ok: false, closed: true, error: `The current database could not be kept as a copy (${err.message}). Nothing was replaced.` };
  }
  try {
    fs.copyFileSync(source, activePath);
  } catch (err) {
    try {
      fs.copyFileSync(fallback, activePath);
    } catch {
      // The kept copy stays on disk at its own path, so nothing is lost even when this fails.
    }
    return { ok: false, closed: true, error: `The database could not be replaced (${err.message}). The previous database has been kept.` };
  }
  return { ok: true, fallback };
}

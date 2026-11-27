// Database backup and restore: an export is a checked copy, and a restore refuses a bad file before anything is closed, keeps the current
// database as a copy, and replaces it only after the close. The live database is a real SQLite file here (node:sqlite), and the window and
// relaunch are not involved. Run with: node --test electron/database-backup.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  PRE_RESTORE_KEEP,
  backupFileName,
  checkBackupFile,
  createPreRestoreSnapshot,
  exportBackup,
  importBackup,
  listPreRestoreSnapshots,
  preRestoreSnapshotName,
  prunePreRestoreSnapshots,
  restoreBackupsDirFor,
} from './database-backup.js';

const SCHEMA = 5;
const open = (file) => new DatabaseSync(file, { readOnly: true });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apccmma-backup-'));

/** An app database at `file`, at schema `version`, with the songs table the app checks for. Closed before it returns. */
function appDb(file, version, { songs = true } = {}) {
  const db = new DatabaseSync(file);
  if (songs) db.exec('CREATE TABLE hymns (id INTEGER PRIMARY KEY); INSERT INTO hymns (id) VALUES (1), (2);');
  db.exec(`PRAGMA user_version = ${version};`);
  db.close();
  return file;
}

const bytes = (file) => fs.readFileSync(file);

test('the export file is named with the day it was made', () => {
  assert.equal(backupFileName(new Date(2026, 9, 28)), 'apccmma-backup-2026-10-28.db');
});

test('a file from this app or an older one is accepted, and a newer one is refused', () => {
  assert.deepEqual(checkBackupFile(appDb(path.join(dir, 'ok.db'), 3), { schemaVersion: SCHEMA, open }), { version: 3 });
  assert.throws(() => checkBackupFile(appDb(path.join(dir, 'newer.db'), 9), { schemaVersion: SCHEMA, open }), /newer version of the app/);
});

test('a SQLite file that is not an APCCMMA database, and a file that is not a database, are refused', () => {
  assert.throws(() => checkBackupFile(appDb(path.join(dir, 'other.db'), 1, { songs: false }), { schemaVersion: SCHEMA, open }), /not an APCCMMA database/);
  const text = path.join(dir, 'notes.db');
  fs.writeFileSync(text, 'this is a text file, not a database');
  assert.throws(() => checkBackupFile(text, { schemaVersion: SCHEMA, open }), /not a database the app can read/);
  assert.throws(() => checkBackupFile(path.join(dir, 'missing.db'), { schemaVersion: SCHEMA, open }), /not a database the app can read/);
});

test('an export writes the copy and returns its path', async () => {
  const live = appDb(path.join(dir, 'live.db'), 3);
  const target = path.join(dir, 'export.db');
  const result = await exportBackup({ target, backup: async (to) => fs.copyFileSync(live, to), schemaVersion: SCHEMA, open });
  assert.equal(result, target);
  assert.deepEqual(bytes(target), bytes(live));
});

test('an export that does not check out is removed, so no bad backup is left behind', async () => {
  const target = path.join(dir, 'bad-export.db');
  await assert.rejects(
    exportBackup({ target, backup: async (to) => fs.writeFileSync(to, 'not a database'), schemaVersion: SCHEMA, open }),
    /not a database the app can read/,
  );
  assert.equal(fs.existsSync(target), false);
});

test('a bad file is refused before anything is closed, and the live database is unchanged', () => {
  const live = appDb(path.join(dir, 'live-refuse.db'), 3);
  const before = bytes(live);
  let closed = false;
  const result = importBackup({
    source: appDb(path.join(dir, 'newer-import.db'), 9),
    activePath: live,
    schemaVersion: SCHEMA,
    open,
    openForMigration: () => assert.fail('no migration is tried for a refused file'),
    closeDatabase: () => {
      closed = true;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.closed, false);
  assert.match(result.error, /newer version of the app/);
  assert.equal(closed, false, 'the live database stays open');
  assert.deepEqual(bytes(live), before);
});

test('a backup that cannot be upgraded is refused while the live database is still open', () => {
  const live = appDb(path.join(dir, 'live-migrate.db'), 3);
  let closed = false;
  const result = importBackup({
    source: appDb(path.join(dir, 'upgrade-fails.db'), 2),
    activePath: live,
    schemaVersion: SCHEMA,
    open,
    openForMigration: () => {
      throw new Error('migration 4 failed');
    },
    closeDatabase: () => {
      closed = true;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.closed, false);
  assert.match(result.error, /could not be upgraded/);
  assert.equal(closed, false);
});

test('a backup onto the live file itself is refused', () => {
  const live = appDb(path.join(dir, 'live-self.db'), 3);
  const result = importBackup({ source: live, activePath: live, schemaVersion: SCHEMA, open, openForMigration: () => assert.fail(), closeDatabase: () => assert.fail() });
  assert.equal(result.ok, false);
  assert.match(result.error, /cannot be restored onto itself/);
});

test('a valid backup closes the live database first, keeps a timestamped safety copy in backups/, and replaces it', () => {
  const home = fs.mkdtempSync(path.join(dir, 'restore-ok-'));
  const live = appDb(path.join(home, 'live-ok.db'), 3);
  const oldBytes = bytes(live);
  const source = appDb(path.join(dir, 'restore-me.db'), 4);
  const sourceBytes = bytes(source);
  const events = [];
  const result = importBackup({
    source,
    activePath: live,
    schemaVersion: SCHEMA,
    open,
    openForMigration: (file) => {
      events.push('migrate-copy');
      return new DatabaseSync(file);
    },
    closeDatabase: () => events.push('close'),
    now: new Date(2026, 10, 27, 9, 5, 7),
  });
  assert.deepEqual(events, ['migrate-copy', 'close'], 'the copy is migrated before the live database is closed');
  const safetyCopy = path.join(home, 'backups', 'apccmma-pre-restore-20261127-090507.db');
  assert.deepEqual(result, { ok: true, safetyCopy });
  assert.deepEqual(bytes(live), sourceBytes, 'the live file is the backup now');
  assert.deepEqual(bytes(safetyCopy), oldBytes, 'the old database is kept in backups/ next to it');
  assert.equal(fs.existsSync(`${live}.restoring`), false, 'no temporary file is left beside the live database');
});

test('pre-restore safety copies are named by local time, live next to the database, and only the newest five are kept', () => {
  assert.equal(preRestoreSnapshotName(new Date(2026, 0, 2, 3, 4, 5)), 'apccmma-pre-restore-20260102-030405.db');
  assert.equal(preRestoreSnapshotName(new Date(2026, 0, 2, 3, 4, 5), 2), 'apccmma-pre-restore-20260102-030405-2.db');
  assert.equal(restoreBackupsDirFor(path.join('data', 'apccmma.db')), path.join('data', 'backups'));
  assert.equal(PRE_RESTORE_KEEP, 5);

  const home = fs.mkdtempSync(path.join(dir, 'rotate-'));
  const live = appDb(path.join(home, 'apccmma.db'), 3);
  const backups = path.join(home, 'backups');
  fs.mkdirSync(backups);
  // Files the automatic backups and the operator keep in the same folder are never touched by the rotation.
  const others = ['apccmma-backup-2026-11-01.sqlite.bak', 'apccmma-pre-migration-v4-2026-11-01-080000.sqlite.bak', 'notes.txt'];
  for (const name of others) fs.writeFileSync(path.join(backups, name), name);

  const made = [];
  for (let day = 1; day <= 7; day += 1) made.push(createPreRestoreSnapshot({ activePath: live, backupsDir: backups, now: new Date(2026, 10, day, 8, 0, 0) }));
  // Two restores in the same second get distinct names, and the later one counts as newer.
  const sameSecond = createPreRestoreSnapshot({ activePath: live, backupsDir: backups, now: new Date(2026, 10, 7, 8, 0, 0) });
  assert.equal(path.basename(sameSecond), 'apccmma-pre-restore-20261107-080000-1.db');

  assert.deepEqual(
    listPreRestoreSnapshots(backups).map((s) => s.name),
    [
      'apccmma-pre-restore-20261107-080000-1.db',
      'apccmma-pre-restore-20261107-080000.db',
      'apccmma-pre-restore-20261106-080000.db',
      'apccmma-pre-restore-20261105-080000.db',
      'apccmma-pre-restore-20261104-080000.db',
    ],
  );
  for (const name of others) assert.equal(fs.existsSync(path.join(backups, name)), true, `${name} is kept`);
  assert.deepEqual(bytes(made[6]), bytes(live), 'each safety copy is the whole database');
  assert.equal(fs.readdirSync(backups).some((name) => name.endsWith('.partial')), false);

  assert.deepEqual(prunePreRestoreSnapshots(backups, 2), [
    'apccmma-pre-restore-20261106-080000.db',
    'apccmma-pre-restore-20261105-080000.db',
    'apccmma-pre-restore-20261104-080000.db',
  ]);
  assert.equal(listPreRestoreSnapshots(path.join(home, 'missing')).length, 0);
});

test('when the safety copy cannot be saved, nothing is replaced and the result says the database was closed', () => {
  const home = fs.mkdtempSync(path.join(dir, 'restore-blocked-'));
  const live = appDb(path.join(home, 'live-keep.db'), 3);
  const before = bytes(live);
  // A file where the backups folder should be: the folder cannot be made, so no safety copy can be written.
  fs.writeFileSync(path.join(home, 'backups'), 'in the way');
  const result = importBackup({
    source: appDb(path.join(dir, 'restore-blocked.db'), 4),
    activePath: live,
    schemaVersion: SCHEMA,
    open,
    openForMigration: (file) => new DatabaseSync(file),
    closeDatabase: () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.closed, true, 'the database was closed, so the app must restart');
  assert.match(result.error, /safety copy of the current database could not be saved/);
  assert.match(result.error, /Nothing was replaced/);
  assert.deepEqual(bytes(live), before, 'the live database is untouched');
});

test('the app source checks the same rules: the handlers, the preload and the card are wired', () => {
  const read = (rel) => fs.readFileSync(path.resolve(import.meta.dirname, '..', rel), 'utf8');
  const main = read('electron/main.js');
  assert.match(main, /ipcMain\.handle\('db:import-backup'/);
  assert.match(main, /ipcMain\.handle\('db:export-full-backup'/);
  assert.match(main, /ipcMain\.handle\('db:restore-full-backup'/);
  assert.match(main, /replaceLiveDatabase\(\{[\s\S]*?backupsDir: restoreBackupsDirFor\(activePath\)/, 'a full restore keeps a pre-restore safety copy');
  assert.match(main, /backupsDir: restoreBackupsDirFor\(dbStatus\.path\)/, 'a .db restore keeps a pre-restore safety copy');
  assert.match(main, /dialog\.showSaveDialog/);
  assert.match(main, /dialog\.showOpenDialog/);
  assert.match(main, /async function relaunchApp\(\)/, 'the restart goes through relaunchApp');
  const preload = read('electron/preload.cjs');
  assert.match(preload, /exportFullBackup: \(\) => ipcRenderer\.invoke\('db:export-full-backup'\)/);
  assert.match(preload, /restoreFullBackup: \(\) => ipcRenderer\.invoke\('db:restore-full-backup'\)/);
  assert.match(preload, /importBackup: \(\) => ipcRenderer\.invoke\('db:import-backup'\)/);
  const card = read('src/settings/DatabaseSettings.tsx');
  assert.match(card, /Export Full Backup \(DB \+ Media\)/);
  assert.match(card, /Restore Full Backup/);
  assert.match(read('src/settings/Settings.tsx'), /Quick DB Snapshot \(\.db\)/);
  assert.match(read('src/settings/DatabaseSettings.tsx'), /Restoring a database will overwrite all existing lineups, songs, and preferences\. The application will restart automatically to load the new data\. Do you want to continue\?/);
});

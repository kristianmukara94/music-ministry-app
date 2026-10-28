// Database backup and restore: an export is a checked copy, and a restore refuses a bad file before anything is closed, keeps the current
// database as a copy, and replaces it only after the close. The live database is a real SQLite file here (node:sqlite), and the window and
// relaunch are not involved. Run with: node --test electron/database-backup.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupFileName, checkBackupFile, exportBackup, importBackup } from './database-backup.js';

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

test('a valid backup closes the live database first, keeps the old file, and replaces it', () => {
  const live = appDb(path.join(dir, 'live-ok.db'), 3);
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
  });
  assert.deepEqual(events, ['migrate-copy', 'close'], 'the copy is migrated before the live database is closed');
  assert.deepEqual(result, { ok: true, fallback: `${live}.pre-import-bak` });
  assert.deepEqual(bytes(live), sourceBytes, 'the live file is the backup now');
  assert.deepEqual(bytes(`${live}.pre-import-bak`), oldBytes, 'the old database is kept beside it');
});

test('when the old database cannot be kept, nothing is replaced and the result says the database was closed', () => {
  const live = appDb(path.join(dir, 'live-keep.db'), 3);
  const blocked = `${live}.pre-import-bak`;
  fs.mkdirSync(blocked);
  try {
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
    assert.match(result.error, /could not be kept/);
  } finally {
    fs.rmdirSync(blocked);
  }
});

test('the app source checks the same rules: the handlers, the preload and the card are wired', () => {
  const read = (rel) => fs.readFileSync(path.resolve(import.meta.dirname, '..', rel), 'utf8');
  const main = read('electron/main.js');
  assert.match(main, /ipcMain\.handle\('db:export-backup'/);
  assert.match(main, /ipcMain\.handle\('db:import-backup'/);
  assert.match(main, /dialog\.showSaveDialog/);
  assert.match(main, /dialog\.showOpenDialog/);
  assert.match(main, /async function relaunchApp\(\)/, 'the restart goes through relaunchApp');
  assert.match(read('electron/preload.cjs'), /exportBackup: \(\) => ipcRenderer\.invoke\('db:export-backup'\)/);
  assert.match(read('src/settings/DatabaseSettings.tsx'), /Restoring a database will overwrite all existing lineups, songs, and preferences\. The application will restart automatically to load the new data\. Do you want to continue\?/);
});

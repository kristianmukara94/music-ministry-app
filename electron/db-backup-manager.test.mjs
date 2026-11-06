// Automatic database protection: the start-up integrity check and recovery, pre-migration copies, rotating daily snapshots and incremental
// vacuum. Every database here is a real SQLite file (node:sqlite), and damaged files are made by overwriting real pages.
// Run with: node --test electron/db-backup-manager.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  checkDatabaseFile,
  dailyBackupName,
  ensureIncrementalAutoVacuum,
  findLatestValidBackup,
  incrementalVacuum,
  isCorruptionError,
  preMigrationBackup,
  preMigrationBackupName,
  pruneBackups,
  recoverDatabase,
  takeDailyBackup,
  timeStamp,
} from './db-backup-manager.js';

const SCHEMA = 10;
const open = (file) => new DatabaseSync(file);
const openReadonly = (file) => new DatabaseSync(file, { readOnly: true });
const quiet = { error() {}, warn() {}, log() {} };
const NOW = new Date(2026, 10, 7, 9, 5, 3);

const freshDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'apccmma-guard-'));

/** An app database at `file` with `songs` hymn rows, at schema `version`. Closed before it returns. */
function appDb(file, { version = 5, songs = 3 } = {}) {
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE hymns (id INTEGER PRIMARY KEY, title TEXT);');
  const insert = db.prepare('INSERT INTO hymns (title) VALUES (?)');
  db.exec('BEGIN');
  for (let i = 0; i < songs; i += 1) insert.run(`Hymn ${i} ${'x'.repeat(200)}`);
  db.exec('COMMIT');
  db.exec(`PRAGMA user_version = ${version};`);
  db.close();
  return file;
}

const hymnCount = (file) => {
  const db = openReadonly(file);
  try {
    return db.prepare('SELECT COUNT(*) AS n FROM hymns').get().n;
  } finally {
    db.close();
  }
};

/** Overwrites the b-tree pages after the schema page with garbage: the header still reads, the data does not. */
function corruptPages(file) {
  const buf = fs.readFileSync(file);
  const pageSize = buf.readUInt16BE(16) === 1 ? 65536 : buf.readUInt16BE(16);
  for (let i = pageSize; i < buf.length; i += 1) buf[i] = (i * 31) & 0xff;
  fs.writeFileSync(file, buf);
}

/** A snapshot file in `dir` with a set modification time, so "newest" is not left to the clock. */
function snapshot(dir, name, { mtime, songs = 3, version = 5 } = {}) {
  const file = appDb(path.join(dir, name), { songs, version });
  if (mtime) fs.utimesSync(file, mtime, mtime);
  return file;
}

test('names follow the backups-folder conventions', () => {
  assert.equal(dailyBackupName(NOW), 'apccmma-backup-2026-11-07.sqlite.bak');
  assert.equal(preMigrationBackupName(58, NOW), 'apccmma-pre-migration-v58-2026-11-07-090503.sqlite.bak');
  assert.equal(timeStamp(NOW), '2026-11-07-090503');
});

test('only damage counts as corruption, not a locked or missing file', () => {
  assert.equal(isCorruptionError({ code: 'SQLITE_CORRUPT' }), true);
  assert.equal(isCorruptionError({ code: 'SQLITE_NOTADB' }), true);
  assert.equal(isCorruptionError({ errcode: 11 }), true);
  assert.equal(isCorruptionError({ errcode: 26 }), true);
  assert.equal(isCorruptionError({ code: 'SQLITE_BUSY' }), false);
  assert.equal(isCorruptionError({ code: 'SQLITE_CANTOPEN' }), false);
  assert.equal(isCorruptionError({ code: 'ENOENT', message: 'no such file' }), false);
});

test('the integrity check passes a sound file and reports a damaged or foreign one', () => {
  const dir = freshDir();
  assert.equal(checkDatabaseFile(appDb(path.join(dir, 'good.db')), { open }).state, 'ok');
  assert.equal(checkDatabaseFile(path.join(dir, 'none.db'), { open }).state, 'missing');

  const damaged = appDb(path.join(dir, 'damaged.db'), { songs: 200 });
  corruptPages(damaged);
  const result = checkDatabaseFile(damaged, { open });
  assert.equal(result.state, 'corrupt');
  assert.ok(result.problems.length > 0);

  const text = path.join(dir, 'text.db');
  fs.writeFileSync(text, 'this is not a database at all, but it is long enough to have a header'.repeat(20));
  assert.equal(checkDatabaseFile(text, { open }).state, 'corrupt');
});

test('a file that cannot be opened for another reason is left unchecked, not called corrupt', () => {
  const dir = freshDir();
  const file = appDb(path.join(dir, 'locked.db'));
  const busy = () => {
    const err = new Error('database is locked');
    err.code = 'SQLITE_BUSY';
    throw err;
  };
  assert.equal(checkDatabaseFile(file, { open: busy }).state, 'unchecked');
  const r = recoverDatabase({ dbPath: file, backupsDir: dir, open: busy, openReadonly, schemaVersion: SCHEMA, log: quiet });
  assert.equal(r.status, 'unchecked');
  assert.equal(hymnCount(file), 3, 'the file was not touched');
});

test('a damaged database is set aside and replaced by the newest good snapshot', () => {
  const root = freshDir();
  const backups = path.join(root, 'backups');
  fs.mkdirSync(backups);
  snapshot(backups, 'apccmma-backup-2026-11-05.sqlite.bak', { songs: 1, mtime: new Date(2026, 10, 5) });
  snapshot(backups, 'apccmma-backup-2026-11-06.sqlite.bak', { songs: 2, mtime: new Date(2026, 10, 6) });
  // The newest file is itself damaged, so it is skipped for the next one.
  const badNewest = snapshot(backups, 'apccmma-pre-migration-v4-2026-11-06-200000.sqlite.bak', { songs: 200, mtime: new Date(2026, 10, 6, 20) });
  corruptPages(badNewest);
  fs.utimesSync(badNewest, new Date(2026, 10, 6, 20), new Date(2026, 10, 6, 20));

  const dbPath = appDb(path.join(root, 'apccmma.db'), { songs: 200 });
  corruptPages(dbPath);
  fs.writeFileSync(`${dbPath}-journal`, 'journal of the damaged file');

  const r = recoverDatabase({ dbPath, backupsDir: backups, open, openReadonly, schemaVersion: SCHEMA, now: NOW, log: quiet });
  assert.equal(r.status, 'restored');
  assert.equal(path.basename(r.restoredFrom), 'apccmma-backup-2026-11-06.sqlite.bak');
  assert.equal(r.quarantined, `${dbPath}.corrupt-2026-11-07-090503`);
  assert.ok(fs.existsSync(r.quarantined), 'the damaged file is kept');
  assert.equal(fs.existsSync(`${dbPath}-journal`), false, 'no stale journal is left beside the restored file');
  assert.equal(fs.existsSync(`${dbPath}.restoring`), false);
  assert.equal(hymnCount(dbPath), 2);
  assert.equal(checkDatabaseFile(dbPath, { open }).state, 'ok');
});

test('a read-only pre-migration snapshot restores to a writable database', () => {
  const root = freshDir();
  const backups = path.join(root, 'backups');
  fs.mkdirSync(backups);
  const snap = snapshot(backups, 'apccmma-pre-migration-v4-2026-11-07-080000.sqlite.bak', { songs: 4 });
  fs.chmodSync(snap, 0o444);
  const dbPath = appDb(path.join(root, 'apccmma.db'), { songs: 200 });
  corruptPages(dbPath);

  const r = recoverDatabase({ dbPath, backupsDir: backups, open, openReadonly, schemaVersion: SCHEMA, now: NOW, log: quiet });
  assert.equal(r.status, 'restored');
  const db = open(dbPath);
  db.exec("INSERT INTO hymns (title) VALUES ('new')");
  db.close();
  assert.equal(hymnCount(dbPath), 5);
  fs.chmodSync(snap, 0o666);
});

test('with no good snapshot the damaged file is left in place and reported', () => {
  const root = freshDir();
  const backups = path.join(root, 'backups');
  fs.mkdirSync(backups);
  // A snapshot from a newer app is not a valid candidate either.
  snapshot(backups, 'apccmma-backup-2026-11-06.sqlite.bak', { version: SCHEMA + 1 });
  const dbPath = appDb(path.join(root, 'apccmma.db'), { songs: 200 });
  corruptPages(dbPath);
  const before = fs.readFileSync(dbPath);

  const r = recoverDatabase({ dbPath, backupsDir: backups, open, openReadonly, schemaVersion: SCHEMA, now: NOW, log: quiet });
  assert.equal(r.status, 'corrupt-no-backup');
  assert.deepEqual(fs.readFileSync(dbPath), before);
  assert.equal(fs.readdirSync(root).some((n) => n.includes('.corrupt-')), false);
});

test('a sound database is left alone', () => {
  const root = freshDir();
  const dbPath = appDb(path.join(root, 'apccmma.db'));
  const before = fs.readFileSync(dbPath);
  const r = recoverDatabase({ dbPath, backupsDir: path.join(root, 'backups'), open, openReadonly, schemaVersion: SCHEMA, log: quiet });
  assert.equal(r.status, 'ok');
  assert.deepEqual(fs.readFileSync(dbPath), before);
});

test('the pre-migration copy holds the data and version as they were, and is read-only', () => {
  const root = freshDir();
  const backups = path.join(root, 'backups');
  const db = open(appDb(path.join(root, 'apccmma.db'), { version: 7, songs: 6 }));
  const first = preMigrationBackup(db, { backupsDir: backups, version: 7, now: NOW });
  const second = preMigrationBackup(db, { backupsDir: backups, version: 7, now: NOW });
  db.close();

  assert.equal(path.basename(first), 'apccmma-pre-migration-v7-2026-11-07-090503.sqlite.bak');
  assert.equal(path.basename(second), 'apccmma-pre-migration-v7-2026-11-07-090503-2.sqlite.bak');
  assert.equal(hymnCount(first), 6);
  const copy = openReadonly(first);
  assert.equal(copy.prepare('PRAGMA user_version').get().user_version, 7);
  copy.close();
  assert.throws(() => fs.writeFileSync(first, 'overwrite'), /EPERM|EACCES/);
  assert.ok(findLatestValidBackup(backups, { schemaVersion: SCHEMA, openReadonly }));
  for (const f of [first, second]) fs.chmodSync(f, 0o666);
});

test('a pre-migration copy that cannot be written stops the upgrade with a clear error', () => {
  const root = freshDir();
  const db = open(appDb(path.join(root, 'apccmma.db')));
  const notADir = path.join(root, 'file-not-dir');
  fs.writeFileSync(notADir, '');
  assert.throws(() => preMigrationBackup(db, { backupsDir: notADir, version: 5, now: NOW }));
  const failing = { prepare: () => ({ run: () => { throw new Error('disk full'); } }) };
  assert.throws(
    () => preMigrationBackup(failing, { backupsDir: path.join(root, 'backups'), version: 5, now: NOW }),
    /could not be backed up before its upgrade \(disk full\), so the upgrade was not run/,
  );
  assert.deepEqual(fs.readdirSync(path.join(root, 'backups')), [], 'no half-written copy is left');
  db.close();
});

test('the daily snapshot is made once per day, checked, and old ones are pruned', async () => {
  const root = freshDir();
  const backups = path.join(root, 'backups');
  fs.mkdirSync(backups);
  for (const day of ['2026-10-20', '2026-10-25', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-03']) {
    snapshot(backups, `apccmma-backup-${day}.sqlite.bak`);
  }
  snapshot(backups, 'apccmma-pre-migration-v3-2026-09-01-100000.sqlite.bak');
  fs.writeFileSync(path.join(backups, 'apccmma-backup-2026-11-02.sqlite.bak.partial'), 'left over');

  const live = open(appDb(path.join(root, 'apccmma.db'), { songs: 9 }));
  const backup = async (target) => live.prepare('VACUUM INTO ?').run(target);
  const first = await takeDailyBackup({ backup, backupsDir: backups, schemaVersion: SCHEMA, openReadonly, now: NOW });
  assert.equal(first.status, 'created');
  assert.equal(path.basename(first.file), 'apccmma-backup-2026-11-07.sqlite.bak');
  assert.equal(hymnCount(first.file), 9);
  // 7 days before 2026-11-07 is 2026-10-31: older files go, and the pre-migration copy stays however old it is.
  assert.deepEqual(first.pruned.sort(), [
    'apccmma-backup-2026-10-20.sqlite.bak',
    'apccmma-backup-2026-10-25.sqlite.bak',
    'apccmma-backup-2026-10-30.sqlite.bak',
    'apccmma-backup-2026-11-02.sqlite.bak.partial',
  ]);
  assert.deepEqual(fs.readdirSync(backups).sort(), [
    'apccmma-backup-2026-10-31.sqlite.bak',
    'apccmma-backup-2026-11-01.sqlite.bak',
    'apccmma-backup-2026-11-03.sqlite.bak',
    'apccmma-backup-2026-11-07.sqlite.bak',
    'apccmma-pre-migration-v3-2026-09-01-100000.sqlite.bak',
  ]);

  let calls = 0;
  const again = await takeDailyBackup({ backup: async () => { calls += 1; }, backupsDir: backups, schemaVersion: SCHEMA, openReadonly, now: NOW });
  assert.equal(again.status, 'exists');
  assert.equal(calls, 0);
  live.close();
});

test('pruning keeps the newest few snapshots on a laptop that is rarely opened', () => {
  const dir = freshDir();
  for (const day of ['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27']) snapshot(dir, `apccmma-backup-${day}.sqlite.bak`);
  assert.deepEqual(pruneBackups(dir, { now: NOW }), ['apccmma-backup-2026-09-06.sqlite.bak']);
  assert.equal(fs.readdirSync(dir).length, 3);
});

test('a daily snapshot that fails its check is removed and not kept as today\'s', async () => {
  const backups = freshDir();
  await assert.rejects(
    takeDailyBackup({ backup: async (t) => fs.writeFileSync(t, 'garbage'), backupsDir: backups, schemaVersion: SCHEMA, openReadonly, now: NOW }),
    /not a database the app can read/,
  );
  assert.deepEqual(fs.readdirSync(backups), []);
});

test('an existing database is switched to incremental auto-vacuum, and maintenance gives free pages back', () => {
  const root = freshDir();
  const file = appDb(path.join(root, 'apccmma.db'), { songs: 2000 });
  const db = open(file);
  assert.equal(incrementalVacuum(db), 0, 'nothing happens before the switch');
  assert.equal(ensureIncrementalAutoVacuum(db, { log: quiet }), 'converted');
  assert.equal(ensureIncrementalAutoVacuum(db, { log: quiet }), 'already');

  db.exec('DELETE FROM hymns');
  const freeBefore = db.prepare('PRAGMA freelist_count').get().freelist_count;
  assert.ok(freeBefore > 10);
  const sizeBefore = fs.statSync(file).size;
  assert.equal(incrementalVacuum(db, 5), freeBefore);
  assert.equal(db.prepare('PRAGMA freelist_count').get().freelist_count, freeBefore - 5, 'one pass is bounded');
  while (incrementalVacuum(db) > 0);
  assert.equal(db.prepare('PRAGMA freelist_count').get().freelist_count, 0);
  assert.ok(fs.statSync(file).size < sizeBefore);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  db.close();
});

test('the switch is deferred, not fatal, when the file is busy', () => {
  const busy = {
    prepare: () => ({ get: () => ({ auto_vacuum: 0 }) }),
    exec: (sql) => {
      if (sql === 'VACUUM') throw new Error('database is locked');
    },
  };
  assert.equal(ensureIncrementalAutoVacuum(busy, { log: quiet }), 'deferred');
});

// Full backups (database + media in one .zip): the streaming ZIP writer and reader, path safety on restore, the export → restore round trip,
// the rule that existing media is never overwritten, and the storage sizes on the settings page. Everything runs on synthetic files in a
// temp folder. Run with: node --test electron/full-backup.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { checkBackupFile } from './database-backup.js';
import { DEFLATE, STORE, createZipWriter, openZip } from './zip-archive.js';
import {
  DB_ENTRY,
  FULL_BACKUP_FORMAT,
  MANIFEST_ENTRY,
  exportFullBackup,
  fullBackupFileName,
  isInside,
  listTree,
  measureStorage,
  openFullBackup,
  planFullRestore,
  safeEntryPath,
} from './full-backup.js';

const JSZip = createRequire(import.meta.url)('jszip');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apccmma-full-backup-test-'));
const SCHEMA = 5;
const open = (file) => new DatabaseSync(file, { readOnly: true });
let counter = 0;
const scratch = (label) => fs.mkdtempSync(path.join(root, `${label}-${(counter += 1)}-`));

function write(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}

/** An app database (it has the hymns table the restore checks for) at `file`. */
function appDb(file, rows = 3) {
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE hymns (id INTEGER PRIMARY KEY, title TEXT);');
  for (let i = 1; i <= rows; i += 1) db.prepare('INSERT INTO hymns (id, title) VALUES (?, ?)').run(i, `Song ${i} `.repeat(50));
  db.exec(`PRAGMA user_version = ${SCHEMA};`);
  db.close();
  return file;
}

/** A synthetic media folder: UUID-named files in the app's folders, one presentation deck, and one larger "video". */
function mediaFolder(dir) {
  const files = {
    'media/0b0e7c1e-1111-4a4a-8b8b-000000000001.jpg': Buffer.from('jpeg bytes'),
    'media/0b0e7c1e-1111-4a4a-8b8b-000000000002.mp4': Buffer.alloc(300 * 1024, 7),
    'thumbnails/0b0e7c1e-1111-4a4a-8b8b-000000000003.png': Buffer.from('png'),
    'presentations/12/0b0e7c1e-1111-4a4a-8b8b-000000000004.png': Buffer.from('slide one'),
    'whiteboard/0b0e7c1e-1111-4a4a-8b8b-000000000005.json': Buffer.from('{"strokes":[]}'),
    'announcements/0b0e7c1e-1111-4a4a-8b8b-000000000006.png': Buffer.alloc(0),
  };
  for (const [rel, bytes] of Object.entries(files)) write(path.join(dir, ...rel.split('/')), bytes);
  return files;
}

async function zipOf(file, entries, options) {
  const writer = await createZipWriter(file, options);
  for (const [name, data, method] of entries) await writer.addBuffer(name, Buffer.from(data), { method: method ?? DEFLATE });
  await writer.finish();
  return file;
}

// ---- ZIP writer and reader -------------------------------------------------------------------------------------------------------------

test('a ZIP round-trips stored, deflated, empty and non-ASCII entries, and opens in an independent reader (jszip)', async () => {
  const dir = scratch('zip');
  const source = write(path.join(dir, 'big.bin'), Buffer.alloc(200 * 1024, 3));
  const file = path.join(dir, 'out.zip');
  const writer = await createZipWriter(file);
  await writer.addBuffer('notes/readme.txt', Buffer.from('hello '.repeat(1000)), { method: DEFLATE });
  await writer.addFile('data/big.bin', source, { method: STORE });
  await writer.addBuffer('empty.txt', Buffer.alloc(0), { method: STORE });
  await writer.addBuffer('Señor/Ama Namin.txt', Buffer.from('Ama Namin'), { method: DEFLATE });
  const size = await writer.finish();
  assert.equal(size, fs.statSync(file).size);

  const zip = await openZip(file);
  try {
    assert.deepEqual(
      zip.entries.map((e) => [e.name, e.method, e.size]),
      [
        ['notes/readme.txt', DEFLATE, 6000],
        ['data/big.bin', STORE, 200 * 1024],
        ['empty.txt', STORE, 0],
        ['Señor/Ama Namin.txt', DEFLATE, 9],
      ],
    );
    assert.ok(zip.entries[0].compressedSize < 6000, 'text is deflated');
    const out = path.join(dir, 'big.out');
    await zip.extractEntry(zip.entries[1], out);
    assert.deepEqual(fs.readFileSync(out), fs.readFileSync(source));
    assert.equal((await zip.readEntry(zip.entries[3])).toString(), 'Ama Namin');
    assert.equal((await zip.readEntry(zip.entries[2])).length, 0);
  } finally {
    await zip.close();
  }

  const other = await JSZip.loadAsync(fs.readFileSync(file));
  assert.equal(await other.file('notes/readme.txt').async('string'), 'hello '.repeat(1000));
  assert.equal(await other.file('Señor/Ama Namin.txt').async('string'), 'Ama Namin');
  assert.deepEqual(await other.file('data/big.bin').async('nodebuffer'), fs.readFileSync(source));
});

test('ZIP64 records (forced with low test limits) are written and read back, here and by jszip', async () => {
  const dir = scratch('zip64');
  const file = path.join(dir, 'z64.zip');
  // Entries of 16+ bytes, offsets past 16, and 3+ entries all take the ZIP64 path, as 4 GB files and 65,535 entries would.
  await zipOf(
    file,
    [
      ['a.bin', 'x'.repeat(40), STORE],
      ['b.txt', 'short', DEFLATE],
      ['c.bin', 'y'.repeat(64), STORE],
    ],
    { limits: { size: 16, count: 3 } },
  );
  const bytes = fs.readFileSync(file);
  assert.ok(bytes.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06])), 'a ZIP64 end-of-directory record is present');
  assert.ok(bytes.includes(Buffer.from([0x50, 0x4b, 0x06, 0x07])), 'a ZIP64 locator is present');

  const zip = await openZip(file);
  try {
    assert.deepEqual(
      zip.entries.map((e) => [e.name, e.size]),
      [
        ['a.bin', 40],
        ['b.txt', 5],
        ['c.bin', 64],
      ],
    );
    assert.equal((await zip.readEntry(zip.entries[2])).toString(), 'y'.repeat(64));
    assert.equal((await zip.readEntry(zip.entries[1])).toString(), 'short');
  } finally {
    await zip.close();
  }
  const other = await JSZip.loadAsync(bytes);
  assert.equal(await other.file('c.bin').async('string'), 'y'.repeat(64));
  assert.equal(await other.file('a.bin').async('string'), 'x'.repeat(40));
});

test('a damaged entry fails its checksum and leaves no file behind; a file that is not a ZIP is refused', async () => {
  const dir = scratch('damaged');
  const file = await zipOf(path.join(dir, 'd.zip'), [['m.bin', 'A'.repeat(500), STORE]]);
  const bytes = fs.readFileSync(file);
  bytes[30 + 'm.bin'.length + 100] = 'B'.charCodeAt(0); // inside the stored data
  fs.writeFileSync(file, bytes);
  const zip = await openZip(file);
  const out = path.join(dir, 'm.out');
  try {
    await assert.rejects(zip.extractEntry(zip.entries[0], out), /damaged or incomplete \(m\.bin failed its checksum\)/);
    assert.equal(fs.existsSync(out), false);
  } finally {
    await zip.close();
  }

  await assert.rejects(openZip(write(path.join(dir, 'notes.zip'), 'just some text, not an archive')), /not a backup archive/);
  const cut = path.join(dir, 'cut.zip');
  fs.writeFileSync(cut, fs.readFileSync(file).subarray(0, 40));
  await assert.rejects(openZip(cut), /not a backup archive/);
});

test('an entry longer than its listed size is stopped at the listed size (no unbounded inflate)', async () => {
  const dir = scratch('bomb');
  const file = await zipOf(path.join(dir, 'b.zip'), [['x.txt', 'z'.repeat(10000), DEFLATE]]);
  const zip = await openZip(file);
  try {
    const entry = { ...zip.entries[0], size: 100 };
    await assert.rejects(zip.extractEntry(entry, path.join(dir, 'x.out')), /longer than its listed size/);
    assert.equal(fs.existsSync(path.join(dir, 'x.out')), false);
  } finally {
    await zip.close();
  }
});

// ---- Path safety -----------------------------------------------------------------------------------------------------------------------

test('archive paths that could escape the restore folder, or that Windows cannot name, are refused', () => {
  assert.equal(safeEntryPath('apccmma_assets/media/a.jpg'), 'apccmma_assets/media/a.jpg');
  assert.equal(safeEntryPath('apccmma_assets\\media\\a.jpg'), 'apccmma_assets/media/a.jpg', 'backslashes from Windows zippers are read as folders');
  for (const bad of [
    '../evil.txt',
    'apccmma_assets/../../evil.txt',
    'apccmma_assets/./a.jpg',
    '/abs/path.txt',
    '\\\\server\\share\\x',
    'C:/Windows/x.dll',
    'c:evil',
    'apccmma_assets//a.jpg',
    'apccmma_assets/media/CON',
    'apccmma_assets/media/nul.txt',
    'apccmma_assets/media/trailing.',
    'apccmma_assets/media/a:stream',
    'apccmma_assets/media/a\u0000b',
    '',
  ]) {
    assert.throws(() => safeEntryPath(bad), /file path that is not allowed/, JSON.stringify(bad));
  }
  assert.equal(isInside(path.join('a', 'b', 'c'), path.join('a', 'b')), true);
  assert.equal(isInside(path.join('a', 'bc'), path.join('a', 'b')), false);
});

test('a restore plan needs apccmma.db, sorts media under apccmma_assets/, and refuses duplicates and encrypted files', () => {
  const entry = (name, extra = {}) => ({ name, directory: name.endsWith('/'), encrypted: false, size: 1, ...extra });
  const plan = planFullRestore([
    entry('manifest.json'),
    entry('apccmma.db'),
    entry('apccmma_assets/'),
    entry('apccmma_assets/media/a.jpg'),
    entry('apccmma_assets/presentations/3/b.png'),
    entry('README.txt'),
  ]);
  assert.equal(plan.database.name, 'apccmma.db');
  assert.equal(plan.manifest.name, 'manifest.json');
  assert.deepEqual(plan.media.map((m) => m.rel), ['media/a.jpg', 'presentations/3/b.png']);

  assert.throws(() => planFullRestore([entry('apccmma_assets/media/a.jpg')]), /not an APCCMMA full backup: it has no apccmma\.db/);
  assert.throws(() => planFullRestore([entry('apccmma.db'), entry('APCCMMA.DB')]), /twice/);
  assert.throws(() => planFullRestore([entry('apccmma.db', { encrypted: true })]), /password-protected/);
  assert.throws(() => planFullRestore([entry('apccmma.db'), entry('apccmma_assets/../x')]), /not allowed/);
});

// ---- Export and restore ----------------------------------------------------------------------------------------------------------------

async function exportFrom(home, options = {}) {
  const live = appDb(path.join(home, 'apccmma.db'));
  const assets = path.join(home, 'apccmma_assets');
  const files = mediaFolder(assets);
  const target = path.join(home, 'out', fullBackupFileName(new Date(2026, 10, 27, 9, 30, 0)));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const progress = [];
  const result = await exportFullBackup({
    target,
    snapshotDatabase: async (file) => fs.copyFileSync(live, file),
    checkDatabase: (file) => checkBackupFile(file, { schemaVersion: SCHEMA, open }),
    assetRoot: assets,
    appVersion: '9.9.9',
    schemaVersion: SCHEMA,
    onProgress: (p) => progress.push(p),
    now: new Date(2026, 10, 27, 9, 30, 0),
    ...options,
  });
  return { live, assets, files, target, result, progress };
}

test('a full export holds the manifest, the database and every media file, and leaves no .partial file', async () => {
  const home = scratch('export');
  const { live, files, target, result, progress } = await exportFrom(home);
  assert.equal(path.basename(target), 'apccmma-full-backup-20261127-093000.zip');
  assert.equal(result.path, target);
  assert.equal(result.mediaFiles, Object.keys(files).length);
  assert.equal(result.mediaBytes, Object.values(files).reduce((sum, b) => sum + b.length, 0));
  assert.equal(result.bytes, fs.statSync(target).size);
  assert.equal(fs.existsSync(`${target}.partial`), false);

  const zip = await openZip(target);
  try {
    const names = zip.entries.map((e) => e.name);
    assert.deepEqual(names.slice(0, 2), [MANIFEST_ENTRY, DB_ENTRY]);
    assert.deepEqual(names.slice(2).sort(), Object.keys(files).map((rel) => `apccmma_assets/${rel}`).sort());
    const manifest = JSON.parse((await zip.readEntry(zip.entries[0])).toString());
    assert.equal(manifest.format, FULL_BACKUP_FORMAT);
    assert.equal(manifest.appVersion, '9.9.9');
    assert.equal(manifest.schemaVersion, SCHEMA);
    assert.equal(manifest.mediaFiles, Object.keys(files).length);
    const db = zip.entries.find((e) => e.name === DB_ENTRY);
    assert.equal(db.method, DEFLATE, 'the database is compressed');
    assert.equal(db.size, fs.statSync(live).size);
    assert.ok(zip.entries.filter((e) => e.name.startsWith('apccmma_assets/')).every((e) => e.method === STORE), 'media is stored as is');
  } finally {
    await zip.close();
  }
  const last = progress.at(-1);
  assert.equal(last.done, last.total, 'the last progress report is complete');
  assert.equal(last.total, Object.keys(files).length + 1);
});

test('an export refuses a target inside the media folder, and a database that fails its check leaves no file', async () => {
  const home = scratch('export-refused');
  const assets = path.join(home, 'apccmma_assets');
  mediaFolder(assets);
  const live = appDb(path.join(home, 'apccmma.db'));
  const common = {
    snapshotDatabase: async (file) => fs.copyFileSync(live, file),
    checkDatabase: (file) => checkBackupFile(file, { schemaVersion: SCHEMA, open }),
    assetRoot: assets,
    appVersion: '1.0.0',
    schemaVersion: SCHEMA,
  };
  await assert.rejects(exportFullBackup({ ...common, target: path.join(assets, 'media', 'backup.zip') }), /outside the media folder/);

  const target = path.join(home, 'bad.zip');
  await assert.rejects(
    exportFullBackup({ ...common, target, snapshotDatabase: async (file) => fs.writeFileSync(file, 'not a database') }),
    /not a database the app can read/,
  );
  assert.equal(fs.existsSync(target), false);
  assert.equal(fs.existsSync(`${target}.partial`), false);
});

test('a full restore extracts the database and adds only missing media; existing files are never overwritten or deleted', async () => {
  const from = scratch('restore-from');
  const { live, files, target } = await exportFrom(from);

  const to = scratch('restore-to');
  const assets = path.join(to, 'apccmma_assets');
  // This laptop already has one of the files (same UUID name, so the same file), with its own bytes, and a file the backup does not have.
  const keptRel = 'media/0b0e7c1e-1111-4a4a-8b8b-000000000001.jpg';
  write(path.join(assets, ...keptRel.split('/')), 'this laptop’s copy');
  const ownRel = 'media/0b0e7c1e-2222-4a4a-8b8b-000000000009.jpg';
  write(path.join(assets, ...ownRel.split('/')), 'only on this laptop');

  const backup = await openFullBackup(target);
  try {
    assert.equal(backup.manifest.format, FULL_BACKUP_FORMAT);
    const dbOut = path.join(to, 'restored.db');
    await backup.extractDatabase(dbOut);
    assert.deepEqual(fs.readFileSync(dbOut), fs.readFileSync(live));

    const progress = [];
    const result = await backup.restoreMedia(assets, (p) => progress.push(p));
    assert.deepEqual(result, { added: Object.keys(files).length - 1, skipped: 1, bytes: Object.values(files).reduce((s, b) => s + b.length, 0) - files[keptRel].length });
    assert.equal(progress.at(-1).done, Object.keys(files).length);
  } finally {
    await backup.close();
  }

  for (const [rel, bytes] of Object.entries(files)) {
    if (rel === keptRel) continue;
    assert.deepEqual(fs.readFileSync(path.join(assets, ...rel.split('/'))), bytes, rel);
  }
  assert.equal(fs.readFileSync(path.join(assets, ...keptRel.split('/')), 'utf8'), 'this laptop’s copy', 'the existing file is not overwritten');
  assert.equal(fs.readFileSync(path.join(assets, ...ownRel.split('/')), 'utf8'), 'only on this laptop', 'files not in the backup are kept');
  assert.equal((await listTree(assets)).some((f) => f.rel.endsWith('.restoring')), false, 'no temporary files are left');
});

test('a crafted archive with a path outside the media folder is refused before anything is written', async () => {
  const dir = scratch('slip');
  const file = await zipOf(path.join(dir, 'evil.zip'), [
    ['apccmma.db', 'x'],
    ['apccmma_assets/media/ok.jpg', 'fine'],
    ['apccmma_assets/../../escaped.txt', 'gotcha'],
  ]);
  await assert.rejects(openFullBackup(file), /file path that is not allowed/);
  assert.equal(fs.existsSync(path.join(dir, 'escaped.txt')), false);
  assert.equal(fs.existsSync(path.join(path.dirname(dir), 'escaped.txt')), false);
});

test('an archive zipped by hand (database + media folder, no manifest) restores; a foreign manifest or a .db-less zip is refused', async () => {
  const dir = scratch('by-hand');
  const handMade = await zipOf(path.join(dir, 'hand.zip'), [
    ['apccmma.db', 'db bytes'],
    ['apccmma_assets/media/0b0e7c1e-3333-4a4a-8b8b-000000000001.jpg', 'pic'],
  ]);
  const backup = await openFullBackup(handMade);
  try {
    assert.equal(backup.manifest, null);
    assert.deepEqual(await backup.restoreMedia(path.join(dir, 'assets')), { added: 1, skipped: 0, bytes: 3 });
  } finally {
    await backup.close();
  }

  const foreign = await zipOf(path.join(dir, 'foreign.zip'), [
    ['manifest.json', JSON.stringify({ format: 'something-else' })],
    ['apccmma.db', 'x'],
  ]);
  await assert.rejects(openFullBackup(foreign), /not an APCCMMA full backup/);
  const newer = await zipOf(path.join(dir, 'newer.zip'), [
    ['manifest.json', JSON.stringify({ format: FULL_BACKUP_FORMAT, version: 99 })],
    ['apccmma.db', 'x'],
  ]);
  await assert.rejects(openFullBackup(newer), /newer version of APCCMMA/);
  const photos = await zipOf(path.join(dir, 'photos.zip'), [['holiday/1.jpg', 'pic']]);
  await assert.rejects(openFullBackup(photos), /has no apccmma\.db inside/);
});

// ---- Storage sizes ---------------------------------------------------------------------------------------------------------------------

test('storage sizes: the database file, and the media folder’s bytes and file count; unreadable parts are null', async () => {
  const home = scratch('measure');
  const db = write(path.join(home, 'apccmma.db'), Buffer.alloc(4096));
  const assets = path.join(home, 'apccmma_assets');
  const files = mediaFolder(assets);
  write(path.join(assets, 'media', 'left-over.mp4.restoring'), 'half a file');

  const stats = await measureStorage({ dbPath: db, assetRoot: assets });
  assert.deepEqual(stats, {
    database: { bytes: 4096 },
    media: { bytes: Object.values(files).reduce((s, b) => s + b.length, 0), files: Object.keys(files).length },
  });

  assert.deepEqual(await measureStorage({ dbPath: path.join(home, 'missing.db'), assetRoot: path.join(home, 'no-media') }), {
    database: null,
    media: { bytes: 0, files: 0 },
  });
});

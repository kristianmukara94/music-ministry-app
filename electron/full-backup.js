// Full backups: one portable .zip holding the database and the whole media folder, so a parish can move to a new laptop, or recover from a
// dead one, with a single file. Layout inside the archive:
//
//   manifest.json            what made it and when (FULL_BACKUP_FORMAT)
//   apccmma.db               a checked online-backup snapshot of the live database
//   apccmma_assets/<path>    every file in the media folder, at its own relative path
//
// A restore reads the archive in place (electron/zip-archive.js streams it), checks every path before anything is written, and adds media
// files the active folder does not have yet. Media files are named by UUID (electron/assets.js), so a file that is already there is the same
// file: nothing is ever overwritten or deleted. The database swap itself is electron/database-backup.js, which keeps a safety copy first.
// Database handles, dialogs and the relaunch stay in main.js, so all of this runs in the tests on plain files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compactTimestamp } from '../shared/backup-format.js';
import { ASSET_DIR_NAME } from './assets.js';
import { DEFLATE, STORE, ZipError, createZipWriter, openZip } from './zip-archive.js';

export const DB_ENTRY = 'apccmma.db';
export const MANIFEST_ENTRY = 'manifest.json';
export const FULL_BACKUP_FORMAT = 'apccmma-full-backup';
export const FULL_BACKUP_VERSION = 1;
export const ARCHIVE_FILTERS = [{ name: 'APCCMMA Full Backup', extensions: ['zip'] }];
/** The database is deflated (lyrics and plans shrink a lot); media is stored as is, since photos and video are compressed already. */
const DEFLATE_DB_BELOW = 2 * 1024 * 1024 * 1024;
/** Progress is sent at most this often, so thousands of small files cannot flood IPC. */
const PROGRESS_INTERVAL_MS = 80;
/** Free space kept on the disk after a restore, on top of the media it adds. */
const SPACE_MARGIN = 64 * 1024 * 1024;

/** apccmma-full-backup-YYYYMMDD-HHMMSS.zip, from the local time. */
export const fullBackupFileName = (now = new Date()) => `apccmma-full-backup-${compactTimestamp(now)}.zip`;

/** True when `child` is `parent` or inside it. */
export function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Calls `send` at most every PROGRESS_INTERVAL_MS, except for `force` (the first and last report). */
export function throttleProgress(send, intervalMs = PROGRESS_INTERVAL_MS) {
  let last = 0;
  return (progress, force = false) => {
    const now = Date.now();
    if (!force && now - last < intervalMs) return;
    last = now;
    send(progress);
  };
}

/**
 * Every file under `root` as { rel, abs, size }, with forward-slash `rel` paths. Links and leftover `.restoring` files are skipped. Async, so
 * it never blocks the main thread.
 */
export async function listTree(root) {
  const found = [];
  const walk = async (dir, prefix) => {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT' && prefix === '') return;
      throw err;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(abs, rel);
      // A media file a restore was still writing when the app stopped is not part of the library.
      else if (entry.isFile() && !entry.name.endsWith('.restoring')) {
        try {
          found.push({ rel, abs, size: (await fs.promises.stat(abs)).size });
        } catch (err) {
          // Removed while the folder was being read.
          if (err.code !== 'ENOENT') throw err;
        }
      }
    }
  };
  await walk(root, '');
  return found;
}

/**
 * The sizes the Backup & restore page shows: { database: { bytes } | null, media: { bytes, files } | null }. Null when that part could not
 * be read (an unplugged share, say), so the page shows a dash rather than failing.
 */
export async function measureStorage({ dbPath, assetRoot }) {
  const [database, media] = await Promise.all([
    fs.promises.stat(dbPath).then(
      (stat) => ({ bytes: stat.size }),
      () => null,
    ),
    listTree(assetRoot).then(
      (files) => ({ bytes: files.reduce((sum, f) => sum + f.size, 0), files: files.length }),
      () => null,
    ),
  ]);
  return { database, media };
}

/**
 * Writes a full backup to `target`. `snapshotDatabase(file)` writes a consistent copy of the live database (SQLite's online backup) and
 * `checkDatabase(file)` throws if that copy is not sound, so a bad database never goes into an archive. The archive is written beside the
 * target as `.partial` and renamed when complete, so a cancelled or failed export never leaves a file that looks like a backup.
 * Returns { path, bytes, databaseBytes, mediaFiles, mediaBytes }.
 */
export async function exportFullBackup({ target, snapshotDatabase, checkDatabase, assetRoot, appVersion, schemaVersion, onProgress = () => {}, now = new Date(), tempDir = os.tmpdir() }) {
  if (isInside(target, assetRoot)) throw new Error('Save the full backup outside the media folder, or it would end up inside the next backup.');
  const report = throttleProgress(onProgress);
  const work = await fs.promises.mkdtemp(path.join(tempDir, 'apccmma-full-backup-'));
  const partial = `${target}.partial`;
  let writer = null;
  try {
    report({ done: 0, total: 0, current: DB_ENTRY }, true);
    const dbCopy = path.join(work, DB_ENTRY);
    await snapshotDatabase(dbCopy);
    checkDatabase(dbCopy);
    const databaseBytes = (await fs.promises.stat(dbCopy)).size;

    const files = await listTree(assetRoot);
    const total = files.length + 1;
    const manifest = {
      format: FULL_BACKUP_FORMAT,
      version: FULL_BACKUP_VERSION,
      createdAt: now.toISOString(),
      appVersion,
      schemaVersion,
      database: DB_ENTRY,
      mediaFolder: ASSET_DIR_NAME,
      mediaFiles: files.length,
      mediaBytes: files.reduce((sum, f) => sum + f.size, 0),
    };

    await fs.promises.rm(partial, { force: true });
    writer = await createZipWriter(partial);
    await writer.addBuffer(MANIFEST_ENTRY, Buffer.from(JSON.stringify(manifest, null, 2)), { method: DEFLATE, mtime: now });
    await writer.addFile(DB_ENTRY, dbCopy, { method: databaseBytes < DEFLATE_DB_BELOW ? DEFLATE : STORE });
    let done = 1;
    report({ done, total, current: DB_ENTRY }, true);

    let mediaFiles = 0;
    let mediaBytes = 0;
    for (const file of files) {
      try {
        await writer.addFile(`${ASSET_DIR_NAME}/${file.rel}`, file.abs, { method: STORE });
        mediaFiles += 1;
        mediaBytes += file.size;
      } catch (err) {
        // Deleted from the library after the folder was listed: it is not part of the library any more. Any other failure stops the export.
        if (err.code !== 'ENOENT') throw err;
      }
      done += 1;
      report({ done, total, current: file.rel });
    }
    const bytes = await writer.finish();
    writer = null;
    await fs.promises.rename(partial, target);
    report({ done: total, total, current: '' }, true);
    return { path: target, bytes, databaseBytes, mediaFiles, mediaBytes };
  } catch (err) {
    await writer?.abort();
    await fs.promises.rm(partial, { force: true }).catch(() => {});
    throw err;
  } finally {
    await fs.promises.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
const BAD_CHARACTERS = /[<>:"|?*\u0000-\u001f]/;

/**
 * An archive entry's path, checked: relative, forward slashes, no `.` or `..` parts, no drive letters, and nothing Windows cannot name.
 * Throws for anything else, so a crafted archive can never write outside the folder it is restored into ("zip slip").
 */
export function safeEntryPath(name) {
  const rel = String(name).replace(/\\/g, '/');
  const refuse = () => {
    throw new ZipError(`This backup contains a file path that is not allowed (${String(name).slice(0, 120)}), so it was not restored.`);
  };
  if (!rel || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) refuse();
  const parts = rel.split('/');
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..' || BAD_CHARACTERS.test(part) || /[. ]$/.test(part) || WINDOWS_RESERVED.test(part)) refuse();
  }
  return parts.join('/');
}

/**
 * Sorts an archive's entries into the database, the manifest and the media files, refusing the whole archive if any path is unsafe, if it has
 * no database, or if it is not one this app can read. Other files at the top level are ignored. Returns { database, manifest, media }, where
 * media is [{ entry, rel }] with `rel` relative to the media folder.
 */
export function planFullRestore(entries) {
  let database = null;
  let manifest = null;
  const media = [];
  const seen = new Set();
  for (const entry of entries) {
    if (entry.directory) continue;
    const rel = safeEntryPath(entry.name);
    const key = rel.toLowerCase();
    if (seen.has(key)) throw new ZipError(`This backup lists ${rel} twice, so it is not one this app made.`);
    seen.add(key);
    if (entry.encrypted) throw new ZipError('This backup is password-protected, so it cannot be restored.');
    if (rel === DB_ENTRY) database = entry;
    else if (rel === MANIFEST_ENTRY) manifest = entry;
    else if (rel.startsWith(`${ASSET_DIR_NAME}/`)) media.push({ entry, rel: rel.slice(ASSET_DIR_NAME.length + 1) });
  }
  if (!database) {
    throw new ZipError(`This file is not an APCCMMA full backup: it has no ${DB_ENTRY} inside. To restore a .db file, use Restore DB Snapshot.`);
  }
  return { database, manifest, media };
}

/** Reads and checks the manifest, if the archive has one. An archive zipped by hand (database + media folder) has none and is accepted. */
async function readManifest(zip, entry) {
  if (!entry) return null;
  let manifest;
  try {
    manifest = JSON.parse((await zip.readEntry(entry)).toString('utf8'));
  } catch (err) {
    if (err instanceof ZipError) throw err;
    throw new ZipError('The backup’s manifest.json cannot be read, so the backup may be damaged.');
  }
  if (!manifest || manifest.format !== FULL_BACKUP_FORMAT) throw new ZipError('This archive is not an APCCMMA full backup.');
  if (Number(manifest.version) > FULL_BACKUP_VERSION) {
    throw new ZipError('This full backup was made by a newer version of APCCMMA. Update the app, then restore it.');
  }
  return manifest;
}

/**
 * Opens a full backup and checks it without writing anything. Returns { manifest, plan, extractDatabase(dest), restoreMedia(assetRoot,
 * onProgress), close() }. Throws ZipError (an operator-readable sentence) for a file that is not a full backup.
 */
export async function openFullBackup(file) {
  const zip = await openZip(file);
  try {
    const plan = planFullRestore(zip.entries);
    const manifest = await readManifest(zip, plan.manifest);
    return {
      manifest,
      plan,
      extractDatabase: (dest) => zip.extractEntry(plan.database, dest),
      restoreMedia: (assetRoot, onProgress) => restoreMedia({ zip, media: plan.media, assetRoot, onProgress }),
      close: () => zip.close(),
    };
  } catch (err) {
    await zip.close();
    throw err;
  }
}

async function freeBytes(dir) {
  try {
    const stat = await fs.promises.statfs(dir);
    return Number(stat.bavail) * Number(stat.bsize);
  } catch {
    return Infinity; // Not measurable (some network shares): the copy itself reports a full disk.
  }
}

/**
 * Adds the archive's media files that `assetRoot` does not have yet. Existing files are left exactly as they are. Each file is written as
 * `<name>.restoring` and renamed once its checksum passes, so an interrupted restore leaves no half-written media under a real name.
 * Returns { added, skipped, bytes }.
 */
export async function restoreMedia({ zip, media, assetRoot, onProgress = () => {} }) {
  const report = throttleProgress(onProgress);
  const root = path.resolve(assetRoot);
  const pending = [];
  let skipped = 0;
  for (const item of media) {
    const dest = path.join(root, ...item.rel.split('/'));
    if (!isInside(dest, root) || dest === root) throw new ZipError(`This backup contains a file path that is not allowed (${item.rel}), so it was not restored.`);
    if (fs.existsSync(dest)) skipped += 1;
    else pending.push({ ...item, dest });
  }
  const needed = pending.reduce((sum, item) => sum + item.entry.size, 0);
  await fs.promises.mkdir(root, { recursive: true });
  if (needed + SPACE_MARGIN > (await freeBytes(root))) {
    throw new Error(`There is not enough free space for the backup's media (${Math.ceil(needed / 1024 / 1024)} MB needed). Nothing was replaced.`);
  }

  const total = media.length;
  let done = skipped;
  let added = 0;
  report({ done, total, current: '' }, true);
  for (const item of pending) {
    const temp = `${item.dest}.restoring`;
    try {
      await fs.promises.mkdir(path.dirname(item.dest), { recursive: true });
      await fs.promises.rm(temp, { force: true });
      await zip.extractEntry(item.entry, temp);
      // Added by the library while the restore ran: keep the library's copy.
      if (fs.existsSync(item.dest)) await fs.promises.rm(temp, { force: true });
      else await fs.promises.rename(temp, item.dest);
    } catch (err) {
      await fs.promises.rm(temp, { force: true }).catch(() => {});
      const why = err instanceof ZipError ? err.message : `${item.rel}: ${err.message}`;
      throw new Error(`A media file could not be restored (${why}). The current database was not replaced. ${added} media file(s) copied before this were kept.`);
    }
    added += 1;
    done += 1;
    report({ done, total, current: item.rel });
  }
  report({ done: total, total, current: '' }, true);
  return { added, skipped, bytes: needed };
}

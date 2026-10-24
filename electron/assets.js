import fs from 'node:fs';
import path from 'node:path';

// Media and slide files live in a folder beside the active database, so a database moved to
// a shared drive takes its files with it. The database stores only relative paths such as
// `media/<uuid>.mp4`, which resolve against whichever folder the database is opened from.
export const ASSET_DIR_NAME = 'apccmma_assets';
export const ASSET_FOLDERS = ['announcements', 'media', 'thumbnails', 'presentations'];

// Every file we write is named by a UUID. Anything else is refused, which also blocks traversal.
const ASSET_NAME = /^[0-9a-f-]{36}\.[a-z0-9]{2,4}$/i;
// Presentation pages sit in one folder per deck: `presentations/<deck id>/<uuid>.<ext>`.
const DECK_ID = /^\d+$/;

let activeRoot = null;

/** The asset folder for a database file: `<folder of the database>/apccmma_assets`. */
export function assetRootFor(dbPath) {
  return path.join(path.dirname(dbPath), ASSET_DIR_NAME);
}

/** Makes the active root the one every resolver uses, and creates its subfolders. */
export function setActiveAssetRoot(root) {
  for (const folder of ASSET_FOLDERS) fs.mkdirSync(path.join(root, folder), { recursive: true });
  activeRoot = root;
}

export function getAssetRoot() {
  if (!activeRoot) throw new Error('The asset folder is not ready yet.');
  return activeRoot;
}

/** The relative form stored in the database, always with forward slashes: `media/<uuid>.mp4`. */
export function relPath(folder, fileName) {
  return `${folder}/${fileName}`;
}

/**
 * Resolves a stored relative path against a root. Returns null for anything that is not a
 * known folder and a UUID file name, so a crafted path can never reach outside the root.
 */
export function resolveAsset(root, rel) {
  if (typeof rel !== 'string') return null;
  const parts = rel.split('/');
  if (parts.length === 3 && parts[0] === 'presentations' && DECK_ID.test(parts[1]) && ASSET_NAME.test(parts[2])) {
    return path.join(root, parts[0], parts[1], parts[2]);
  }
  if (parts.length !== 2) return null;
  const [folder, name] = parts;
  if (!ASSET_FOLDERS.includes(folder) || !ASSET_NAME.test(name)) return null;
  return path.join(root, folder, name);
}

/** Copies a whole asset folder into another root. Existing files are kept, never overwritten. */
export function copyAssets(fromRoot, toRoot) {
  if (!fs.existsSync(fromRoot)) return;
  fs.cpSync(fromRoot, toRoot, { recursive: true, force: false, errorOnExist: false });
}

/**
 * One-time conversion for databases created before relative paths. Older rows hold absolute
 * paths inside each laptop's userData folder. The files are copied into the asset folder and
 * the rows rewritten. Originals are left alone. Safe to run on every start: finished rows are
 * already relative and are skipped.
 */
export function migrateAbsolutePaths(db, root) {
  const columns = [
    { table: 'announcement_slides', column: 'file_path', folder: 'announcements' },
    { table: 'announcement_slides', column: 'background_image_path', folder: 'announcements' },
    { table: 'media_assets', column: 'file_path', folder: 'media' },
    { table: 'media_assets', column: 'thumbnail_path', folder: 'thumbnails' },
  ];

  for (const { table, column, folder } of columns) {
    const rows = db.prepare(`SELECT id, ${column} AS p FROM ${table} WHERE ${column} IS NOT NULL`).all();
    const absolute = rows.filter((r) => path.isAbsolute(r.p));
    if (absolute.length === 0) continue;

    const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`);
    db.transaction(() => {
      for (const row of absolute) {
        const name = path.basename(row.p);
        const dest = path.join(root, folder, name);
        if (!fs.existsSync(dest) && fs.existsSync(row.p)) fs.copyFileSync(row.p, dest);
        update.run(relPath(folder, name), row.id);
      }
    })();
  }
}

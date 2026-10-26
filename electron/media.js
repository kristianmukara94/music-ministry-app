import { dialog, ipcMain, BrowserWindow, nativeImage, shell } from 'electron';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MEDIA_SCHEME, registerMediaRoute } from './protocol.js';
import { createVideoThumbnailer } from './video-thumbnailer.js';
import { getAssetRoot, relPath, resolveAsset } from './assets.js';

const FILTERS = [
  { name: 'Media', extensions: ['mp4', 'mov', 'webm', 'mkv', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'mp3', 'wav', 'aac', 'flac', 'ogg'] },
];
const TYPE_BY_EXT = {
  '.mp4': 'video', '.mov': 'video', '.webm': 'video', '.mkv': 'video',
  '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.webp': 'image', '.gif': 'image', '.svg': 'image',
  '.mp3': 'audio', '.wav': 'audio', '.aac': 'audio', '.flac': 'audio', '.ogg': 'audio',
};
const THUMB_WIDTH = 480;

export const MEDIA_MIGRATIONS = [
  `
  CREATE TABLE media_assets (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    filename        TEXT NOT NULL,
    file_path       TEXT NOT NULL,
    media_type      TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
    thumbnail_path  TEXT,
    uploaded_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
];

/**
 * Adds audio to the library. SQLite cannot change a CHECK in place, so the table is copied, keeping every row.
 */
export const MEDIA_AUDIO_MIGRATIONS = [
  `
  CREATE TABLE media_assets_new (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    filename        TEXT NOT NULL,
    file_path       TEXT NOT NULL,
    media_type      TEXT NOT NULL CHECK (media_type IN ('image', 'video', 'audio')),
    thumbnail_path  TEXT,
    uploaded_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO media_assets_new (id, filename, file_path, media_type, thumbnail_path, uploaded_at)
    SELECT id, filename, file_path, media_type, thumbnail_path, uploaded_at FROM media_assets;
  DROP TABLE media_assets;
  ALTER TABLE media_assets_new RENAME TO media_assets;
  `,
];

// Shown when an .mkv is imported and ffmpeg is not installed. Chromium cannot play Matroska, so the file needs converting.
export const MKV_NOTICE = 'For optimal projector playback, please convert .mkv files to .mp4.';

let ffmpegCheck = null;

/** The ffmpeg command that runs on this computer, or null when none is installed. Looked up once per session. */
export function findFfmpeg() {
  ffmpegCheck ??= (async () => {
    for (const cmd of [process.env.APCCMMA_FFMPEG, 'ffmpeg'].filter(Boolean)) {
      const works = await new Promise((resolve) => execFile(cmd, ['-version'], { windowsHide: true, timeout: 15_000 }, (err) => resolve(!err)));
      if (works) return cmd;
    }
    return null;
  })();
  return ffmpegCheck;
}

/**
 * Copies the video and audio into an MP4 without re-encoding, so it is quick and loses no quality. Subtitle and data
 * streams are left out, because MP4 cannot hold them.
 */
function remuxToMp4(ffmpeg, input, output) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', '-movflags', '+faststart', output];
    const child = spawn(ffmpeg, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`))));
  });
}

/**
 * Media library data access and import. Paths in the database are relative to the asset
 * folder (`media/…`, `thumbnails/…`). Thumbnailing is injected so the logic can be tested without a window.
 */
export function createMediaService(db, root, deps) {
  // makeImageThumbnail(file, src): `file` is the copy on disk, `src` its apcc-media URL, for formats the native decoder cannot read.
  const { showOpenDialog, makeImageThumbnail, captureVideoFrame, capturePoster, notify } = deps;
  const newRel = (folder, ext) => relPath(folder, `${randomUUID()}${ext}`);

  const q = {
    list: db.prepare(`
      SELECT id, filename, media_type AS mediaType, thumbnail_path AS thumbnailPath, uploaded_at AS uploadedAt
      FROM media_assets ORDER BY uploaded_at DESC, id DESC`),
    insert: db.prepare('INSERT INTO media_assets (filename, file_path, media_type) VALUES (?, ?, ?)'),
    setThumb: db.prepare('UPDATE media_assets SET thumbnail_path = ? WHERE id = ?'),
    byId: db.prepare('SELECT file_path AS filePath, thumbnail_path AS thumbnailPath FROM media_assets WHERE id = ?'),
    remove: db.prepare('DELETE FROM media_assets WHERE id = ?'),
    rename: db.prepare('UPDATE media_assets SET filename = ? WHERE id = ?'),
  };

  const toAsset = ({ thumbnailPath, ...row }) => ({
    ...row,
    src: `${MEDIA_SCHEME}://media/${row.id}`,
    thumbSrc: thumbnailPath ? `${MEDIA_SCHEME}://thumb/${row.id}` : null,
  });

  /**
   * Converts an .mkv to an .mp4 beside it, in the background. The MP4 becomes a new library item, and the original stays.
   * Nothing waits for this: the import has already finished, and the window is told when the MP4 is ready.
   */
  const startRemux = (sourceRel, sourceName) => {
    findFfmpeg()
      .then(async (ffmpeg) => {
        if (!ffmpeg) return;
        const rel = newRel('media', '.mp4');
        const out = resolveAsset(root, rel);
        try {
          await remuxToMp4(ffmpeg, resolveAsset(root, sourceRel), out);
        } catch (err) {
          console.warn(`[media] Could not convert ${sourceName} to MP4: ${err.message}`);
          await fs.promises.rm(out, { force: true });
          notify?.('remux-failed', sourceName);
          return;
        }
        const id = Number(q.insert.run(`${path.basename(sourceName, path.extname(sourceName))}.mp4`, rel, 'video').lastInsertRowid);
        const src = `${MEDIA_SCHEME}://media/${id}`;
        const jpeg = (await captureVideoFrame(src).catch(() => null)) ?? (await capturePoster().catch(() => null));
        if (jpeg) {
          const thumbRel = newRel('thumbnails', '.jpg');
          await fs.promises.writeFile(resolveAsset(root, thumbRel), jpeg);
          q.setThumb.run(thumbRel, id);
        }
        notify?.('changed', sourceName);
      })
      .catch((err) => console.warn(`[media] Background conversion failed: ${err.message}`));
  };

  return {
    list() {
      return q.list.all().map(toAsset);
    },

    /** Copies the chosen files in and thumbnails each one. A failed thumbnail never blocks the import. */
    async importMedia(win) {
      const picked = await showOpenDialog(win, { title: 'Import media', properties: ['openFiles', 'multiSelections'], filters: FILTERS });
      if (picked.canceled || picked.filePaths.length === 0) return { imported: 0, failed: [] };

      const failed = [];
      let imported = 0;
      let needsConverter = false;
      for (const source of picked.filePaths) {
        const name = path.basename(source);
        const ext = path.extname(source).toLowerCase();
        const mediaType = TYPE_BY_EXT[ext];
        if (!mediaType) {
          failed.push(name);
          continue;
        }

        const rel = newRel('media', ext);
        const dest = resolveAsset(root, rel);
        try {
          await fs.promises.copyFile(source, dest);
          const id = Number(q.insert.run(name, rel, mediaType).lastInsertRowid);
          imported += 1;
          const src = `${MEDIA_SCHEME}://media/${id}`;
          let jpeg = null;
          if (mediaType === 'video') {
            // A video always imports. If its frame cannot be read (a codec the app cannot decode, for example), a dark poster
            // stands in, and the import is not reported as a problem.
            jpeg = await captureVideoFrame(src).catch(() => null);
            jpeg ??= await capturePoster().catch(() => null);
          } else if (mediaType === 'image') {
            try {
              jpeg = await makeImageThumbnail(dest, src);
            } catch {
              failed.push(`${name} (no thumbnail)`);
            }
          }
          if (jpeg) {
            const thumbRel = newRel('thumbnails', '.jpg');
            await fs.promises.writeFile(resolveAsset(root, thumbRel), jpeg);
            q.setThumb.run(thumbRel, id);
          }
          // An .mkv converts in the background when ffmpeg is installed. Without it, the operator is told once.
          if (ext === '.mkv') {
            if (await findFfmpeg()) startRemux(rel, name);
            else needsConverter = true;
          }
        } catch {
          await fs.promises.rm(dest, { force: true });
          failed.push(name);
        }
      }
      return { imported, failed, notice: needsConverter ? MKV_NOTICE : null };
    },

    deleteMedia(id) {
      const row = q.byId.get(id);
      if (!row) return false;
      // The files go first. If one cannot be removed, the row stays, so the library still lists a file that is on disk.
      for (const rel of [row.filePath, row.thumbnailPath]) {
        const file = rel ? resolveAsset(root, rel) : null;
        if (file) fs.rmSync(file, { force: true });
      }
      q.remove.run(id);
      return true;
    },

    /** Renames the library item. The file on disk keeps its name, so only the label changes. */
    renameMedia(id, name) {
      const clean = String(name ?? '').trim();
      if (!clean || clean.length > 200) throw new Error('Name must be 1 to 200 characters.');
      if (q.rename.run(clean, id).changes === 0) throw new Error('That file is no longer in the library.');
      return true;
    },

    /** Opens the folder that holds the file, with the file selected. */
    revealMedia(id) {
      const row = q.byId.get(id);
      const file = row ? resolveAsset(root, row.filePath) : null;
      if (!file || !fs.existsSync(file)) throw new Error('That file is missing from the media folder.');
      shell.showItemInFolder(file);
      return true;
    },

    /** Relative paths for the protocol. The protocol resolves them against the open database's folder. */
    filePath(id) {
      return q.byId.get(id)?.filePath ?? null;
    },

    thumbPath(id) {
      return q.byId.get(id)?.thumbnailPath ?? null;
    },
  };
}

/** Registers `media:*` IPC, the `apcc-media://media|thumb` routes, and the thumbnailer. */
/**
 * Waits until the file can be opened for writing again. Windows keeps a file locked while the projector is still showing
 * it, so a delete that comes straight after a background clear waits here for the renderer to let go.
 */
async function waitForFileRelease(file) {
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(file, 'r+'));
      return;
    } catch (err) {
      if (err.code !== 'EBUSY' && err.code !== 'EPERM') return;
      if (Date.now() > deadline) throw new Error('This file is still open on the projector. Try again in a moment.');
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

/**
 * Registers `media:*` IPC. `releaseBackground(url)` is supplied by the main process: it clears the background layer when it
 * shows the file at `url`, and returns true when it did.
 */
export function setupMedia(db, { loadRoute, preload, releaseBackground }) {
  const root = getAssetRoot();

  const thumbnailer = createVideoThumbnailer({ loadRoute, preload });
  const service = createMediaService(db, root, {
    showOpenDialog: (win, options) => (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)),
    // PNG and JPEG decode natively. WebP does not, so the hidden renderer (which uses Chromium's decoder) draws it instead.
    makeImageThumbnail: async (file, src) => {
      const image = nativeImage.createFromPath(file);
      if (!image.isEmpty()) return image.resize({ width: THUMB_WIDTH }).toJPEG(82);
      return thumbnailer.capture(src, 'image');
    },
    captureVideoFrame: (src) => thumbnailer.capture(src, 'video'),
    capturePoster: () => thumbnailer.capture('', 'poster'),
    notify: (kind, name) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('media:event', { kind, name });
      }
    },
  });

  registerMediaRoute('media', (name) => service.filePath(Number(name)));
  registerMediaRoute('thumb', (name) => service.thumbPath(Number(name)));

  const handle = (channel, fn) =>
    ipcMain.handle(`media:${channel}`, (event, ...args) => fn(BrowserWindow.fromWebContents(event.sender), ...args));
  handle('list', () => service.list());
  handle('import', (win) => service.importMedia(win));
  handle('delete', async (_win, id) => {
    const mediaId = Number(id);
    // A file on the projector is cleared first, so the screen lets go of it. Then the delete waits for the file to be free.
    if (releaseBackground?.(`apcc-media://media/${mediaId}`)) {
      const file = service.filePath(mediaId);
      if (file) await waitForFileRelease(file);
    }
    return service.deleteMedia(mediaId);
  });
  handle('rename', (_win, id, name) => service.renameMedia(Number(id), name));
  handle('reveal', (_win, id) => service.revealMedia(Number(id)));

  return { close: () => thumbnailer.dispose() };
}

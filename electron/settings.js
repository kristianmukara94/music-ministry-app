import { BrowserWindow, ipcMain } from 'electron';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { DB_FILE_NAME, LANGUAGES, defaultDatabasePath, readConfig, resolveDatabasePath, validateRegistration, writeConfig } from './config.js';
import { titleBarOverlayFor } from '../shared/title-bar.js';
import { assetRootFor, getAssetRoot } from './assets.js';
import { compactTimestamp } from '../shared/backup-format.js';
import { measureStorage } from './full-backup.js';

const FOLDER_OPTIONS = (title) => ({ title, properties: ['openDirectory', 'createDirectory'] });

// Files copied at the same time. Enough to keep a network drive busy without flooding it.
const COPY_CONCURRENCY = 4;
// Progress is sent at most this often, so a folder of thousands of small files cannot flood IPC.
const PROGRESS_INTERVAL_MS = 80;

/** Opens a backup and checks it, so a bad copy is caught when it is made rather than during a Mass. */
function verifyBackup(file) {
  const copy = new Database(file, { readonly: true, fileMustExist: true });
  try {
    if (copy.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('The backup failed its integrity check.');
  } finally {
    copy.close();
  }
}

/** Every file under `dir`, as forward-slash paths relative to it. Async, so it never blocks the main thread. */
async function listFiles(dir) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  const walk = async (current, prefix) => {
    for (const entry of await fs.promises.readdir(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(current, entry.name), rel);
      else if (entry.isFile()) found.push(rel);
    }
  };
  await walk(dir, '');
  return found;
}

/**
 * Copies the files that are not already at the destination, a few at a time. Existing files
 * are never overwritten (COPYFILE_EXCL), so a re-run after an interruption just continues.
 */
async function copyMissing(fromRoot, toRoot, files, onCopied) {
  let next = 0;
  let copied = 0;
  const worker = async () => {
    while (next < files.length) {
      const rel = files[next++];
      const dst = path.join(toRoot, rel);
      await fs.promises.mkdir(path.dirname(dst), { recursive: true });
      try {
        await fs.promises.copyFile(path.join(fromRoot, rel), dst, fs.constants.COPYFILE_EXCL);
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
      }
      copied += 1;
      onCopied(rel);
    }
  };
  await Promise.all(Array.from({ length: Math.min(COPY_CONCURRENCY, files.length) }, worker));
}

/** Settings logic. The database handle and dialog are injected, so this can be tested without a window. */
export function createSettingsService({
  userData,
  getDb,
  getStatus,
  appVersion,
  showOpenDirectory,
  showItemInFolder = () => {},
  openPath = async () => '',
  // The full backup export or restore running in main.js, if any ('export' | 'restore' | null). A move waits for it.
  archiveJob = () => null,
}) {
  // A move is copying files. While it runs, no other move or backup may start, and quitting is refused.
  let moving = false;
  const databasePath = () => resolveDatabasePath(userData, readConfig(userData));

  /** Notes a backup the operator made, for the Last Backup badge. A failed note never fails the backup itself. */
  const recordBackup = (kind) => {
    try {
      writeConfig(userData, { last_backup: { at: new Date().toISOString(), kind } });
    } catch (err) {
      console.error('Could not record the backup time:', err);
    }
  };

  return {
    isMoving: () => moving,
    recordBackup,

    /** The database file's size and the media folder's size and file count, measured off the main thread's critical path. */
    storageStats() {
      return measureStorage({ dbPath: databasePath(), assetRoot: getAssetRoot() });
    },

    /** Shows the database file selected in Explorer. */
    revealDatabase() {
      const file = databasePath();
      if (!fs.existsSync(file)) throw new Error('The database file cannot be found at its saved location.');
      showItemInFolder(file);
    },

    /** Opens the media folder in Explorer, creating it if it is not there yet. */
    async openMediaFolder() {
      const root = getAssetRoot();
      fs.mkdirSync(root, { recursive: true });
      const error = await openPath(root);
      if (error) throw new Error(error);
    },

    get() {
      const config = readConfig(userData);
      // The Remote view PINs stay in the main process. The settings page is only told whether one is set (remoteView:get).
      const { remote_view: _remoteView, ...shown } = config;
      return {
        config: shown,
        databasePath: resolveDatabasePath(userData, config),
        defaultDatabasePath: defaultDatabasePath(userData),
        status: getStatus(),
        assetsPath: getAssetRoot(),
        version: appVersion,
      };
    },

    /** Saves the theme. The window applies it instantly; this makes it survive a restart. */
    setTheme(theme) {
      return writeConfig(userData, { theme }).theme;
    },

    setLanguage(lang) {
      if (!LANGUAGES.includes(lang)) throw new Error('Language must be English, Tagalog, or Cebuano.');
      return writeConfig(userData, { default_language: lang });
    },

    /**
     * Records the EULA acceptance and the church registration together, with the date of acceptance.
     * Acceptance is never written without a valid registration, and there is no way to un-accept it in the app.
     */
    acceptEula(registration) {
      const { church, location } = validateRegistration(registration);
      writeConfig(userData, {
        eula_accepted: true,
        registered_church: church,
        registered_location: location,
        registered_at: new Date().toISOString(),
      });
    },

    /** Changes the church and location on the registration. The date of the original acceptance is kept. */
    updateRegistration(registration) {
      const { church, location } = validateRegistration(registration);
      writeConfig(userData, { registered_church: church, registered_location: location });
    },

    /**
     * Points the app at a database folder (e.g. a mapped network drive). The database file and
     * the whole apccmma_assets folder are copied there, reporting progress as they go. The
     * change applies on the next start. If the target already holds a database, it is kept
     * and only missing media is copied in.
     */
    async changeLocation(win, onProgress = () => {}) {
      if (moving) throw new Error('A database move is already in progress.');
      if (archiveJob()) throw new Error('Wait for the full backup to finish before moving the database.');
      // Claimed before the folder picker opens, so a second request cannot slip in while the picker is up.
      moving = true;
      const picked = await showOpenDirectory(win, FOLDER_OPTIONS('Choose the folder for the APCCMMA database')).catch((err) => {
        moving = false;
        throw err;
      });
      if (picked.canceled || picked.filePaths.length === 0) {
        moving = false;
        return null;
      }

      const target = path.join(picked.filePaths[0], DB_FILE_NAME);
      const current = resolveDatabasePath(userData, readConfig(userData));
      if (path.resolve(target) === path.resolve(current)) {
        moving = false;
        return { changed: false, path: target };
      }

      try {
        const sourceRoot = getAssetRoot();
        const targetRoot = assetRootFor(target);
        const files = await listFiles(sourceRoot);
        const copyDatabase = !fs.existsSync(target);
        const total = files.length + (copyDatabase ? 1 : 0);

        let done = 0;
        let lastSent = 0;
        const report = (current, force = false) => {
          const now = Date.now();
          if (!force && now - lastSent < PROGRESS_INTERVAL_MS && done < total) return;
          lastSent = now;
          onProgress({ done, total, current });
        };
        report('', true);

        if (copyDatabase) {
          // SQLite's online backup copies a consistent snapshot, even though the app is open.
          await getDb().backup(target);
          done += 1;
          report(DB_FILE_NAME, true);
        }

        await copyMissing(sourceRoot, targetRoot, files, (rel) => {
          done += 1;
          report(rel);
        });
        report('', true);

        writeConfig(userData, { database_path: target });
        return { changed: true, path: target, files: files.length };
      } finally {
        moving = false;
      }
    },

    /**
     * Quick DB Snapshot: copies the live database (apccmma.db only, no media) to a folder as apccmma-db-snapshot-YYYYMMDD-HHMMSS.db in
     * local time, then verifies the copy. A copy that fails the check is removed.
     */
    async backup(win) {
      if (moving) throw new Error('Wait for the database move to finish before making a backup.');
      const picked = await showOpenDirectory(win, FOLDER_OPTIONS('Choose a folder for the database snapshot'));
      if (picked.canceled || picked.filePaths.length === 0) return null;

      const dest = path.join(picked.filePaths[0], `apccmma-db-snapshot-${compactTimestamp()}.db`);
      // SQLite's online backup API copies a consistent snapshot even while the app is writing.
      await getDb().backup(dest);
      try {
        verifyBackup(dest);
      } catch (err) {
        fs.rmSync(dest, { force: true });
        throw err;
      }
      recordBackup('snapshot');
      return { path: dest };
    },
  };
}

/** Registers the `config:*` IPC channels. Called once from the main process. */
export function setupSettings(deps) {
  const service = createSettingsService(deps);
  const handle = (channel, fn) =>
    ipcMain.handle(`config:${channel}`, (event, ...args) => fn(BrowserWindow.fromWebContents(event.sender), ...args));

  handle('get', () => service.get());
  handle('setLanguage', (_win, lang) => service.setLanguage(lang));
  // The title-bar buttons take the new theme's colours at once, so they match the top bar without a restart. Every other open
  // window (a slide editor, say) is told too, and repaints with the same calibrated colours.
  handle('setTheme', (win, theme) => {
    const saved = service.setTheme(theme);
    // The website follows the laptop's theme (electron/theme-sync.js). A failure there must never fail the save.
    try {
      deps.onThemeSaved?.(saved);
    } catch {
      /* the theme sync retries on its own */
    }
    for (const other of BrowserWindow.getAllWindows()) {
      if (other.isDestroyed()) continue;
      // Frameless output windows have no overlay and Electron throws for them; the save must not fail because of that.
      if (process.platform === 'win32') {
        try {
          other.setTitleBarOverlay?.(titleBarOverlayFor(saved));
        } catch {
          /* no title-bar overlay on this window */
        }
      }
      if (other !== win) other.webContents.send('config:themeChanged', saved);
    }
    return saved;
  });
  handle('acceptEula', (_win, registration) => service.acceptEula(registration));
  handle('updateRegistration', (_win, registration) => service.updateRegistration(registration));
  // Progress goes back to the window that asked, so only the Settings page sees it.
  ipcMain.handle('config:changeLocation', (event) =>
    service.changeLocation(BrowserWindow.fromWebContents(event.sender), (progress) =>
      event.sender.send('config:migrationProgress', progress),
    ),
  );
  handle('backup', (win) => service.backup(win));
  handle('storageStats', () => service.storageStats());
  handle('revealDatabase', () => service.revealDatabase());
  handle('openMediaFolder', () => service.openMediaFolder());

  return service;
}

import { app, BrowserWindow, ipcMain, Notification } from 'electron';
import { execFile } from 'node:child_process';
// Default import, then destructure: electron-updater defines autoUpdater as a getter, which ESM named imports cannot see.
import electronUpdater from 'electron-updater';
import { readConfig, UPDATE_CHANNELS, writeConfig } from './config.js';

const { autoUpdater } = electronUpdater;

// The repository releases are published to. Must match build.publish in package.json.
const REPO = 'kristianmukara94/music-ministry-app';
const HISTORY_COUNT = 5;
const HISTORY_CACHE_MS = 10 * 60 * 1000;
const REMIND_LATER_MS = 24 * 60 * 60 * 1000;
// The launch check waits so it does not compete with the windows opening.
const LAUNCH_CHECK_DELAY_MS = 15 * 1000;
const METERED_CHECK_TIMEOUT_MS = 5 * 1000;
// The most release-note text sent to the page. Longer notes end with an ellipsis.
const NOTES_LIMIT = 4000;

// Windows reports how a connection is billed. NetworkCostType 2 (Fixed) and 3 (Variable) are metered.
// Electron has no API for this, so it is read through WinRT in PowerShell.
const METERED_SCRIPT = [
  '$p = [Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]::GetInternetConnectionProfile()',
  'if ($null -eq $p) { "Unknown" } elseif ($p.GetConnectionCost().NetworkCostType -in 2,3) { "Metered" } else { "Unmetered" }',
].join('; ');

/** The fields the page needs from a release, whatever the update event carried. */
function updateInfo(info) {
  return { version: info.version, releaseDate: info.releaseDate ?? null, notes: summarizeNotes(info.releaseNotes) };
}

/**
 * Release notes arrive as plain text, one entry per version, or HTML. The page shows them as plain text with their line
 * breaks kept: tags and link targets are removed, so nothing from the notes is rendered as markup.
 */
function summarizeNotes(notes) {
  const text = Array.isArray(notes) ? notes.map((entry) => entry.note ?? '').join('\n\n') : (notes ?? '');
  const plain = String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|li|ul|ol|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return plain.length > NOTES_LIMIT ? `${plain.slice(0, NOTES_LIMIT - 3).trimEnd()}...` : plain;
}

/** Resolves true only when Windows reports a metered connection. Any failure counts as unmetered, so a broken check never blocks an update. */
function isMeteredConnection() {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    const args = ['-NoProfile', '-NonInteractive', '-Command', METERED_SCRIPT];
    execFile('powershell.exe', args, { timeout: METERED_CHECK_TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
      if (err) console.warn('[updater] could not read the connection cost:', err.message);
      resolve(!err && stdout.trim() === 'Metered');
    });
  });
}

let historyCache = null;

/** The last few published releases, newest first. Cached briefly so opening Settings does not hit GitHub's rate limit. */
async function getReleaseHistory() {
  if (historyCache && Date.now() - historyCache.at < HISTORY_CACHE_MS) return historyCache.releases;
  const url = `https://api.github.com/repos/${REPO}/releases?per_page=${HISTORY_COUNT}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'APCCMMA-Updater' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`GitHub answered with status ${res.status}.`);
  const releases = (await res.json())
    .filter((release) => !release.draft)
    .slice(0, HISTORY_COUNT)
    .map((release) => ({
      name: release.name || release.tag_name,
      tag_name: release.tag_name,
      published_at: release.published_at,
      body: release.body ?? '',
      prerelease: release.prerelease === true,
    }));
  historyCache = { at: Date.now(), releases };
  return releases;
}

/**
 * Wires the updater into the main process: lifecycle events, the launch check, notifications,
 * and the IPC handlers the Settings page calls.
 */
export function setupUpdater({ userData }) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = readConfig(userData).update_channel === 'beta';

  let lastEvent = null;
  let lastCheckedAt = null;
  // True while a check or download the operator asked for is running. Only those reach the page; a launch check stays quiet.
  let userInitiated = false;

  const settings = () => {
    const config = readConfig(userData);
    return { channel: config.update_channel, skippedVersion: config.skipped_version, pauseOnMetered: config.pause_on_metered };
  };

  function publish(channel, payload) {
    lastEvent = { channel, payload };
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  }

  function publishError(err) {
    publish('UPDATE_ERROR', { message: err?.message ?? String(err) });
  }

  function notify(title, body) {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  }

  autoUpdater.on('checking-for-update', () => {
    if (userInitiated) publish('UPDATE_CHECKING');
  });

  autoUpdater.on('update-available', (info) => {
    lastCheckedAt = Date.now();
    if (userInitiated) {
      publish('UPDATE_AVAILABLE', updateInfo(info));
      return;
    }
    // A launch check stays quiet for a version the operator skipped, and until a "remind me later" period ends.
    const config = readConfig(userData);
    if (config.skipped_version === info.version) return;
    if (config.remind_after && Date.now() < config.remind_after) return;
    publish('UPDATE_AVAILABLE', updateInfo(info));
    notify('APCCMMA update available', `Version ${info.version} can be downloaded from Settings → Updates.`);
  });

  autoUpdater.on('update-not-available', (info) => {
    lastCheckedAt = Date.now();
    if (userInitiated) publish('UPDATE_NOT_AVAILABLE', { version: info.version });
  });

  autoUpdater.on('download-progress', (progress) =>
    publish('UPDATE_PROGRESS', {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    }),
  );

  autoUpdater.on('update-downloaded', (info) => {
    publish('UPDATE_DOWNLOADED', updateInfo(info));
    notify('APCCMMA update ready', `Version ${info.version} is downloaded. Restart from Settings → Updates to finish installing.`);
  });

  autoUpdater.on('error', (err) => {
    if (userInitiated) publishError(err);
    else console.warn('[updater] background check failed:', err?.message ?? err);
  });

  async function check() {
    userInitiated = true;
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      publishError(err);
    }
  }

  ipcMain.handle('CHECK_FOR_UPDATES', () => {
    // A development run has no installed release to compare against, so a check says so instead of waiting forever.
    if (!app.isPackaged) return publishError(new Error('Updates can only be checked in the installed app.'));
    return check();
  });

  // The operator's choice to download anyway is passed as `force`, which skips the metered-connection pause once.
  ipcMain.handle('START_UPDATE_DOWNLOAD', async (_event, options) => {
    userInitiated = true;
    try {
      if (!options?.force && readConfig(userData).pause_on_metered && (await isMeteredConnection())) {
        publish('UPDATE_PAUSED', { reason: 'metered' });
        return;
      }
      await autoUpdater.downloadUpdate();
    } catch (err) {
      publishError(err);
    }
  });

  ipcMain.handle('RESTART_AND_INSTALL_UPDATE', () => autoUpdater.quitAndInstall());

  ipcMain.handle('UPDATES_GET_STATE', () => ({ last: lastEvent, lastCheckedAt, settings: settings() }));

  ipcMain.handle('updater:set-channel', (_event, channel) => {
    if (!UPDATE_CHANNELS.includes(channel)) throw new Error('The channel must be stable or beta.');
    writeConfig(userData, { update_channel: channel });
    // Beta includes pre-releases. Stable ignores them.
    autoUpdater.allowPrerelease = channel === 'beta';
  });

  ipcMain.handle('updater:skip-version', (_event, version) => {
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+/.test(version.trim())) throw new Error('Skipping needs a version number.');
    writeConfig(userData, { skipped_version: version.trim() });
  });

  ipcMain.handle('updater:remind-later', () => {
    writeConfig(userData, { remind_after: Date.now() + REMIND_LATER_MS });
  });

  ipcMain.handle('updater:set-pause-on-metered', (_event, enabled) => {
    writeConfig(userData, { pause_on_metered: enabled === true });
  });

  ipcMain.handle('updater:get-history', () => getReleaseHistory());

  // One check shortly after launch, so a new release is noticed without opening Settings. Packaged builds only.
  if (app.isPackaged) {
    setTimeout(() => {
      userInitiated = false;
      autoUpdater.checkForUpdates().catch((err) => console.warn('[updater] launch check failed:', err.message));
    }, LAUNCH_CHECK_DELAY_MS);
  }
}

import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, screen, session, shell } from 'electron';
// First of the app's own modules: in the packaged app it refuses debugging flags before anything else is loaded (see anti-tamper.js).
import { SECURE_WEB_PREFERENCES, setupAntiTamper } from './anti-tamper.js';
import { createCloudDevice } from './cloud-device.js';
import { createSongSync, SONG_ROWS_SQL } from './song-sync.js';
import { createPlanSync } from './plan-sync.js';
import { createPlanSyncStore } from './plan-sync-store.js';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialLiveState, liveReducer, OUTPUTS } from '../shared/live.js';
import Database from 'better-sqlite3';
import { SCHEMA_VERSION, openDatabase, setupAnnouncements } from './announcements.js';
import { DB_FILTERS, backupFileName, exportBackup, importBackup } from './database-backup.js';
import { databaseCounts } from './db-check.js';
import { backupsDirFor, incrementalVacuum, listBackups, recoverDatabase, takeDailyBackup } from './db-backup-manager.js';
import { createHealthReader, createWriteMeter } from './system-health.js';
import { purgeDeletedHymns, setupLyrics } from './lyrics.js';
import { setupSpontaneousLog } from './spontaneous-log.js';
import { announceMassOrderChange, setupMassOrderTexts } from './mass-order.js';
import { registerLyricsImport } from './lyrics-import.js';
import { NOTE_SEALED_FIELDS, setupNotes } from './notes.js';
import { createDbVault } from './db-vault.js';
import { setupWhiteboard } from './whiteboard.js';
import { setupLectionary } from './lectionary.js';
import { setupMedia } from './media.js';
import { setupMassPlans } from './mass-plans.js';
import { setupPwSessions } from './pw-sessions.js';
import { seedBible } from './bible-seed.js';
import { setupBible } from './bible.js';
import { seedRosary, setupRosary } from './rosary.js';
import { queueFromPlanItems, readQueueState, writeQueueState } from './queue-state.js';
import { openSessionStore } from './session-store.js';
import { createSessionWriter, restoreSession } from '../shared/session-recovery.js';
import { defaultDatabasePath, PREVIEW_MIN, readConfig, resolveDatabasePath, writeConfig } from './config.js';
import { resolveCloudAddress, saveCloudAddress } from './cloud-address.js';
import { setupSettings } from './settings.js';
import { titleBarOverlayFor } from '../shared/title-bar.js';
import { sanitizeProjectorSettings } from '../shared/projector-settings.js';
import { sanitizeWelcomeSettings } from '../shared/welcome-settings.js';
import { sanitizeLowerThirdStyle } from '../shared/lower-third-style.js';
import { createLowerThirdServer, LOWER_THIRD_PORT, lanAddress } from './lower-third-server.js';
import { createRemoteViewServer, localNetworkAddress, networkInfo } from './remote-view-server.js';
import { mediaFileFor, slideFileFor } from './protocol.js';
import {
  REMOTE_DEVICE_LIMIT,
  REMOTE_HOTSPOT_WARN_ABOVE,
  REMOTE_ROLES,
  controlAction,
  remoteViewSnapshot,
  secondaryViewSnapshot,
  sanitizeRemoteView,
  validateRemoteViewPatch,
} from '../shared/remote-view.js';
import { setupUpdater } from './updater.js';
import { ALERT_TOGGLE_CHANNEL, attachAppHotkeys, attachFailoverHotkey } from './hotkeys.js';
import { createSanctuaryWatchdog, PONG_CHANNEL, sanitizeFailoverMode, STATUS_CHANNEL } from './watchdog.js';
import { createFailoverSurface, FAILOVER_PAINTED_CHANNEL } from './windows.js';
import { createEdidWatchdog, loadDisplayMatrix, WM_DISPLAYCHANGE } from './edid-watchdog.js';
import { enforceHardwareLock } from './hardware-id.js';
import { createAlertExpiry } from './sanctuary-alert.js';
import { applyImport, checkExportOptions, collectLibrary, decodeTransfer, defaultExportName, encodeTransfer, previewImport, TRANSFER_EXTENSION } from './transfer.js';
import { isOwnPage, lockDownContents, restrictPermissions } from './web-lockdown.js';
import { checkLaunchTarget, LAUNCH_REFUSED_DETAIL } from './launch-target.js';
import os from 'node:os';

// Sanctuary hardware lock, before anything else runs: the packaged app's userData must be on the PC it was activated on. A copied folder
// shows "Unapproved Sanctuary Hardware" and exits with code 1 before the database is opened (see hardware-id.js).
enforceHardwareLock();

// Windows needs this to show notifications under the app's name. It must match build.appId in package.json.
app.setAppUserModelId('com.apccmma.churchapp');

// Not called __dirname: the release build makes this file a CommonJS module, where that name is already taken.
const appDir = path.dirname(fileURLToPath(import.meta.url));
// In development the windows load the Vite dev server. The URL comes from the environment the dev script sets, and falls back to Vite's default
// port when the app is unpackaged and there is no built copy to load, so a relaunch still finds the server. The installed app never looks at
// this: an environment variable must not be able to point its windows, with their full bridge to the main process, at another page.
const DEV_URL = app.isPackaged
  ? null
  : process.env.VITE_DEV_SERVER_URL || (!fs.existsSync(path.join(appDir, '../dist/index.html')) ? 'http://localhost:5173' : null);

// Every page the app creates, from now on, stays on the app's own page and opens no other windows (see web-lockdown.js).
app.on('web-contents-created', (_event, contents) => {
  lockDownContents(contents, { isAllowed: (url) => isOwnPage(url, { devUrl: DEV_URL, entryFile: path.join(appDir, '../dist/index.html') }) });
});

// Failures that mean the page is not reachable yet (the dev server still starting, a network not up). A missing file is not retried.
const RETRY_ERRORS = new Set([-102, -105, -106, -109]); // connection refused, name not resolved, internet disconnected, address unreachable
const RETRY_LIMIT = 15;
const RETRY_MS = 1000;

// The parish logo. Windows uses the .ico (taskbar and window frame); elsewhere the .png.
// Missing files fall back to Electron's default icon rather than failing to start.
const ICON_PATH = path.join(appDir, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const APP_ICON = fs.existsSync(ICON_PATH) ? ICON_PATH : undefined;

// The main process owns the authoritative live state. Every window is a view of it.
let state = initialLiveState();
let announcements = null;
let media = null;
let settings = null;
// What the Settings page and the sidebar badge report about the database.
let dbStatus = { connected: false, path: null, fallback: false, error: null };
const windows = { operator: null, projector: null, lowerThird: null, preview: null };

const ROUTES = { projector: 'projector', lowerThird: 'lower-third', preview: 'preview' };

// The slide editors: one window per Whiteboard slide being edited, keyed by the slide's id. They are views of the live state like any other
// window, so they are told of every change to it.
const editorWindows = new Map();

/** Tells every open window that a Whiteboard slide or folder changed, so a list on screen in any of them reloads. */
function announceWhiteboardChange() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('whiteboard:changed');
  }
}

/**
 * Opens a slide in its own editor window, or brings the open one forward. The window is an ordinary one, so it can be moved, resized and put on
 * another screen. Closing it first asks the page to write any change still waiting; the window goes when the page says so, or after a moment.
 */
function openSlideEditor(slideId) {
  const existing = editorWindows.get(slideId);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return;
  }
  // The window opens near the operator's, nudged for each one already open, so several do not sit exactly on top of each other.
  const anchor = windows.operator && !windows.operator.isDestroyed() ? windows.operator.getBounds() : null;
  const nudge = 28 * editorWindows.size;
  const win = new BrowserWindow({
    width: 1180,
    height: 840,
    minWidth: 820,
    minHeight: 600,
    ...(anchor ? { x: anchor.x + 70 + nudge, y: anchor.y + 50 + nudge } : {}),
    show: false,
    backgroundColor: '#100306',
    title: 'APCCMMA — Edit slide',
    icon: APP_ICON,
    autoHideMenuBar: true,
    webPreferences,
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());
  editorWindows.set(slideId, win);

  let closing = false;
  win.on('close', (event) => {
    if (closing || win.isDestroyed()) return;
    event.preventDefault();
    closing = true;
    const finish = () => {
      clearTimeout(timer);
      if (!win.isDestroyed()) win.destroy();
    };
    const timer = setTimeout(finish, 3000);
    win.once('editor-flushed', finish);
    win.webContents.send('editor:flush');
  });
  win.on('closed', () => {
    editorWindows.delete(slideId);
    // The operator window is gone and was waiting on this one: the app can now quit.
    if (!windows.operator) app.quit();
  });
  load(win, `editor/${slideId}`);
}

/**
 * The editor page asks for its window to be closed. It goes through the window's own close, so the save-before-closing step runs. A page that
 * closes itself with `window.close()` is closed at once by Electron, with no close event, and would lose a change still waiting to be saved.
 */
ipcMain.on('editor:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

/** The editor page says its pending changes are written. */
ipcMain.on('editor:flushed', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.emit('editor-flushed');
});

ipcMain.handle('whiteboard:openEditor', (_event, slideId) => {
  const id = Number(slideId);
  if (!Number.isInteger(id) || id < 1) return false;
  openSlideEditor(id);
  return true;
});

const webPreferences = {
  ...SECURE_WEB_PREFERENCES,
  preload: path.join(appDir, 'preload.cjs'),
};

function load(win, route) {
  const target = DEV_URL ? `${DEV_URL}#/${route}` : null;
  let retries = 0;
  // A window that fails to load says so in the console, so a blank screen can be traced to its cause. A dev server that is not up yet is
  // tried again each second, for a while, so the window fills in once the server answers.
  win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    console.error(`[window ${route}] failed to load ${url}: ${description} (${code})`);
    if (!target || !isMainFrame || !RETRY_ERRORS.has(code) || retries >= RETRY_LIMIT) return;
    retries += 1;
    console.warn(`[Window Load Warning]: ${description} (${code}) at ${url}. Retrying in ${RETRY_MS / 1000}s (${retries} of ${RETRY_LIMIT})...`);
    setTimeout(() => {
      if (!win.isDestroyed()) win.loadURL(target);
    }, RETRY_MS);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[window ${route}] its renderer stopped: ${details.reason}`);
  });
  if (DEV_URL) win.loadURL(`${DEV_URL}#/${route}`);
  else win.loadFile(path.join(appDir, '../dist/index.html'), { hash: `/${route}` });
}

/**
 * The display the projector opens on. Pinned to a physical monitor (the EDID lock): that monitor's display, or null when it is not connected
 * or has become the operator's screen, and then the projector opens hidden. Otherwise: the one chosen in Settings if still connected, else
 * the first external one, else the primary.
 */
function targetDisplay() {
  const locked = edid?.target('projector');
  if (locked?.locked && !locked.pending) {
    if (!locked.display) console.warn(`[projector] its pinned monitor is ${locked.reason === 'primary' ? 'the operator screen' : 'not connected'}; it opens hidden.`);
    return locked.display;
  }
  const chosen = screen.getAllDisplays().find((d) => d.id === state.settings.displayId);
  if (state.settings.displayId != null && !chosen) {
    console.warn(`[projector] display ${state.settings.displayId} is not connected. Using the default display instead.`);
  }
  return chosen ?? externalDisplay() ?? screen.getPrimaryDisplay();
}

/**
 * The display the lower-third window may open on: the one chosen in Settings, only while it is connected and is not the primary display.
 * The primary display is where the operator console runs, so the window never opens there. With no such display the window stays closed,
 * and the lower third still shows on the projector and in the OBS browser source.
 */
function lowerThirdDisplay() {
  const target = state.lowerStyle.target;
  if (target == null) return null;
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().find((d) => d.id === target && d.id !== primaryId) ?? null;
}

function externalDisplay() {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().find((d) => d.id !== primary.id) ?? null;
}

/** How long the preview window must stay still before its position is saved. */
const PREVIEW_BOUNDS_DELAY_MS = 400;
/** The projector layout is designed for a 1920x1080 page. The mirror is zoomed to that page width. */
const PREVIEW_STAGE_WIDTH = 1920;
/** A session of its own for the mirror, so its zoom never applies to the console or the projector. */
const MIRROR_PARTITION = 'mirror';
let previewBoundsTimer = null;

/**
 * The preview's saved rectangle, if any part of it still lands on a connected screen. A saved position
 * from a monitor that has since been unplugged would open off-screen, so it is ignored and the default is used.
 */
function savedPreviewBounds() {
  const saved = readConfig(app.getPath('userData')).preview_window_bounds;
  if (!saved) return null;
  const overlaps = (area) =>
    saved.x < area.x + area.width && saved.x + saved.width > area.x && saved.y < area.y + area.height && saved.y + saved.height > area.y;
  return screen.getAllDisplays().some((d) => overlaps(d.workArea)) ? saved : null;
}

/** Writes the preview's rectangle to config.json. Minimised, maximised and full-screen states are not saved. */
function persistPreviewBounds(win) {
  if (win.isDestroyed() || win.isMinimized() || win.isMaximized() || win.isFullScreen()) return;
  try {
    writeConfig(app.getPath('userData'), { preview_window_bounds: win.getBounds() });
  } catch (err) {
    console.error('Could not save the preview window position:', err);
  }
}

/** Debounced: a drag fires many move events, and only the resting position is written. */
function schedulePreviewBoundsSave(win) {
  clearTimeout(previewBoundsTimer);
  previewBoundsTimer = setTimeout(() => persistPreviewBounds(win), PREVIEW_BOUNDS_DELAY_MS);
}

/**
 * The operator mirror, also the booth's confidence monitor (Detach Monitor on a live console's Outputs panel). It is pinned above the operator
 * console and never steals focus on open, so clicking around the console leaves it where it is. It stays until the PREVIEW button, or its own
 * close button, closes it. It has no frame: the page is the drag handle, and the window edges still resize it.
 */
function openPreviewWindow() {
  const saved = savedPreviewBounds();
  const win = new BrowserWindow({
    ...(saved ?? { width: 640, height: 360 }),
    minWidth: PREVIEW_MIN.width,
    minHeight: PREVIEW_MIN.height,
    frame: false,
    resizable: true,
    maximizable: false,
    show: false,
    backgroundColor: '#000000',
    title: 'APCCMMA — Operator Mirror',
    autoHideMenuBar: true,
    icon: APP_ICON,
    webPreferences: { ...webPreferences, partition: MIRROR_PARTITION },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  // The mirror shows the projector layout at window scale: the window stays 16:9 and its page is zoomed
  // so that 1 vw and 1 vh match the projector's. Text then wraps and fits exactly as it does on screen.
  win.setAspectRatio(16 / 9);
  const fitStage = () => {
    if (!win.isDestroyed()) win.webContents.setZoomFactor(win.getContentSize()[0] / PREVIEW_STAGE_WIDTH);
  };
  win.on('resize', fitStage);
  win.webContents.on('did-finish-load', fitStage);
  // Shown without activating, so opening the mirror does not pull focus away from the console.
  win.once('ready-to-show', () => win.showInactive());
  win.on('move', () => schedulePreviewBoundsSave(win));
  win.on('resize', () => schedulePreviewBoundsSave(win));
  // Closing saves at once, so a move made just before closing is not lost to the debounce.
  win.on('close', () => {
    clearTimeout(previewBoundsTimer);
    persistPreviewBounds(win);
  });
  return win;
}

/** True when a live frame holds something the operator chose: a verse, a Mass Queue item, a slide or an announcement. */
function holdsContent(frame) {
  if (!frame || ['idle', 'blackout', 'welcome'].includes(frame.kind)) return false;
  if (frame.kind === 'lyrics') return frame.text.trim() !== '';
  return true;
}

/**
 * Shows the chosen startup screen when the projector window opens. "Last content" keeps whatever was live. A live frame
 * with content is kept too, so turning the projector on shows what the operator chose, not the welcome screen. After a crash, the
 * recovered session's frame is kept whatever it is (Blackout or the welcome screen over a Mass slide included).
 */
function applyStartupScreen() {
  const mode = state.settings.startupScreen;
  const recovered = skipStartupScreen;
  skipStartupScreen = false;
  if (recovered || holdsContent(state.projector.live)) {
    // Staging the frame that is already staged changes nothing on screen. It still counts as the startup step, which the
    // startup helper in the renderer waits for before it takes a Mass Queue or Praise & Worship item.
    apply({ type: 'projector/stage', frame: state.projector.staged });
    return;
  }
  if (mode === 'welcome') {
    apply({ type: 'projector/show', frame: { kind: 'welcome', lang: readConfig(app.getPath('userData')).default_language } });
  } else if (mode === 'black') {
    apply({ type: 'projector/show', frame: { kind: 'blackout' } });
  }
}

// The sanctuary display watchdog (electron/watchdog.js). The failover surface is a hidden window kept over the projector; a crashed, frozen or
// hung projector page is covered by it at once and restarted behind it. Every window hears its status, for the Go Live badge.
const failoverSurface = createFailoverSurface({ BrowserWindow, webPreferences, load, icon: APP_ICON });
// The EDID lock (electron/edid-watchdog.js). Created once the app is ready, as it reads the screens.
let edid = null;
const watchdog = createSanctuaryWatchdog({
  failover: failoverSurface,
  screen,
  preferredDisplayId: () => state.settings.displayId,
  lockedTarget: () => edid?.target('projector') ?? { locked: false },
  onReanchor: (displayId) => edid?.reanchored(displayId),
  onStatus: (status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(STATUS_CHANNEL, status);
    }
  },
});

const createOutput = {
  // Congregation screen. It opens on the display chosen in Settings (or the first external one). It is
  // fullscreen only on an external projector, and only when the setting asks for it; otherwise a windowed preview.
  projector: () => {
    const target = targetDisplay();
    // Pinned, and its monitor is not connected: the window opens hidden, with the slides running, and appears when the monitor returns.
    // It never falls back to the operator's screen.
    const parked = !target;
    const host = target ?? screen.getPrimaryDisplay();
    const b = host.bounds;
    const fullscreen = !parked && state.settings.fullscreen && host.id !== screen.getPrimaryDisplay().id;
    const win = new BrowserWindow({
      x: b.x + (fullscreen ? 0 : 80),
      y: b.y + (fullscreen ? 0 : 80),
      width: fullscreen ? b.width : 1280,
      height: fullscreen ? b.height : 720,
      fullscreen,
      show: !parked,
      frame: false,
      backgroundColor: '#000000',
      title: 'APCCMMA — Projector',
      icon: APP_ICON,
      webPreferences,
    });
    // A projector window must be seen the moment it opens: show it, bring it forward, and keep it above other windows. Unless its monitor
    // went away while it loaded.
    win.once('ready-to-show', () => {
      if (watchdog.status().parked) return;
      win.show();
      win.focus();
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    // A parked window comes back fullscreen if Settings asks for it.
    watchdog.attachProjector(win, { displayId: target?.id ?? null, fullscreen: parked ? state.settings.fullscreen : fullscreen, parked });
    console.log(parked ? '[projector] opened hidden: its pinned monitor is not available' : `[projector] opened on display ${target.id}, ${fullscreen ? 'fullscreen' : 'windowed'}`);
    // Set once the window is registered, so the window step does not open a second one.
    setImmediate(applyStartupScreen);
    return win;
  },
  // The lower third on its own screen, for a second projector or a stream. Transparent, so only the bar shows.
  lowerThird: () => {
    // reconcileWindows opens this window only when lowerThirdDisplay() has a display for it. The primary display is never a fallback.
    const display = lowerThirdDisplay();
    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      title: 'APCCMMA — Lower third',
      icon: APP_ICON,
      webPreferences,
    });
    win.setIgnoreMouseEvents(true);
    watchdog.attachLowerThird(win);
    return win;
  },
  // Confidence monitor for the booth / stage.
  preview: () => openPreviewWindow(),
};

function reconcileWindows() {
  for (const key of OUTPUTS) {
    const win = windows[key];
    const wanted = state.outputs[key];
    // The lower-third window needs a display other than the primary one. Without it nothing opens, and the output is switched off again.
    if (key === 'lowerThird' && wanted && !win && !lowerThirdDisplay()) {
      console.warn('[lower third] no display other than the primary one is chosen or connected, so no window opens.');
      setImmediate(() => apply({ type: 'output/set', output: 'lowerThird', on: false }));
      continue;
    }
    // Outputs without a window creator (the lower third now draws on the projector) never open a window.
    if (wanted && !win && createOutput[key]) {
      const created = createOutput[key]();
      windows[key] = created;
      created.on('closed', () => {
        windows[key] = null;
        if (state.outputs[key]) apply({ type: 'output/set', output: key, on: false });
      });
      load(created, ROUTES[key]);
    } else if (!wanted && win) {
      win.close();
    }
  }
}

// The browser source's server, started once the app is ready.
let lowerThirdServer = null;
// Whether the browser source server is listening. A port already in use leaves it off, which the dashboard's readiness check reports.
let lowerThirdServerUp = false;

/**
 * Makes the lower-third window match the chosen display. A window already open moves to that display. Choosing
 * a display with no window opens one; choosing no display closes it.
 */
function placeLowerThirdWindow() {
  const display = lowerThirdDisplay();
  if (!display) {
    // No display chosen, the chosen one is unplugged, or it is the primary display: the window closes, and stays closed.
    if (state.outputs.lowerThird) apply({ type: 'output/set', output: 'lowerThird', on: false });
    return;
  }
  const win = windows.lowerThird;
  if (win && !win.isDestroyed()) {
    win.setBounds(display.bounds);
    return;
  }
  apply({ type: 'output/set', output: 'lowerThird', on: true });
}

const REMOTE_NO_NETWORK = 'No WiFi or local network was found. Connect this laptop to the same WiFi as the phones. The page starts by itself once a network is found.';
const ACTIVITY_LIMIT = 30;
/** The two viewers' pages. Each is its own server on its own port: Primary controls the output, Secondary only watches. */
const remoteViews = {
  primary: createRemoteViewServer({
    distDir: path.join(appDir, '../dist'),
    role: 'primary',
    canConnect: canAcceptPhone,
    onControl: controlFromPhone,
    slideFile: slideFileFor,
    // The TV page's port, from the saved Secondary viewer settings, so the helper page links to the right address.
    tvPort: () => readConfig(app.getPath('userData')).remote_view.secondary.port,
  }),
  secondary: createRemoteViewServer({ distDir: path.join(appDir, '../dist'), role: 'secondary', canConnect: canAcceptPhone, mediaFile: mediaFileFor, slideFile: slideFileFor }),
};
// Why each viewer is not running when it is turned on. Null when it runs, or when it is off.
const remoteViewErrors = { primary: null, secondary: null };
// Control actions phones have sent, newest last. Kept for the session only, so the operator can see who changed the slide.
const remoteActivity = [];

/** Phones with a viewer open, across both viewers. Past the limit, new phones are turned away. */
function phonesConnected() {
  return REMOTE_ROLES.reduce((total, role) => total + remoteViews[role].devices(), 0);
}

function canAcceptPhone() {
  return phonesConnected() < REMOTE_DEVICE_LIMIT;
}

function describeControl(request) {
  if (request?.action === 'next') return 'Next slide';
  if (request?.action === 'previous') return 'Previous slide';
  if (request?.action === 'jump') return `Jump to slide ${Number(request.index) + 1}`;
  return 'Unknown control';
}

/**
 * A control request from the Primary viewer. It goes through the same paths as the operator: the action is the one the
 * arrow keys send, and it is refused while the projector is paused. Every attempt is recorded, allowed or not.
 */
function controlFromPhone(request, device) {
  const result = controlAction(state, request);
  if (result.ok && result.action) apply(result.action);
  remoteActivity.push({
    at: Date.now(),
    device: `${device.label} (${device.ip})`,
    action: describeControl(request),
    ok: result.ok,
    error: result.ok ? null : result.error,
  });
  if (remoteActivity.length > ACTIVITY_LIMIT) remoteActivity.shift();
  return result;
}

/**
 * Makes one viewer's page match its settings. It starts when it is on and a network is found, and stops when it is off
 * or when the laptop's network address has changed, so it never serves an address phones cannot reach.
 */
/** What a Remote view port shows: the Secondary port follows the secondary display, the Primary port the projector. */
function snapshotFor(role, live) {
  return role === 'secondary' ? secondaryViewSnapshot(live) : remoteViewSnapshot(live);
}

async function syncRemoteViewRole(role, wanted, address) {
  const view = remoteViews[role];
  if (view.running() && view.address() !== address) await view.stop();
  if (!wanted.enabled) {
    remoteViewErrors[role] = null;
    return;
  }
  if (!address) {
    remoteViewErrors[role] = REMOTE_NO_NETWORK;
    return;
  }
  if (view.running()) return;
  const result = await view.start({ host: address, port: wanted.port, pin: wanted.pin });
  remoteViewErrors[role] = result.ok ? null : result.error;
  if (result.ok) view.push(snapshotFor(role, state));
}

/** Brings both viewers in line with the saved settings. Each one is checked on its own. */
async function syncRemoteView() {
  const config = readConfig(app.getPath('userData')).remote_view;
  const anyOn = REMOTE_ROLES.some((role) => config[role].enabled);
  const address = anyOn ? localNetworkAddress() : null;
  for (const role of REMOTE_ROLES) await syncRemoteViewRole(role, config[role], address);
}

/** One viewer's status for the settings. The PIN itself is never sent; only whether one is set. */
function remoteViewRoleStatus(role, wanted) {
  const view = remoteViews[role];
  const running = view.running();
  return {
    enabled: wanted.enabled,
    port: wanted.port,
    pinSet: wanted.pin !== null,
    running,
    url: running ? `http://${view.address()}:${view.port()}` : null,
    devices: view.devices(),
    clients: view.clients(),
    error: remoteViewErrors[role],
  };
}

/** What the Remote view settings show, for both viewers, the device counts, and the activity list. */
function remoteViewStatus() {
  const config = readConfig(app.getPath('userData')).remote_view;
  const address = remoteViews.primary.address() ?? remoteViews.secondary.address();
  return {
    primary: remoteViewRoleStatus('primary', config.primary),
    secondary: remoteViewRoleStatus('secondary', config.secondary),
    devices: phonesConnected(),
    deviceLimit: REMOTE_DEVICE_LIMIT,
    // Windows' laptop hotspot hands out 192.168.137.x addresses. Its warning is for that case only.
    hotspot: address?.startsWith('192.168.137.') === true,
    hotspotWarnAbove: REMOTE_HOTSPOT_WARN_ABOVE,
    activity: remoteActivity.slice().reverse(),
  };
}

function stopRemoteViews() {
  return Promise.all(REMOTE_ROLES.map((role) => remoteViews[role].stop()));
}

function broadcast() {
  lowerThirdServer?.push({ lowerThird: state.lowerThird.live, lowerStyle: state.lowerStyle });
  for (const role of REMOTE_ROLES) {
    if (remoteViews[role].running()) remoteViews[role].push(snapshotFor(role, state));
  }
  for (const win of Object.values(windows)) {
    if (win && !win.isDestroyed()) win.webContents.send('live:state', state);
  }
  for (const win of editorWindows.values()) {
    if (!win.isDestroyed()) win.webContents.send('live:state', state);
  }
}

/** Saves which plan is loaded and where the operator is in it. A failed write is logged, not fatal. */
function saveQueueState() {
  try {
    writeQueueState(app.getPath('userData'), {
      active_mass_plan_id: state.queuePlanId,
      current_queue_index: state.queueCursor,
      active_pw_session_id: state.pw?.sessionId ?? null,
    });
  } catch (err) {
    console.error('Could not save the service queue position:', err);
  }
}

// A timed Sanctuary Alert comes down on its own. The id keeps a late timer from taking down a newer alert.
const alertExpiry = createAlertExpiry({ clear: (id) => apply({ type: 'sanctuaryAlert/clear', id }) });

function apply(action) {
  // A Sanctuary Alert's clock starts when the main process takes it, the same clock its expiry timer runs on.
  if (action?.type === 'sanctuaryAlert/show') action = { ...action, now: Date.now() };
  const prev = state;
  const next = liveReducer(state, action);
  if (next === state) return;
  state = next;
  alertExpiry.watch(prev, next);
  if (prev.queuePlanId !== next.queuePlanId || prev.queueCursor !== next.queueCursor || prev.pw?.sessionId !== next.pw?.sessionId) saveQueueState();
  sessionWriter?.push(state);
  reconcileWindows();
  broadcast();
}

/**
 * Rebuilds the Service Queue from the last saved plan, so a crash does not lose the service. The position is not
 * restored: nothing is selected at launch, so no queue row shows CURRENT until the operator plays one.
 */
function restoreQueue(planService, pwService) {
  const saved = readQueueState(app.getPath('userData'));
  // The Praise & Worship session comes back loaded but off air, at its start, as the Mass Queue comes back unselected.
  if (saved.active_pw_session_id != null) {
    try {
      pwService.getSession(saved.active_pw_session_id);
      state = liveReducer(state, { type: 'pw/load', sessionId: saved.active_pw_session_id });
    } catch {
      // Deleted since the last run: forget it.
    }
  }
  if (saved.active_mass_plan_id == null) return;
  try {
    const plan = planService.getPlan(saved.active_mass_plan_id);
    state = liveReducer(state, { type: 'queue/set', items: queueFromPlanItems(plan.items), planId: plan.id });
  } catch {
    // The plan was deleted since the last run: start with an empty queue and forget it.
    saveQueueState();
  }
}

// Crash recovery: the live session is saved to its own WAL database after every change (see electron/session-store.js). A clean quit
// clears it, so a row found at launch means the last run ended mid-service without quitting.
let sessionStore = null;
let sessionWriter = null;
// Set when a recovered session turns the projector back on: its first startup screen is skipped, so it does not cover the restored slide.
let skipStartupScreen = false;
// Times each crash-recovery write, for the dashboard's System Health card.
const sessionWrites = createWriteMeter();

function startSessionRecovery() {
  sessionStore = openSessionStore(app.getPath('userData'), (file) => new Database(file));
  if (!sessionStore) return;
  sessionWriter = createSessionWriter({
    // The store is null once quitting has closed it. A window closing after that has nothing left to save.
    save: (row) => sessionWrites.time(() => sessionStore?.save(row)),
    clear: () => sessionStore?.clear(),
    onError: (err) => console.error('[session] could not save the live session:', err),
  });
}

/**
 * Puts back the live session a crash interrupted: the plan's queue and its CURRENT row, the Praise & Worship position, the projector's
 * frames (Blackout and pause included), the lower third and the Secondary display. Runs after restoreQueue and before any window loads.
 * Returns true when a session was restored.
 */
function recoverSession(planService, pwService) {
  if (!sessionStore) return false;
  let saved = null;
  try {
    saved = sessionStore.load();
  } catch (err) {
    console.error('[session] could not read the saved live session:', err);
  }
  if (!saved) return false;
  const snap = saved.snapshot;
  let queue = null;
  if (snap?.queuePlanId != null) {
    if (snap.queuePlanId === state.queuePlanId) queue = state.queue;
    else {
      try {
        queue = queueFromPlanItems(planService.getPlan(snap.queuePlanId).items);
      } catch {
        // Deleted since: the slide on screen comes back without its plan.
      }
    }
  }
  let pwExists = false;
  if (snap?.pw?.sessionId != null) {
    try {
      pwService.getSession(snap.pw.sessionId);
      pwExists = true;
    } catch {
      // Deleted since.
    }
  }
  const next = restoreSession(state, snap, { queue, pwExists, now: Date.now() });
  if (!next) {
    // Too old, or from a format this version does not read: start as usual.
    clearSavedSession();
    return false;
  }
  state = next;
  skipStartupScreen = state.outputs.projector;
  saveQueueState();
  console.info(`[session] restored the live session saved at ${saved.updated_at} UTC (plan ${saved.active_plan_id ?? 'none'}, row ${state.queueCursor})`);
  return true;
}

/** A clean quit or a restart: the session ended on purpose, so the next launch starts fresh. */
function clearSavedSession() {
  sessionWriter?.reset();
  try {
    sessionStore?.clear();
  } catch (err) {
    console.error('[session] could not clear the saved live session:', err);
  }
}

function closeSessionStore() {
  clearSavedSession();
  sessionWriter = null;
  try {
    sessionStore?.close();
  } catch {
    // Already closed.
  }
  sessionStore = null;
}

/** What the start-up integrity check found, for the notice shown once the operator window is up. */
let dbRecovery = null;

/** Opens an existing file read-write for the integrity check, so a journal left by a crash is rolled back rather than reported. */
const openForIntegrityCheck = (file) => new Database(file, { fileMustExist: true, timeout: 5000 });

/** The start-up integrity check. Never throws: a check that cannot run leaves the file to the normal open, which reports its own errors. */
function guardDatabase(dbPath, backupsDir) {
  try {
    return recoverDatabase({
      dbPath,
      backupsDir,
      open: openForIntegrityCheck,
      openReadonly: openReadonlyDatabase,
      schemaVersion: SCHEMA_VERSION,
    });
  } catch (err) {
    console.error('[db-integrity] The integrity check could not run:', err.message);
    return { status: 'unchecked', error: err.message };
  }
}

/** Tells the operator when the start-up check found damage. A restored database may be missing changes made after its snapshot. */
function reportDatabaseRecovery(win) {
  const r = dbRecovery;
  if (!r || !['restored', 'corrupt-no-backup', 'restore-failed'].includes(r.status)) return;
  const restored = r.status === 'restored';
  const detail = restored
    ? `It was restored from the snapshot ${path.basename(r.restoredFrom)}. Changes made after that snapshot are not in it.\n\nThe damaged file was kept at:\n${r.quarantined}`
    : r.status === 'corrupt-no-backup'
      ? `No good snapshot was found in the backups folder, so the damaged file is still in use. Restore a backup from Settings as soon as you can.\n\n${r.path}`
      : `It could not be replaced automatically (${r.error}). Restore a backup from Settings as soon as you can.\n\n${r.path}`;
  void dialog.showMessageBox(win, {
    type: restored ? 'info' : 'warning',
    title: 'Database check',
    message: restored ? 'The database was damaged and has been restored.' : 'The database is damaged.',
    detail,
  });
}

/** Today's snapshot, made in the background after the database opens. A failure is logged and tried again on the next start. */
async function takeStartupSnapshot() {
  try {
    const result = await takeDailyBackup({
      backup: (target) => announcements.db.backup(target),
      backupsDir: backupsDirFor(app.getPath('userData')),
      schemaVersion: SCHEMA_VERSION,
      openReadonly: openReadonlyDatabase,
    });
    if (result.status === 'created') console.log('[db-backup] Daily snapshot:', result.file);
    if (result.pruned.length) console.log('[db-backup] Removed old snapshots:', result.pruned.join(', '));
  } catch (err) {
    console.error('[db-backup] The daily snapshot failed:', err.message);
  }
}

/** Gives free pages back to the disk a few hundred at a time, so a pass never holds the main thread for long. */
function runDatabaseMaintenance() {
  if (databaseClosed || !announcements?.db?.open) return;
  try {
    incrementalVacuum(announcements.db);
  } catch (err) {
    // Usually busy: another laptop on the share is writing. The next pass tries again.
    console.warn('[db-maintenance] Incremental vacuum skipped:', err.message);
  }
}

/**
 * Opens the database named in config.json and checks that it answers. If that fails (for
 * example, the network drive is unplugged), the app opens the local copy and reports it as
 * an error, so the service can still run. If the local copy itself fails, the app stops.
 */
function openConfiguredDatabase() {
  const userData = app.getPath('userData');
  const configured = resolveDatabasePath(userData, readConfig(userData));
  const local = defaultDatabasePath(userData);

  const backupsDir = backupsDirFor(userData);

  // The integrity check runs before the database is opened for use, and a damaged file is replaced by the newest good snapshot.
  // setupAnnouncements then proves the file answers (SELECT 1) before it registers any IPC,
  // so a failed attempt leaves nothing behind for the fallback to collide with.
  const attempt = (dbPath) => {
    dbRecovery = { path: dbPath, ...guardDatabase(dbPath, backupsDir) };
    return setupAnnouncements({ loadRoute: load, preload: webPreferences.preload, dbPath, backupsDir });
  };

  try {
    const handles = attempt(configured);
    dbStatus = { connected: true, path: configured, fallback: false, error: null };
    return handles;
  } catch (err) {
    if (configured === local) {
      dbStatus = { connected: false, path: local, fallback: false, error: err.message };
      dialog.showErrorBox('APCCMMA cannot open its database', `${err.message}\n\n${local}`);
      app.quit();
      throw err;
    }
    const handles = attempt(local);
    dbStatus = {
      connected: true,
      path: local,
      fallback: true,
      error: `Could not open ${configured}: ${err.message}. Using the local copy.`,
    };
    return handles;
  }
}

function createOperator() {
  const win = new BrowserWindow({
    width: 1600,
    height: 960,
    // The smallest size the operator layout still shows every control at. Below this the bars scroll or wrap.
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#100306',
    title: 'APCCMMA — Control',
    icon: APP_ICON,
    // No native white title bar. The app's own top bar is the drag area, and Windows draws its
    // minimise, maximise and close buttons over the top-right corner in the canvas colour.
    // The colours are the saved theme's canvas and foreground, so the buttons match the top bar. Changing the theme
    // updates them (see electron/settings.js).
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlayFor(readConfig(app.getPath('userData')).theme),
    webPreferences,
  });
  setupAntiTamper(win, !app.isPackaged);
  windows.operator = win;
  // Windows' own display-change message: a graphics driver restart sends it even when Electron reports no screen change. Electron's display
  // list may not be updated yet when it arrives, so it only re-reads the hardware and schedules the settle checks, which re-anchor the projector.
  if (process.platform === 'win32') win.hookWindowMessage(WM_DISPLAYCHANGE, () => edid?.topologyChanged('WM_DISPLAYCHANGE'));
  // Closing mid-copy could leave a new database location half-written, so the window stays open until the move ends.
  win.on('close', (event) => {
    if (!settings?.isMoving()) return;
    event.preventDefault();
    dialog.showMessageBoxSync(win, {
      type: 'warning',
      message: 'The database is still being moved.',
      detail: 'Please wait for the move to finish before closing APCCMMA. Closing now could leave the new location incomplete.',
      buttons: ['OK'],
    });
  });
  win.on('closed', () => {
    windows.operator = null;
    app.quit();
  });
  load(win, 'operator');
}

ipcMain.handle('live:get', () => state);

/** Saves the lower third's look. A new window target moves the open window, or opens one on that display. */
ipcMain.handle('lowerThird:save', (_event, patch) => {
  const before = state.lowerStyle.target;
  const merged = sanitizeLowerThirdStyle({ ...state.lowerStyle, ...(patch ?? {}) });
  writeConfig(app.getPath('userData'), { lower_third: merged });
  apply({ type: 'lowerStyle/set', value: merged });
  if (merged.target !== before) placeLowerThirdWindow();
  return state.lowerStyle;
});

/** Where the browser source is: the local address, and the network address for other computers on the same network. */
ipcMain.handle('lowerThird:info', () => ({
  port: LOWER_THIRD_PORT,
  running: lowerThirdServerUp,
  local: `http://127.0.0.1:${LOWER_THIRD_PORT}/lower-third`,
  lan: lanAddress() ? `http://${lanAddress()}:${LOWER_THIRD_PORT}/lower-third` : null,
}));

// ---- Library export and import (plans, setlists, Praise & Worship sessions, songs) ----

/** The file the operator chose to import, held until they confirm. Nothing is written before that. */
let pendingLibraryImport = null;

/** Saves the chosen parts of the library to one .apccmma file, after the operator picks where. */
ipcMain.handle('library:export', async (event, input) => {
  const options = checkExportOptions(input);
  const picked = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
    title: 'Export the library',
    defaultPath: defaultExportName(),
    filters: [{ name: 'APCCMMA library', extensions: [TRANSFER_EXTENSION.slice(1)] }],
  });
  if (picked.canceled || !picked.filePath) return null;
  const data = collectLibrary(announcements.db, options, { laptop: os.hostname() });
  fs.writeFileSync(picked.filePath, encodeTransfer(data), 'utf8');
  return { path: picked.filePath, counts: data.counts, includesLyrics: data.includesLyrics };
});

/** Reads a library file and returns the preview. A damaged or unknown file is refused here with the reason. */
ipcMain.handle('library:open', async (event) => {
  const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    title: 'Choose a library file to import',
    filters: [{ name: 'APCCMMA library', extensions: [TRANSFER_EXTENSION.slice(1)] }],
    properties: ['openFile'],
  });
  if (picked.canceled || !picked.filePaths[0]) return null;
  const data = decodeTransfer(fs.readFileSync(picked.filePaths[0], 'utf8'));
  pendingLibraryImport = data;
  return previewImport(announcements.db, data);
});

/** Writes the file the operator confirmed. `choices` maps `type:uuid` to 'keep' or 'use' for each changed record. */
ipcMain.handle('library:import', (_event, choices) => {
  if (!pendingLibraryImport) throw new Error('Choose a file to import first.');
  const data = pendingLibraryImport;
  pendingLibraryImport = null;
  const summary = applyImport(announcements.db, data, choices ?? {});
  // Holy Mass Order words may have come in: every window reloads them, so the planner and Go Live use them at once.
  announceMassOrderChange();
  return summary;
});

ipcMain.handle('library:cancel', () => {
  pendingLibraryImport = null;
});

// ---- Mass intention privacy: the remembered key, and the Settings channels. ----
// Keys this laptop has unlocked, by key id, in one file encrypted with safeStorage: only this Windows user on this computer can read it.
// Keyed by id, so moving between two databases keeps both. Without safeStorage the key stays in memory and is asked for at each start.
const vaultKeyFile = () => path.join(app.getPath('userData'), 'db-keys.bin');
function vaultKeyCache() {
  if (!safeStorage.isEncryptionAvailable()) return null;
  const readAll = () => {
    if (!fs.existsSync(vaultKeyFile())) return {};
    try {
      const parsed = JSON.parse(safeStorage.decryptString(fs.readFileSync(vaultKeyFile())));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  };
  const writeAll = (all) => {
    if (Object.keys(all).length === 0) fs.rmSync(vaultKeyFile(), { force: true });
    else fs.writeFileSync(vaultKeyFile(), safeStorage.encryptString(JSON.stringify(all)));
  };
  return {
    get: (keyId) => (typeof readAll()[keyId] === 'string' ? Buffer.from(readAll()[keyId], 'base64') : null),
    set: (keyId, key) => writeAll({ ...readAll(), [keyId]: key.toString('base64') }),
    delete: (keyId) => {
      const all = readAll();
      delete all[keyId];
      writeAll(all);
    },
  };
}

/** Registers the `vault:*` channels. Each change tells every window which notes to read again; the passphrase is never sent back. */
function setupVaultIpc(vault, announceNoteChange) {
  const announce = (ids) => {
    for (const id of ids?.notes ?? []) announceNoteChange({ id, removed: false });
  };
  const passphrase = (input, key = 'passphrase') => String(input?.[key] ?? '');
  ipcMain.handle('vault:status', () => vault.status());
  ipcMain.handle('vault:setup', (_event, input) => {
    announce(vault.setup(passphrase(input)));
    return vault.status();
  });
  ipcMain.handle('vault:unlock', (_event, input) => {
    announce(vault.unlock(passphrase(input)));
    return vault.status();
  });
  ipcMain.handle('vault:lock', () => {
    announce(vault.lock());
    return vault.status();
  });
  ipcMain.handle('vault:change-passphrase', (_event, input) => {
    const { ids, damaged } = vault.changePassphrase(passphrase(input, 'current'), passphrase(input, 'next'));
    announce(ids);
    return { ...vault.status(), damaged };
  });
  ipcMain.handle('vault:disable', (_event, input) => {
    announce(vault.disable(passphrase(input)));
    return vault.status();
  });
}

// ---- Cloud sync: linking this laptop with a one-time code. The token stays encrypted on this computer. ----
const cloudFile = () => path.join(app.getPath('userData'), 'cloud-device.bin');
// The cloud address: the environment variable if valid, then the address the operator saved, then the default (see cloud-address.js).
const cloudUrl = () => resolveCloudAddress({ env: process.env.APCCMMA_CLOUD_URL, config: readConfig(app.getPath('userData')).cloud_url });
// The operator changes the address here. It is written to config.json and nothing else; the link is not touched.
ipcMain.handle('cloud:save-address', (_event, input) => {
  const saved = saveCloudAddress(String(input?.address ?? ''));
  if (!saved.ok) return { ok: false, message: saved.message };
  writeConfig(app.getPath('userData'), saved.patch);
  return { ok: true, address: cloudUrl() };
});
const cloud = () =>
  createCloudDevice({
    storage: safeStorage,
    file: {
      read: () => (fs.existsSync(cloudFile()) ? fs.readFileSync(cloudFile()) : null),
      write: (bytes) => fs.writeFileSync(cloudFile(), bytes),
      remove: () => fs.rmSync(cloudFile(), { force: true }),
    },
    fetchFn: (...args) => fetch(...args),
    baseUrl: cloudUrl(),
  });

/** Link state for the Settings screen. It holds display fields only, never the token. */
// The cloud address is shown on the Cloud sync screen, so the user can see where the laptop is pointing. It is not part of any message.
const withAddress = async (result) => ({ ...result, address: cloudUrl() });
ipcMain.handle('cloud:status', async () => withAddress(await cloud().status()));
ipcMain.handle('cloud:link', async (_event, input) => withAddress(await cloud().link(String(input?.code ?? ''), String(input?.label ?? '').slice(0, 80))));
ipcMain.handle('cloud:unlink', async () => withAddress(await cloud().unlink()));
// The input is checked in cloud-device.js, which runs here in the main process, before anything is sent. Only these three fields
// are read, so nothing else from the screen reaches the cloud request.
ipcMain.handle('cloud:create-web-user', (_event, input) =>
  cloud().createWebUser({ username: input?.username, displayName: input?.displayName, role: input?.role }),
);
// Checked in cloud-device.js in the main process before anything is sent. Only these five fields are read.
ipcMain.handle('cloud:create-church-admin', (_event, input) =>
  cloud().createChurchAdmin({
    setupKey: input?.setupKey,
    churchName: input?.churchName,
    username: input?.username,
    displayName: input?.displayName,
    deviceLabel: input?.deviceLabel,
  }),
);
ipcMain.handle('cloud:defaultLabel', () => os.hostname());

// The song list sync: runs in the background and sends metadata only (see song-sync.js). The screen sees its state, never the token.
const songSync = createSongSync({
  readRows: () => announcements.db.prepare(SONG_ROWS_SQL).all(),
  push: (songs) => cloud().pushSongs(songs),
});
ipcMain.handle('cloud:songs-status', () => songSync.status());
// The plan sync's state, for the read-only line on the Cloud sync screen. It is null until the database is open.
let planSync = null;
ipcMain.handle('cloud:plans-status', () => planSync?.status() ?? { status: 'idle', lastSyncedAt: null, message: null, counts: null });
ipcMain.handle('cloud:songs-sync-now', async () => {
  await songSync.runOnce();
  return songSync.status();
});

/** Remote view's status. Also starts the page if it is on and a network has appeared since the last check. */
ipcMain.handle('remoteView:get', async () => {
  await syncRemoteView();
  return remoteViewStatus();
});

/**
 * Saves one viewer's on/off, port and PIN. Any change restarts that viewer's page, so its phones reconnect, and they ask
 * for the PIN again when one is set. The other viewer keeps running.
 */
ipcMain.handle('remoteView:save', async (_event, patch) => {
  const userData = app.getPath('userData');
  const current = sanitizeRemoteView(readConfig(userData).remote_view);
  validateRemoteViewPatch(patch ?? {}, current);
  const { role, ...changes } = patch;
  const merged = sanitizeRemoteView({ ...current, [role]: { ...current[role], ...changes } });
  writeConfig(userData, { remote_view: merged });
  await remoteViews[role].stop();
  await syncRemoteView();
  return remoteViewStatus();
});

/**
 * The network one viewer is served on: the laptop's address, the viewer's port, and the WiFi name when the laptop is on WiFi. The WiFi name
 * is read from the system, so it is asked for when the drawer opens or the address changes, not on every status poll.
 */
ipcMain.handle('remoteView:getNetworkInfo', async (_event, role) => {
  const view = remoteViews[REMOTE_ROLES.includes(role) ? role : 'primary'];
  const address = view.address() ?? localNetworkAddress();
  const info = await networkInfo(address);
  return { ...info, port: view.port() };
});

/** Drops one phone from a viewer. It cannot reconnect to that viewer until the viewer restarts. */
ipcMain.handle('remoteView:disconnect', async (_event, request) => {
  const { role, ip } = request ?? {};
  if (!REMOTE_ROLES.includes(role)) throw new Error('Choose the Primary or the Secondary viewer.');
  if (typeof ip !== 'string' || !ip || ip.length > 64) throw new Error('That phone was not found.');
  remoteViews[role].disconnect(ip);
  return remoteViewStatus();
});

/** Every connected display, numbered as the identify overlay numbers them. Physical pixels, so 1920x1080 is 1920x1080. */
function displayList() {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    index: i + 1,
    width: Math.round(d.size.width * d.scaleFactor),
    height: Math.round(d.size.height * d.scaleFactor),
    primary: d.id === primaryId,
    label: d.label ?? '',
    x: d.bounds.x,
    y: d.bounds.y,
  }));
}

ipcMain.handle('display:list', () => displayList());

// Identify: a large number on each connected display for a few seconds, so the operator can tell them apart.
const identifyWindows = [];
ipcMain.handle('display:identify', () => {
  for (const win of identifyWindows.splice(0)) if (!win.isDestroyed()) win.close();
  screen.getAllDisplays().forEach((d, i) => {
    const win = new BrowserWindow({
      x: d.bounds.x,
      y: d.bounds.y,
      width: d.bounds.width,
      height: d.bounds.height,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      backgroundColor: '#000000',
      webPreferences: { sandbox: true },
    });
    const html = `<!doctype html><html><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#000;color:#ECC98A;font-family:sans-serif;font-size:40vmin;font-weight:800">${i + 1}</body></html>`;
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    identifyWindows.push(win);
  });
  setTimeout(() => {
    for (const win of identifyWindows.splice(0)) if (!win.isDestroyed()) win.close();
  }, 4000);
});

// Saves projector settings. A change to the display or fullscreen applies the next time the projector window opens.
ipcMain.handle('projector:save', (_event, patch) => {
  const merged = sanitizeProjectorSettings({ ...state.settings, ...(patch ?? {}) });
  writeConfig(app.getPath('userData'), { projector: merged });
  apply({ type: 'settings/projector', value: merged });
  return merged;
});
// Saves the welcome screen content and style. The projector shows the change the next time the welcome screen is live.
ipcMain.handle('welcome:save', (_event, patch) => {
  const merged = sanitizeWelcomeSettings({ ...state.welcome, ...(patch ?? {}) });
  writeConfig(app.getPath('userData'), { welcome: merged });
  apply({ type: 'settings/welcome', value: merged });
  return merged;
});
// A bad action is logged and dropped. An uncaught error here would put a modal error box in front of the operator in the middle of a service.
ipcMain.on('live:dispatch', (_event, action) => {
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') return;
  try {
    apply(action);
  } catch (err) {
    console.error(`[live] The action ${action.type} could not be applied: ${err.message}`);
  }
});

/**
 * Ctrl+Shift+A from any window: brings the operator console forward and opens the Sanctuary Alert. Pressed in the console while it is
 * already in front, it toggles the dialog; from another window (the projector, the mirror), it always opens it.
 */
function openSanctuaryAlert(from) {
  const win = windows.operator;
  if (!win || win.isDestroyed()) return;
  const wasInFront = from === win && win.isFocused();
  if (win.isMinimized()) win.restore();
  if (!wasInFront) {
    win.show();
    win.focus();
  }
  win.webContents.send(ALERT_TOGGLE_CHANNEL, { toggle: wasInFront });
}

// ---- Sanctuary display watchdog ----
// The projector page's preload answers each heartbeat ping. Only the projector's own answers count (checked in the watchdog).
ipcMain.on(PONG_CHANNEL, (event, seq) => watchdog.pong(event.sender, seq));
// The failover page says which mode it has drawn, so a show waits for the right one.
ipcMain.on(FAILOVER_PAINTED_CHANNEL, (event, mode) => {
  if (event.sender === failoverSurface.window()?.webContents) failoverSurface.painted(sanitizeFailoverMode(mode));
});
ipcMain.handle('watchdog:get', () => watchdog.status());
ipcMain.handle('watchdog:failoverMode', () => failoverSurface.wantedMode());
// Force Failover (Blackout) from the Go Live badge, and Ctrl+Shift+B from any window: on when off, off when on.
ipcMain.handle('watchdog:force', (_event, on) => watchdog.force(on === true));
ipcMain.handle('watchdog:setMode', (_event, mode) => {
  const next = sanitizeFailoverMode(mode);
  try {
    writeConfig(app.getPath('userData'), { failover_mode: next });
  } catch (err) {
    console.error('Could not save the failover mode:', err);
  }
  return watchdog.setMode(next);
});

// ---- EDID lock ----
const EDID_UNAVAILABLE = { available: false, error: 'The app is still starting.', queryMs: null, shiftAt: null, shiftReason: null, roles: {}, monitors: [] };
ipcMain.handle('edid:get', () => edid?.status() ?? EDID_UNAVAILABLE);
/**
 * Pin Active Sanctuary Projector: binds the projector to the physical monitor it is on now. With the projector off, the display it would open
 * on is used. The projector then follows that monitor through re-indexing, driver restarts and port changes.
 */
ipcMain.handle('edid:pin', () => {
  if (!edid) throw new Error('The app is still starting.');
  const win = windows.projector;
  const open = win && !win.isDestroyed() && win.isVisible();
  const displayId = open ? screen.getDisplayMatching(win.getBounds()).id : targetDisplay()?.id;
  const status = edid.pin('projector', displayId ?? null);
  watchdog.displaysChanged();
  return status;
});
ipcMain.handle('edid:unpin', () => {
  if (!edid) throw new Error('The app is still starting.');
  return edid.unpin('projector');
});
// Detach Monitor: opens the confidence monitor (the operator mirror), or brings it forward when it is open already. Going through the
// preview output keeps the PREVIEW button and the dashboard card in step with the window.
ipcMain.handle('projector:openConfidenceWindow', () => {
  const win = windows.preview;
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.showInactive();
    win.moveTop();
    return true;
  }
  apply({ type: 'output/set', output: 'preview', on: true });
  return windows.preview != null;
});

// Database backup and restore, from Settings. The live database is never copied while it is open: the export uses SQLite's online backup,
// and a restore closes the database before its file is replaced, then restarts the app so it opens the restored file.
const openReadonlyDatabase = (file) => new Database(file, { readonly: true, fileMustExist: true });

let databaseClosed = false;

/** Closes the database once. The import closes it before replacing the file, and the restart must not close it a second time. */
function closeDatabaseOnce() {
  if (databaseClosed || !announcements) return;
  databaseClosed = true;
  announcements.close();
}

/**
 * The environment a relaunched development app starts with: this one's, with the Vite dev server address kept. ELECTRON_RUN_AS_NODE is
 * removed: if it were set, the new process would start as plain Node, with no window at all.
 */
function relaunchEnvironment() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (process.env.VITE_DEV_SERVER_URL) env.VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
  return env;
}

/**
 * Restarts the app after a database change. Everything the app holds open is closed and awaited first, so the new process can take the
 * same ports and open the same file. The new process opens the restored database itself, and runs its migrations as it starts.
 * Packaged: the app relaunches itself. Development: the new process is started with its environment set explicitly, so the Vite dev
 * server address is still there, and then this process exits. Electron's relaunch options have no environment field, so they cannot do it.
 */
async function relaunchApp() {
  await stopRemoteViews();
  if (lowerThirdServer) await lowerThirdServer.stop();
  songSync.stop();
  planSync?.stop();
  closeDatabaseOnce();
  closeSessionStore();
  if (app.isPackaged) {
    app.relaunch();
  } else {
    const child = spawn(process.execPath, process.argv.slice(1), {
      cwd: process.cwd(),
      env: relaunchEnvironment(),
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  }
  app.exit(0);
}

ipcMain.handle('db:export-backup', async (event) => {
  const picked = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
    title: 'Save a database backup',
    defaultPath: backupFileName(),
    filters: DB_FILTERS,
  });
  if (picked.canceled || !picked.filePath) return { success: false, cancelled: true };
  try {
    const filePath = await exportBackup({
      target: picked.filePath,
      backup: (target) => announcements.db.backup(target),
      schemaVersion: SCHEMA_VERSION,
      open: openReadonlyDatabase,
    });
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('db:import-backup', async (event) => {
  const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    title: 'Choose a database backup to restore',
    properties: ['openFile'],
    filters: DB_FILTERS,
  });
  if (picked.canceled || picked.filePaths.length === 0) return { success: false, cancelled: true };
  const source = picked.filePaths[0];
  const result = importBackup({
    source,
    activePath: dbStatus.path,
    schemaVersion: SCHEMA_VERSION,
    open: openReadonlyDatabase,
    openForMigration: (file) => openDatabase(file),
    closeDatabase: () => closeDatabaseOnce(),
  });
  if (!result.ok) {
    // The live database was not closed, so the app keeps running. Once it has been closed, only a restart can reopen it.
    if (!result.closed) return { success: false, error: result.error };
    dialog.showErrorBox('The database could not be restored', result.error);
    await relaunchApp();
    return { success: false, error: result.error };
  }
  await relaunchApp();
  return { success: true, filePath: source };
});
/**
 * The dashboard's System Health card: the LAN address, CPU and memory (the laptop's and the app's), the crash-recovery database's last
 * write and journal mode, and the newest automatic snapshot. CPU is measured between two calls, so the card polls every few seconds.
 */
const readSystemHealth = createHealthReader({
  cpus: () => os.cpus(),
  totalmem: () => os.totalmem(),
  freemem: () => os.freemem(),
  appMetrics: () => app.getAppMetrics(),
  address: () => localNetworkAddress(),
  backups: () => listBackups(backupsDirFor(app.getPath('userData'))),
  session: () => {
    let journalMode = null;
    try {
      journalMode = sessionStore?.journalMode() ?? null;
    } catch {
      // Closed while quitting.
    }
    return { enabled: sessionStore !== null, journalMode, ...sessionWrites.status() };
  },
});
ipcMain.handle('system:health', () => readSystemHealth());

// Programs and network files the operator has agreed to open since the app started, so a shortcut used all morning asks only once.
const approvedLaunches = new Set();

/** Opens a Launchpad shortcut. The check is here in the main process: what a page sends is not trusted to be what the operator typed. */
ipcMain.handle('launch:open', async (event, target) => {
  const launch = checkLaunchTarget(target);
  const win = BrowserWindow.fromWebContents(event.sender);
  if (launch.kind === 'refused') {
    await dialog.showMessageBox(win, { type: 'warning', title: 'APCCMMA', message: 'This shortcut cannot be opened.', detail: LAUNCH_REFUSED_DETAIL });
    return false;
  }
  if (launch.kind === 'url') return shell.openExternal(launch.url);
  if (launch.confirm && !approvedLaunches.has(launch.path)) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      title: 'APCCMMA',
      buttons: ['Cancel', 'Open'],
      defaultId: 0,
      cancelId: 0,
      message: launch.remote ? 'This shortcut opens a file on another computer.' : 'This shortcut starts a program.',
      detail: `${launch.path}\n\nOpen it only if you recognise it.`,
    });
    if (response !== 1) return false;
    approvedLaunches.add(launch.path);
  }
  return shell.openPath(launch.path);
});


app.whenReady().then(() => {
  // No page gets the camera, the microphone, location and the like: nothing in the app uses them. The mirror has a session of its own.
  for (const target of [session.defaultSession, session.fromPartition(MIRROR_PARTITION)]) restrictPermissions(target);
  // No default menu: it would steal F11 (fullscreen) and Ctrl+R from our hotkeys.
  Menu.setApplicationMenu(null);
  // The app-wide hotkeys (Ctrl+Shift+A for the Sanctuary Alert) work from every window the app opens, including ones opened later.
  app.on('browser-window-created', (_event, win) => attachAppHotkeys(win, { onAlert: openSanctuaryAlert }));
  // Ctrl+Shift+B from any window forces the sanctuary failover (pure black), or releases it.
  app.on('browser-window-created', (_event, win) => attachFailoverHotkey(win, { onFailover: () => watchdog.force(!watchdog.status().manual) }));
  // A GPU process crash can leave the projector black or frozen: the watchdog covers it and restarts the projector page.
  app.on('child-process-gone', (_event, details) => watchdog.childProcessGone(details));
  watchdog.setMode(readConfig(app.getPath('userData')).failover_mode);
  // The EDID lock reads the physical displays through the display-matrix addon. Without it (not built, not Windows) it reports itself
  // unavailable and the projector follows the display chosen in Settings, as before.
  edid = createEdidWatchdog({
    native: loadDisplayMatrix(),
    screen,
    getLock: (role) => readConfig(app.getPath('userData')).display_locks[role] ?? null,
    saveLock: (role, lock) => {
      const locks = readConfig(app.getPath('userData')).display_locks;
      writeConfig(app.getPath('userData'), { display_locks: { ...locks, [role]: lock } });
    },
    // Windows keeps re-arranging for a moment after a topology change: the projector is re-anchored after each settle check too.
    onSettled: () => watchdog.displaysChanged(),
    onStatus: (status) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('edid:status', status);
      }
    },
  });
  // The saved projector settings apply before any window opens, so the first projector window already uses them.
  state = liveReducer(state, { type: 'settings/projector', value: readConfig(app.getPath('userData')).projector });
  state = liveReducer(state, { type: 'settings/welcome', value: readConfig(app.getPath('userData')).welcome });
  state = liveReducer(state, { type: 'lowerStyle/set', value: readConfig(app.getPath('userData')).lower_third });
  announcements = openConfiguredDatabase();
  // Where the app opened its database, and what it holds: a restored file that shows zero songs here is not the one the app reads.
  console.log('[DB Path]:', dbStatus.path, dbStatus.fallback ? '(fallback: the configured database would not open)' : '');
  console.log('[DB Counts]:', databaseCounts(announcements.db));
  void takeStartupSnapshot();
  // A first pass a minute after start, then every 15 minutes.
  const maintenanceStart = setTimeout(runDatabaseMaintenance, 60 * 1000);
  const maintenanceTimer = setInterval(runDatabaseMaintenance, 15 * 60 * 1000);
  app.on('before-quit', () => {
    clearTimeout(maintenanceStart);
    clearInterval(maintenanceTimer);
  });
  // A hymn saved here asks the song sync for a send soon, instead of waiting for its next timer tick.
  setupLyrics(announcements.db, {
    onHymnChanged: () => songSync.notify(),
    // Every window reloads the song, so the planners and the lineup show the new lyrics without a restart.
    onLyricsChanged: (id) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('lyrics:changed', id);
      }
    },
  });
  // Hymns deleted more than 30 days ago are removed from this laptop, at start and then once a day. Local only: nothing is sent.
  const purgeRecycled = () => {
    try {
      purgeDeletedHymns(announcements.db);
    } catch (err) {
      console.error(`[lyrics] step=purge name=${err?.name ?? 'Error'}`);
    }
  };
  purgeRecycled();
  const purgeTimer = setInterval(purgeRecycled, 24 * 60 * 60 * 1000);
  app.on('before-quit', () => clearInterval(purgeTimer));
  songSync.start();
  app.on('before-quit', () => songSync.stop());
  // Plans sync in both directions in the background, after the database is open. There is no button for it.
  // One cloud client for the plan sync, so the server clock offset it measures is kept between runs.
  const planCloud = cloud();
  planSync = createPlanSync({
    store: createPlanSyncStore(announcements.db),
    cloud: {
      pullPlans: (cursor) => planCloud.pullPlans(cursor),
      createPlan: (plan) => planCloud.createPlan(plan),
      pushPlan: (plan) => planCloud.pushPlan(plan),
      deletePlan: (id) => planCloud.deletePlan(id),
      getPlan: (id) => planCloud.getPlan(id),
      serverOffset: () => planCloud.serverOffset(),
    },
  });
  planSync.start();
  app.on('before-quit', () => planSync.stop());
  registerLyricsImport(announcements.convertPdf);
  setupLectionary(announcements.db);
  const planService = setupMassPlans(announcements.db);
  const pwService = setupPwSessions(announcements.db);
  // Packaged builds copy resources/bible next to the app; in development it is read from the project.
  const bibleDataDir = app.isPackaged
    ? path.join(process.resourcesPath, 'bible')
    : path.join(app.getAppPath(), 'resources', 'bible');
  try {
    const { seeded } = seedBible(announcements.db, bibleDataDir);
    if (seeded.length) console.info(`Bible seeded on first launch: ${seeded.join(', ')}`);
  } catch (err) {
    // The app still starts. The Bible module shows an empty list until the data is fixed.
    console.error('Bible seed failed:', err);
  }
  setupBible(announcements.db);
  seedRosary(announcements.db);
  setupRosary(announcements.db);
  // Every window reads the notes again after a save or a delete, so Notes & Prayers and Go Live's Order of Holy Mass stay in step.
  const announceNoteChange = (change) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('notes:changed', change);
    }
  };
  // Mass intention privacy: the body of a Mass Intention note is sealed with a key made from the parish passphrase (see db-vault.js).
  const vault = createDbVault(announcements.db, { fields: NOTE_SEALED_FIELDS, keyCache: vaultKeyCache() });
  setupNotes(announcements.db, { vault, onChanged: announceNoteChange });
  setupVaultIpc(vault, announceNoteChange);
  // The parish's own words for the Holy Mass Order parts.
  setupMassOrderTexts(announcements.db);
  // The projector is open when its window exists, whatever its title. Quick Live asks this before it shows a song.
  setupSpontaneousLog(announcements.db, { isProjectorOpen: () => Boolean(windows.projector && !windows.projector.isDestroyed()) });
  setupWhiteboard(announcements.db, announcements.service, { onChanged: announceWhiteboardChange, convertPdf: announcements.convertPdf });
  // The browser source: the lower third at http://127.0.0.1:3002/lower-third, updated live.
  lowerThirdServer = createLowerThirdServer({ distDir: path.join(appDir, '../dist') });
  void lowerThirdServer.start().then((ok) => {
    lowerThirdServerUp = ok;
  });
  // Remote view starts only when the operator turned it on last time.
  void syncRemoteView();
  if (state.lowerStyle.target != null) placeLowerThirdWindow();
  // Unplugging the chosen display closes the window at once, instead of letting the system drag it onto the main screen, and plugging it
  // back in opens it again.
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(event, () => {
      // The projector first, so an unplugged projector is hidden before anything else runs: it is on the operator's screen by now.
      // It is hidden (or moved to another external screen), and comes back where it was when its display returns. Pinned, it follows its
      // physical monitor: the hardware is read again first, so it is placed by what is connected now.
      edid?.topologyChanged(event);
      watchdog.displaysChanged();
      if (state.lowerStyle.target != null) placeLowerThirdWindow();
    });
  }
  media = setupMedia(announcements.db, {
    loadRoute: load,
    preload: webPreferences.preload,
    // Deleting a file that the background layer shows clears the layer first, so the file is not held open.
    releaseBackground: (url) => {
      const bg = state.projector.background;
      if (![bg.live, bg.staged].some((frame) => frame?.src === url)) return false;
      apply({ type: 'background/clear' });
      return true;
    },
  });
  settings = setupSettings({
    userData: app.getPath('userData'),
    getDb: () => announcements.db,
    getStatus: () => dbStatus,
    appVersion: app.getVersion(),
    showOpenDirectory: (win, options) => (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)),
  });
  // Restore before any window loads, so the first render already shows the resumed queue.
  restoreQueue(planService, pwService);
  startSessionRecovery();
  const recovered = recoverSession(planService, pwService);
  setupUpdater({ userData: app.getPath('userData') });
  createOperator();
  windows.operator?.webContents.once('did-finish-load', () => reportDatabaseRecovery(windows.operator));
  if (recovered) {
    // Opens the outputs the session had on (the projector on its display), and sends the restored state to the phones.
    reconcileWindows();
    broadcast();
  }
});

app.on('will-quit', () => {
  closeSessionStore();
  void stopRemoteViews();
  media?.close();
  announcements?.close();
});

app.on('window-all-closed', () => app.quit());

import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, screen, shell } from 'electron';
import { createCloudDevice } from './cloud-device.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialLiveState, liveReducer, OUTPUTS } from '../shared/live.js';
import { setupAnnouncements } from './announcements.js';
import { setupLyrics } from './lyrics.js';
import { registerLyricsImport } from './lyrics-import.js';
import { setupNotes } from './notes.js';
import { setupWhiteboard } from './whiteboard.js';
import { setupLectionary } from './lectionary.js';
import { setupMedia } from './media.js';
import { setupMassPlans } from './mass-plans.js';
import { setupPwSessions } from './pw-sessions.js';
import { seedBible } from './bible-seed.js';
import { setupBible } from './bible.js';
import { seedRosary, setupRosary } from './rosary.js';
import { queueFromPlanItems, readQueueState, writeQueueState } from './queue-state.js';
import { defaultDatabasePath, PREVIEW_MIN, readConfig, resolveDatabasePath, writeConfig } from './config.js';
import { setupSettings } from './settings.js';
import { titleBarOverlayFor } from '../shared/title-bar.js';
import { sanitizeProjectorSettings } from '../shared/projector-settings.js';
import { sanitizeWelcomeSettings } from '../shared/welcome-settings.js';
import { sanitizeLowerThirdStyle } from '../shared/lower-third-style.js';
import { createLowerThirdServer, LOWER_THIRD_PORT, lanAddress } from './lower-third-server.js';
import { createRemoteViewServer, localNetworkAddress } from './remote-view-server.js';
import {
  REMOTE_DEVICE_LIMIT,
  REMOTE_HOTSPOT_WARN_ABOVE,
  REMOTE_ROLES,
  controlAction,
  remoteViewSnapshot,
  sanitizeRemoteView,
  validateRemoteViewPatch,
} from '../shared/remote-view.js';
import { setupUpdater } from './updater.js';
import { applyImport, checkExportOptions, collectLibrary, decodeTransfer, defaultExportName, encodeTransfer, previewImport, TRANSFER_EXTENSION } from './transfer.js';
import os from 'node:os';

// Windows needs this to show notifications under the app's name. It must match build.appId in package.json.
app.setAppUserModelId('com.apccmma.churchapp');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

// The parish logo. Windows uses the .ico (taskbar and window frame); elsewhere the .png.
// Missing files fall back to Electron's default icon rather than failing to start.
const ICON_PATH = path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
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

const webPreferences = {
  preload: path.join(__dirname, 'preload.cjs'),
  contextIsolation: true,
  sandbox: true,
};

function load(win, route) {
  // A window that fails to load says so in the console, so a blank screen can be traced to its cause.
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`[window ${route}] failed to load ${url}: ${description} (${code})`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[window ${route}] its renderer stopped: ${details.reason}`);
  });
  if (DEV_URL) win.loadURL(`${DEV_URL}#/${route}`);
  else win.loadFile(path.join(__dirname, '../dist/index.html'), { hash: `/${route}` });
}

/** The display the projector opens on: the one chosen in Settings if still connected, else the first external one, else the primary. */
function targetDisplay() {
  const chosen = screen.getAllDisplays().find((d) => d.id === state.settings.displayId);
  if (state.settings.displayId != null && !chosen) {
    console.warn(`[projector] display ${state.settings.displayId} is not connected. Using the default display instead.`);
  }
  return chosen ?? externalDisplay() ?? screen.getPrimaryDisplay();
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
 * The operator mirror. It is pinned above the operator console and never steals focus on open, so
 * clicking around the console leaves it where it is. It stays until the PREVIEW button closes it.
 */
function openPreviewWindow() {
  const saved = savedPreviewBounds();
  const win = new BrowserWindow({
    ...(saved ?? { width: 640, height: 360 }),
    minWidth: PREVIEW_MIN.width,
    minHeight: PREVIEW_MIN.height,
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
 * with content is kept too, so turning the projector on shows what the operator chose, not the welcome screen.
 */
function applyStartupScreen() {
  const mode = state.settings.startupScreen;
  if (holdsContent(state.projector.live)) {
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

const createOutput = {
  // Congregation screen. It opens on the display chosen in Settings (or the first external one). It is
  // fullscreen only on an external projector, and only when the setting asks for it; otherwise a windowed preview.
  projector: () => {
    const target = targetDisplay();
    const b = target.bounds;
    const fullscreen = state.settings.fullscreen && target.id !== screen.getPrimaryDisplay().id;
    const win = new BrowserWindow({
      x: b.x + (fullscreen ? 0 : 80),
      y: b.y + (fullscreen ? 0 : 80),
      width: fullscreen ? b.width : 1280,
      height: fullscreen ? b.height : 720,
      fullscreen,
      frame: false,
      backgroundColor: '#000000',
      title: 'APCCMMA — Projector',
      icon: APP_ICON,
      webPreferences,
    });
    // A projector window must be seen the moment it opens: show it, bring it forward, and keep it above other windows.
    win.once('ready-to-show', () => {
      win.show();
      win.focus();
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    console.log(`[projector] opened on display ${target.id}, ${fullscreen ? 'fullscreen' : 'windowed'}`);
    // Set once the window is registered, so the window step does not open a second one.
    setImmediate(applyStartupScreen);
    return win;
  },
  // The lower third on its own screen, for a second projector or a stream. Transparent, so only the bar shows.
  lowerThird: () => {
    const target = state.lowerStyle.target;
    const display = (target != null && screen.getAllDisplays().find((d) => d.id === target)) || screen.getPrimaryDisplay();
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
    return win;
  },
  // Confidence monitor for the booth / stage.
  preview: () => openPreviewWindow(),
};

function reconcileWindows() {
  for (const key of OUTPUTS) {
    const win = windows[key];
    const wanted = state.outputs[key];
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

/**
 * Makes the lower-third window match the chosen display. A window already open moves to that display. Choosing
 * a display with no window opens one; choosing no display closes it.
 */
function placeLowerThirdWindow() {
  const target = state.lowerStyle.target;
  if (target == null) {
    apply({ type: 'output/set', output: 'lowerThird', on: false });
    return;
  }
  const display = screen.getAllDisplays().find((d) => d.id === target) ?? screen.getPrimaryDisplay();
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
  primary: createRemoteViewServer({ distDir: path.join(__dirname, '../dist'), role: 'primary', canConnect: canAcceptPhone, onControl: controlFromPhone }),
  secondary: createRemoteViewServer({ distDir: path.join(__dirname, '../dist'), role: 'secondary', canConnect: canAcceptPhone }),
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
  if (result.ok) view.push(remoteViewSnapshot(state));
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
    if (remoteViews[role].running()) remoteViews[role].push(remoteViewSnapshot(state));
  }
  for (const win of Object.values(windows)) {
    if (win && !win.isDestroyed()) win.webContents.send('live:state', state);
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

function apply(action) {
  const prev = state;
  const next = liveReducer(state, action);
  if (next === state) return;
  state = next;
  if (prev.queuePlanId !== next.queuePlanId || prev.queueCursor !== next.queueCursor || prev.pw?.sessionId !== next.pw?.sessionId) saveQueueState();
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

/**
 * Opens the database named in config.json and checks that it answers. If that fails (for
 * example, the network drive is unplugged), the app opens the local copy and reports it as
 * an error, so the service can still run. If the local copy itself fails, the app stops.
 */
function openConfiguredDatabase() {
  const userData = app.getPath('userData');
  const configured = resolveDatabasePath(userData, readConfig(userData));
  const local = defaultDatabasePath(userData);

  // setupAnnouncements proves the file answers (SELECT 1) before it registers any IPC,
  // so a failed attempt leaves nothing behind for the fallback to collide with.
  const attempt = (dbPath) => setupAnnouncements({ loadRoute: load, preload: webPreferences.preload, dbPath });

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
  windows.operator = win;
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
  return applyImport(announcements.db, data, choices ?? {});
});

ipcMain.handle('library:cancel', () => {
  pendingLibraryImport = null;
});

// ---- Cloud sync: linking this laptop with a one-time code. The token stays encrypted on this computer. ----
const cloudFile = () => path.join(app.getPath('userData'), 'cloud-device.bin');
// The cloud address comes from the environment first, then from config.json. Only http and https addresses are used.
const cloudUrl = () => {
  const value = process.env.APCCMMA_CLOUD_URL || readConfig(app.getPath('userData')).cloud_url || '';
  return /^https?:\/\//.test(value) ? value : '';
};
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
ipcMain.handle('cloud:status', () => cloud().status());
ipcMain.handle('cloud:link', (_event, input) => cloud().link(String(input?.code ?? ''), String(input?.label ?? '').slice(0, 80)));
ipcMain.handle('cloud:unlink', () => cloud().unlink());
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
ipcMain.on('live:dispatch', (_event, action) => apply(action));
ipcMain.handle('launch:open', (_event, target) => {
  if (typeof target !== 'string' || !target) return;
  return /^https?:\/\//i.test(target) ? shell.openExternal(target) : shell.openPath(target);
});


app.whenReady().then(() => {
  // No default menu: it would steal F11 (fullscreen) and Ctrl+R from our hotkeys.
  Menu.setApplicationMenu(null);
  // The saved projector settings apply before any window opens, so the first projector window already uses them.
  state = liveReducer(state, { type: 'settings/projector', value: readConfig(app.getPath('userData')).projector });
  state = liveReducer(state, { type: 'settings/welcome', value: readConfig(app.getPath('userData')).welcome });
  state = liveReducer(state, { type: 'lowerStyle/set', value: readConfig(app.getPath('userData')).lower_third });
  announcements = openConfiguredDatabase();
  setupLyrics(announcements.db);
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
  setupNotes(announcements.db);
  setupWhiteboard(announcements.db);
  // The browser source: the lower third at http://127.0.0.1:3002/lower-third, updated live.
  lowerThirdServer = createLowerThirdServer({ distDir: path.join(__dirname, '../dist') });
  void lowerThirdServer.start();
  // Remote view starts only when the operator turned it on last time.
  void syncRemoteView();
  if (state.lowerStyle.target != null) placeLowerThirdWindow();
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
  setupUpdater({ userData: app.getPath('userData') });
  createOperator();
});

app.on('will-quit', () => {
  void stopRemoteViews();
  media?.close();
  announcements?.close();
});

app.on('window-all-closed', () => app.quit());

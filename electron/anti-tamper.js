// Debugger and DevTools lockout for the packaged app. Imported first by main.js, so the launch check runs before any other app module is
// evaluated: no database is opened and no window exists yet when a debugging flag closes the app.
//
// Only the packaged app is guarded. `npm run dev`, the tests and the CDP checks used while building the app run unpackaged and keep their
// debugging flags.
//
// What this can and cannot do: it closes the app when it was started with a debugging flag, and it keeps DevTools closed. It cannot
// stop someone who has already paused the app at its first line (--inspect-brk) and attached a debugger: their debugger runs before
// this file. Turning Node's inspector off in the executable itself (Electron's EnableNodeCliInspectArguments fuse) is what closes that.
// No timers and no polling: the launch check runs once, and the DevTools guard runs only on key presses and DevTools events.
import { app } from 'electron';
import fs from 'node:fs';
import inspector from 'node:inspector';
import path from 'node:path';

/**
 * Switches that open a debugger or weaken the app's checks. The Node inspector (--inspect, --inspect-brk and Electron's
 * --inspect-brk-node), Chromium's DevTools protocol (--remote-debugging-port, --remote-debugging-pipe), verbose logging to the console
 * (--enable-logging), and switching off certificate checks (--ignore-certificate-errors), which would let the cloud sync be intercepted.
 */
export const FORBIDDEN_SWITCHES = [
  'inspect',
  'inspect-brk',
  'inspect-brk-node',
  'remote-debugging-port',
  'remote-debugging-pipe',
  'enable-logging',
  'ignore-certificate-errors',
];

/** The Node inspector switches. They are also refused in NODE_OPTIONS, which Node reads as if they were on the command line. */
const INSPECT_SWITCHES = new Set(['inspect', 'inspect-brk', 'inspect-brk-node']);

export const SECURITY_LOG = 'security.log';
const MAX_LOG_BYTES = 256 * 1024;

/**
 * The switch name in one argument, in lower case, or null when it is not a switch. Chromium on Windows also takes `-` and `/` as switch
 * prefixes and ignores case, so `/Remote-Debugging-Port=9222` counts the same as `--remote-debugging-port=9222`.
 */
export function switchName(arg, platform = process.platform) {
  const text = String(arg ?? '');
  const match = (platform === 'win32' ? /^(?:--|-|\/)([^=\s]+)/ : /^--?([^=\s]+)/).exec(text);
  return match ? match[1].toLowerCase() : null;
}

/** The forbidden switches in a list of arguments. A bare `--` ends the switches, as it does for Chromium. */
export function forbiddenIn(args, { platform = process.platform, only = null } = {}) {
  const found = [];
  for (const arg of args ?? []) {
    if (arg === '--') break;
    const name = switchName(arg, platform);
    if (name && FORBIDDEN_SWITCHES.includes(name) && (!only || only.has(name))) found.push(name);
  }
  return found;
}

/**
 * Every debugging flag this process was started with, from all the places a flag can come in: the command line (as written, and as
 * Chromium read it), Node's own arguments, NODE_OPTIONS, and the inspector itself (open for any reason). Returns the names, each once.
 */
export function findLaunchFlags({ argv = [], execArgv = [], nodeOptions = '', platform = process.platform, hasSwitch = () => false, inspectorUrl } = {}) {
  const found = new Set([
    ...forbiddenIn(argv.slice(1), { platform }),
    ...forbiddenIn(execArgv, { platform }),
    ...forbiddenIn(String(nodeOptions ?? '').split(/\s+/).filter(Boolean), { platform, only: INSPECT_SWITCHES }),
  ]);
  for (const name of FORBIDDEN_SWITCHES) if (hasSwitch(name)) found.add(name);
  if (inspectorUrl) found.add('inspect');
  return [...found];
}

/** Appends one line to userData/security.log. A full log starts again, so it never grows past MAX_LOG_BYTES. Never throws. */
export function writeSecurityLog(event, details = {}, { userData = safeUserData(), now = new Date() } = {}) {
  const line = `${JSON.stringify({ at: now.toISOString(), event, ...details })}\n`;
  try {
    // No console line: the packaged app has no console, and with a debugger attached a console write goes to it first and slows the exit.
    if (!userData) return;
    const file = path.join(userData, SECURITY_LOG);
    fs.mkdirSync(userData, { recursive: true });
    const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
    if (size + line.length > MAX_LOG_BYTES) fs.writeFileSync(file, line);
    else fs.appendFileSync(file, line);
  } catch {
    // A log that cannot be written never stops the check it reports on.
  }
}

function safeUserData() {
  try {
    return app.getPath('userData');
  } catch {
    return null;
  }
}

/**
 * The launch check. In the packaged app, a debugging flag ends the process at once: it is logged and the app exits with code 1. No
 * dialog is shown first: while one waited for a click, the debugger or DevTools port the flag opened would already be listening.
 * Returns the flags found (the process is gone before the caller sees them in the packaged app).
 */
export function auditLaunch({
  electronApp = app,
  argv = process.argv,
  execArgv = process.execArgv,
  nodeOptions = process.env.NODE_OPTIONS,
  platform = process.platform,
  inspectorUrl = inspector.url(),
  exit = (code) => {
    electronApp.exit(code);
    // app.exit() returns before the process is gone; nothing more of the app may run in the meantime.
    process.exit(code);
  },
  log = writeSecurityLog,
} = {}) {
  if (!electronApp.isPackaged) return [];
  const hasSwitch = (name) => {
    try {
      return electronApp.commandLine.hasSwitch(name);
    } catch {
      return false;
    }
  };
  const found = findLaunchFlags({ argv, execArgv, nodeOptions, platform, hasSwitch, inspectorUrl });
  if (found.length) {
    log('debug-flags-refused', { flags: found });
    exit(1);
  }
  return found;
}

/**
 * Whether a key press opens DevTools in Chromium: F12, Ctrl+Shift+I or Ctrl+Shift+J, and on a Mac Cmd+Option+I or Cmd+Option+J. The
 * physical key (`code`) is used, since Option changes the character a Mac key types. Held-key repeats count too.
 */
export function isDevToolsShortcut(input, platform = process.platform) {
  if (!input || input.type !== 'keyDown') return false;
  if (input.key === 'F12' || input.code === 'F12') return true;
  const letter = typeof input.code === 'string' && input.code.startsWith('Key') ? input.code.slice(3).toLowerCase() : String(input.key ?? '').toLowerCase();
  if (letter !== 'i' && letter !== 'j') return false;
  if (platform === 'darwin') return Boolean(input.meta && input.alt && !input.control);
  return Boolean(input.control && input.shift && !input.alt && !input.meta);
}

const guardedContents = new WeakSet();

/**
 * Guards one page: the DevTools keys never reach it, and DevTools opened any other way is closed again at once and logged. A page is only
 * guarded once, as the operator window is reached both by the app-wide lockout and by setupAntiTamper.
 */
export function guardWebContents(contents, { platform = process.platform, log = writeSecurityLog } = {}) {
  if (guardedContents.has(contents)) return;
  guardedContents.add(contents);
  contents.on('before-input-event', (event, input) => {
    if (isDevToolsShortcut(input, platform)) event.preventDefault();
  });
  contents.on('devtools-opened', () => {
    let url = '';
    try {
      url = contents.getURL();
    } catch {
      url = '';
    }
    log('devtools-closed', { url });
    contents.closeDevTools();
  });
}

/** In the packaged app, guards every page the app creates from now on: windows, hidden renderers and DevTools' own page. */
export function installDevToolsLockout({ electronApp = app, platform = process.platform, log = writeSecurityLog } = {}) {
  if (!electronApp.isPackaged) return false;
  electronApp.on('web-contents-created', (_event, contents) => guardWebContents(contents, { platform, log }));
  return true;
}

/** The renderer settings every window with the app's bridge is created with. */
export const SECURE_WEB_PREFERENCES = Object.freeze({
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
});

/** Whether a page may navigate to `url`: the app's own files or the local machine. electron/web-lockdown.js then narrows this to the built page. */
export function isTrustedNavigation(url) {
  try {
    const target = new URL(url);
    return target.protocol === 'file:' || ((target.protocol === 'http:' || target.protocol === 'https:') && target.hostname === 'localhost');
  } catch {
    return false;
  }
}

/** Locks down one window of the packaged app: no DevTools, no leaving for an outside address, no pop-ups. An unpackaged run is left alone. */
export function setupAntiTamper(win, isDev, { platform = process.platform, log = writeSecurityLog } = {}) {
  if (isDev) return false;
  const contents = win.webContents;
  guardWebContents(contents, { platform, log });
  contents.on('will-navigate', (event, url) => {
    const target = event.url ?? url;
    if (isTrustedNavigation(target)) return;
    event.preventDefault();
    log('navigation-blocked', { url: target });
  });
  contents.setWindowOpenHandler(({ url }) => {
    log('window-open-denied', { url });
    return { action: 'deny' };
  });
  return true;
}

// Runs as this module is imported, before main.js's other imports are evaluated. In the tests (unpackaged, Electron stubbed) both do nothing.
auditLaunch();
installDevToolsLockout();

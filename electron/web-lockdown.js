// Keeps every window of the app on the app's own page, and refuses the browser permissions it has no use for. Electron's defaults allow all
// of this: a page can go to any address or open new windows, and whatever page it lands on still has the whole window.apcc bridge. Nothing in
// the app does so today; this makes sure no link or bad content ever can. No Electron import here, so it can be tested under plain Node.
import { pathToFileURL } from 'node:url';

/** The only permissions a page of the app ever asks for: full screen, and putting an address or a temporary password on the clipboard. */
export const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write']);

/**
 * Whether `url` is the app's own page. In development that is anything on the dev server; packaged, it is the one built page, whatever its
 * `#/route`. `entryFile` is the built index.html.
 */
export function isOwnPage(url, { devUrl = null, entryFile, platform = process.platform }) {
  let target;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  if (devUrl) {
    try {
      return target.origin === new URL(devUrl).origin;
    } catch {
      return false;
    }
  }
  if (target.protocol !== 'file:') return false;
  const entry = pathToFileURL(entryFile).pathname;
  return platform === 'win32' ? target.pathname.toLowerCase() === entry.toLowerCase() : target.pathname === entry;
}

/**
 * Guards one page: it cannot open a new window, and cannot leave the app. A hash change is an in-page navigation, which does not come here,
 * and a window the app loads itself with loadURL or loadFile does not either, so the app's own hidden renderers are not affected.
 */
export function lockDownContents(contents, { isAllowed, log = console }) {
  contents.setWindowOpenHandler(() => {
    log.warn?.('[security] A page tried to open a new window. It was refused.');
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (isAllowed(event.url ?? url)) return;
    event.preventDefault();
    log.warn?.('[security] A page tried to leave the app. It was refused.');
  });
}

/** Answers every permission request on one session from `allowed`. */
export function restrictPermissions(session, { allowed = ALLOWED_PERMISSIONS } = {}) {
  session.setPermissionRequestHandler((_contents, permission, callback) => callback(allowed.has(permission)));
}

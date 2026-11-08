// App-wide hotkeys, caught in the main process before any page sees the key, so they work from every APCCMMA window: the operator
// console, the projector, the mirror and the slide editor.
//
// These are deliberately not `globalShortcut`s. A global shortcut belongs to the whole computer: it would take Ctrl+Shift+A away from OBS,
// the browser and every other program on the booth PC, even while APCCMMA is in the background.

/** The channel that tells the operator console to open (or close) the Sanctuary Alert. */
export const ALERT_TOGGLE_CHANNEL = 'sanctuary-alert:toggle-modal';

/**
 * Whether an Electron `before-input-event` input is the Sanctuary Alert hotkey: Ctrl+Shift+A, or Cmd+Shift+A on a Mac. Alt must be up, so
 * Ctrl+Alt+Shift+A (AltGr layouts) is left alone. A held key's repeats do not count.
 */
export function isSanctuaryAlertHotkey(input, platform = process.platform) {
  if (!input || input.type !== 'keyDown' || input.isAutoRepeat) return false;
  if (typeof input.key !== 'string' || input.key.toLowerCase() !== 'a') return false;
  const primary = platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta;
  return Boolean(primary && input.shift && !input.alt);
}

/** Listens for the app-wide hotkeys on one window. `onAlert(win)` runs for the Sanctuary Alert hotkey; the page never sees that key. */
export function attachAppHotkeys(win, { onAlert, platform = process.platform }) {
  win.webContents.on('before-input-event', (event, input) => {
    if (!isSanctuaryAlertHotkey(input, platform)) return;
    event.preventDefault();
    onAlert(win);
  });
}

/**
 * Whether an input is the Force Failover hotkey: Ctrl+Shift+B, or Cmd+Shift+B on a Mac (B for Blackout, beside F11 and B, Black Screen).
 * Not Ctrl+Shift+F, which toggles the operator console's fullscreen. Alt must be up, and a held key's repeats do not count, so holding the
 * keys cannot flicker the sanctuary screen.
 */
export function isFailoverHotkey(input, platform = process.platform) {
  if (!input || input.type !== 'keyDown' || input.isAutoRepeat) return false;
  if (typeof input.key !== 'string' || input.key.toLowerCase() !== 'b') return false;
  const primary = platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta;
  return Boolean(primary && input.shift && !input.alt);
}

/** Listens for the Force Failover hotkey on one window. `onFailover(win)` runs for it; the page never sees that key. */
export function attachFailoverHotkey(win, { onFailover, platform = process.platform }) {
  win.webContents.on('before-input-event', (event, input) => {
    if (!isFailoverHotkey(input, platform)) return;
    event.preventDefault();
    onFailover(win);
  });
}

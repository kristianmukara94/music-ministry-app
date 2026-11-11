import { BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { CHURCH_NAME_MAX_LENGTH, readConfig, writeConfig } from './config.js';

// The parish profile: the name and logo the app shows in the sidebar, on the projector's idle and failover screens and on the lower third.
// The name lives in config.json. The logo is a PNG in userData/assets, per machine, like the rest of config.json.

export const LOGO_DIR_NAME = 'assets';
export const LOGO_FILE_NAME = 'church-logo.png';
/**
 * The largest logo accepted from the window. The setup form crops and resizes every upload (SVG included) to a 512 px PNG before it is sent,
 * which is well under this; the limit stops a bad caller from writing a huge file.
 */
export const LOGO_MAX_BYTES = 4 * 1024 * 1024;
/** The largest side, in pixels, accepted in the PNG header. */
export const LOGO_MAX_SIDE = 2048;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Checks that `bytes` is a PNG of a sensible size. Throws with a message the form can show. Returns the bytes as a Buffer. */
export function checkLogoPng(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error('The logo must be sent as image bytes.');
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length > LOGO_MAX_BYTES) throw new Error('The logo is too large. Choose a smaller image.');
  // The signature, then the IHDR chunk: length (4), "IHDR" (4), width (4), height (4).
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE) || buf.toString('latin1', 12, 16) !== 'IHDR') {
    throw new Error('The logo could not be read as an image.');
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width < 1 || height < 1 || width > LOGO_MAX_SIDE || height > LOGO_MAX_SIDE) {
    throw new Error(`The logo must be at most ${LOGO_MAX_SIDE} pixels on each side.`);
  }
  return buf;
}

/** Checks the parish name the operator typed, and returns it trimmed. */
export function checkChurchName(input) {
  const name = typeof input === 'string' ? input.trim().replace(/\s+/g, ' ') : '';
  if (!name) throw new Error('Enter the parish or church name.');
  if (name.length > CHURCH_NAME_MAX_LENGTH) throw new Error(`The name must be ${CHURCH_NAME_MAX_LENGTH} characters or fewer.`);
  return name;
}

/** Profile logic. No window or IPC, so it can be tested on its own. */
export function createChurchProfileService({ userData, onChanged = () => {} }) {
  const logoFile = path.join(userData, LOGO_DIR_NAME, LOGO_FILE_NAME);
  // The logo as a data URL, kept so every window's request does not read and encode the file again. Keyed by the saved version.
  let cached = { version: null, dataUrl: null };

  /** The saved logo's path, or null when there is no custom logo (or its file has gone missing). */
  const customLogoPath = () => (readConfig(userData).church_logo_version && fs.existsSync(logoFile) ? logoFile : null);

  const logoDataUrl = (version) => {
    if (!version) return null;
    if (cached.version === version) return cached.dataUrl;
    try {
      const dataUrl = `data:image/png;base64,${fs.readFileSync(logoFile).toString('base64')}`;
      cached = { version, dataUrl };
      return dataUrl;
    } catch {
      // The file was deleted by hand: the default emblem shows, rather than a broken image on the projector.
      return null;
    }
  };

  return {
    logoPath: customLogoPath,

    /** The profile as the windows use it. `logoDataUrl` is null when the default APCCMMA emblem should show. */
    get() {
      const config = readConfig(userData);
      const dataUrl = logoDataUrl(config.church_logo_version);
      return {
        churchName: config.church_name ?? config.registered_church ?? '',
        logoPath: dataUrl ? logoFile : null,
        logoDataUrl: dataUrl,
        logoVersion: dataUrl ? config.church_logo_version : null,
        onboarded: config.onboarded,
      };
    },

    /**
     * Saves the name and, when given, the logo, and marks setup as done. `logo`: PNG bytes to use a new logo, null to go back to the default
     * emblem, or undefined to keep the current one. Everything is checked before anything is written, so a bad logo leaves the old profile.
     */
    save({ name, logo } = {}) {
      const churchName = checkChurchName(name);
      const png = logo === undefined || logo === null ? logo : checkLogoPng(logo);
      const patch = { church_name: churchName, onboarded: true };

      if (png) {
        fs.mkdirSync(path.dirname(logoFile), { recursive: true });
        // Temp file, then rename, so a crash mid-write never leaves a half-written logo on the projector.
        const temp = `${logoFile}.tmp`;
        fs.writeFileSync(temp, png);
        fs.renameSync(temp, logoFile);
        // Always moves forward, even if two saves land in the same millisecond, so the browser source never keeps a stale copy.
        patch.church_logo_version = Math.max(Date.now(), (readConfig(userData).church_logo_version ?? 0) + 1);
      } else if (png === null) {
        fs.rmSync(logoFile, { force: true });
        patch.church_logo_version = null;
      }

      writeConfig(userData, patch);
      const profile = this.get();
      onChanged(profile);
      return profile;
    },
  };
}

/** Registers the `church:*` IPC channels and tells every window when the profile changes. Called once from the main process. */
export function setupChurchProfile({ userData, onChanged = () => {} }) {
  const service = createChurchProfileService({
    userData,
    onChanged: (profile) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('church:changed', profile);
      }
      onChanged(profile);
    },
  });
  ipcMain.handle('church:get_profile', () => service.get());
  ipcMain.handle('church:save_profile', (_event, input) => service.save(input));
  return service;
}

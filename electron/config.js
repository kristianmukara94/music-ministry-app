import fs from 'node:fs';
import path from 'node:path';
import { PROJECTOR_SETTINGS_DEFAULTS, sanitizeProjectorSettings } from '../shared/projector-settings.js';
import { LOWER_THIRD_DEFAULTS, sanitizeLowerThirdStyle } from '../shared/lower-third-style.js';
import { WELCOME_DEFAULTS, sanitizeWelcomeSettings } from '../shared/welcome-settings.js';
import { REMOTE_VIEW_DEFAULTS, sanitizeRemoteView } from '../shared/remote-view.js';
import { checkCloudAddress } from './cloud-address.js';

// Preferences that must be known before the database opens, so they live in a plain file
// in userData rather than in the database itself.
export const DB_FILE_NAME = 'apccmma.db';
export const LANGUAGES = ['en', 'tl', 'ceb'];
// Must match the [data-theme] blocks in src/styles.css.
export const THEME_IDS = ['obsidian', 'default', 'light', 'classic', 'olive', 'black-gold', 'deep-teal', 'burgundy', 'wine', 'slate', 'ice-blue', 'mint', 'sage', 'linen', 'shell'];
const FILE = 'config.json';

export const UPDATE_CHANNELS = ['stable', 'beta'];

const DEFAULTS = {
  database_path: null,
  default_language: 'en',
  theme: 'obsidian',
  preview_window_bounds: null,
  projector: PROJECTOR_SETTINGS_DEFAULTS,
  lower_third: LOWER_THIRD_DEFAULTS,
  welcome: WELCOME_DEFAULTS,
  remote_view: REMOTE_VIEW_DEFAULTS,
  update_channel: 'stable',
  skipped_version: null,
  remind_after: null,
  cloud_url: '',
  pause_on_metered: false,
  eula_accepted: false,
  registered_church: null,
  registered_location: null,
  registered_at: null,
};

/** The longest church name or location the registration accepts. */
export const REGISTRATION_MAX_LENGTH = 120;

/**
 * Checks the registration the operator typed, and returns it trimmed. Throws with a message the form can show,
 * so a blank or oversized name is refused here rather than saved.
 */
export function validateRegistration(input) {
  const church = typeof input?.church === 'string' ? input.church.trim() : '';
  const location = typeof input?.location === 'string' ? input.location.trim() : '';
  if (!church) throw new Error('Enter the church, parish, or ministry name.');
  if (!location) throw new Error('Enter the location or city.');
  if (church.length > REGISTRATION_MAX_LENGTH || location.length > REGISTRATION_MAX_LENGTH) {
    throw new Error(`Each name must be ${REGISTRATION_MAX_LENGTH} characters or fewer.`);
  }
  return { church, location };
}
// The smallest preview the operator can resize to. A saved size below this is treated as corrupt.
export const PREVIEW_MIN = { width: 480, height: 270 };

/** A saved window rectangle, or null when the stored value is missing or not a usable rectangle. */
function sanitizeBounds(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { x, y, width, height } = raw;
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width < PREVIEW_MIN.width || height < PREVIEW_MIN.height) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/** Keeps only known keys with valid values. Anything else falls back to the default. */
function sanitize(raw) {
  return {
    database_path: typeof raw.database_path === 'string' && raw.database_path.trim() ? raw.database_path : null,
    default_language: LANGUAGES.includes(raw.default_language) ? raw.default_language : DEFAULTS.default_language,
    theme: THEME_IDS.includes(raw.theme) ? raw.theme : DEFAULTS.theme,
    preview_window_bounds: sanitizeBounds(raw.preview_window_bounds),
    projector: sanitizeProjectorSettings(raw.projector),
    lower_third: sanitizeLowerThirdStyle(raw.lower_third),
    welcome: sanitizeWelcomeSettings(raw.welcome),
    remote_view: sanitizeRemoteView(raw.remote_view),
    update_channel: UPDATE_CHANNELS.includes(raw.update_channel) ? raw.update_channel : DEFAULTS.update_channel,
    skipped_version: typeof raw.skipped_version === 'string' && raw.skipped_version.trim() ? raw.skipped_version.trim() : null,
    remind_after: Number.isFinite(raw.remind_after) ? raw.remind_after : null,
    cloud_url: checkCloudAddress(raw.cloud_url).ok ? checkCloudAddress(raw.cloud_url).address : '',
    pause_on_metered: raw.pause_on_metered === true,
    eula_accepted: raw.eula_accepted === true,
    registered_church: typeof raw.registered_church === 'string' && raw.registered_church.trim() ? raw.registered_church.trim() : null,
    registered_location: typeof raw.registered_location === 'string' && raw.registered_location.trim() ? raw.registered_location.trim() : null,
    registered_at: typeof raw.registered_at === 'string' && !Number.isNaN(Date.parse(raw.registered_at)) ? raw.registered_at : null,
  };
}

export function readConfig(userData) {
  try {
    return sanitize(JSON.parse(fs.readFileSync(path.join(userData, FILE), 'utf8')));
  } catch {
    // First run, or an unreadable file. Defaults are safe: the local database.
    return { ...DEFAULTS };
  }
}

/** Merges `patch` into the stored config and writes it atomically (temp file, then rename). */
export function writeConfig(userData, patch) {
  // Refuse a bad value rather than quietly replacing the saved one with the default.
  if ('theme' in patch && !THEME_IDS.includes(patch.theme)) throw new Error('Unknown theme.');
  if ('default_language' in patch && !LANGUAGES.includes(patch.default_language)) {
    throw new Error('Language must be English, Tagalog, or Cebuano.');
  }
  const next = sanitize({ ...readConfig(userData), ...patch });
  const file = path.join(userData, FILE);
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(next, null, 2));
  fs.renameSync(temp, file);
  return next;
}

/** The database to open: the configured path, or the local file in userData. */
export function resolveDatabasePath(userData, config) {
  return config.database_path ?? defaultDatabasePath(userData);
}

export function defaultDatabasePath(userData) {
  return path.join(userData, DB_FILE_NAME);
}

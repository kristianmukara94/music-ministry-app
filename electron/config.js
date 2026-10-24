import fs from 'node:fs';
import path from 'node:path';
import { PROJECTOR_SETTINGS_DEFAULTS, sanitizeProjectorSettings } from '../shared/projector-settings.js';
import { LOWER_THIRD_DEFAULTS, sanitizeLowerThirdStyle } from '../shared/lower-third-style.js';
import { WELCOME_DEFAULTS, sanitizeWelcomeSettings } from '../shared/welcome-settings.js';

// Preferences that must be known before the database opens, so they live in a plain file
// in userData rather than in the database itself.
export const DB_FILE_NAME = 'apccmma.db';
export const LANGUAGES = ['en', 'tl', 'ceb'];
// Must match the [data-theme] blocks in src/styles.css.
export const THEME_IDS = ['default', 'light', 'classic', 'olive', 'black-gold', 'deep-teal', 'burgundy', 'wine', 'slate', 'ice-blue', 'mint', 'sage', 'linen', 'shell'];
const FILE = 'config.json';

const DEFAULTS = { database_path: null, default_language: 'en', theme: 'default', preview_window_bounds: null, projector: PROJECTOR_SETTINGS_DEFAULTS, lower_third: LOWER_THIRD_DEFAULTS, welcome: WELCOME_DEFAULTS };
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

// Church identity and branding: the rules shared by the desktop app, the web planner and the cloud API. Pure: no imports,
// so it runs in Electron, the browser and Node alike.
//
// A church is identified by its UUID (church_id). Its display code is for people to type, and its name is only text:
// nothing is keyed by name, so two churches may share one.

export const DEFAULT_BRANDING = {
  name: '',
  accentGold: '#ecc98a',
  fontChoice: 'Archivo',
};

/** The only fonts a church can pick. These are the bundled ones, so no font is fetched from outside. */
export const FONT_CHOICES = ['Archivo', 'Cormorant Garamond', 'JetBrains Mono'];

/** Display codes use no 0, O, 1 or I, so they read the same on a screen and on paper. */
export const DISPLAY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const DISPLAY_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

export const LOGO_MAX_BYTES = 500 * 1024;
export const NAME_MAX = 120;
const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * A display code from random bytes, for example K7QM-4XD2. `bytes` must have at least 8 values. The caller supplies them
 * from a secure random source, so the code can be tested without randomness.
 */
export function displayCodeFrom(bytes) {
  const chars = [...bytes.slice(0, 8)].map((b) => DISPLAY_CODE_ALPHABET[b % DISPLAY_CODE_ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

/** The code typed in on a laptop, tidied: spaces and case are ignored. Null when it cannot be a display code. */
export function normaliseDisplayCode(input) {
  const code = String(input ?? '').toUpperCase().replace(/[\s]/g, '');
  const dashed = code.includes('-') ? code : code.replace(/^(.{4})(.{4})$/, '$1-$2');
  return DISPLAY_CODE_PATTERN.test(dashed) ? dashed : null;
}

export const isChurchId = (value) => typeof value === 'string' && UUID.test(value);

/** Keeps only the branding fields a church may set, with safe values. Anything else falls back to the default. */
export function sanitiseBranding(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, NAME_MAX) : '';
  return {
    name,
    accentGold: typeof r.accentGold === 'string' && HEX_COLOUR.test(r.accentGold) ? r.accentGold.toLowerCase() : DEFAULT_BRANDING.accentGold,
    fontChoice: FONT_CHOICES.includes(r.fontChoice) ? r.fontChoice : DEFAULT_BRANDING.fontChoice,
  };
}

/** Refuses a branding change the operator typed, with a message the settings page can show. */
export function checkBrandingChange(patch) {
  if ('name' in patch && (typeof patch.name !== 'string' || !patch.name.trim())) throw new Error('Enter the church name.');
  if ('name' in patch && patch.name.trim().length > NAME_MAX) throw new Error(`The church name must be ${NAME_MAX} characters or fewer.`);
  if ('accentGold' in patch && !HEX_COLOUR.test(patch.accentGold)) throw new Error('The accent gold must be a colour such as #ecc98a.');
  if ('fontChoice' in patch && !FONT_CHOICES.includes(patch.fontChoice)) {
    throw new Error(`Choose one of the bundled fonts: ${FONT_CHOICES.join(', ')}.`);
  }
}

/**
 * Checks a logo by its bytes, not by its file name. PNG must begin with the PNG signature and SVG must be a plain SVG
 * image with no script, no event handlers and no outside links. Returns `{ ok: true, type }` or `{ ok: false, error }`.
 */
export function checkLogo(bytes) {
  const data = Buffer.from(bytes ?? []);
  if (data.length === 0) return { ok: false, error: 'The logo file is empty.' };
  if (data.length > LOGO_MAX_BYTES) return { ok: false, error: 'The logo is larger than 500 KB. Save a smaller copy and try again.' };

  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (data.subarray(0, 8).equals(PNG_SIGNATURE)) return { ok: true, type: 'image/png' };

  const text = data.toString('utf8').replace(/^﻿/, '').trimStart();
  const looksLikeSvg = (text.startsWith('<svg') || text.startsWith('<?xml')) && /<svg[\s>]/.test(text);
  if (looksLikeSvg) {
    if (/<script/i.test(text) || /\son[a-z]+\s*=/i.test(text) || /<foreignObject/i.test(text)) {
      return { ok: false, error: 'This SVG contains script or interactive parts. Use a plain logo image.' };
    }
    if (/(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/)/i.test(text)) {
      return { ok: false, error: 'This SVG links to another website. Use a logo with no outside links.' };
    }
    return { ok: true, type: 'image/svg+xml' };
  }
  return { ok: false, error: 'The logo must be a PNG or SVG image.' };
}

/**
 * The licence record names the church it was issued to. The app may sync only when that church is the one this laptop
 * is linked to. Returns `{ ok: true }` or `{ ok: false, message }` for the message the app shows.
 */
export function checkLicenceChurch(licenceChurchId, localChurchId) {
  if (!localChurchId) return { ok: false, message: 'This laptop is not linked to a church yet. Set up the church in Cloud sync.' };
  if (!licenceChurchId) return { ok: false, message: 'The licence is not tied to a church. Contact support before syncing.' };
  if (licenceChurchId !== localChurchId) {
    return { ok: false, message: 'This laptop\'s church does not match its licence. Sync is off until the licence and the church are the same.' };
  }
  return { ok: true };
}

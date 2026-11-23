// Plan Appearance: one plan's default look for every slide in it. A Holy Mass plan (mass_plans) or a Praise & Worship plan (pw_sessions)
// can carry its own background (a colour, a picture or a looping motion clip from the Media Library, with a dim over it) and its own type
// (font, size, weight, case, alignment, colour, drop shadow). Saved as JSON on the plan's row (`appearance_json`); see
// electron/plan-appearance.js. Pure: no Electron or React imports, so the main process, the outputs and the tests share it.
//
// Precedence, for every slide (resolveSlideLook in slide-look.js):
//   1. the slide's own look, set on air (Go Live "This Slide"), or a song or reading's own saved style;
//   2. the plan's appearance, when the plan is loaded for Go Live and its appearance is on (`enabled`);
//   3. the Global Appearance (the projector settings and the Live slide background).
// A typography key the plan leaves unset follows the Global Appearance, so a plan can change the font alone.

import { SLIDE_FONTS } from './projector-settings.js';
import { BACKGROUND_COLORS, TEXT_FONTS, normalizeHex } from './text-style.js';

export const PLAN_KINDS = Object.freeze(['mass', 'pw']);
export const PLAN_BACKGROUND_TYPES = Object.freeze(['color', 'image', 'motion']);
/** The size pills, as a share of each slide's normal size. 'max' is edge-to-edge (the Go Live MAX pill). */
export const PLAN_FONT_SIZES = Object.freeze([0.85, 1, 1.15, 1.25, 1.5, 2, 'max']);
export const PLAN_FONT_WEIGHTS = Object.freeze(['normal', 'semibold', 'bold']);
export const PLAN_TEXT_CASES = Object.freeze(['none', 'upper']);
export const PLAN_TEXT_ALIGNS = Object.freeze(['center', 'left', 'right']);
/** The dim over the background reaches 80%: past that the picture is gone and a colour would do. */
export const PLAN_DIM_MAX = 0.8;
/** The plan fonts: the projector's slide fonts (no system Georgia), sans-serif first, then serif and display faces. */
export const PLAN_FONTS = Object.freeze([...SLIDE_FONTS]);
/** CSS font-weight for each weight. Bold is 700, the weight lyrics are drawn in by default. */
export const PLAN_WEIGHT_CSS = Object.freeze({ normal: 400, semibold: 600, bold: 700 });

/** Sanctuary colours for the background: the slide colours the app already offers, then the liturgical season colours. */
export const PLAN_COLOR_PRESETS = Object.freeze([
  ...BACKGROUND_COLORS,
  { label: 'Rose Sunday', hex: '#4A1E2E' },
  { label: 'Martyr Red', hex: '#4A0F12' },
  { label: 'Easter White', hex: '#2B2A26' },
]);
/** Text colours: white, ivory, gold and black, as the slide styles offer, plus a soft sky blue for Marian feasts. */
export const PLAN_TEXT_COLORS = Object.freeze(['#FFFFFF', '#FAF6E9', '#ECC98A', '#BFDBFE', '#000000']);

/** A plan with nothing saved: it follows the Global Appearance. The background is kept ready for when Custom Plan Look is turned on. */
export const PLAN_APPEARANCE_DEFAULT = Object.freeze({
  enabled: false,
  background: Object.freeze({ type: 'color', color: '#000000', dimOpacity: 0 }),
  typography: Object.freeze({}),
});

const MEDIA_SRC = /^apcc-media:\/\/media\/(\d+)$/;

/** A dim from 0 to 0.8, in steps of 0.05. Anything else is 0. */
export function clampDim(value) {
  const n = Number(value);
  if (value === null || value === '' || !Number.isFinite(n)) return 0;
  return Math.round(Math.min(PLAN_DIM_MAX, Math.max(0, n)) * 20) / 20;
}

/** A size pill's value: one of PLAN_FONT_SIZES, else undefined (the size follows the Global Appearance). */
export function planFontSizeOf(value) {
  if (value === 'max') return 'max';
  const n = Math.round(Number(value) * 100) / 100;
  return value !== null && value !== '' && PLAN_FONT_SIZES.includes(n) ? n : undefined;
}

/** The library id in `apcc-media://media/<id>`, or null. */
export function mediaIdOfPath(path) {
  const match = MEDIA_SRC.exec(String(path ?? ''));
  return match ? match[1] : null;
}

function sanitizeBackground(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  const type = PLAN_BACKGROUND_TYPES.includes(b.type) ? b.type : 'color';
  const out = { type, color: normalizeHex(b.color) ?? PLAN_APPEARANCE_DEFAULT.background.color, dimOpacity: clampDim(b.dimOpacity) };
  // A picture or clip is kept only as a Media Library address. Its id is read from the address, so the two can never disagree.
  const path = typeof b.mediaPath === 'string' && MEDIA_SRC.test(b.mediaPath) ? b.mediaPath : null;
  if (path) {
    out.mediaPath = path;
    out.mediaId = mediaIdOfPath(path);
  }
  return out;
}

function sanitizeTypography(raw) {
  const t = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  if (PLAN_FONTS.includes(t.fontFamily)) out.fontFamily = t.fontFamily;
  const size = planFontSizeOf(t.fontSizeScale);
  if (size !== undefined) out.fontSizeScale = size;
  if (PLAN_FONT_WEIGHTS.includes(t.fontWeight)) out.fontWeight = t.fontWeight;
  if (PLAN_TEXT_CASES.includes(t.textCase)) out.textCase = t.textCase;
  if (PLAN_TEXT_ALIGNS.includes(t.textAlign)) out.textAlign = t.textAlign;
  const color = normalizeHex(t.textColor);
  if (color) out.textColor = color;
  if (typeof t.textShadow === 'boolean') out.textShadow = t.textShadow;
  return out;
}

/** The appearance as it may be saved and drawn: only known keys with valid values. Anything unreadable is the default (Use Global Default). */
export function sanitizePlanAppearance(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  return { enabled: a.enabled === true, background: sanitizeBackground(a.background), typography: sanitizeTypography(a.typography) };
}

/** The appearance stored in a plan's `appearance_json`. NULL, blank or broken JSON reads as the default. */
export function parsePlanAppearance(json) {
  if (typeof json !== 'string' || !json.trim()) return sanitizePlanAppearance(null);
  try {
    return sanitizePlanAppearance(JSON.parse(json));
  } catch {
    return sanitizePlanAppearance(null);
  }
}

/** The text for `appearance_json`, or null when the plan has nothing of its own (the default), so an untouched plan keeps a NULL column. */
export function serializePlanAppearance(appearance) {
  const clean = sanitizePlanAppearance(appearance);
  return samePlanAppearance(clean, PLAN_APPEARANCE_DEFAULT) ? null : JSON.stringify(clean);
}

/** Whether two appearances draw the same, after sanitizing. */
export function samePlanAppearance(a, b) {
  return JSON.stringify(sanitizePlanAppearance(a)) === JSON.stringify(sanitizePlanAppearance(b));
}

/** True when the plan's own look is on (Custom Plan Look). Off is Use Global Default. */
export const planLookActive = (appearance) => appearance?.enabled === true;

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Settings layer

/**
 * The projector settings a plan's typography replaces, for the keys it sets: the font, the size (MAX is edge-to-edge, a percentage turns it
 * off), the case and the alignment. Empty when the plan's look is off.
 */
export function planSettingsOverlay(appearance) {
  if (!planLookActive(appearance)) return {};
  const t = sanitizeTypography(appearance.typography);
  const out = {};
  if (t.fontFamily) out.slideFont = t.fontFamily;
  if (t.fontSizeScale === 'max') out.edgeToEdge = true;
  else if (typeof t.fontSizeScale === 'number') Object.assign(out, { slideFontScale: t.fontSizeScale, edgeToEdge: false });
  if (t.textCase) out.textCase = t.textCase === 'upper' ? 'uppercase' : 'original';
  if (t.textAlign) out.slideAlign = t.textAlign;
  return out;
}

// One merged object per settings object and appearance, so a selector that returns settings keeps its identity between renders.
const mergedSettings = new WeakMap();

/** The projector settings with the plan's typography over them. The same object back when the plan changes nothing. */
export function applyPlanAppearance(settings, appearance) {
  if (!settings || !appearance || !planLookActive(appearance)) return settings;
  const overlay = planSettingsOverlay(appearance);
  if (Object.keys(overlay).every((k) => settings[k] === overlay[k])) return settings;
  let byAppearance = mergedSettings.get(settings);
  if (!byAppearance) mergedSettings.set(settings, (byAppearance = new WeakMap()));
  let out = byAppearance.get(appearance);
  if (!out) byAppearance.set(appearance, (out = { ...settings, ...overlay }));
  return out;
}

/**
 * The plan's text styling that the projector settings have no key for: the weight (CSS), one colour for the words, and the drop shadow
 * (true forces it on, false takes it off). Null where the plan leaves it to the slide.
 */
export function planTextLook(appearance) {
  if (!planLookActive(appearance)) return { weight: null, color: null, shadow: null };
  const t = sanitizeTypography(appearance.typography);
  return { weight: t.fontWeight ? PLAN_WEIGHT_CSS[t.fontWeight] : null, color: t.textColor ?? null, shadow: typeof t.textShadow === 'boolean' ? t.textShadow : null };
}

/**
 * A short key for what changes how the words measure and paint: a surface keys its slide by it, so the fit runs again from scratch when the
 * plan's weight, colour or shadow changes (those are drawn by CSS, outside the fit's own dependencies).
 */
export function planLookSignature(appearance) {
  const look = planTextLook(appearance);
  return look.weight || look.color || look.shadow !== null ? `plan:${look.weight ?? ''}:${look.color ?? ''}:${look.shadow ?? ''}` : 'global';
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Background layer

/**
 * The background a plan draws behind its slides, or null when the plan's look is off. A picture or motion clip with no file chosen falls back
 * to the colour, so a slide is never left on an empty layer. `media` is in the shape the slide background layers take.
 */
export function planBackgroundOf(appearance) {
  if (!planLookActive(appearance)) return null;
  const b = sanitizeBackground(appearance.background);
  const media =
    b.type !== 'color' && b.mediaPath ? { kind: b.type === 'motion' ? 'video' : 'image', src: b.mediaPath, fit: 'cover', loop: true } : null;
  return { type: media ? b.type : 'color', color: b.color, media, dim: b.dimOpacity };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Which plan a slide belongs to

/** The kinds of slide a plan's look reaches: songs, prayers, readings, Scripture, notes and title cards. Pictures, decks of images, video,
 *  whiteboards, the Rosary and the Welcome screen keep their own design. */
const PLAN_FRAME_KINDS = new Set(['text', 'deck', 'lyrics', 'psalm', 'pw']);

/** Whether a plan's look reaches this kind of slide at all. */
export const planReachesFrame = (frame) => Boolean(frame && typeof frame === 'object' && PLAN_FRAME_KINDS.has(frame.kind));

/**
 * The plan background to draw behind `frame`, or null. A slide's own backdrop (Go Live "This Slide") and a song's own background colour win
 * over the plan's. A Media Library background the operator put live wins too: behind every slide when it is shown everywhere
 * (`backgroundEverywhere`), and behind Holy Mass text slides, which always drew it.
 */
export function planBackgroundShown({ frame, appearance, ownBackdrop = null, libraryBackground = false, backgroundEverywhere = false }) {
  const bg = planReachesFrame(frame) ? planBackgroundOf(appearance) : null;
  if (!bg) return null;
  if (frame.kind === 'pw') return ownBackdrop || (libraryBackground && backgroundEverywhere) ? null : bg;
  if (libraryBackground) return null;
  return frame.style && typeof frame.style === 'object' && frame.style.bgColor ? null : bg;
}

/** The appearance kept in the live state for the plan of `kind` that is loaded now, when its look is on; else null. */
export function loadedPlanAppearance(state, kind) {
  const entry = state?.planLooks?.[kind];
  if (!entry || !planLookActive(entry.appearance)) return null;
  const loaded = kind === 'mass' ? state.queuePlanId : state.pw?.sessionId;
  return loaded != null && entry.planId === loaded ? entry.appearance : null;
}

/**
 * The plan appearance `frame` is drawn with in `state`, or null (the Global Appearance). A Praise & Worship slide takes the loaded Praise &
 * Worship plan's; a Holy Mass song's title card, and every other text slide, the loaded Holy Mass plan's, unless Praise & Worship has the
 * projector, when its plan's look carries on for an item played from the library mid-session.
 */
export function planAppearanceFor(state, frame) {
  if (!planReachesFrame(frame)) return null;
  if (frame.kind === 'pw') return frame.massSong ? loadedPlanAppearance(state, 'mass') : loadedPlanAppearance(state, 'pw');
  return state?.projector?.source === 'PW_SESSION' ? loadedPlanAppearance(state, 'pw') : loadedPlanAppearance(state, 'mass');
}

// One merged state per state object and appearance (see applyPlanAppearance).
const mergedStates = new WeakMap();

/** The live state with a plan's typography over its projector settings. The same state back when the plan changes nothing. */
export function withPlanAppearance(state, appearance) {
  if (!state || !appearance) return state;
  const settings = applyPlanAppearance(state.settings, appearance);
  if (settings === state.settings) return state;
  let byAppearance = mergedStates.get(state);
  if (!byAppearance) mergedStates.set(state, (byAppearance = new WeakMap()));
  let out = byAppearance.get(appearance);
  if (!out) byAppearance.set(appearance, (out = { ...state, settings }));
  return out;
}

/** The plan appearance in the live state: who it belongs to and what it is. Kept only for the plans loaded now. */
export function planLookEntry(kind, planId, appearance) {
  if (!PLAN_KINDS.includes(kind) || planId == null) return null;
  return { planId, appearance: sanitizePlanAppearance(appearance) };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The Planner's controls

/** The next size pill from `size` (−1 smaller, +1 larger): A− and A+. Unset steps from 100%. MAX is the top. */
export function stepPlanFontSize(size, delta) {
  const at = PLAN_FONT_SIZES.indexOf(planFontSizeOf(size) ?? 1);
  return PLAN_FONT_SIZES[Math.min(PLAN_FONT_SIZES.length - 1, Math.max(0, at + delta))];
}

/** A size pill's label: "85%", "100%", "MAX". */
export const planFontSizeLabel = (size) => (size === 'max' ? 'MAX' : `${Math.round(Number(size) * 100)}%`);

/** The CSS font stack of a plan font key. */
export const planFontCss = (key) => TEXT_FONTS[key]?.css ?? null;

/** The badge on the Planner's Plan Appearance button: Global Default, or Custom Look with its colour or picture. */
export function planAppearanceBadge(appearance) {
  const bg = planBackgroundOf(appearance);
  if (!bg) return { custom: false, color: null, thumb: null, motion: false };
  return { custom: true, color: bg.color, thumb: bg.media ? bg.media.src : null, motion: bg.type === 'motion' };
}

/**
 * The appearance as it may be kept on this laptop: a picture or clip whose Media Library item is not here (an import from another laptop,
 * an item deleted since) falls back to the colour. `hasMedia(id)` says whether the library holds the item.
 */
export function portablePlanAppearance(appearance, hasMedia) {
  const clean = sanitizePlanAppearance(appearance);
  const b = clean.background;
  if (b.type === 'color' || (b.mediaId && hasMedia(b.mediaId))) return clean;
  const { mediaId, mediaPath, ...rest } = b;
  return { ...clean, background: { ...rest, type: 'color' } };
}

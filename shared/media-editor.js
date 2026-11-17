// Non-destructive edits for Media Library items: framing, colour grade, backdrop optics and video trim. The settings are a plain object
// stored as JSON on the library record (media_assets.edit_settings_json) and carried on a staged/live background frame, so every screen
// (stage preview, projector, mirror, previews) draws the same picture from the same numbers. The file on disk never changes; "Save as New
// Copy" is the only path that bakes pixels, and it writes a new library item.
//
// Everything here is pure, so the projector, the Studio and the tests share one source of truth.

/** The width the blur radius is authored at. A screen of another width scales the radius, so a 12px blur looks the same everywhere. */
export const MEDIA_EDIT_REFERENCE_WIDTH = 1920;

export const MEDIA_ASPECT_RATIOS = ['16:9', '4:3', '1:1', '9:16', 'free'];
export const MEDIA_FIT_MODES = ['cover', 'contain', 'fill'];
export const MEDIA_TINT_BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay'];

/** Neutral settings: drawing a file with these is drawing the file as it is. */
export const DEFAULT_MEDIA_EDIT_SETTINGS = Object.freeze({
  // Transform & framing
  aspectRatio: '16:9',
  fitMode: 'cover',
  crop: Object.freeze({ x: 0, y: 0, width: 1, height: 1 }),
  zoom: 1,
  panX: 0,
  panY: 0,
  rotate: 0,
  flipH: false,
  flipV: false,
  // Colour grade & backdrop optics
  brightness: 0,
  contrast: 0,
  saturation: 100,
  warmth: 0,
  hueRotate: 0,
  blur: 0,
  vignette: 0,
  tintColor: '#000000',
  tintOpacity: 0,
  tintBlendMode: 'multiply',
  // Video & audio
  trimStart: 0,
  trimEnd: null,
  playbackSpeed: 1,
  volume: 0,
  fadeInSec: 0,
  fadeOutSec: 0,
});

/** Slider ranges, shared by the Studio's controls and the normaliser so the two can never disagree. */
export const MEDIA_EDIT_RANGES = Object.freeze({
  zoom: { min: 1, max: 3, step: 0.05 },
  panX: { min: -50, max: 50, step: 1 },
  panY: { min: -50, max: 50, step: 1 },
  rotate: { min: -180, max: 180, step: 1 },
  brightness: { min: -50, max: 50, step: 1 },
  contrast: { min: -50, max: 50, step: 1 },
  saturation: { min: 0, max: 200, step: 1 },
  warmth: { min: -50, max: 50, step: 1 },
  hueRotate: { min: -180, max: 180, step: 1 },
  blur: { min: 0, max: 24, step: 0.5 },
  vignette: { min: 0, max: 100, step: 1 },
  tintOpacity: { min: 0, max: 80, step: 1 },
  playbackSpeed: { min: 0.25, max: 2, step: 0.05 },
  volume: { min: 0, max: 100, step: 1 },
  fadeInSec: { min: 0, max: 3, step: 0.1 },
  fadeOutSec: { min: 0, max: 3, step: 0.1 },
});

/** The smallest crop side, as a share of the frame, and the shortest trimmed clip, in seconds. */
export const MIN_CROP = 0.05;
export const MIN_TRIM_SECONDS = 0.1;

const num = (value, fallback) => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
/** Rounds to the slider's step, without float dust (0.1 + 0.2 stays 0.3). */
const snap = (n, step) => Number((Math.round(n / step) * step).toFixed(4));
const ranged = (key, value) => {
  const r = MEDIA_EDIT_RANGES[key];
  return snap(clamp(num(value, DEFAULT_MEDIA_EDIT_SETTINGS[key]), r.min, r.max), r.step);
};
const oneOf = (list, value, fallback) => (list.includes(value) ? value : fallback);
const HEX = /^#[0-9a-f]{6}$/i;

/** A crop rectangle inside the frame: each side at least MIN_CROP, never past an edge. */
export function normalizeCrop(crop) {
  const c = crop && typeof crop === 'object' ? crop : {};
  const width = clamp(num(c.width, 1), MIN_CROP, 1);
  const height = clamp(num(c.height, 1), MIN_CROP, 1);
  const x = clamp(num(c.x, 0), 0, 1 - width);
  const y = clamp(num(c.y, 0), 0, 1 - height);
  const r = (n) => Number(n.toFixed(5));
  return { x: r(x), y: r(y), width: r(width), height: r(height) };
}

/**
 * Settings from anything: a parsed JSON column, a partial patch, null, or junk. Missing or invalid fields take the neutral value, numbers are
 * clamped to their slider range and step, and the trim window is kept in order (`duration`, when known, caps it).
 */
export function normalizeMediaEditSettings(input, duration) {
  const s = input && typeof input === 'object' ? input : {};
  const d = DEFAULT_MEDIA_EDIT_SETTINGS;
  const out = {
    aspectRatio: oneOf(MEDIA_ASPECT_RATIOS, s.aspectRatio, d.aspectRatio),
    fitMode: oneOf(MEDIA_FIT_MODES, s.fitMode, d.fitMode),
    crop: normalizeCrop(s.crop),
    zoom: ranged('zoom', s.zoom),
    panX: ranged('panX', s.panX),
    panY: ranged('panY', s.panY),
    rotate: ranged('rotate', s.rotate),
    flipH: s.flipH === true,
    flipV: s.flipV === true,
    brightness: ranged('brightness', s.brightness),
    contrast: ranged('contrast', s.contrast),
    saturation: ranged('saturation', s.saturation),
    warmth: ranged('warmth', s.warmth),
    hueRotate: ranged('hueRotate', s.hueRotate),
    blur: ranged('blur', s.blur),
    vignette: ranged('vignette', s.vignette),
    tintColor: typeof s.tintColor === 'string' && HEX.test(s.tintColor) ? s.tintColor.toLowerCase() : d.tintColor,
    tintOpacity: ranged('tintOpacity', s.tintOpacity),
    tintBlendMode: oneOf(MEDIA_TINT_BLEND_MODES, s.tintBlendMode, d.tintBlendMode),
    playbackSpeed: ranged('playbackSpeed', s.playbackSpeed),
    volume: ranged('volume', s.volume),
    fadeInSec: ranged('fadeInSec', s.fadeInSec),
    fadeOutSec: ranged('fadeOutSec', s.fadeOutSec),
    ...normalizeTrim(s.trimStart, s.trimEnd, duration),
  };
  return out;
}

/**
 * The trim window in order: start at 0 or later, end null (the whole clip) or at least MIN_TRIM_SECONDS after start. With a known duration,
 * start stays inside the clip and an end at (or past) the clip's end becomes null, so the clip simply plays to its natural end.
 */
export function normalizeTrim(trimStart, trimEnd, duration) {
  const known = Number.isFinite(duration) && duration > 0 ? duration : null;
  let start = Math.max(0, num(trimStart, 0));
  if (known !== null) start = Math.min(start, Math.max(0, known - MIN_TRIM_SECONDS));
  let end = trimEnd === null || trimEnd === undefined || trimEnd === '' ? null : num(trimEnd, null);
  if (end !== null) {
    end = Math.max(end, start + MIN_TRIM_SECONDS);
    if (known !== null && end >= known - 0.001) end = null;
  }
  const r = (n) => Number(n.toFixed(3));
  return { trimStart: r(start), trimEnd: end === null ? null : r(end) };
}

/** Parses the stored column. NULL, empty or broken JSON is the neutral look, so an item from before the Studio loads exactly as it did. */
export function parseMediaEditSettings(json) {
  if (json === null || json === undefined || json === '') return normalizeMediaEditSettings(null);
  try {
    return normalizeMediaEditSettings(typeof json === 'string' ? JSON.parse(json) : json);
  } catch {
    return normalizeMediaEditSettings(null);
  }
}

/** The JSON to store: null when the settings change nothing, so an untouched item keeps a NULL column. */
export function serializeMediaEditSettings(settings) {
  const s = normalizeMediaEditSettings(settings);
  return hasActiveMediaEdits(s) ? JSON.stringify(s) : null;
}

const VISUAL_KEYS = [
  'fitMode', 'zoom', 'panX', 'panY', 'rotate', 'flipH', 'flipV',
  'brightness', 'contrast', 'saturation', 'warmth', 'hueRotate', 'blur', 'vignette',
  'trimStart', 'trimEnd', 'playbackSpeed', 'volume', 'fadeInSec', 'fadeOutSec',
];

const cropIsFull = (c) => c.x === 0 && c.y === 0 && c.width === 1 && c.height === 1;

/**
 * True when the settings change what is drawn or played. The aspect-ratio pill is only the crop tool's lock, so on its own it is not an
 * edit; a tint at 0% opacity is not either, whatever its colour. Accepts settings, a library item carrying `edit`, or null.
 */
export function hasActiveMediaEdits(input) {
  if (!input || typeof input !== 'object') return false;
  const raw = 'edit' in input && !('brightness' in input) ? input.edit : input;
  if (!raw) return false;
  const s = normalizeMediaEditSettings(raw);
  const d = DEFAULT_MEDIA_EDIT_SETTINGS;
  if (!cropIsFull(s.crop)) return true;
  if (s.tintOpacity > 0) return true;
  return VISUAL_KEYS.some((k) => s[k] !== d[k]);
}

/** True when the colour/optics part differs from neutral (used for the "Before / After" toggle and the inline badge). */
export function hasColorEdits(settings) {
  const s = normalizeMediaEditSettings(settings);
  const d = DEFAULT_MEDIA_EDIT_SETTINGS;
  return s.tintOpacity > 0 || ['brightness', 'contrast', 'saturation', 'warmth', 'hueRotate', 'blur', 'vignette'].some((k) => s[k] !== d[k]);
}

const fmt = (n) => String(Number(n.toFixed(3)));

/**
 * The CSS `filter` chain, in a fixed order: brightness, contrast, saturate, sepia (warmth's golden cast), hue-rotate, blur. Each part
 * appears only when it changes something, and unedited settings give 'none'. `scale` is the drawn width over MEDIA_EDIT_REFERENCE_WIDTH,
 * so the blur radius follows the screen size. Canvas 2D's `ctx.filter` takes the same string, so a baked copy matches the screen.
 */
export function buildMediaFilterCss(settings, { scale = 1 } = {}) {
  const s = normalizeMediaEditSettings(settings);
  const parts = [];
  if (s.brightness !== 0) parts.push(`brightness(${fmt(1 + s.brightness / 100)})`);
  if (s.contrast !== 0) parts.push(`contrast(${fmt(1 + s.contrast / 100)})`);
  if (s.saturation !== 100) parts.push(`saturate(${fmt(s.saturation / 100)})`);
  if (s.warmth > 0) parts.push(`sepia(${fmt(s.warmth / 250)})`);
  if (s.hueRotate !== 0) parts.push(`hue-rotate(${fmt(s.hueRotate)}deg)`);
  const px = s.blur * (Number.isFinite(scale) && scale > 0 ? scale : 1);
  if (s.blur > 0) parts.push(`blur(${fmt(px)}px)`);
  return parts.length ? parts.join(' ') : 'none';
}

/**
 * The geometry of the transform: crop, zoom, pan, rotation and flips as one translate/scale/rotate/flip. The crop rectangle (a share of
 * the fitted frame) is scaled up until it fills the frame on its longer side and its centre is moved to the frame's centre; zoom multiplies
 * that scale and pan then moves the picture by a share of the frame. Flips are applied first, so a flipped crop still frames the same
 * part of the picture.
 */
export function mediaTransformParts(settings) {
  const s = normalizeMediaEditSettings(settings);
  const c = s.crop;
  const cropScale = 1 / Math.max(c.width, c.height);
  const scale = cropScale * s.zoom;
  const fx = s.flipH ? -1 : 1;
  const fy = s.flipV ? -1 : 1;
  // The crop's centre relative to the frame's centre, flipped, rotated and scaled as the picture will be.
  const cx = (c.x + c.width / 2 - 0.5) * fx;
  const cy = (c.y + c.height / 2 - 0.5) * fy;
  const rad = (s.rotate * Math.PI) / 180;
  const rx = cx * Math.cos(rad) - cy * Math.sin(rad);
  const ry = cx * Math.sin(rad) + cy * Math.cos(rad);
  const tx = (-rx * scale) * 100 + s.panX;
  const ty = (-ry * scale) * 100 + s.panY;
  const clean = (n) => (Math.abs(n) < 1e-9 ? 0 : Number(n.toFixed(4)));
  return { translateX: clean(tx), translateY: clean(ty), scale: clean(scale), rotate: s.rotate, flipX: fx, flipY: fy };
}

/** The CSS `transform` for the media element (origin at its centre). Unedited framing gives 'none'. */
export function buildMediaTransformCss(settings) {
  const t = mediaTransformParts(settings);
  const parts = [];
  if (t.translateX !== 0 || t.translateY !== 0) parts.push(`translate(${fmt(t.translateX)}%, ${fmt(t.translateY)}%)`);
  if (t.scale !== 1) parts.push(`scale(${fmt(t.scale)})`);
  if (t.rotate !== 0) parts.push(`rotate(${fmt(t.rotate)}deg)`);
  if (t.flipX !== 1 || t.flipY !== 1) parts.push(`scale(${t.flipX}, ${t.flipY})`);
  return parts.length ? parts.join(' ') : 'none';
}

/** The `object-fit` for the media element. */
export const mediaObjectFit = (settings) => normalizeMediaEditSettings(settings).fitMode;

/** The colour wash that carries warmth: gold for warm, blue for cool. Soft light keeps it a cast rather than a fill. */
export const WARM_WASH = '#ff9d2e';
export const COOL_WASH = '#2e7dff';

/**
 * The layers drawn over the media, bottom to top: the warmth wash, the liturgical tint, then the vignette. Each comes with the CSS that draws
 * it, so the projector, the Studio and the baking canvas stack the same layers in the same order.
 */
export function buildMediaOverlays(settings) {
  const s = normalizeMediaEditSettings(settings);
  const layers = [];
  if (s.warmth !== 0) {
    layers.push({
      kind: 'warmth',
      color: s.warmth > 0 ? WARM_WASH : COOL_WASH,
      opacity: Number((Math.abs(s.warmth) / 100 * 0.7).toFixed(3)),
      blendMode: 'soft-light',
    });
  }
  if (s.tintOpacity > 0) {
    layers.push({ kind: 'tint', color: s.tintColor, opacity: Number((s.tintOpacity / 100).toFixed(3)), blendMode: s.tintBlendMode });
  }
  if (s.vignette > 0) {
    const strength = Number((s.vignette / 100 * 0.85).toFixed(3));
    // Where the darkening starts, as a share of the way to the corners: a stronger vignette reaches further in.
    const inner = Number((60 - s.vignette * 0.25).toFixed(3));
    layers.push({
      kind: 'vignette',
      strength,
      inner,
      blendMode: 'normal',
      background: `radial-gradient(ellipse at center, rgba(0,0,0,0) ${fmt(inner)}%, rgba(0,0,0,${fmt(strength)}) 100%)`,
    });
  }
  return layers;
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Aspect-locked crop.
// ---------------------------------------------------------------------------------------------------------------------------------------

/** Width over height for a ratio name, or null for free. */
export function aspectValue(ratio) {
  if (ratio === 'free') return null;
  const m = /^(\d+):(\d+)$/.exec(String(ratio));
  return m ? Number(m[1]) / Number(m[2]) : 16 / 9;
}

/**
 * The largest crop of the chosen ratio that fits inside `crop`'s bounds around its centre, in frame shares. `frameAspect` is the frame's
 * width over height (16:9 on a projector), so a 16:9 crop in a 16:9 frame has equal width and height shares.
 */
export function cropForAspect(crop, ratio, frameAspect = 16 / 9) {
  const c = normalizeCrop(crop);
  const target = aspectValue(ratio);
  if (target === null) return c;
  // The crop's width share over its height share, for that ratio in this frame.
  const shareRatio = target / frameAspect;
  let width = c.width;
  let height = width / shareRatio;
  if (height > c.height) {
    height = c.height;
    width = height * shareRatio;
  }
  // A ratio narrower than the crop box that also overflows the frame is shrunk to fit inside the frame.
  if (width > 1) {
    width = 1;
    height = width / shareRatio;
  }
  if (height > 1) {
    height = 1;
    width = height * shareRatio;
  }
  const cx = c.x + c.width / 2;
  const cy = c.y + c.height / 2;
  return normalizeCrop({ x: cx - width / 2, y: cy - height / 2, width, height });
}

/** The full frame at a ratio: the biggest centred crop of that shape. */
export const fullCropForAspect = (ratio, frameAspect = 16 / 9) => cropForAspect({ x: 0, y: 0, width: 1, height: 1 }, ratio, frameAspect);

// ---------------------------------------------------------------------------------------------------------------------------------------
// Video trim, loop and fades.
// ---------------------------------------------------------------------------------------------------------------------------------------

/** The part of the clip that plays: [start, end) in seconds. With an unknown duration and no out point, end is Infinity. */
export function resolveTrimWindow(settings, duration) {
  const s = normalizeMediaEditSettings(settings, duration);
  const known = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  return { start: s.trimStart, end: s.trimEnd ?? known };
}

/** How close to the out point (seconds) a loop jumps back, so it never shows the frame past the trim. About two frames at 30 fps. */
export const TRIM_LOOKAHEAD = 0.05;

/**
 * What a playing background should do at `time`: 'seek-start' to loop back to the in point (and, before the in point, to get there),
 * 'end' when a play-once or hold clip reaches its out point, or 'none'. `playback` is the frame's end behaviour.
 */
export function trimPlaybackAction(time, settings, duration, playback = 'loop') {
  const { start, end } = resolveTrimWindow(settings, duration);
  if (!Number.isFinite(time)) return 'none';
  if (time < start - TRIM_LOOKAHEAD) return 'seek-start';
  if (Number.isFinite(end) && time >= end - TRIM_LOOKAHEAD) return playback === 'loop' ? 'seek-start' : 'end';
  return 'none';
}

/** True when native `loop` is enough: a loop with no in or out point. Otherwise the renderer loops the trim window itself. */
export function usesNativeLoop(settings, playback = 'loop') {
  const s = normalizeMediaEditSettings(settings);
  return playback === 'loop' && s.trimStart === 0 && s.trimEnd === null && s.fadeInSec === 0 && s.fadeOutSec === 0;
}

/** Opacity (0..1) at `time` for the fade in after the in point and the fade out before the out point. 1 with no fades. */
export function fadeOpacityAt(time, settings, duration) {
  const s = normalizeMediaEditSettings(settings, duration);
  const { start, end } = resolveTrimWindow(s, duration);
  let opacity = 1;
  if (s.fadeInSec > 0) opacity = Math.min(opacity, (time - start) / s.fadeInSec);
  if (s.fadeOutSec > 0 && Number.isFinite(end)) opacity = Math.min(opacity, (end - time) / s.fadeOutSec);
  return clamp(Number.isFinite(opacity) ? opacity : 1, 0, 1);
}

/** A timecode for the trim bar: MM:SS.d (tenths). */
export function formatTimecode(seconds) {
  const t = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const tenths = Math.floor(t * 10 + 1e-6);
  const m = Math.floor(tenths / 600);
  const sec = Math.floor((tenths % 600) / 10);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${tenths % 10}`;
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Presets.
// ---------------------------------------------------------------------------------------------------------------------------------------

/** The colour/optics fields a preset owns. Applying a preset resets these, so presets never stack; framing and trim are left alone. */
export const LOOK_KEYS = ['brightness', 'contrast', 'saturation', 'warmth', 'hueRotate', 'blur', 'vignette', 'tintColor', 'tintOpacity', 'tintBlendMode'];

/** One-click looks. `labelKey` is the media-i18n key for the button. */
export const MEDIA_GRADE_PRESETS = Object.freeze([
  { id: 'original', labelKey: 'presetOriginal', settings: {} },
  { id: 'softLyric', labelKey: 'presetSoftLyric', settings: { blur: 6, vignette: 45, brightness: -30 } },
  { id: 'worshipWarm', labelKey: 'presetWorshipWarm', settings: { warmth: 30, saturation: 110, brightness: 4, contrast: 6 } },
  { id: 'vibrantGlory', labelKey: 'presetVibrantGlory', settings: { saturation: 150, contrast: 15, brightness: 6 } },
  { id: 'crispMono', labelKey: 'presetCrispMono', settings: { saturation: 0, contrast: 20, brightness: 2 } },
  { id: 'adventPurple', labelKey: 'presetAdventPurple', settings: { tintColor: '#5b2a86', tintOpacity: 40, tintBlendMode: 'multiply', brightness: 8 } },
  { id: 'ordinaryGreen', labelKey: 'presetOrdinaryGreen', settings: { tintColor: '#1f7a3f', tintOpacity: 35, tintBlendMode: 'overlay' } },
  { id: 'solemnityGold', labelKey: 'presetSolemnityGold', settings: { tintColor: '#d4a017', tintOpacity: 30, tintBlendMode: 'overlay', warmth: 20, contrast: 6 } },
  { id: 'pentecostFlame', labelKey: 'presetPentecostFlame', settings: { tintColor: '#c0281e', tintOpacity: 35, tintBlendMode: 'overlay', warmth: 25, contrast: 10 } },
]);

/** The settings with a preset's look: colour fields reset to neutral, then the preset's applied. Unknown ids change nothing. */
export function applyMediaPreset(settings, presetId) {
  const current = normalizeMediaEditSettings(settings);
  const preset = MEDIA_GRADE_PRESETS.find((p) => p.id === presetId);
  if (!preset) return current;
  const reset = Object.fromEntries(LOOK_KEYS.map((k) => [k, DEFAULT_MEDIA_EDIT_SETTINGS[k]]));
  return normalizeMediaEditSettings({ ...current, ...reset, ...preset.settings });
}

/** The preset whose look the settings have exactly, or null. */
export function matchingPreset(settings) {
  const s = normalizeMediaEditSettings(settings);
  return MEDIA_GRADE_PRESETS.find((p) => LOOK_KEYS.every((k) => applyMediaPreset(s, p.id)[k] === s[k]))?.id ?? null;
}

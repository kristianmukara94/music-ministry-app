// Auto-legibility: how readable slide text is over a background picture or video frame, and how much shade and shadow it needs.
// Pure and DOM-free, so the renderer, its worker and the node tests all run the same maths.
//
// Two contrast models are used, and text must pass both:
//  - WCAG 2.1 contrast ratio over relative luminance Y = 0.2126 R + 0.7152 G + 0.0722 B (linearised sRGB). Pass: 4.5:1.
//  - APCA-W3 0.0.98G-4g lightness contrast (Lc). Pass: |Lc| 60, the APCA level for body text.
//
// The background is measured from a small (64 x 64) copy of the frame, per text zone. Text over a picture is only as readable as the
// worst part of the picture behind it, so each zone keeps a bright and a dark percentile, not only its average.

/** The size the frame is reduced to before it is measured. 4096 pixels: well under a millisecond to read. */
export const SAMPLE_SIZE = 64;

/** Where slide text sits, as shares of the frame's width and height. The zones overlap a little, as the text does. */
export const TEXT_ZONES = {
  /** The slot title banner and a psalm response. */
  top: { x0: 0.07, x1: 0.93, y0: 0, y1: 0.24 },
  /** The stanza, reading or prayer in the middle of the slide. */
  center: { x0: 0.07, x1: 0.93, y0: 0.2, y1: 0.8 },
  /** The lower-third band. */
  lower: { x0: 0.04, x1: 0.96, y0: 0.72, y1: 1 },
};

/** @typedef {keyof typeof TEXT_ZONES} ZoneName */
export const ZONE_NAMES = /** @type {ZoneName[]} */ (Object.keys(TEXT_ZONES));

export const WCAG_MIN_RATIO = 4.5;
export const APCA_MIN_LC = 60;
/** The shade over a background: never lighter than 30% (the look of a dark picture), never darker than 75% (the picture must still show). */
export const SCRIM_MIN = 0.3;
export const SCRIM_MAX = 0.75;
/** The look used when auto-legibility is off or nothing has been measured: the fixed shade and shadow the projector has always drawn. */
export const LEGACY_SHADOW = { blurPx: 12, alpha: 0.95, strokeAlpha: 0 };

// --- Colour maths -----------------------------------------------------------------------------------------------------------------------

/** An 8-bit sRGB channel as linear light, 0 to 1 (the WCAG 2.1 transfer). */
export function srgbToLinear(c8) {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear light back to an sRGB value, 0 to 1. */
export function linearToSrgb(y) {
  const v = y <= 0.0031308 ? y * 12.92 : 1.055 * y ** (1 / 2.4) - 0.055;
  return Math.min(1, Math.max(0, v));
}

/** WCAG 2.1 relative luminance of an 8-bit sRGB colour: Y = 0.2126 R + 0.7152 G + 0.0722 B over linearised channels. */
export function relativeLuminance(r, g, b) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG 2.1 contrast ratio of two relative luminances, 1 to 21. */
export function wcagRatio(y1, y2) {
  const hi = Math.max(y1, y2);
  const lo = Math.min(y1, y2);
  return (hi + 0.05) / (lo + 0.05);
}

/** APCA screen luminance (Ys) of an 8-bit sRGB colour: APCA's own simple 2.4 exponent and coefficients, before the black soft clamp. */
export function apcaLuminance(r, g, b) {
  return 0.2126729 * (r / 255) ** 2.4 + 0.7151522 * (g / 255) ** 2.4 + 0.072175 * (b / 255) ** 2.4;
}

/**
 * APCA-W3 0.0.98G-4g lightness contrast, Lc, of text over a background, from their APCA luminances. Positive for dark text on a light
 * background, negative for light text on a dark one. About -108 to 106.
 */
export function apcaContrast(textYs, bgYs) {
  const blkThrs = 0.022;
  const blkClmp = 1.414;
  const clamp = (y) => (y > blkThrs ? y : y + (blkThrs - y) ** blkClmp);
  const txt = clamp(Math.max(0, textYs));
  const bg = clamp(Math.max(0, bgYs));
  if (Math.abs(bg - txt) < 0.0005) return 0;
  let sapc;
  if (bg > txt) {
    sapc = (bg ** 0.56 - txt ** 0.57) * 1.14;
    return sapc < 0.1 ? 0 : (sapc - 0.027) * 100;
  }
  sapc = (bg ** 0.65 - txt ** 0.62) * 1.14;
  return sapc > -0.1 ? 0 : (sapc + 0.027) * 100;
}

/** An `#rgb` or `#rrggbb` colour as 8-bit channels, or null when it is not one. */
export function parseHex(hex) {
  if (typeof hex !== 'string') return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

// --- Measuring a frame ----------------------------------------------------------------------------------------------------------------

/**
 * @typedef {{ mean: number, p10: number, p90: number, std: number }} Spread
 * @typedef {{ wcag: Spread, apca: Spread }} ZoneLuminance
 * @typedef {{ zones: Record<ZoneName, ZoneLuminance>, frames: number }} LuminanceProfile
 */

/** The value at share `q` of a sorted list. */
function percentile(sorted, q) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

/** @returns {Spread} */
function spread(values) {
  const n = values.length;
  if (n === 0) return { mean: 0, p10: 0, p90: 0, std: 0 };
  let sum = 0;
  for (let i = 0; i < n; i++) sum += values[i];
  const mean = sum / n;
  let sq = 0;
  for (let i = 0; i < n; i++) sq += (values[i] - mean) ** 2;
  values.sort();
  return { mean, p10: percentile(values, 0.1), p90: percentile(values, 0.9), std: Math.sqrt(sq / n) };
}

// Lookup tables: one entry per 8-bit channel value, so a pixel costs three reads per model instead of three powers.
const LIN = new Float32Array(256);
const APC = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  LIN[i] = srgbToLinear(i);
  APC[i] = (i / 255) ** 2.4;
}

/**
 * Measures each text zone of an RGBA pixel buffer (as `ImageData.data` gives it). Transparent pixels count as black, which is what shows
 * behind a picture with holes in it on the projector.
 * @param {ArrayLike<number>} data
 * @param {number} width
 * @param {number} height
 * @returns {LuminanceProfile}
 */
export function analyzePixels(data, width, height) {
  /** @type {Record<string, ZoneLuminance>} */
  const zones = {};
  for (const name of ZONE_NAMES) {
    const z = TEXT_ZONES[name];
    const x0 = Math.floor(z.x0 * width);
    const x1 = Math.max(x0 + 1, Math.ceil(z.x1 * width));
    const y0 = Math.floor(z.y0 * height);
    const y1 = Math.max(y0 + 1, Math.ceil(z.y1 * height));
    const count = (x1 - x0) * (y1 - y0);
    const wcag = new Float32Array(count);
    const apca = new Float32Array(count);
    let k = 0;
    for (let y = y0; y < y1; y++) {
      let p = (y * width + x0) * 4;
      for (let x = x0; x < x1; x++, p += 4, k++) {
        const a = data[p + 3] / 255;
        const r = Math.round(data[p] * a);
        const g = Math.round(data[p + 1] * a);
        const b = Math.round(data[p + 2] * a);
        wcag[k] = 0.2126 * LIN[r] + 0.7152 * LIN[g] + 0.0722 * LIN[b];
        apca[k] = 0.2126729 * APC[r] + 0.7151522 * APC[g] + 0.072175 * APC[b];
      }
    }
    zones[name] = { wcag: spread(wcag), apca: spread(apca) };
  }
  return { zones: /** @type {Record<ZoneName, ZoneLuminance>} */ (zones), frames: 1 };
}

/**
 * Several frames of one video as one profile: each zone keeps the worst of them (the brightest bright end and the darkest dark end),
 * so the look chosen holds for the whole clip, not just its first frame.
 * @param {LuminanceProfile[]} profiles
 * @returns {LuminanceProfile | null}
 */
export function mergeProfiles(profiles) {
  if (profiles.length === 0) return null;
  if (profiles.length === 1) return profiles[0];
  const worst = (a, b) => ({ mean: Math.max(a.mean, b.mean), p10: Math.min(a.p10, b.p10), p90: Math.max(a.p90, b.p90), std: Math.max(a.std, b.std) });
  /** @type {Record<string, ZoneLuminance>} */
  const zones = {};
  for (const name of ZONE_NAMES) {
    zones[name] = profiles.reduce((acc, p) => ({ wcag: worst(acc.wcag, p.zones[name].wcag), apca: worst(acc.apca, p.zones[name].apca) }), profiles[0].zones[name]);
  }
  return { zones: /** @type {Record<ZoneName, ZoneLuminance>} */ (zones), frames: profiles.reduce((n, p) => n + p.frames, 0) };
}

// --- Choosing the look ----------------------------------------------------------------------------------------------------------------

/**
 * A luminance under a black shade of opacity `alpha`. The browser blends in sRGB, so the value is taken back to sRGB, darkened, and
 * linearised again. `toSrgb`/`fromSrgb` pick the model's transfer (WCAG's piecewise curve, or APCA's plain 2.4 power).
 */
function shaded(y, alpha, model) {
  if (alpha <= 0) return y;
  const v = model === 'wcag' ? linearToSrgb(y) : Math.max(0, y) ** (1 / 2.4);
  const d = v * (1 - alpha);
  return model === 'wcag' ? srgbToLinear(d * 255) : d ** 2.4;
}

/**
 * How readable text of colour `text` is over one zone, under a shade of opacity `alpha`. Light text is judged against the zone's bright end
 * (p90) and dark text against its dark end (p10): the part of the picture that makes it hardest to read.
 * @param {ZoneLuminance} zone
 * @param {{ r: number, g: number, b: number }} text
 * @param {number} alpha
 */
export function zoneContrast(zone, text, alpha = 0) {
  const textY = relativeLuminance(text.r, text.g, text.b);
  const textYs = apcaLuminance(text.r, text.g, text.b);
  const lightText = textY >= shaded(zone.wcag.mean, alpha, 'wcag');
  const bgY = shaded(lightText ? zone.wcag.p90 : zone.wcag.p10, alpha, 'wcag');
  const bgYs = shaded(lightText ? zone.apca.p90 : zone.apca.p10, alpha, 'apca');
  const ratio = wcagRatio(textY, bgY);
  const lc = apcaContrast(textYs, bgYs);
  return { ratio, lc, passes: ratio >= WCAG_MIN_RATIO && Math.abs(lc) >= APCA_MIN_LC, lightText };
}

/** How far short of both thresholds a contrast falls: 0 when it passes, 1 when there is no contrast at all. */
function shortfall({ ratio, lc }) {
  const byLc = Math.max(0, (APCA_MIN_LC - Math.abs(lc)) / APCA_MIN_LC);
  const byRatio = Math.max(0, (WCAG_MIN_RATIO - ratio) / (WCAG_MIN_RATIO - 1));
  return Math.min(1, Math.max(byLc, byRatio));
}

/**
 * @typedef {{
 *   scrim: Record<ZoneName, number>,
 *   shadow: { blurPx: number, alpha: number, strokeAlpha: number },
 *   contrast: Record<ZoneName, { ratio: number, lc: number, passes: boolean }>,
 *   boosted: boolean,
 * }} LegibilityPlan
 */

/**
 * The shade and shadow that keep text readable over a measured background. Each zone gets the lightest shade, from 30% to 75% in steps of
 * 5%, that lets the text pass both thresholds. What a 75% shade still cannot fix, and a busy picture (one with a wide spread of light and
 * dark behind the text), is made up for with a wider, darker shadow and a dark outline around each letter.
 * The shade and shadow are black, so they only help text that is lighter than the picture. Dark text over a light picture keeps the lightest
 * shade and the usual shadow: darkening behind it would make it harder to read, not easier. Its contrast is still reported.
 * @param {LuminanceProfile} profile
 * @param {string | null | undefined} textColor `#rrggbb`; anything else is read as white, the projector's default.
 * @returns {LegibilityPlan}
 */
export function legibilityPlan(profile, textColor) {
  const text = parseHex(textColor) ?? { r: 255, g: 255, b: 255 };
  /** @type {Record<string, number>} */
  const scrim = {};
  /** @type {Record<string, { ratio: number, lc: number, passes: boolean }>} */
  const contrast = {};
  let residual = 0;
  let busy = 0;
  for (const name of ZONE_NAMES) {
    const zone = profile.zones[name];
    let alpha = SCRIM_MIN;
    let c = zoneContrast(zone, text, alpha);
    while (!c.passes && c.lightText && alpha < SCRIM_MAX - 1e-9) {
      alpha = Math.round((alpha + 0.05) * 100) / 100;
      c = zoneContrast(zone, text, alpha);
    }
    scrim[name] = alpha;
    contrast[name] = { ratio: c.ratio, lc: c.lc, passes: c.passes };
    if (!c.lightText) continue;
    residual = Math.max(residual, shortfall(c));
    // A standard deviation of 0.25 in linear light is a picture of strong highlights next to deep shadow.
    busy = Math.max(busy, Math.min(1, zone.wcag.std / 0.25));
  }
  // The shadow grows with what the shade could not fix, and a little with a busy picture even when the shade did fix it.
  const need = Math.min(1, residual + 0.35 * busy);
  const shadow = {
    blurPx: Math.round((LEGACY_SHADOW.blurPx + need * 10) * 10) / 10,
    alpha: Math.round(Math.min(1, LEGACY_SHADOW.alpha + need * 0.05) * 100) / 100,
    strokeAlpha: Math.round(Math.min(0.7, need * 0.7) * 100) / 100,
  };
  return {
    scrim: /** @type {Record<ZoneName, number>} */ (scrim),
    shadow,
    contrast: /** @type {LegibilityPlan['contrast']} */ (contrast),
    boosted: need > 0 || ZONE_NAMES.some((n) => scrim[n] > SCRIM_MIN),
  };
}

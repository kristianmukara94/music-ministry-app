// A song's filing under several song categories, and its own projector font size. Plain JS with no Electron or React, so the main process
// (which checks what is saved), the song form (which previews it) and the projector (which draws it) share one set of rules.

/**
 * The stored font scale's limits: 75% to 250% of the theme's lyric size, so a dense verse or a large-print song can go well past the theme. A
 * value outside them is clamped, never refused.
 */
export const FONT_SCALE_MIN = 0.75;
export const FONT_SCALE_MAX = 2.5;
export const FONT_SCALE_DEFAULT = 1;
/**
 * The ceiling of the original `hymns.font_scale` column, whose CHECK constraint stops at 150%. A larger size is kept in `font_scale_wide`
 * beside it (see fontScaleColumns), so the column and its constraint never need a table rebuild.
 */
export const FONT_SCALE_LEGACY_MAX = 1.5;
/** The lowest size the song form's A- button reaches. A song stored lower (75%) keeps its size until the operator changes it. */
export const FONT_SCALE_STEP_MIN = 0.8;
/** One press of A- or A+: 5 percentage points up to 150%, then 10 points up to 250%, so the large sizes are a few presses away. */
export const FONT_SCALE_STEP = 0.05;
export const FONT_SCALE_WIDE_STEP = 0.1;

/** How many song categories one song can carry. */
export const MAX_SONG_CATEGORIES = 8;

const round2 = (n) => Math.round(n * 100) / 100;

/** A font scale as stored: a number from 0.75 to 2.5, to two decimals. Anything missing or unreadable is 1 (the theme's own size). */
export function clampFontScale(value) {
  if (value == null || value === '') return FONT_SCALE_DEFAULT;
  const n = Number(value);
  if (!Number.isFinite(n)) return FONT_SCALE_DEFAULT;
  return round2(Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, n)));
}

/** The scale after one press of A+ (`direction` 1) or A- (-1), kept between 80% and 250%. */
export function stepFontScale(scale, direction) {
  const current = clampFontScale(scale);
  const sign = Math.sign(direction);
  const wide = sign > 0 ? current >= FONT_SCALE_LEGACY_MAX : current > FONT_SCALE_LEGACY_MAX;
  const next = round2(current + sign * (wide ? FONT_SCALE_WIDE_STEP : FONT_SCALE_STEP));
  return round2(Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_STEP_MIN, next)));
}

/**
 * A scale as the hymns table stores it: `fontScale` in the original column (at most 150%, its CHECK constraint) and `fontScaleWide`, the full
 * size when it is past 150% and null otherwise. A reader takes `font_scale_wide` when it is set, else `font_scale`.
 */
export function fontScaleColumns(scale) {
  const value = clampFontScale(scale);
  return { fontScale: Math.min(value, FONT_SCALE_LEGACY_MAX), fontScaleWide: value > FONT_SCALE_LEGACY_MAX ? value : null };
}

/** Whether A- or A+ can still change the size. */
export const canStepFontScale = (scale, direction) => stepFontScale(scale, direction) !== clampFontScale(scale);

/** The scale as the form shows it: 100, 115, 130 (percent). */
export const fontScalePercent = (scale) => Math.round(clampFontScale(scale) * 100);

/**
 * A list of category names: trimmed, blanks dropped, and each name once (letter case does not count; the first spelling is kept), in order.
 * Longer lists are cut to MAX_SONG_CATEGORIES.
 */
export function normalizeCategories(names) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(names) ? names : []) {
    const name = String(raw ?? '').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out.slice(0, MAX_SONG_CATEGORIES);
}

/**
 * A song's categories, from the two columns that hold them: `songCategory` (the primary one, which older code and exports still read) and
 * `categoriesJson` (the full list, or null for a song saved before songs could have more than one). The primary category always comes first,
 * so a song saved before the list existed reads as the one category it had.
 */
export function categoriesOf(songCategory, categoriesJson) {
  let stored = [];
  if (categoriesJson) {
    try {
      const parsed = JSON.parse(categoriesJson);
      if (Array.isArray(parsed)) stored = parsed;
    } catch {
      // A damaged list reads as the primary category alone.
    }
  }
  return normalizeCategories([songCategory, ...stored]);
}

/** Whether a song with these categories is listed under `name` (letter case does not count). */
export const hasCategory = (categories, name) => {
  const wanted = String(name ?? '').trim().toLowerCase();
  return Boolean(wanted) && (categories ?? []).some((c) => String(c).toLowerCase() === wanted);
};

/** `categories` with `name` added at the end, unless it is already there. */
export const withCategory = (categories, name) => normalizeCategories([...(categories ?? []), name]);

/** `categories` without `name`. The last category is never removed: a song keeps at least one. */
export function withoutCategory(categories, name) {
  const list = normalizeCategories(categories);
  if (list.length <= 1) return list;
  const wanted = String(name ?? '').trim().toLowerCase();
  return list.filter((c) => c.toLowerCase() !== wanted);
}

/**
 * The font size (in cqw, a hundredth of the slide's width) a stanza is drawn at in the song form's preview cards, following the projector's
 * rule: the theme's lyric size (4.6cqw, as on the projector) times the song's scale, with long lines wrapping inside 88% of the width, and the
 * whole stanza shrinking to the largest size that fits 82% of the height. So a short stanza shows the scale in full and a long one shrinks, as
 * it will live; a larger scale is never drawn smaller than a smaller one.
 */
export function previewFontCqw(text, scale = FONT_SCALE_DEFAULT) {
  const lines = String(text ?? '').split('\n');
  const roomCqw = 82 * (9 / 16); // 82% of the height, in hundredths of the width (16:9).
  const target = 4.6 * clampFontScale(scale);
  // The stanza's height at size s: each line wraps to as many rows as it needs, at a line height of 1.3. It only grows with s.
  const height = (s) => lines.reduce((n, line) => n + Math.max(1, Math.ceil((line.length * 0.55 * s) / 88)), 0) * 1.3 * s;
  if (height(target) <= roomCqw) return Math.round(target * 100) / 100;
  let lo = 0.5;
  let hi = target;
  for (let i = 0; i < 30; i += 1) {
    const mid = (lo + hi) / 2;
    if (height(mid) <= roomCqw) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo * 100) / 100;
}

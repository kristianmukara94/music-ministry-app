// Theme contrast engine. Every theme in src/styles.css is a handful of colours; this module measures them the way WCAG 2.1 does and,
// where a pairing falls short, moves the text colour (never the background) just far enough towards black or white to pass.
//
// The renderer runs resolveReadableThemeTokens() each time a theme is painted (src/theme/themes.ts), so a theme that is edited badly
// is still readable. shared/theme-contrast.test.js runs it over every built-in theme and checks that styles.css already holds the
// resolved values, so for the themes we ship the runtime pass changes nothing and the first paint is already correct.
//
// Plain ES module, no DOM: it runs in the renderer, in the main process and under node:test.

/** The minimum contrast each role must reach against every surface it is drawn on. */
export const CONTRAST_TARGETS = Object.freeze({
  /** Titles, labels, song names, primary controls. WCAG AAA. */
  fg: 7,
  /** Descriptions, subtitles, section headers. */
  muted: 5,
  /** Hints, counters, metadata. WCAG AA for body text. */
  faint: 4.5,
  /** Accent and status colours used as text (gold labels, "Duplicate", chip text). */
  tint: 4.5,
  /** A label on an accent fill. */
  onAccent: 4.5,
  /** Input and card outlines: WCAG 1.4.11 asks 3:1 for the edge of a control. */
  lineStrong: 3,
  /** Hairline dividers: visible, not loud. */
  line: 1.35,
});

/** The two labels an accent fill can take. */
export const ON_DARK = '#ffffff';
export const ON_LIGHT = '#0f1115';

/** How strong the tinted chip behind accent and status text is (`bg-ok/10` and the like). */
const CHIP_ALPHA = 0.1;

/**
 * Reads #rgb, #rrggbb, #rrggbbaa, rgb()/rgba() in either the comma or the space syntax. Returns 0-255 channels and 0-1 alpha,
 * or null for anything else (a var(), a color-mix(), a keyword), so a caller can leave such a value alone.
 * @param {string | {r:number,g:number,b:number,a?:number}} input
 */
export function parseColor(input) {
  if (input && typeof input === 'object') return { r: input.r, g: input.g, b: input.b, a: input.a ?? 1 };
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(s);
  if (m) {
    const alpha = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a: Math.max(0, Math.min(1, alpha)) };
  }
  return null;
}

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

/** #rrggbb for an opaque colour (alpha is dropped). */
export function toHex(color) {
  const c = parseColor(color);
  if (!c) throw new Error(`Not a colour: ${String(color)}`);
  return `#${[c.r, c.g, c.b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Paints a possibly translucent colour over an opaque one: what the eye actually sees. */
export function composite(top, bottom) {
  const t = parseColor(top);
  const b = parseColor(bottom);
  if (!t || !b) throw new Error(`Cannot composite ${String(top)} over ${String(bottom)}`);
  const a = t.a;
  return { r: t.r * a + b.r * (1 - a), g: t.g * a + b.g * (1 - a), b: t.b * a + b.b * (1 - a), a: 1 };
}

/** Straight sRGB mix: `amount` 0 is `from`, 1 is `to`. */
function mix(from, to, amount) {
  return { r: from.r + (to.r - from.r) * amount, g: from.g + (to.g - from.g) * amount, b: from.b + (to.b - from.b) * amount, a: 1 };
}

/** WCAG 2.1 relative luminance, 0 (black) to 1 (white). */
export function getRelativeLuminance(color) {
  const c = parseColor(color);
  if (!c) throw new Error(`Not a colour: ${String(color)}`);
  const lin = (v) => {
    const s = clamp255(v) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/**
 * WCAG 2.1 contrast ratio, 1 to 21. A translucent foreground is first painted over the background, as it would be on screen.
 * The background must be opaque (or is treated as such).
 */
export function getContrastRatio(fg, bg) {
  const back = parseColor(bg);
  if (!back) throw new Error(`Not a colour: ${String(bg)}`);
  const front = parseColor(fg);
  if (!front) throw new Error(`Not a colour: ${String(fg)}`);
  const seen = front.a < 1 ? composite(front, { ...back, a: 1 }) : front;
  const l1 = getRelativeLuminance(seen);
  const l2 = getRelativeLuminance(back);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** The lowest contrast a colour reaches against any of the backgrounds. */
export const minContrast = (fg, backgrounds) => Math.min(...backgrounds.map((bg) => getContrastRatio(fg, bg)));

/** True when the surfaces are dark, so text should be light and native controls should draw dark. */
export const isDarkSurface = (bg) => getRelativeLuminance(bg) < 0.18;

/**
 * The colour itself if it already reaches `target` against every background; otherwise the smallest step towards white (dark
 * surfaces) or black (light surfaces) that does. Hue is kept, so a gold stays a gold, only lighter. Steps are fixed, so the
 * same theme always gives the same answer.
 */
export function ensureContrast(color, backgrounds, target) {
  const start = parseColor(color);
  if (!start) return color;
  const opaque = start.a < 1 ? composite(start, backgrounds[0]) : start;
  if (minContrast(opaque, backgrounds) >= target) return start.a < 1 ? toHex(opaque) : toHex(start);
  // Text goes the opposite way to the surfaces: towards whichever extreme can reach the most contrast against all of them.
  const white = { r: 255, g: 255, b: 255, a: 1 };
  const black = { r: 0, g: 0, b: 0, a: 1 };
  const goal = minContrast(white, backgrounds) >= minContrast(black, backgrounds) ? white : black;
  for (let i = 1; i <= 100; i++) {
    // Judge the rounded hex, so running the engine again on its own output changes nothing.
    const next = toHex(mix(opaque, goal, i / 100));
    if (minContrast(next, backgrounds) >= target) return next;
  }
  return toHex(goal);
}

/** Whichever of near-black and white reads better on a fill. */
export function pickOnColor(fill) {
  return getContrastRatio(ON_LIGHT, fill) >= getContrastRatio(ON_DARK, fill) ? ON_LIGHT : ON_DARK;
}

/**
 * The CSS variable each palette key is painted with. Order matters only for readability of the output.
 * `surface` and `surface2` are derived (opaque) and have no input key.
 */
export const TOKEN_VARS = Object.freeze({
  canvas: '--color-canvas',
  panel: '--color-panel',
  panel2: '--color-panel-2',
  surface: '--color-surface',
  surface2: '--color-surface-2',
  line: '--color-line',
  lineStrong: '--color-line-strong',
  fg: '--color-fg',
  muted: '--color-muted',
  faint: '--color-faint',
  accent: '--color-accent',
  onAccent: '--color-on-accent',
  gold: '--color-gold',
  danger: '--color-danger',
  ok: '--color-ok',
  warn: '--color-warn',
  info: '--color-info',
});

/** The keys that are text drawn in a tint on the app's surfaces. */
const TINTS = ['accent', 'gold', 'danger', 'ok', 'warn', 'info'];

/**
 * Takes a theme's colours (any CSS colour strings; `panel`/`panel2` may be translucent) and returns them with every text role
 * raised to its target, plus the opaque surfaces modals and menus paint on:
 *
 *  - `surface`  = panel painted over canvas: dialogs, drawers, popovers, menus. Never shows what is behind it.
 *  - `surface2` = panel-2 painted over surface: inputs, rows and pills inside those.
 *
 * Text is checked against canvas, surface and surface2, i.e. everywhere the app draws it. Accent and status colours are also
 * checked against their own 10% chip, since that is how pills and badges show them. Backgrounds are never changed.
 *
 * @param {Record<string, string>} palette  keys as in TOKEN_VARS (surface/surface2 ignored if given)
 * @returns {{ tokens: Record<string, string>, scheme: 'dark' | 'light', changed: string[] }}
 */
export function resolveReadableThemeTokens(palette) {
  const canvas = parseColor(palette.canvas);
  if (!canvas) throw new Error('A theme needs an opaque canvas colour');
  const canvasOpaque = { ...canvas, a: 1 };
  const surface = composite(palette.panel ?? palette.canvas, canvasOpaque);
  const surface2 = composite(palette.panel2 ?? palette.panel ?? palette.canvas, surface);
  const grounds = [canvasOpaque, surface, surface2];

  const tokens = { ...palette, surface: toHex(surface), surface2: toHex(surface2) };
  const changed = [];
  const settle = (key, value) => {
    if (palette[key] == null || value.toLowerCase() !== String(palette[key]).toLowerCase()) changed.push(key);
    tokens[key] = value;
  };
  const raise = (key, target, backgrounds = grounds) => {
    if (palette[key] == null) return;
    const value = ensureContrast(palette[key], backgrounds, target);
    if (toHex(value) !== safeHex(palette[key])) settle(key, value);
  };

  raise('fg', CONTRAST_TARGETS.fg);
  raise('muted', CONTRAST_TARGETS.muted);
  raise('faint', CONTRAST_TARGETS.faint);
  for (const key of TINTS) {
    const c = parseColor(palette[key]);
    if (!c || c.a < 1) continue;
    // The chip is the tint itself at 10% over either surface, so it moves with the tint: judge each candidate on its own chip.
    const backgroundsFor = (tint) => [...grounds, ...[surface, surface2].map((s) => composite({ ...parseColor(tint), a: CHIP_ALPHA }, s))];
    const passes = (tint) => minContrast(tint, backgroundsFor(tint)) >= CONTRAST_TARGETS.tint;
    if (passes(c)) continue;
    const goal = parseColor(ensureContrast(c, grounds, CONTRAST_TARGETS.tint));
    let value = toHex(goal);
    for (let i = 1; i <= 100; i++) {
      const candidate = toHex(mix(c, goal.r + goal.g + goal.b > c.r + c.g + c.b ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 }, i / 100));
      if (passes(candidate)) {
        value = candidate;
        break;
      }
    }
    settle(key, value);
  }

  // A label on the accent fill: keep the theme's own choice while it passes, else take whichever of black and white reads better.
  const accent = tokens.accent;
  if (accent != null) {
    const own = palette.onAccent;
    const keeps = own != null && parseColor(own) && getContrastRatio(own, accent) >= CONTRAST_TARGETS.onAccent;
    if (!keeps) settle('onAccent', pickOnColor(accent));
  }

  // Outlines: lineStrong frames inputs and cards; line is the hairline divider. Both are judged on the modal surface.
  for (const [key, target] of [['lineStrong', CONTRAST_TARGETS.lineStrong], ['line', CONTRAST_TARGETS.line]]) {
    const c = parseColor(palette[key]);
    if (!c) continue;
    const seen = c.a < 1 ? composite(c, surface) : c;
    if (getContrastRatio(seen, surface) >= target) continue;
    // A translucent line keeps its colour and gains opacity, so it still blends with whatever it sits on.
    if (c.a < 1) {
      let alpha = c.a;
      while (alpha < 1 && getContrastRatio({ ...c, a: alpha }, surface) < target) alpha = Math.min(1, Math.round((alpha + 0.01) * 100) / 100);
      if (alpha < 1) {
        settle(key, rgbaFor({ ...c, a: alpha }));
        continue;
      }
    }
    settle(key, ensureContrast(seen, [surface], target));
  }

  return { tokens, scheme: isDarkSurface(surface) ? 'dark' : 'light', changed };
}

const safeHex = (value) => {
  const c = parseColor(value);
  return c && c.a === 1 ? toHex(c) : String(value).toLowerCase();
};

const rgbaFor = (c) => `rgb(${clamp255(c.r)} ${clamp255(c.g)} ${clamp255(c.b)} / ${Math.round(c.a * 100) / 100})`;

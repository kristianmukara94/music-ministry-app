// The lower third's look, shared by the main process (saved to config.json, sent to the browser-source stream),
// the renderer (draws the lower third and its preview), and the settings page. Pure: no Electron imports.

export const LOWER_THIRD_POSITIONS = ['bottom', 'top'];
export const LOWER_THIRD_ALIGNS = ['left', 'center', 'right'];

/** Each value's allowed range, so an out-of-range number from a saved file is pulled back in. */
export const LOWER_THIRD_RANGES = {
  offset: [0, 300],
  width: [30, 100],
  padding: [0, 80],
  radius: [0, 60],
  bgOpacity: [0, 100],
  fontSize: [14, 96],
  outlineWidth: [1, 8],
  refSize: [30, 120],
  refBgOpacity: [0, 100],
};

export const LOWER_THIRD_DEFAULTS = {
  /** Null means no separate window: the lower third shows only on the projector and in the browser source.
   *  A number is the display a transparent lower-third window is placed on. */
  target: null,
  position: 'bottom',
  offset: 0,
  width: 100,
  padding: 20,
  radius: 0,
  bgColor: '#000000',
  bgOpacity: 85,
  fontFamily: 'sans',
  textColor: '#FFFFFF',
  fontSize: 28,
  align: 'left',
  boldDepth: false,
  outline: false,
  outlineWidth: 2,
  outlineColor: '#000000',
  shadow: false,
  /** Shows the reference (the second line) on its own, with its own styling. Off folds it into the main text. */
  showReference: true,
  refPosition: 'left',
  refSize: 70,
  refColor: '#FFD700',
  refBackground: false,
  refBgColor: '#000000',
  refBgOpacity: 60,
  showLogo: false,
};

/** One-click setups. Each lists only what it changes; the rest keeps its current value. */
export const LOWER_THIRD_PRESETS = {
  lowerThird: {
    label: 'Lower Third',
    description: 'Professional news-style full-width bar',
    values: { position: 'bottom', width: 100, align: 'left', padding: 20, radius: 0, bgColor: '#000000', bgOpacity: 85, fontSize: 28, showReference: true, boldDepth: false, shadow: false, outline: false },
  },
  centerFocus: {
    label: 'Center Focus',
    description: 'Centred scripture emphasis',
    values: { position: 'bottom', width: 70, align: 'center', padding: 28, radius: 14, bgColor: '#000000', bgOpacity: 60, fontSize: 40, boldDepth: true, shadow: true, outline: false, refPosition: 'center', refSize: 60 },
  },
  minimal: {
    label: 'Minimal Transparent',
    description: 'Text only, no background',
    values: { position: 'bottom', width: 100, align: 'left', padding: 6, radius: 0, bgOpacity: 0, fontSize: 30, outline: true, outlineWidth: 3, shadow: true, showReference: false, boldDepth: false },
  },
  topBanner: {
    label: 'Top Banner',
    description: 'Alternative top positioning',
    values: { position: 'top', width: 100, align: 'center', padding: 18, radius: 0, bgColor: '#1A1A1A', bgOpacity: 90, fontSize: 30, showReference: true, boldDepth: false, shadow: false, outline: false },
  },
  highContrast: {
    label: 'High Contrast',
    description: 'Maximum video readability',
    values: { position: 'bottom', width: 100, align: 'left', padding: 24, radius: 0, bgColor: '#000000', bgOpacity: 100, textColor: '#FFFFFF', fontSize: 36, boldDepth: true, outline: true, outlineWidth: 3, outlineColor: '#000000', shadow: false, refColor: '#FFFFFF' },
  },
};

const HEX = /^#[0-9a-fA-F]{6}$/;

const clampInt = (value, [min, max], fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const hexOr = (value, fallback) => (typeof value === 'string' && HEX.test(value) ? value.toUpperCase() : fallback);

/** Keeps only known keys with valid values. Anything else falls back to the default. */
export function sanitizeLowerThirdStyle(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const d = LOWER_THIRD_DEFAULTS;
  const bool = (key) => (typeof p[key] === 'boolean' ? p[key] : d[key]);
  const range = (key) => clampInt(p[key], LOWER_THIRD_RANGES[key], d[key]);
  return {
    target: Number.isInteger(p.target) && p.target > 0 ? p.target : null,
    position: LOWER_THIRD_POSITIONS.includes(p.position) ? p.position : d.position,
    offset: range('offset'),
    width: range('width'),
    padding: range('padding'),
    radius: range('radius'),
    bgColor: hexOr(p.bgColor, d.bgColor),
    bgOpacity: range('bgOpacity'),
    fontFamily: ['sans', 'roboto', 'montserrat', 'serif', 'playfair', 'georgia', 'display', 'bodoni', 'mono'].includes(p.fontFamily) ? p.fontFamily : d.fontFamily,
    textColor: hexOr(p.textColor, d.textColor),
    fontSize: range('fontSize'),
    align: LOWER_THIRD_ALIGNS.includes(p.align) ? p.align : d.align,
    boldDepth: bool('boldDepth'),
    outline: bool('outline'),
    outlineWidth: range('outlineWidth'),
    outlineColor: hexOr(p.outlineColor, d.outlineColor),
    shadow: bool('shadow'),
    showReference: bool('showReference'),
    refPosition: LOWER_THIRD_ALIGNS.includes(p.refPosition) ? p.refPosition : d.refPosition,
    refSize: range('refSize'),
    refColor: hexOr(p.refColor, d.refColor),
    refBackground: bool('refBackground'),
    refBgColor: hexOr(p.refBgColor, d.refBgColor),
    refBgOpacity: range('refBgOpacity'),
    showLogo: bool('showLogo'),
  };
}

// Typography and background choices for text slides. Shared by the main process (which checks what is saved) and
// the renderer (which draws the editor preview and the projector). Sizes are in pixels on the 1920x1080 slide.

// Each family is loaded in src/styles.css. Its key is what gets saved, so a key is never renamed once slides use it.
export const TEXT_FONT_GROUPS = [
  { label: 'Sans-Serif · Clean', keys: ['sans', 'roboto', 'montserrat'] },
  { label: 'Serif · Traditional', keys: ['serif', 'playfair', 'georgia'] },
  { label: 'Liturgical · Display', keys: ['display', 'bodoni'] },
  { label: 'Monospace · Tabular', keys: ['mono'] },
];

export const TEXT_FONTS = {
  sans: { label: 'Inter (Default)', css: "'Inter Variable', Inter, system-ui, sans-serif" },
  roboto: { label: 'Roboto', css: "'Roboto Variable', Roboto, system-ui, sans-serif" },
  montserrat: { label: 'Montserrat', css: "'Montserrat Variable', Montserrat, system-ui, sans-serif" },
  serif: { label: 'Merriweather', css: "Merriweather, Georgia, serif" },
  playfair: { label: 'Playfair Display', css: "'Playfair Display Variable', 'Playfair Display', Georgia, serif" },
  georgia: { label: 'Georgia', css: "Georgia, 'Times New Roman', serif" },
  display: { label: 'Cinzel', css: "Cinzel, Georgia, serif" },
  bodoni: { label: 'Bodoni Moda', css: "'Bodoni Moda', 'Didot', Georgia, serif" },
  mono: { label: 'JetBrains Mono', css: "'JetBrains Mono Variable', ui-monospace, monospace" },
};

export const TEXT_SIZES = [
  { key: 'small', label: 'Small', px: 32 },
  { key: 'medium', label: 'Medium', px: 48 },
  { key: 'large', label: 'Large', px: 64 },
  { key: 'xlarge', label: 'Extra Large', px: 80 },
];

export const TEXT_ALIGNS = ['left', 'center', 'right'];

export const TEXT_COLORS = [
  { label: 'White', hex: '#FFFFFF' },
  { label: 'Gold', hex: '#ECC98A' },
  { label: 'Soft Ivory', hex: '#FAF6E9' },
  { label: 'Black', hex: '#000000' },
];

export const BACKGROUND_COLORS = [
  { label: 'Pitch Black', hex: '#000000' },
  { label: 'Dark Charcoal', hex: '#1A1A1A' },
  { label: 'Liturgical Violet', hex: '#2E1A47' },
  { label: 'Marian Blue', hex: '#0F2A4A' },
  { label: 'Liturgical Green', hex: '#1B3B2B' },
  { label: 'Liturgical Gold', hex: '#3D3008' },
];

/**
 * A colour as #RRGGBB in upper case, from #RGB or #RRGGBB in either case. Null for anything else.
 * A three-digit code is expanded, so #abc and #AABBCC name the same colour.
 */
export function normalizeHex(value) {
  if (typeof value !== 'string') return null;
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const digits = match[1].length === 3 ? match[1].split('').map((c) => c + c).join('') : match[1];
  return `#${digits.toUpperCase()}`;
}

/**
 * Checks a style from the editor or the database and returns a clean copy, or null when nothing is set.
 * Anything out of range or unknown is dropped, so a bad value can never reach the projector.
 */
export function sanitizeTextStyle(input) {
  if (!input || typeof input !== 'object') return null;
  const style = {};
  if (Object.prototype.hasOwnProperty.call(TEXT_FONTS, input.fontFamily)) style.fontFamily = input.fontFamily;
  const size = Number(input.fontSize);
  if (Number.isFinite(size) && size >= 20 && size <= 200) style.fontSize = Math.round(size);
  if (normalizeHex(input.textColor)) style.textColor = normalizeHex(input.textColor);
  if (normalizeHex(input.bgColor)) style.bgColor = normalizeHex(input.bgColor);
  if (TEXT_ALIGNS.includes(input.textAlign)) style.textAlign = input.textAlign;
  return Object.keys(style).length > 0 ? style : null;
}

/** The stored style (a JSON string, or null) as an object. Invalid stored JSON reads as no style. */
export function parseTextStyle(json) {
  if (!json) return null;
  try {
    return sanitizeTextStyle(JSON.parse(json));
  } catch {
    return null;
  }
}

/** The CSS font stack for a style, or undefined to keep the projector's default face. */
export function fontCss(style) {
  return style?.fontFamily ? TEXT_FONTS[style.fontFamily].css : undefined;
}

/**
 * A font size with the operator's slide scale applied. `size` is any CSS length. At a scale of 1 the size is returned unchanged,
 * so the look is the same as before the control existed.
 */
export function scaledSize(size, scale) {
  return scale == null || scale === 1 ? size : `calc(${size} * ${scale})`;
}

/** The CSS font stack for the slide font the operator chose for every slide, or undefined to keep each slide's own face. */
export function slideFontCss(key) {
  return key && Object.prototype.hasOwnProperty.call(TEXT_FONTS, key) ? TEXT_FONTS[key].css : undefined;
}

/**
 * The body and headline sizes (pixels on the 1920 slide) when the operator has chosen a size, or null for the
 * projector's default sizes. The headline is 30% larger than the body.
 */
export function customSizes(style) {
  if (!style?.fontSize) return null;
  return { body: style.fontSize, headline: Math.round(style.fontSize * 1.3) };
}

// Whiteboard slides: the design model shared by the editor, the library thumbnails, the projector and the database.
// Pure: no Electron imports.

export const BULLET_STYLES = ['bullet', 'number', 'check', 'arrow', 'star', 'none'];
export const BORDER_STYLES = ['solid', 'dashed', 'dotted', 'gradient'];
export const PATTERNS = ['none', 'grid', 'gradient', 'dots'];
export const ALIGNMENTS = ['left', 'center', 'right', 'justify'];
/** The font families the slide builder offers. Each id is a family in shared/text-style.js. */
export const WHITEBOARD_FONTS = ['roboto', 'serif', 'mono', 'playfair', 'sans'];
/** How a background picture fills the slide: cropped to cover it, shown whole, or stretched to the slide's edges (as a PowerPoint slide's own background is). */
export const BG_FITS = ['cover', 'contain', 'stretch'];
/**
 * A background picture is one of the app's own: a Media Library picture, the picture of a PowerPoint slide, or the background of a PowerPoint
 * slide with its words taken out (`wb/<file>`). Never an outside address.
 */
export const BG_IMAGE_PATTERN = /^apcc-media:\/\/(?:(?:media|slide)\/\d{1,12}|wb\/[0-9a-f-]{36}\.jpg)$/;
/** The most text boxes one slide can hold. */
export const MAX_TEXT_BOXES = 40;
export const TEXT_BOX_TEXT_MAX = 2000;
/** A text box's font size, in pixels on the 1920-wide slide. */
export const TEXT_BOX_SIZE_MIN = 8;
export const TEXT_BOX_SIZE_MAX = 300;
export const TEXT_BOX_VALIGNS = ['top', 'middle', 'bottom'];
/** A font name a text box may use. Letters, digits, spaces, dots and dashes only, so it is always safe inside CSS. */
export const TEXT_BOX_FONT_PATTERN = /^[A-Za-z0-9 .-]{1,60}$/;
export const MAX_VERSES = 6;
/** How a verse sits on the slide: a block at the top or bottom, centred, or filling the slide. */
export const VERSE_POSITIONS = ['bottom', 'top', 'center', 'full'];
export const VERSE_STYLES = ['plain', 'italic', 'boxed', 'callout'];
export const VERSE_ALIGNS = ['center', 'left', 'right'];
export const VERSE_FONT_MIN = 18;
export const VERSE_FONT_MAX = 60;
/** A verse range can run to several verses, so the text allows room for them. */
export const VERSE_TEXT_MAX = 2000;

export const SLIDE_DESIGN_DEFAULTS = {
  titleVisible: true,
  titleSize: 54,
  titleBold: true,
  titleItalic: false,
  fontSize: 40,
  fontFamily: 'sans',
  align: 'left',
  bodyBold: false,
  bodyItalic: false,
  bgColor: '#1C1917',
  textColor: '#FFFFFF',
  bulletStyle: 'bullet',
  bulletColor: '#FBBF24',
  pattern: 'none',
  border: false,
  borderStyle: 'solid',
  borderColor: '#F59E0B',
  borderWidth: 2,
  bgImage: null,
  bgFit: 'cover',
  bgDim: 35,
  verses: [],
  boxes: [],
};

/** A new text box: across the middle of the slide, white, centred. */
export const TEXT_BOX_DEFAULTS = {
  text: 'New text',
  x: 15,
  y: 40,
  w: 70,
  h: 20,
  size: 72,
  font: 'Segoe UI',
  color: '#FFFFFF',
  bold: false,
  italic: false,
  underline: false,
  align: 'center',
  valign: 'middle',
  rot: 0,
};

/** One-click looks. Each lists only what it changes. */
export const SLIDE_THEME_PRESETS = {
  modern: { label: 'Modern', values: { bgColor: '#0C0A09', textColor: '#F5F5F4', bulletColor: '#F59E0B', fontFamily: 'sans', border: false, pattern: 'gradient' } },
  classic: { label: 'Classic', values: { bgColor: '#1C1917', textColor: '#FDE68A', bulletColor: '#D97706', fontFamily: 'serif', border: true, borderStyle: 'solid', borderColor: '#B45309', borderWidth: 3, pattern: 'none' } },
  minimal: { label: 'Minimal', values: { bgColor: '#FAFAF9', textColor: '#1C1917', bulletColor: '#78716C', fontFamily: 'roboto', border: false, pattern: 'none' } },
  bold: { label: 'Bold', values: { bgColor: '#451A03', textColor: '#FFFFFF', bulletColor: '#FBBF24', fontFamily: 'roboto', titleBold: true, bodyBold: true, border: false, pattern: 'none' } },
  elegant: { label: 'Elegant', values: { bgColor: '#1C1917', textColor: '#FDE68A', bulletColor: '#F59E0B', fontFamily: 'playfair', border: true, borderStyle: 'dotted', borderColor: '#F59E0B', borderWidth: 2, pattern: 'none' } },
  dark: { label: 'Dark', values: { bgColor: '#000000', textColor: '#E7E5E4', bulletColor: '#A8A29E', fontFamily: 'sans', border: false, pattern: 'grid' } },
  light: { label: 'Light', values: { bgColor: '#FFFFFF', textColor: '#1C1917', bulletColor: '#D97706', fontFamily: 'sans', border: false, pattern: 'none' } },
};

/** The starting content of each template, and the title it starts with. */
export const SLIDE_TEMPLATES = {
  sermon: { title: 'Sermon Title', content: '- Introduction\n- Point 1\n- Point 2\n- Point 3\n- Conclusion' },
  scripture: {
    title: "Today's Scripture",
    content: ['- First point', '- Second point', '- Third point', '', 'Or write paragraphs...'].join('\n'),
  },
  announcement: { title: 'Announcement', content: '- Date\n- Time\n- Place' },
  worship: { title: 'Worship', content: '- Opening Hymn\n- Responsorial Psalm\n- Closing Hymn' },
  prayer: { title: 'Prayer Points', content: '- Prayer 1\n- Prayer 2\n- Prayer 3' },
};

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const clampInt = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
const hexOr = (value, fallback) => (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : fallback);
const text = (value, max) => String(value ?? '').slice(0, max);

/** Keeps one verse to known keys with valid values. Verses saved before these settings existed get the defaults. */
function sanitizeVerse(v) {
  return {
    reference: text(v?.reference, 80),
    text: text(v?.text, VERSE_TEXT_MAX),
    style: pick(v?.style, VERSE_STYLES, 'plain'),
    position: pick(v?.position, VERSE_POSITIONS, 'bottom'),
    fontSize: clampInt(v?.fontSize, VERSE_FONT_MIN, VERSE_FONT_MAX, 32),
    align: pick(v?.align, VERSE_ALIGNS, 'center'),
    showReference: bool(v?.showReference, true),
  };
}

const clampNum = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n)) * 100) / 100 : fallback;
};

/**
 * Keeps one text box to known keys with valid values. Its place and size are percentages of the slide, so it sits in the same spot at any
 * size; its font size is in pixels on the 1920-wide slide. A box always keeps a little of itself on the slide, so it can be found again.
 */
export function sanitizeTextBox(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const d = TEXT_BOX_DEFAULTS;
  const w = clampNum(p.w, 1, 100, d.w);
  const h = clampNum(p.h, 1, 100, d.h);
  return {
    text: text(p.text, TEXT_BOX_TEXT_MAX),
    x: clampNum(p.x, 1 - w, 99, d.x),
    y: clampNum(p.y, 1 - h, 99, d.y),
    w,
    h,
    size: clampNum(p.size, TEXT_BOX_SIZE_MIN, TEXT_BOX_SIZE_MAX, d.size),
    font: typeof p.font === 'string' && TEXT_BOX_FONT_PATTERN.test(p.font) ? p.font : d.font,
    color: hexOr(p.color, d.color),
    bold: bool(p.bold, d.bold),
    italic: bool(p.italic, d.italic),
    underline: bool(p.underline, d.underline),
    align: pick(p.align, ALIGNMENTS, d.align),
    valign: pick(p.valign, TEXT_BOX_VALIGNS, d.valign),
    rot: clampNum(p.rot, -360, 360, 0),
  };
}

/** Keeps a design to known keys with valid values. */
export function sanitizeSlideDesign(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const d = SLIDE_DESIGN_DEFAULTS;
  const verses = Array.isArray(p.verses)
    ? p.verses
        .slice(0, MAX_VERSES)
        .map(sanitizeVerse)
        .filter((v) => v.reference || v.text)
    : d.verses;
  return {
    titleVisible: bool(p.titleVisible, d.titleVisible),
    titleSize: clampInt(p.titleSize, 24, 96, d.titleSize),
    titleBold: bool(p.titleBold, d.titleBold),
    titleItalic: bool(p.titleItalic, d.titleItalic),
    fontSize: clampInt(p.fontSize, 20, 72, d.fontSize),
    fontFamily: pick(p.fontFamily, WHITEBOARD_FONTS, d.fontFamily),
    align: pick(p.align, ALIGNMENTS, d.align),
    bodyBold: bool(p.bodyBold, d.bodyBold),
    bodyItalic: bool(p.bodyItalic, d.bodyItalic),
    bgColor: hexOr(p.bgColor, d.bgColor),
    textColor: hexOr(p.textColor, d.textColor),
    bulletStyle: pick(p.bulletStyle, BULLET_STYLES, d.bulletStyle),
    bulletColor: hexOr(p.bulletColor, d.bulletColor),
    pattern: pick(p.pattern, PATTERNS, d.pattern),
    border: bool(p.border, d.border),
    borderStyle: pick(p.borderStyle, BORDER_STYLES, d.borderStyle),
    borderColor: hexOr(p.borderColor, d.borderColor),
    borderWidth: clampInt(p.borderWidth, 1, 10, d.borderWidth),
    bgImage: typeof p.bgImage === 'string' && BG_IMAGE_PATTERN.test(p.bgImage) ? p.bgImage : null,
    bgFit: pick(p.bgFit, BG_FITS, d.bgFit),
    bgDim: clampInt(p.bgDim, 0, 85, d.bgDim),
    verses,
    boxes: Array.isArray(p.boxes) ? p.boxes.slice(0, MAX_TEXT_BOXES).map(sanitizeTextBox) : [],
  };
}

/** Checks one slide for saving. Throws with a message the operator can act on. */
export function cleanSlide(input = {}) {
  const title = text(input.title, 200).trim();
  if (!title) throw new Error('A slide needs a title.');
  return { title, content: text(input.content, 4000), design: sanitizeSlideDesign(input.design) };
}

/**
 * The content as items. A line starting with "-" or "*" is a bullet; any other non-empty line is plain text.
 * Each item keeps its line order, so the slide reads top to bottom as it was typed.
 */
export function parseSlideContent(content) {
  return String(content ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const bullet = /^[-*]\s+/.exec(line);
      return bullet ? { text: line.slice(bullet[0].length), bullet: true } : { text: line, bullet: false };
    });
}

/** The mark that starts a bullet item. Numbered items use their position, so the list counts itself. */
export function bulletMark(style, index) {
  switch (style) {
    case 'number':
      return `${index + 1}.`;
    case 'check':
      return '✓';
    case 'arrow':
      return '→';
    case 'star':
      return '★';
    case 'none':
      return '';
    default:
      return '•';
  }
}

// Whiteboard slides: the design model shared by the editor, the library thumbnails, the projector and the database.
// Pure: no Electron imports.

export const BULLET_STYLES = ['bullet', 'number', 'check', 'arrow', 'star', 'none'];
export const BORDER_STYLES = ['solid', 'dashed', 'dotted', 'gradient'];
export const PATTERNS = ['none', 'grid', 'gradient', 'dots'];
export const ALIGNMENTS = ['left', 'center', 'right', 'justify'];
/** The font families the slide builder offers. Each id is a family in shared/text-style.js. */
export const WHITEBOARD_FONTS = ['roboto', 'serif', 'mono', 'playfair', 'sans'];
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
  verses: [],
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
    verses,
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

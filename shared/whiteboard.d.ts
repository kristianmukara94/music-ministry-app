export const BULLET_STYLES: readonly string[];
export const BORDER_STYLES: readonly string[];
export const PATTERNS: readonly string[];
export const ALIGNMENTS: readonly string[];
export const WHITEBOARD_FONTS: readonly string[];
export const MAX_VERSES: number;
export const VERSE_POSITIONS: readonly string[];
export const VERSE_STYLES: readonly string[];
export const VERSE_ALIGNS: readonly string[];
export const VERSE_FONT_MIN: number;
export const VERSE_FONT_MAX: number;
export const VERSE_TEXT_MAX: number;

export interface WhiteboardVerse {
  /** The citation, for example "Leviticus 1:1" or "John 3:16-18". */
  reference: string;
  text: string;
  style: 'plain' | 'italic' | 'boxed' | 'callout';
  position: 'bottom' | 'top' | 'center' | 'full';
  fontSize: number;
  align: 'center' | 'left' | 'right';
  showReference: boolean;
}

/** A block of text placed anywhere on the slide, as a PowerPoint text box is. */
export interface WhiteboardTextBox {
  text: string;
  /** Left and top edges, and width and height, as percentages of the slide. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Font size in pixels on the 1920-wide slide. */
  size: number;
  /** A font name, for example "Calibri". */
  font: string;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: 'left' | 'center' | 'right' | 'justify';
  valign: 'top' | 'middle' | 'bottom';
  /** Turn, in degrees clockwise. */
  rot: number;
}

export interface WhiteboardDesign {
  titleVisible: boolean;
  titleSize: number;
  titleBold: boolean;
  titleItalic: boolean;
  fontSize: number;
  fontFamily: string;
  align: 'left' | 'center' | 'right' | 'justify';
  bodyBold: boolean;
  bodyItalic: boolean;
  bgColor: string;
  textColor: string;
  bulletStyle: 'bullet' | 'number' | 'check' | 'arrow' | 'star' | 'none';
  bulletColor: string;
  pattern: 'none' | 'grid' | 'gradient' | 'dots';
  border: boolean;
  borderStyle: 'solid' | 'dashed' | 'dotted' | 'gradient';
  borderColor: string;
  borderWidth: number;
  /**
   * A background picture: `apcc-media://media/<id>` (Media Library), `apcc-media://slide/<id>` (a PowerPoint slide's picture), or
   * `apcc-media://wb/<file>` (a PowerPoint slide's background without its words). Null for none.
   */
  bgImage: string | null;
  bgFit: 'cover' | 'contain' | 'stretch';
  /** How much the picture is darkened so the text stays readable, 0 to 85 per cent. */
  bgDim: number;
  verses: WhiteboardVerse[];
  /** Text placed freely on the slide, drawn over everything else. */
  boxes: WhiteboardTextBox[];
}

export const BG_FITS: readonly ['cover', 'contain', 'stretch'];
export const MAX_TEXT_BOXES: number;
export const TEXT_BOX_TEXT_MAX: number;
export const TEXT_BOX_SIZE_MIN: number;
export const TEXT_BOX_SIZE_MAX: number;
export const TEXT_BOX_VALIGNS: readonly ['top', 'middle', 'bottom'];
export const TEXT_BOX_FONT_PATTERN: RegExp;
export const TEXT_BOX_DEFAULTS: WhiteboardTextBox;
export function sanitizeTextBox(raw: unknown): WhiteboardTextBox;
export const BG_IMAGE_PATTERN: RegExp;
export const SLIDE_DESIGN_DEFAULTS: WhiteboardDesign;
export const SLIDE_THEME_PRESETS: Record<string, { label: string; values: Partial<WhiteboardDesign> }>;
export const SLIDE_TEMPLATES: Record<string, { title: string; content: string }>;

export function sanitizeSlideDesign(raw: unknown): WhiteboardDesign;
export function cleanSlide(input: { title?: unknown; content?: unknown; design?: unknown }): { title: string; content: string; design: WhiteboardDesign };
export function parseSlideContent(content: string): { text: string; bullet: boolean }[];
export function bulletMark(style: WhiteboardDesign['bulletStyle'], index: number): string;

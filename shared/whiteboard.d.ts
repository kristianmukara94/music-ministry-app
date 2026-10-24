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
  verses: WhiteboardVerse[];
}

export const SLIDE_DESIGN_DEFAULTS: WhiteboardDesign;
export const SLIDE_THEME_PRESETS: Record<string, { label: string; values: Partial<WhiteboardDesign> }>;
export const SLIDE_TEMPLATES: Record<string, { title: string; content: string }>;

export function sanitizeSlideDesign(raw: unknown): WhiteboardDesign;
export function cleanSlide(input: { title?: unknown; content?: unknown; design?: unknown }): { title: string; content: string; design: WhiteboardDesign };
export function parseSlideContent(content: string): { text: string; bullet: boolean }[];
export function bulletMark(style: WhiteboardDesign['bulletStyle'], index: number): string;

export type TextFontFamily = 'sans' | 'roboto' | 'montserrat' | 'serif' | 'playfair' | 'georgia' | 'display' | 'bodoni' | 'mono';
export type TextAlign = 'left' | 'center' | 'right';

/** How a text slide looks. Every field is optional: an absent field keeps the projector's default. */
export interface TextStyle {
  fontFamily?: TextFontFamily;
  /** Pixels on the 1920x1080 slide. */
  fontSize?: number;
  textColor?: string;
  bgColor?: string;
  textAlign?: TextAlign;
}

export const TEXT_FONT_GROUPS: { label: string; keys: TextFontFamily[] }[];
export const TEXT_FONTS: Record<TextFontFamily, { label: string; css: string }>;
export const TEXT_SIZES: { key: string; label: string; px: number }[];
export const TEXT_ALIGNS: TextAlign[];
export const TEXT_COLORS: { label: string; hex: string }[];
export const BACKGROUND_COLORS: { label: string; hex: string }[];
export function sanitizeTextStyle(input: unknown): TextStyle | null;
export function parseTextStyle(json: string | null): TextStyle | null;
export function fontCss(style: TextStyle | null | undefined): string | undefined;
export function slideFontCss(key: string | null | undefined): string | undefined;
export function scaledSize(size: string, scale: number | null | undefined): string;
export function customSizes(style: TextStyle | null | undefined): { body: number; headline: number } | null;
export function normalizeHex(value: unknown): string | null;

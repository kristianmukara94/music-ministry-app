export interface Rgba {
  r: number;
  g: number;
  b: number;
  a?: number;
}
export type ColorInput = string | Rgba;

/** The keys a theme palette may carry, each painted as the CSS variable in TOKEN_VARS. */
export type PaletteKey =
  | 'canvas' | 'panel' | 'panel2' | 'surface' | 'surface2' | 'line' | 'lineStrong'
  | 'fg' | 'muted' | 'faint' | 'accent' | 'onAccent' | 'gold' | 'danger' | 'ok' | 'warn' | 'info';
export type ThemePalette = Partial<Record<PaletteKey, string>> & { canvas: string };

export declare const CONTRAST_TARGETS: Readonly<{
  fg: number;
  muted: number;
  faint: number;
  tint: number;
  onAccent: number;
  lineStrong: number;
  line: number;
}>;
export declare const ON_DARK: string;
export declare const ON_LIGHT: string;
export declare const TOKEN_VARS: Readonly<Record<PaletteKey, string>>;

export declare function parseColor(input: ColorInput): Required<Rgba> | null;
export declare function toHex(color: ColorInput): string;
export declare function composite(top: ColorInput, bottom: ColorInput): Required<Rgba>;
export declare function getRelativeLuminance(color: ColorInput): number;
export declare function getContrastRatio(fg: ColorInput, bg: ColorInput): number;
export declare function minContrast(fg: ColorInput, backgrounds: ColorInput[]): number;
export declare function isDarkSurface(bg: ColorInput): boolean;
export declare function ensureContrast(color: ColorInput, backgrounds: ColorInput[], target: number): string;
export declare function pickOnColor(fill: ColorInput): string;
export declare function resolveReadableThemeTokens(palette: ThemePalette): {
  tokens: Record<PaletteKey, string>;
  scheme: 'dark' | 'light';
  changed: PaletteKey[];
};

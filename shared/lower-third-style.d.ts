export const LOWER_THIRD_POSITIONS: readonly ['bottom', 'top'];
export const LOWER_THIRD_ALIGNS: readonly ['left', 'center', 'right'];
export const LOWER_THIRD_RANGES: Record<string, [number, number]>;

export interface LowerThirdStyle {
  target: number | null;
  position: 'bottom' | 'top';
  offset: number;
  width: number;
  padding: number;
  radius: number;
  bgColor: string;
  bgOpacity: number;
  fontFamily: string;
  textColor: string;
  fontSize: number;
  align: 'left' | 'center' | 'right';
  boldDepth: boolean;
  outline: boolean;
  outlineWidth: number;
  outlineColor: string;
  shadow: boolean;
  showReference: boolean;
  refPosition: 'left' | 'center' | 'right';
  refSize: number;
  refColor: string;
  refBackground: boolean;
  refBgColor: string;
  refBgOpacity: number;
  showLogo: boolean;
}

export const LOWER_THIRD_DEFAULTS: LowerThirdStyle;
export const LOWER_THIRD_PRESETS: Record<
  'lowerThird' | 'centerFocus' | 'minimal' | 'topBanner' | 'highContrast',
  { label: string; description: string; values: Partial<LowerThirdStyle> }
>;
export function sanitizeLowerThirdStyle(raw: unknown): LowerThirdStyle;

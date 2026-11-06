export type ZoneName = 'top' | 'center' | 'lower';
export interface ZoneBox { x0: number; x1: number; y0: number; y1: number }
export interface Spread { mean: number; p10: number; p90: number; std: number }
export interface ZoneLuminance { wcag: Spread; apca: Spread }
export interface LuminanceProfile { zones: Record<ZoneName, ZoneLuminance>; frames: number }
export interface ZoneContrast { ratio: number; lc: number; passes: boolean }
export interface LegibilityShadow { blurPx: number; alpha: number; strokeAlpha: number }
export interface LegibilityPlan {
  scrim: Record<ZoneName, number>;
  shadow: LegibilityShadow;
  contrast: Record<ZoneName, ZoneContrast>;
  boosted: boolean;
}

export const SAMPLE_SIZE: number;
export const TEXT_ZONES: Record<ZoneName, ZoneBox>;
export const ZONE_NAMES: ZoneName[];
export const WCAG_MIN_RATIO: number;
export const APCA_MIN_LC: number;
export const SCRIM_MIN: number;
export const SCRIM_MAX: number;
export const LEGACY_SHADOW: LegibilityShadow;

export function srgbToLinear(c8: number): number;
export function linearToSrgb(y: number): number;
export function relativeLuminance(r: number, g: number, b: number): number;
export function wcagRatio(y1: number, y2: number): number;
export function apcaLuminance(r: number, g: number, b: number): number;
export function apcaContrast(textYs: number, bgYs: number): number;
export function parseHex(hex: unknown): { r: number; g: number; b: number } | null;
export function analyzePixels(data: ArrayLike<number>, width: number, height: number): LuminanceProfile;
export function mergeProfiles(profiles: LuminanceProfile[]): LuminanceProfile | null;
export function zoneContrast(zone: ZoneLuminance, text: { r: number; g: number; b: number }, alpha?: number): ZoneContrast & { lightText: boolean };
export function legibilityPlan(profile: LuminanceProfile, textColor: string | null | undefined): LegibilityPlan;

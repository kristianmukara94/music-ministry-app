import type { ProjectorSettings } from './projector-settings.js';
import type { Frame, LiveState } from './live.js';

export type PlanKind = 'mass' | 'pw';
export type PlanBackgroundType = 'color' | 'image' | 'motion';
export type PlanFontSize = 0.85 | 1 | 1.15 | 1.25 | 1.5 | 2 | 'max';
export type PlanFontWeight = 'normal' | 'semibold' | 'bold';
export type PlanTextCase = 'none' | 'upper';
export type PlanTextAlign = 'center' | 'left' | 'right';

export interface PlanBackground {
  type: PlanBackgroundType;
  color?: string;
  /** The Media Library id, read from `mediaPath`. */
  mediaId?: string;
  /** `apcc-media://media/<id>`. */
  mediaPath?: string;
  /** The dark overlay over the background, 0 to 0.8. */
  dimOpacity?: number;
}

/** Every key is optional: one left out follows the Global Appearance. */
export interface PlanTypography {
  fontFamily?: string;
  fontSizeScale?: PlanFontSize;
  fontWeight?: PlanFontWeight;
  textCase?: PlanTextCase;
  textAlign?: PlanTextAlign;
  textColor?: string;
  textShadow?: boolean;
}

export interface PlanAppearance {
  /** False: Use Global Default. True: Custom Plan Look. */
  enabled: boolean;
  background: PlanBackground;
  typography: PlanTypography;
}

export interface PlanLookEntry {
  planId: number;
  appearance: PlanAppearance;
}

export interface ResolvedPlanBackground {
  type: PlanBackgroundType;
  color: string;
  media: { kind: 'image' | 'video'; src: string; fit: 'cover'; loop: true } | null;
  dim: number;
}

export const PLAN_KINDS: readonly PlanKind[];
export const PLAN_BACKGROUND_TYPES: readonly PlanBackgroundType[];
export const PLAN_FONT_SIZES: readonly PlanFontSize[];
export const PLAN_FONT_WEIGHTS: readonly PlanFontWeight[];
export const PLAN_TEXT_CASES: readonly PlanTextCase[];
export const PLAN_TEXT_ALIGNS: readonly PlanTextAlign[];
export const PLAN_DIM_MAX: number;
export const PLAN_FONTS: readonly string[];
export const PLAN_WEIGHT_CSS: Readonly<Record<PlanFontWeight, number>>;
export const PLAN_COLOR_PRESETS: readonly { label: string; hex: string }[];
export const PLAN_TEXT_COLORS: readonly string[];
export const PLAN_APPEARANCE_DEFAULT: Readonly<PlanAppearance>;

export function clampDim(value: unknown): number;
export function planFontSizeOf(value: unknown): PlanFontSize | undefined;
export function mediaIdOfPath(path: unknown): string | null;
export function sanitizePlanAppearance(raw: unknown): PlanAppearance;
export function parsePlanAppearance(json: unknown): PlanAppearance;
export function serializePlanAppearance(appearance: unknown): string | null;
export function samePlanAppearance(a: unknown, b: unknown): boolean;
export function planLookActive(appearance: PlanAppearance | null | undefined): boolean;
export function planSettingsOverlay(appearance: PlanAppearance | null | undefined): Partial<ProjectorSettings>;
export function applyPlanAppearance<S extends Partial<ProjectorSettings> | null | undefined>(settings: S, appearance: PlanAppearance | null | undefined): S;
export function planTextLook(appearance: PlanAppearance | null | undefined): { weight: number | null; color: string | null; shadow: boolean | null };
export function planLookSignature(appearance: PlanAppearance | null | undefined): string;
export function planBackgroundOf(appearance: PlanAppearance | null | undefined): ResolvedPlanBackground | null;
export function planReachesFrame(frame: unknown): boolean;
export function planBackgroundShown(input: {
  /** A frame, or any object with its kind (a Praise & Worship monitor passes `{ kind: 'pw' }`). */
  frame: Frame | { kind: string; style?: unknown } | null | undefined;
  appearance: PlanAppearance | null | undefined;
  ownBackdrop?: string | null;
  libraryBackground?: boolean;
  backgroundEverywhere?: boolean;
}): ResolvedPlanBackground | null;
export function loadedPlanAppearance(state: LiveState | null | undefined, kind: PlanKind): PlanAppearance | null;
export function planAppearanceFor(state: LiveState | null | undefined, frame: Frame | null | undefined): PlanAppearance | null;
export function withPlanAppearance<S extends LiveState | null | undefined>(state: S, appearance: PlanAppearance | null | undefined): S;
export function planLookEntry(kind: PlanKind, planId: number | null | undefined, appearance: unknown): PlanLookEntry | null;
export function stepPlanFontSize(size: PlanFontSize | null | undefined, delta: number): PlanFontSize;
export function planFontSizeLabel(size: PlanFontSize): string;
export function planFontCss(key: string): string | null;
export function planAppearanceBadge(appearance: PlanAppearance | null | undefined): { custom: boolean; color: string | null; thumb: string | null; motion: boolean };
export function portablePlanAppearance(appearance: unknown, hasMedia: (id: string) => boolean): PlanAppearance;

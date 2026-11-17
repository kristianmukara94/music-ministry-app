export type MediaAspectRatio = '16:9' | '4:3' | '1:1' | '9:16' | 'free';
export type MediaFitMode = 'cover' | 'contain' | 'fill';
export type MediaTintBlendMode = 'normal' | 'multiply' | 'screen' | 'overlay';

export interface MediaCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Non-destructive edits on a Media Library item. See shared/media-editor.js for ranges and meaning. */
export interface MediaEditSettings {
  aspectRatio: MediaAspectRatio;
  fitMode: MediaFitMode;
  crop: MediaCrop;
  zoom: number;
  panX: number;
  panY: number;
  rotate: number;
  flipH: boolean;
  flipV: boolean;
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  hueRotate: number;
  blur: number;
  vignette: number;
  tintColor: string;
  tintOpacity: number;
  tintBlendMode: MediaTintBlendMode;
  trimStart: number;
  trimEnd: number | null;
  playbackSpeed: number;
  volume: number;
  fadeInSec: number;
  fadeOutSec: number;
}

export type MediaEditKey = keyof MediaEditSettings;
export type NumericEditKey = {
  [K in MediaEditKey]: MediaEditSettings[K] extends number ? K : never;
}[MediaEditKey];

export interface MediaOverlayLayer {
  kind: 'warmth' | 'tint' | 'vignette';
  color?: string;
  opacity?: number;
  strength?: number;
  /** Vignette only: where the darkening starts, in percent of the way to the corners. */
  inner?: number;
  background?: string;
  blendMode: 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light';
}

export interface MediaGradePreset {
  id: string;
  labelKey: string;
  settings: Partial<MediaEditSettings>;
}

export const MEDIA_EDIT_REFERENCE_WIDTH: number;
export const MEDIA_ASPECT_RATIOS: readonly MediaAspectRatio[];
export const MEDIA_FIT_MODES: readonly MediaFitMode[];
export const MEDIA_TINT_BLEND_MODES: readonly MediaTintBlendMode[];
export const DEFAULT_MEDIA_EDIT_SETTINGS: Readonly<MediaEditSettings>;
export const MEDIA_EDIT_RANGES: Readonly<Record<NumericEditKey, { min: number; max: number; step: number }>>;
export const MIN_CROP: number;
export const MIN_TRIM_SECONDS: number;
export const TRIM_LOOKAHEAD: number;
export const WARM_WASH: string;
export const COOL_WASH: string;
export const LOOK_KEYS: readonly MediaEditKey[];
export const MEDIA_GRADE_PRESETS: readonly MediaGradePreset[];

export function normalizeCrop(crop: unknown): MediaCrop;
export function normalizeMediaEditSettings(input: unknown, duration?: number): MediaEditSettings;
export function normalizeTrim(trimStart: unknown, trimEnd: unknown, duration?: number): { trimStart: number; trimEnd: number | null };
export function parseMediaEditSettings(json: unknown): MediaEditSettings;
export function serializeMediaEditSettings(settings: unknown): string | null;
export function hasActiveMediaEdits(input: unknown): boolean;
export function hasColorEdits(settings: unknown): boolean;
export function buildMediaFilterCss(settings: unknown, options?: { scale?: number }): string;
export function mediaTransformParts(settings: unknown): { translateX: number; translateY: number; scale: number; rotate: number; flipX: number; flipY: number };
export function buildMediaTransformCss(settings: unknown): string;
export function mediaObjectFit(settings: unknown): MediaFitMode;
export function buildMediaOverlays(settings: unknown): MediaOverlayLayer[];
export function aspectValue(ratio: MediaAspectRatio | string): number | null;
export function cropForAspect(crop: unknown, ratio: MediaAspectRatio, frameAspect?: number): MediaCrop;
export function fullCropForAspect(ratio: MediaAspectRatio, frameAspect?: number): MediaCrop;
export function resolveTrimWindow(settings: unknown, duration?: number): { start: number; end: number };
export function trimPlaybackAction(time: number, settings: unknown, duration?: number, playback?: 'loop' | 'once' | 'hold'): 'none' | 'seek-start' | 'end';
export function usesNativeLoop(settings: unknown, playback?: 'loop' | 'once' | 'hold'): boolean;
export function fadeOpacityAt(time: number, settings: unknown, duration?: number): number;
export function formatTimecode(seconds: number): string;
export function applyMediaPreset(settings: unknown, presetId: string): MediaEditSettings;
export function matchingPreset(settings: unknown): string | null;

import type { Frame, LiveState } from './live.js';
import type { ProjectorSettings } from './projector-settings.js';
import type { TextCase } from './text-fit.js';
import type { BackdropThemeId } from './stage-cue.js';

export type SlideAlign = 'left' | 'center' | 'right';
export const SLIDE_ALIGNS: readonly SlideAlign[];
export function slideTextAlign(align: unknown): SlideAlign;

/** One slide's own formatting, over the projector settings. Every key is optional: a missing key follows the setting. */
export interface SlideLook {
  textCase?: TextCase;
  align?: SlideAlign;
  fontScale?: number;
  maxFit?: boolean;
  backdrop?: BackdropThemeId;
}
export type SlideLookKey = keyof SlideLook;
export const SLIDE_LOOK_KEYS: readonly SlideLookKey[];

export function sanitizeSlideLook(look: unknown): SlideLook | null;
export function hasSlideLook(look: unknown): boolean;

export interface ResolvedSlideLook {
  textCase: TextCase;
  align: SlideAlign | null;
  fontScale: number;
  maxFit: boolean;
  backdrop: BackdropThemeId | null;
  hasOverride: boolean;
}
export function resolveSlideLook(
  settings: Partial<Pick<ProjectorSettings, 'textCase' | 'slideFontScale' | 'edgeToEdge' | 'slideAlign'>> | null | undefined,
  look: SlideLook | null | undefined,
  globalBackdrop?: BackdropThemeId | null,
  planAppearance?: import('./plan-appearance.js').PlanAppearance | null,
): ResolvedSlideLook;
export function withoutPlanSlideLooks(looks: Record<string, SlideLook> | null | undefined, kind: 'mass' | 'pw', planId: number | null | undefined): Record<string, SlideLook>;
export function planSlideLookCount(looks: Record<string, SlideLook> | null | undefined, kind: 'mass' | 'pw', planId: number | null | undefined): number;

export function lookChange<K extends SlideLookKey>(
  look: SlideLook | null | undefined,
  key: K,
  value: NonNullable<SlideLook[K]>,
  scope: 'slide' | 'global',
): { look: SlideLook | null; settings: Partial<ProjectorSettings> | null; backdrop: BackdropThemeId | null };

export interface EditorFields {
  text: string;
  tag: string | null;
  label: string;
  notes: string;
  look: SlideLook | null;
}
export function editorDraftChanged(draft: EditorFields | null | undefined, from: EditorFields | null | undefined): boolean;
export function stepScale(scale: number, delta: number): number;
export function frameWithAlign<F extends Frame>(frame: F, align: SlideAlign | null | undefined): F;

export function pwLookKey(segmentKey: string, index: number): string;
export function massLookKey(planId: number | string | null | undefined, row: number, page: number): string;
export function framePageOf(frame: Frame | null | undefined): number;
export function slideLookKeyOf(state: LiveState | null | undefined, frame: Frame | null | undefined): string | null;
export function slideLookAt(state: LiveState | null | undefined, key: string | null | undefined): SlideLook | null;
export function frameOwnLook(frame: unknown): SlideLook | null;

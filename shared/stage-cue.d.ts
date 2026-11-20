import type { LiveState } from './live.js';
import type { TextCase } from './text-fit.js';

export function pad2(n: number): string;
export function clockOf(seconds: number): string;

export interface SegmentTimer {
  key: string | null;
  since: number | null;
  banked: number;
}
export type TimerAction = { type: 'start' } | { type: 'pause' } | { type: 'toggle' } | { type: 'reset' } | { type: 'segment'; key: string | null; run: boolean };
export const TIMER_ZERO: Readonly<SegmentTimer>;
export function timerElapsed(timer: SegmentTimer | null | undefined, now: number): number;
export function timerReducer(timer: SegmentTimer | null | undefined, action: TimerAction, now: number): SegmentTimer;
export function timerProgress(elapsedMs: number, plannedMs: number | null | undefined): { percent: number; over: boolean };

export type OutputStatus = 'blackout' | 'hidden' | 'onAir' | 'offAir';
export function outputStatus(live: Pick<LiveState, 'projector'> | null | undefined, runOnAir: boolean): OutputStatus;

export interface Cue {
  /** The step the cue goes to. */
  index: number;
  /** The 1-based slide number shown on the card. */
  number: number;
  tag: string;
  text: string;
  /** The song the cue belongs to, or null. */
  group?: string | null;
  /** The short chip label (V1, C1, 3) the C and V keys read. */
  chip?: string;
  /** False for a cue that takes no number key (a song's title card, the black step). */
  hotkey?: boolean;
}
export function cueText(text: string | null | undefined, textCase: TextCase | string | null | undefined): string;
export function cueTabs(cues: Cue[]): string[];
export function baseTag(tag: string | null | undefined): string;
export function filterCues(cues: Cue[], options?: { query?: string; tab?: string | null }): Cue[];
export function cueKeys(cues: Cue[]): Map<number, number>;
export function cueState(cue: Pick<Cue, 'index'>, activeIndex: number): 'live' | 'next' | null;

export type EditorMode = 'staged' | 'live';
export const EDITOR_MODES: readonly EditorMode[];
export interface EditorSlide {
  key: string | null;
  text: string;
  tag: string | null;
}
export interface EditorState {
  mode: EditorMode;
  key: string | null;
  base: { text: string; tag: string | null };
  draft: { text: string; tag: string | null };
  confirmDelete: boolean;
  adding: boolean;
}
export type EditorAction =
  | { type: 'slide'; slide: EditorSlide | null }
  | { type: 'edit'; text?: string; tag?: string | null }
  | { type: 'applied' }
  | { type: 'discard' }
  | { type: 'mode'; mode?: EditorMode }
  | { type: 'add' }
  | { type: 'askDelete'; canDelete?: boolean }
  | { type: 'cancelDelete' };
export function editorInit(slide: EditorSlide | null, mode?: EditorMode): EditorState;
export function editorDirty(state: EditorState): boolean;
export function shouldApplyLive(state: EditorState): boolean;
export function draftPending(state: EditorState): boolean;
export function editorReducer(state: EditorState, action: EditorAction): EditorState;
export function canDeleteSlide(count: number): boolean;

export type ConsoleKeyAction = 'blackout' | 'lowerThird' | 'hideText';
export function isTypingTarget(target: unknown): boolean;
export function consoleKeyAction(e: { key?: string; repeat?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; shiftKey?: boolean; target?: unknown } | null | undefined): ConsoleKeyAction | null;
export const CONSOLE_SHORTCUTS: readonly string[];

export type BackdropThemeId = 'burgundy' | 'obsidian' | 'ember' | 'midnight';
export const BACKDROP_THEMES: readonly { id: BackdropThemeId; color: string }[];
export function backdropThemeOf(slideBackground: { backgroundType?: string; backgroundColor?: string | null } | null | undefined): BackdropThemeId | null;
export function withBackdropTheme<T extends object>(slideBackground: T, id: BackdropThemeId): T;

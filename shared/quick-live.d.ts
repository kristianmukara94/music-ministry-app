import type { Frame, LiveAction, LiveState } from './live.js';

/** An open Quick-Live Mini Output Preview: the item's slides, and the main run its LIVE press parked ('mass', 'pw' or null). */
export interface QuickLiveSession {
  title: string;
  frames: Frame[];
  parked: 'mass' | 'pw' | null;
}

export type QuickLiveExit = 'restore' | 'clear' | 'none';

export function quickLiveSession(before: LiveState | null, item: { title: string; frames: Frame[] }, previous?: QuickLiveSession | null): QuickLiveSession;
export function heldFrame(projector: LiveState['projector'] | null | undefined): Frame | null;
export function sameSlide(a: Frame | null | undefined, b: Frame | null | undefined): boolean;
export function quickLiveIndex(session: QuickLiveSession | null, projector: LiveState['projector'] | null | undefined): number;
export function quickLiveNextFrame(session: QuickLiveSession | null, projector: LiveState['projector'] | null | undefined): Frame | null;
export function quickLiveStepAction(session: QuickLiveSession | null, projector: LiveState['projector'] | null | undefined, delta: 1 | -1): LiveAction | null;
export function quickLiveCounter(session: QuickLiveSession | null, projector: LiveState['projector'] | null | undefined): string | null;
export function quickLiveExit(session: QuickLiveSession | null, state: LiveState | null): QuickLiveExit;
export function quickLiveShouldClose(session: QuickLiveSession | null, state: LiveState | null, seen: boolean): boolean;

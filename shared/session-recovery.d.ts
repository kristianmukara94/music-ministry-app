import type { LiveState, QueueItem } from './live';

export const SESSION_VERSION: 1;
export const RECOVERY_MAX_AGE_MS: number;

/** What a crash would lose: the frames on air, the outputs, the queue's place and the Praise & Worship position. */
export interface SessionSnapshot {
  v: 1;
  savedAt: number;
  outputs: LiveState['outputs'];
  /** `look` is the look frozen at a pause, or null. */
  projector: LiveState['projector'] & { look: unknown };
  lowerThird: LiveState['lowerThird'];
  display: LiveState['display'];
  introSlideMode: LiveState['introSlideMode'];
  noteOverlay: LiveState['noteOverlay'];
  counter: LiveState['counter'];
  queuePlanId: number | null;
  queueSlotTitle: boolean | null;
  queueCursor: number;
  pw: LiveState['pw'];
}

export interface SessionRow {
  active_plan_id: string | null;
  active_pw_session_id: string | null;
  active_slot_id: string | null;
  active_slide_index: number;
  lower_third_enabled: 0 | 1;
  lower_third_text: string | null;
  blackout_enabled: 0 | 1;
  clear_text_enabled: 0 | 1;
  queue_cursor_index: number;
  presentation_mode: string | null;
  snapshot: string;
}

export function sessionIsLive(state: LiveState): boolean;
export function sessionSnapshot(state: LiveState, savedAt: number): SessionSnapshot | null;
export function slideIndexOf(snapshot: SessionSnapshot): number;
export function sessionRow(snapshot: SessionSnapshot, queue: QueueItem[] | null | undefined): SessionRow;
export function restoreSession(
  state: LiveState,
  snapshot: unknown,
  options: { queue: QueueItem[] | null; pwExists: boolean; now: number },
): LiveState | null;

export interface SessionWriter {
  push(state: LiveState): void;
  flush(): void;
  reset(): void;
}
export function createSessionWriter(options: {
  save: (row: SessionRow) => void;
  clear: () => void;
  now?: () => number;
  schedule?: (fn: () => void) => unknown;
  onError?: (err: unknown) => void;
}): SessionWriter;

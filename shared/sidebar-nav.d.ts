import type { LiveAction, LiveState } from './live.js';

export type NavHotkeyView = 'dashboard' | 'goLive' | 'lyrics' | 'planner';

export type OutputPillKey = 'projector' | 'lowerThird' | 'preview';

export interface OutputPill {
  key: OutputPillKey;
  on: boolean;
  paused: boolean;
  /** False only for the Lower 3rd before there is one to show. */
  ready: boolean;
  disabled: boolean;
  intent: { type: 'dispatch'; action: LiveAction } | { type: 'openLowerThird' };
}

export function activeNavKey<V extends string>(view: V): V | 'announcements' | 'planner' | null;
export const NAV_HOTKEYS: Readonly<Record<NavHotkeyView, number>>;
export function navHotkeyCombo(view: string): string | null;
export function isTextEntryTarget(target: unknown): boolean;
export function navHotkeyView(
  e: {
    code?: string;
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    repeat?: boolean;
    defaultPrevented?: boolean;
    target?: unknown;
  } | null | undefined,
): NavHotkeyView | null;
export function lineupCount(state: Pick<LiveState, 'queue' | 'pw' | 'pwLineup'>): number;
export function outputPills(
  state: Pick<LiveState, 'outputs' | 'lowerThird'> & { projector: Pick<LiveState['projector'], 'paused'> },
  locked?: boolean,
): OutputPill[];

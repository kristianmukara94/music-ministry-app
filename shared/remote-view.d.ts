import type { LiveState } from './live.js';

/** The live screen as a Remote view phone sees it (see snapshotOf in remote-view.js). Only the fields the app's own pages read are typed. */
export interface RemoteViewSnapshot {
  screen: 'off' | 'idle' | 'blackout' | 'live';
  title: string;
  next: string | null;
  position: string | null;
  lines: string[];
  nextLines: string[];
  paused: boolean;
  updatedAt: number;
  /** The Primary viewer's screen controls. Absent from the Secondary viewer's snapshot. */
  blackoutActive?: boolean;
  welcomeActive?: boolean;
  projectorPaused?: boolean;
  projectorLive?: boolean;
}

export function remoteViewSnapshot(state: LiveState, now?: number): RemoteViewSnapshot;

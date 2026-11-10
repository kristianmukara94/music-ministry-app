import type { Frame, LiveState } from '../../shared/live.js';
import { useLive } from '../live/store';
import { massShowing } from './massLive';

export type LiveRun = 'pw' | 'mass';

/**
 * Whether a live run has the screen: the one answer the console bar's Go Live / Live button and each view's On air badge read, so they never
 * disagree. With an id, only that session or plan counts. This is not the projector window being open: that is the top bar's Projector switch.
 */
export function runOnAir(state: LiveState, run: LiveRun, id?: number | null): boolean {
  if (run === 'mass') return massShowing(state) && (id == null || state.queuePlanId === id);
  return state.pw?.onAir === true && (id == null || state.pw.sessionId === id);
}

export const useRunOnAir = (run: LiveRun, id?: number | null) => useLive((s) => runOnAir(s.state, run, id));

/** What the projector shows, as one short line for the operator. Null when nothing is on screen. */
export function onAirLabel(live: LiveState['projector']['live']): string | null {
  switch (live.kind) {
    case 'idle':
      return null;
    case 'blackout':
    case 'black':
      return 'Black screen';
    case 'pw':
      return live.segmentName;
    case 'whiteboard':
      return live.slide.title;
    case 'rosary':
      return live.mystery || live.section;
    case 'psalm':
    case 'deck':
    case 'lyrics':
    case 'text':
    case 'image':
      return live.title || null;
    default:
      return (live as Frame).kind;
  }
}

/** The projector's state in words: off, black, or on. */
export function projectorState(state: LiveState): 'off' | 'black' | 'on' {
  if (!state.outputs.projector) return 'off';
  return state.projector.live.kind === 'blackout' ? 'black' : 'on';
}

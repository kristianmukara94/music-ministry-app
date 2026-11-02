import type { Frame, LiveState } from '../../shared/live.js';

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

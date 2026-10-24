import type { Frame, LowerThird, ProjectionSource } from '../../shared/live.js';
import { dispatch } from '../live/store';
import type { Note } from './types';

/**
 * The lower-third layout for a note. A Mass intention uses the intention layout; everything else a nameplate.
 * The second line is the start of the body, flattened to one line, so the banner stays short.
 */
export function lowerThirdOf(note: Note): LowerThird {
  const line2 = note.body.replace(/\s+/g, ' ').trim().slice(0, 140);
  return {
    template: note.category === 'Mass Intention' ? 'intention' : 'nameplate',
    line1: note.title,
    ...(line2 ? { line2 } : {}),
  };
}

/** The full-screen frame: the title as the headline and the body beneath it, styled as the operator chose. */
export function slideFrameOf(note: Note): Frame {
  return { kind: 'text', title: note.title, headline: note.title, text: note.body, bg: null, style: note.style };
}

/**
 * Stages a projectable note without showing it. Nothing reaches the projector until it is taken live.
 * An operator-only note does nothing here, so it cannot leak to the congregation screen.
 */
export function stagePrayer(note: Note) {
  if (note.display === 'full') dispatch({ type: 'projector/stage', frame: slideFrameOf(note) });
  else if (note.display === 'lower') dispatch({ type: 'lowerThird/stage', value: lowerThirdOf(note) });
}

/** Stages and shows a projectable note straight away. Operator-only notes do nothing. `source` says who sent it. */
export function takePrayer(note: Note, source?: ProjectionSource) {
  if (note.display === 'full') {
    stagePrayer(note);
    dispatch({ type: 'projector/take', source });
  } else if (note.display === 'lower') {
    dispatch({ type: 'lowerThird/show', value: lowerThirdOf(note) });
  }
}

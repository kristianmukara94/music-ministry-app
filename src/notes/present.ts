import type { Frame, LowerThird, ProjectionSource } from '../../shared/live.js';
import { stanzaTarget } from '../../shared/live-song.js';
import { screenPagesOf } from '../../shared/prayer-screen.js';
import { useLiveNotice } from '../live/liveNotice';
import { dispatch, useLive } from '../live/store';
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

/**
 * The full-screen frames for a prayer, one per slide. Each slide carries the size it fits at, and its place when there is more than one.
 * The title is the headline on every slide.
 */
export function slideFramesOf(note: Note): Frame[] {
  const pages = screenPagesOf(note);
  return pages.map((page, index) => ({
    kind: 'text',
    title: note.title,
    headline: note.title,
    text: page.text,
    bg: null,
    style: { ...note.style, fontSize: page.fontPx },
    key: `prayer:${note.id}`,
    top: page.top,
    centred: page.centred,
    ...(pages.length > 1 ? { page: { index, total: pages.length } } : {}),
  }));
}

/** The full-screen frame for one slide of a prayer. */
export function slideFrameOf(note: Note, index = 0): Frame {
  return slideFramesOf(note)[index];
}

/**
 * Stages a projectable note without showing it. Nothing reaches the projector until it is taken live.
 * An operator-only note does nothing here, so it cannot leak to the congregation screen.
 */
export function stagePrayer(note: Note, index = 0) {
  if (note.display === 'full') dispatch({ type: 'projector/stage', frame: slideFrameOf(note, index) });
  else if (note.display === 'lower') dispatch({ type: 'lowerThird/stage', value: lowerThirdOf(note) });
}

/** Stages and shows a projectable note straight away. Operator-only notes do nothing. `source` says who sent it. */
export function takePrayer(note: Note, source?: ProjectionSource, index = 0) {
  if (note.display === 'full') {
    stagePrayer(note, index);
    dispatch({ type: 'projector/take', source });
  } else if (note.display === 'lower') {
    dispatch({ type: 'lowerThird/show', value: lowerThirdOf(note) });
  }
}

/**
 * Re-renders a prayer on the projector after it was saved, when it is live: the same slide where it still exists, otherwise the last
 * one, with the operator told. A save that changes only the style leaves the slide as it is.
 */
export function refreshLivePrayer(note: Note) {
  const { projector } = useLive.getState().state;
  const shown = [projector.live, projector.staged].find((f): f is Extract<Frame, { kind: 'text' }> => f.kind === 'text' && f.key === `prayer:${note.id}`);
  if (!shown) return;
  const frames = slideFramesOf(note);
  const target = stanzaTarget(shown.page?.index ?? 0, shown.page?.total ?? 1, frames.length);
  if (!target) return;
  const next = frames[target.position];
  if (next.kind !== 'text') return;
  if (next.text === shown.text && next.title === shown.title && (shown.page?.index ?? 0) === target.position) return;
  dispatch({ type: 'projector/refresh', key: `prayer:${note.id}`, frame: next });
  if (target.moved) {
    useLiveNotice.getState().show({ kind: 'moved', text: `The prayer now has ${frames.length} slide${frames.length === 1 ? '' : 's'}, so the projector moved to the last one.` });
  }
}

/** A prayer was deleted while it is live: its slide stays on screen, and the operator decides whether to clear it. */
export function prayerRemovedWhileLive(note: Note) {
  const { projector } = useLive.getState().state;
  const live = [projector.live, projector.staged].some((f) => f.kind === 'text' && f.key === `prayer:${note.id}`);
  if (live) useLiveNotice.getState().show({ kind: 'deleted', text: `"${note.title}" was deleted. It is still on the projector.` });
}

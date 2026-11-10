import type { Frame, LowerThird, ProjectionSource } from '../../shared/live.js';
import { stanzaTarget } from '../../shared/live-song.js';
import { screenPagesOf } from '../../shared/prayer-screen.js';
import { noteSource, noteSourceId, pickSlides } from '../../shared/notes.js';
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

/** The projector key of a prayer's slides: `prayer:<id>`, or `prayer:<id>:<slides>` for a Holy Mass row that plays only some of them. */
export const prayerKey = (id: number, slides?: readonly number[] | null): string => `prayer:${noteSourceId(id, slides)}`;

/** The note and the slides a frame's key names (parsed as a plan row's source id is). Null for a frame that is not a prayer's. */
export function prayerOfKey(key: string | undefined): { id: number; slides: number[] | null } | null {
  return key?.startsWith('prayer:') ? noteSource(key.slice('prayer:'.length)) : null;
}

/**
 * The full-screen frames for a prayer, one per slide. Each slide carries the size it fits at, and its place when there is more than one.
 * The title is the headline on every slide. `slides` keeps only those slides (0-based), numbered 1 to n among themselves, for a Holy Mass
 * row that plays part of the prayer.
 */
export function slideFramesOf(note: Note, slides?: readonly number[] | null): Frame[] {
  const pages = pickSlides(screenPagesOf(note), slides ?? null);
  const key = prayerKey(note.id, slides);
  return pages.map((page, index) => ({
    kind: 'text',
    title: note.title,
    headline: note.title,
    text: page.text,
    bg: null,
    style: { ...note.style, fontSize: page.fontPx },
    key,
    top: page.top,
    centred: page.centred,
    ...(pages.length > 1 ? { page: { index, total: pages.length } } : {}),
  }));
}

/** The full-screen frame for one slide of a prayer (of the slides kept, when `slides` is given). */
export function slideFrameOf(note: Note, index = 0, slides?: readonly number[] | null): Frame {
  const frames = slideFramesOf(note, slides);
  return frames[index] ?? frames[0];
}

/**
 * Stages a projectable note without showing it. Nothing reaches the projector until it is taken live.
 * An operator-only note does nothing here, so it cannot leak to the congregation screen.
 */
export function stagePrayer(note: Note, index = 0, slides?: readonly number[] | null) {
  if (note.display === 'full') dispatch({ type: 'projector/stage', frame: slideFrameOf(note, index, slides) });
  else if (note.display === 'lower') dispatch({ type: 'lowerThird/stage', value: lowerThirdOf(note) });
}

/**
 * Stages and shows a projectable note straight away. Operator-only notes do nothing. `source` says who sent it. A lower-third note does not
 * turn the Lower 3rd on: it is staged, or replaces a band already on air (see lowerThird/show).
 */
export function takePrayer(note: Note, source?: ProjectionSource, index = 0, slides?: readonly number[] | null) {
  if (note.display === 'full') {
    stagePrayer(note, index, slides);
    dispatch({ type: 'projector/take', source });
  } else if (note.display === 'lower') {
    dispatch({ type: 'lowerThird/show', value: lowerThirdOf(note) });
  }
}

/**
 * Re-renders a prayer on the projector after it was saved, when it is live: the same slide where it still exists, otherwise the last
 * one, with the operator told. A save that changes only the style leaves the slide as it is. A Holy Mass row that plays some of the
 * prayer's slides is rebuilt from those slides.
 */
export function refreshLivePrayer(note: Note) {
  const { projector } = useLive.getState().state;
  const shown = [projector.live, projector.staged].find((f): f is Extract<Frame, { kind: 'text' }> => f.kind === 'text' && prayerOfKey(f.key)?.id === note.id);
  if (!shown?.key) return;
  const frames = slideFramesOf(note, prayerOfKey(shown.key)?.slides);
  const target = stanzaTarget(shown.page?.index ?? 0, shown.page?.total ?? 1, frames.length);
  if (!target) return;
  const next = frames[target.position];
  if (next.kind !== 'text') return;
  if (next.text === shown.text && next.title === shown.title && (shown.page?.index ?? 0) === target.position) return;
  dispatch({ type: 'projector/refresh', key: shown.key, frame: next });
  if (target.moved) {
    useLiveNotice.getState().show({ kind: 'moved', text: `The prayer now has ${frames.length} slide${frames.length === 1 ? '' : 's'}, so the projector moved to the last one.` });
  }
}

/** A prayer was deleted while it is live: its slide stays on screen, and the operator decides whether to clear it. */
export function prayerRemovedWhileLive(note: Note) {
  const { projector } = useLive.getState().state;
  const live = [projector.live, projector.staged].some((f) => f.kind === 'text' && prayerOfKey(f.key)?.id === note.id);
  if (live) useLiveNotice.getState().show({ kind: 'deleted', text: `"${note.title}" was deleted. It is still on the projector.` });
}

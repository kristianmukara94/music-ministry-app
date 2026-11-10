import { blackoutOverMass, welcomeOverMass, type Frame, type QueueItem } from '../../shared/live.js';
import { MASS_FLOW_CATEGORIES, MAX_NOTE_BODY, MAX_NOTE_TITLE, noteSource, slidesNote } from '../../shared/notes.js';
import { screenPagesOf } from '../../shared/prayer-screen.js';
import type { PrayerSplit } from '../../shared/prayer-screen';
import { bridge } from '../live/bridge';
import { dispatch, useLive } from '../live/store';
import { slideFramesOf } from '../notes/present';
import type { Note } from '../notes/types';
import { isCopyFor, massCopyOwner } from '../notes/slideCopies';
import { replaceRowInFlow } from '../planner/plan-api';
import { massShowing, prayerIdOf, prayerSlidesOf, showWithin, whenLive } from './massLive';

/**
 * Edit slide on air and Add slide for a Holy Mass item that is not a song: a Mass part (Kyrie, Gloria), a reading or psalm, a prayer, a typed
 * response, a Bible passage. Its words come from shared places (the built-in Mass text, the Lectionary, a Hub prayer other plans also use), so
 * an edit is never written back there. Instead the item becomes this plan's own copy of it: a full-screen Notes & Prayers entry holding every
 * slide, with a manual slide break between them, put in the item's row (same slot, same block). The copy plays as a prayer does, so it steps
 * slide by slide, is fitted to the screen, and a one-slide item becomes a multi-slide one when a slide is added. Later edits change the copy.
 */

/**
 * Whether the row plays this plan's own copy, whole (not a pick of its slides). Anything else, a Hub entry, another plan's copy (a plan made
 * from this one) or a pick of a copy's slides, is copied first, so it is left exactly as it is.
 */
function isOwnCopy(item: QueueItem, note: Note | null, owner: string): note is Note {
  const source = item.module === 'notes' ? noteSource(item.sourceId) : null;
  return Boolean(source && source.slides === null && note?.id === source.id && isCopyFor(note, owner));
}

/**
 * The words of each slide of the item `frame` shows, in order, as the operator sees them. Null when the item has no words to edit (a picture,
 * a video, a song, which has its own editor) or when a prayer's text has not loaded yet.
 */
export function slidePagesOf(frame: Frame, note: Note | null): string[] | null {
  switch (frame.kind) {
    case 'text': {
      const id = prayerIdOf(frame);
      if (id === undefined) return [frame.text];
      if (!note || note.id !== id) return null;
      return slideFramesOf(note, prayerSlidesOf(frame)).map((f) => (f.kind === 'text' ? f.text : ''));
    }
    case 'deck':
      return frame.slides.map((lines) => lines.map((line) => line.text).join('\n'));
    case 'psalm': {
      // The response is pinned over every verse on screen, so each slide of the copy carries it.
      const response = frame.response.trim();
      return frame.pages.map((page) => (response ? `R. ${response}\n${page}` : page));
    }
    default:
      return null;
  }
}

/** The slide of its item `frame` is (0-based). */
export function slideIndexOf(frame: Frame): number {
  if (frame.kind === 'text') return frame.page?.index ?? 0;
  if (frame.kind === 'deck' || frame.kind === 'psalm') return frame.index;
  return 0;
}

/** The note body and manual split for these slides (see slidesNote). */
const composeSlides = (pages: string[]): { body: string; split: PrayerSplit | null } => slidesNote(pages);

/** Whether these slides fit in one note. */
export const slidesTooLong = (pages: string[]): boolean => composeSlides(pages).body.length > MAX_NOTE_BODY;
export { MAX_NOTE_BODY };

/** The screen slide that slide `page` of `pages` starts on, once the copy is fitted (a long slide can take more than one screen). */
function screenIndexOf(title: string, pages: string[], page: number): number {
  const before = pages.slice(0, Math.max(0, page)).filter((p) => p.trim());
  if (before.length === 0) return 0;
  const { body, split } = composeSlides(before);
  return screenPagesOf({ title, body, style: null, split }).length;
}

/** The Content Hub category the copy is filed under: the prayer's own, or the Mass flow category that matches the item. */
function categoryOf(item: QueueItem, note: Note | null): string {
  if (note && item.module === 'notes') return note.category;
  if (item.module === 'lectionary' || item.module === 'bible') return 'Scripture Reading';
  const label = item.label.toLowerCase();
  return MASS_FLOW_CATEGORIES.find((c) => label.includes(c.toLowerCase())) ?? 'Holy Mass Response';
}

export interface SaveSlides {
  /** The queue row of the item. */
  index: number;
  item: QueueItem;
  /** The prayer the item plays, when it is one (useNoteOf). */
  note: Note | null;
  /** Every slide of the item, after the change. */
  pages: string[];
  /** The slide (of `pages`) to have on screen afterwards: the one that was there, or the new one for Add and show. */
  showPage: number;
  /** True when the slide on screen is the one that changed in place, so it is redrawn with no transition. */
  inPlace: boolean;
}

/**
 * Saves the item's slides to this plan's copy (made the first time), and puts the copy's slide `showPage` where the item's slide was: on air
 * when the Holy Mass has the screen, otherwise staged, so Take live shows it.
 */
export async function saveItemSlides({ index, item, note, pages, showPage, inPlace }: SaveSlides): Promise<void> {
  const { body, split } = composeSlides(pages);
  if (!body.trim()) throw new Error('A slide needs some words.');
  if (body.length > MAX_NOTE_BODY) throw new Error(`This item is too long to save: keep it under ${MAX_NOTE_BODY} characters.`);
  const planId = useLive.getState().state.queuePlanId;
  if (planId == null) throw new Error('No Holy Mass plan is loaded in the queue.');
  const owner = massCopyOwner(planId);
  const own = isOwnCopy(item, note, owner);
  const title = (note?.title ?? item.label).trim().slice(0, MAX_NOTE_TITLE) || 'Holy Mass';
  // saveCopy only ever makes a new copy or changes this plan's own: the Hub entry, the Lectionary and the Mass text are read, never written.
  const saved = await bridge.notes.saveCopy(
    {
      ...(own ? { id: note.id } : {}),
      title,
      category: categoryOf(item, note),
      body,
      display: 'full',
      style: note?.style ?? null,
      split,
      slot: item.slot ?? null,
    },
    owner,
  );
  let at = index;
  if (!own) {
    at = await replaceRowInFlow(index, { module: 'notes', sourceId: String(saved.id), label: saved.title });
    // The slide goes up once the queue the main process holds plays the copy, so stepping on from it walks the copy.
    await whenLive((s) => s.queue[at]?.module === 'notes' && noteSource(s.queue[at].sourceId)?.id === saved.id);
  }

  const frames = slideFramesOf(saved);
  const frame = frames[Math.min(screenIndexOf(saved.title, pages, showPage), frames.length - 1)];
  if (!frame) return;
  const state = useLive.getState().state;
  // The operator moved on to another item while this saved: the copy is in the plan, and the screen is left as it is.
  if (state.queueCursor !== at) return;
  const covered = welcomeOverMass(state) || blackoutOverMass(state);
  if (massShowing(state) && !covered) {
    // The same slide with new words is swapped where it stands, as a song's is; anything else goes up as the queue's own take.
    if (own && inPlace && frame.kind === 'text' && frame.key) dispatch({ type: 'projector/refresh', key: frame.key, frame });
    else showWithin(frame);
  } else {
    dispatch({ type: 'projector/stage', frame });
  }
}

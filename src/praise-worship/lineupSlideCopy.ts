import { MAX_NOTE_BODY, MAX_NOTE_TITLE, exactSlidesNote } from '../../shared/notes.js';
import { prayerSlidesFor } from '../../shared/prayer-slides.js';
import { cardNameOf, removeChainItem, slideOriginsFor, withChain, type PwChainItem, type PwContent, type PwSegment, type PwSlideOrigin } from '../../shared/pw.js';
import { arrangementWithout, itemPages, liveStepAfterDelete, lyricAt, occurrenceOf, pagesWithout, type CardTextTarget } from '../../shared/pw-hot-edit.js';
import { bridge } from '../live/bridge';
import { useLive } from '../live/store';
import { cardCopyOwner, isCopyFor } from '../notes/slideCopies';
import { jumpTo, liveDeck, type LiveStep } from './live';
import { resolvedFor, setPwState, updateSegment, usePw } from './store';

/**
 * Edit slide on air and Add slide for the Praise & Worship lineup's slides that are not a song's: a prayer's pages, a reading's pages, a title
 * slide, and a PowerPoint deck's pictures (which take a text slide after them). As in the Holy Mass (see golive/massSlideCopy.ts), a prayer's or
 * a reading's words come from shared places (Notes & Prayers, the Lectionary), so they are never written back there: the card gets its own copy,
 * a full-screen Notes & Prayers entry holding every page with a slide break between them, put in the card where the item was. Later edits change
 * the copy. A title slide is the card's name, which belongs to this lineup, so editing it renames the card.
 */

export type { CardTextTarget };

// Paged as liveDeck pages: with the band, never with the operator's text size (a slide stays one slide at every size).
const settings = () => ({ band: useLive.getState().state.lowerThird.live });

/** Where each live step of a card comes from, lined up with liveDeck (the black step at the end has none). */
export function originsOf(segment: PwSegment): PwSlideOrigin[] {
  return slideOriginsFor(segment, resolvedFor(segment, usePw.getState()), settings());
}

/** The words of an item's text slides, in order, as the lineup shows them. Empty for a prayer slot with no prayer yet. */
export function pagesOfItem(steps: LiveStep[], origins: PwSlideOrigin[], item: PwSlideOrigin['item']): string[] {
  return itemPages(steps, origins, item);
}

/** The note an item plays now, if it is a prayer with one. */
function noteIdOf(content: PwContent, target: CardTextTarget): number | null {
  if (target.kind === 'head') return content.kind === 'prayer' ? content.noteId : null;
  if (target.kind === 'chain') {
    const item = content.more?.[target.index];
    return item?.kind === 'prayer' ? item.noteId : null;
  }
  return null;
}

/** The origin `item` the target's slides have once it is saved. */
const itemAfter = (target: CardTextTarget): PwSlideOrigin['item'] =>
  target.kind === 'head' || target.kind === 'newHead' ? 'head' : target.kind === 'chain' ? target.index : target.at;

/** How many screen slides the first `page` pages make: one each, since the operator's pages are kept exactly as typed (exactSlidesNote). */
function slidesBefore(pages: string[], page: number): number {
  const before = pages.slice(0, Math.max(0, page)).filter((p) => p.trim());
  if (before.length === 0) return 0;
  const { body, split } = exactSlidesNote(before);
  return prayerSlidesFor(body, split).pages.length;
}

export interface SaveCardText {
  segmentIndex: number;
  target: CardTextTarget;
  /** Every page of the item, after the change. */
  pages: string[];
  /** The page of the item to have on screen afterwards, or null to keep the slide that is on screen (`keep`). */
  showPage: number | null;
  /** Where the slide on screen came from, before the change. */
  keep: PwSlideOrigin | null;
}

/** Saves the item's pages to the card's own copy (made the first time), and keeps the projector on the right slide of the card. */
export async function saveCardText({ segmentIndex, target, pages, showPage, keep }: SaveCardText): Promise<void> {
  const state = usePw.getState();
  const segment = state.session?.segments[segmentIndex];
  if (!segment) throw new Error('That card is not in the lineup any more.');
  // Each page the operator typed stays one slide: a long page is fitted smaller on screen, never split into more slides.
  const { body, split } = exactSlidesNote(pages);
  if (!body.trim()) throw new Error('A slide needs some words.');
  if (body.length > MAX_NOTE_BODY) throw new Error(`This item is too long to save: keep it under ${MAX_NOTE_BODY} characters.`);

  const c = segment.content;
  const noteId = noteIdOf(c, target);
  const note = noteId == null ? null : state.prayers.find((n) => n.id === noteId) ?? (await bridge.notes.get(noteId).catch(() => null));
  const sessionId = state.session?.id;
  if (sessionId == null) throw new Error('Save the lineup first, then edit its slides.');
  const owner = cardCopyOwner(sessionId, segment.key);
  // Only this card's own copy is changed in place. A Hub prayer, or another card's or lineup's copy (a lineup made from this one), is copied.
  const own = note != null && isCopyFor(note, owner);
  const resolved = resolvedFor(segment, state);
  const reading = target.kind === 'head' ? resolved.reading : target.kind === 'chain' ? resolved.more?.[target.index]?.reading : null;
  const title = (note?.title ?? reading?.citation ?? segment.name).trim().slice(0, MAX_NOTE_TITLE) || segment.name;
  // saveCopy only ever makes a new copy or changes this card's own: the Hub entry and the Lectionary are read, never written.
  const saved = await bridge.notes.saveCopy(
    {
      ...(own ? { id: note.id } : {}),
      title,
      category: note?.category ?? (reading ? 'Scripture Reading' : 'Community Prayer'),
      body,
      display: 'full',
      style: note?.style ?? null,
      split,
    },
    owner,
  );
  // The lineup reads its prayers from the store, so the copy is put there now rather than on the next library refresh.
  setPwState((s) => ({ prayers: [...s.prayers.filter((n) => n.id !== saved.id), saved] }));

  if (!own) {
    const more = [...(c.more ?? [])];
    let content: PwContent = c;
    let cues = segment.cues;
    if (target.kind === 'head' || target.kind === 'newHead') {
      content = { kind: 'prayer', noteId: saved.id, hymnIds: c.hymnIds, ...(more.length ? { more } : {}) };
      // A title card's title slide stays first once it has words after it.
      if (target.kind === 'newHead') cues = { ...cues, titleFirst: true };
    } else {
      const item: PwChainItem = { kind: 'prayer', noteId: saved.id, minutes: target.kind === 'chain' ? more[target.index]?.minutes ?? 0 : 0 };
      if (target.kind === 'chain') more[target.index] = item;
      else more.splice(target.at, 0, item);
      content = { ...c, more };
    }
    updateSegment(segmentIndex, { content, cues });
  }

  // Back on the projector: the slide asked for, or the one that was on screen, wherever the change has moved it.
  const live = useLive.getState().state.pw;
  const fresh = usePw.getState().session?.segments[segmentIndex];
  if (!fresh || !live?.onAir || live.segmentKey !== fresh.key) return;
  const after = itemAfter(target);
  const want: { item: PwSlideOrigin['item']; page: number | null; title: boolean } | null =
    showPage !== null
      ? { item: after, page: slidesBefore(pages, showPage), title: false }
      : keep
        ? {
            item: typeof keep.item === 'number' && target.kind === 'newChain' && keep.item >= target.at ? keep.item + 1 : keep.item,
            page: keep.page,
            title: keep.title,
          }
        : null;
  if (!want) return;
  const origins = originsOf(fresh);
  const deck = liveDeck(usePw.getState().session!)[segmentIndex] ?? [];
  let index = origins.findIndex((o) => o.item === want.item && (want.page === null ? o.title === want.title : o.page === want.page));
  if (index < 0) index = origins.findIndex((o) => o.item === want.item && o.page !== null);
  if (index >= 0 && index < deck.length) jumpTo(segmentIndex, index);
}

/** Why a slide stayed: the item's only slide, the song's last section on the card, or a slide Delete does not reach. */
export type DeleteRefusal = 'deleteSlideLast' | 'deleteSlideLastStanza' | 'deleteSlideNone';

/** How many steps the card has now, to tell how many a delete took out. */
const stepCount = (segmentIndex: number) => {
  const session = usePw.getState().session;
  return session ? (liveDeck(session)[segmentIndex] ?? []).length : 0;
};

/**
 * After a delete, while this card is on air: when the deleted slide was the one on screen, the slide that took its place goes up (the next
 * one, or the one before when the last went). A slide deleted off screen (from the Output Preview Editor) never moves the screen: the slide
 * on screen stays up, one place earlier when the deleted one came before it. `start` is the first step taken out, `before` the card's step
 * count before the delete.
 */
function showAfterDelete(segmentIndex: number, start: number, before: number) {
  const live = useLive.getState().state.pw;
  const session = usePw.getState().session;
  const fresh = session?.segments[segmentIndex];
  if (!session || !fresh || !live?.onAir || live.segmentKey !== fresh.key) return;
  const deck = liveDeck(session)[segmentIndex] ?? [];
  const slides = deck.filter((s) => s.kind === 'slide').length;
  const next = liveStepAfterDelete({ shown: live.slide, start, removed: before - deck.length, slides });
  if (next !== null) jumpTo(segmentIndex, next);
}

/**
 * Delete slide on a song's slide: this appearance of its stanza leaves the card's own order of the song (all its pages go, since a page is part
 * of a stanza). The song in Song Lyrics keeps the stanza; the order is the card's, in this lineup only.
 */
export function deleteSongStep(segmentIndex: number, steps: LiveStep[], step: number): DeleteRefusal | null {
  const state = usePw.getState();
  const segment = state.session?.segments[segmentIndex];
  const slide = lyricAt(steps, step);
  const hymn = slide ? state.hymns[slide.hymnId] : null;
  if (!segment || !slide || !hymn) return 'deleteSlideNone';
  const arrangement = arrangementWithout(segment.arrangement, hymn, slide.sectionId, occurrenceOf(steps, step));
  if (!arrangement) return 'deleteSlideLastStanza';
  const before = stepCount(segmentIndex);
  updateSegment(segmentIndex, { arrangement });
  showAfterDelete(segmentIndex, step - (slide.part ?? 0), before);
  return null;
}

/**
 * Delete slide on any other slide of a card, in this lineup only:
 * - a page of a prayer or a reading leaves the card's own copy of it (made the first time, as Edit does); an item's only page takes the item
 *   off the card when it is chained, and stays when it is the card's first item;
 * - a PowerPoint picture leaves the card's list of the deck's pictures (the Whiteboard keeps it), and the last one takes the deck off the card;
 * - the card's title slide turns off its Title slide first cue, when it is the card's only title slide.
 * The library, the Lectionary and the Whiteboard are never written. Null once the slide is gone.
 */
export async function deleteCardStep(segmentIndex: number, steps: LiveStep[], step: number): Promise<DeleteRefusal | null> {
  const state = usePw.getState();
  const segment = state.session?.segments[segmentIndex];
  const s = steps[step];
  if (!segment || !s || s.kind !== 'slide' || s.slide.kind === 'lyrics') return 'deleteSlideNone';
  const origins = originsOf(segment);
  const origin = origins[step];
  if (!origin) return 'deleteSlideNone';
  const slideCount = steps.filter((x) => x.kind === 'slide').length;
  if (slideCount <= 1) return 'deleteSlideLast';
  const before = stepCount(segmentIndex);
  const firstOf = (item: PwSlideOrigin['item']) => Math.max(0, origins.findIndex((o) => o.item === item));
  const dropChain = (index: number) => {
    const patch = removeChainItem(segment, index);
    if (!patch) return 'deleteSlideNone' as const;
    updateSegment(segmentIndex, patch);
    showAfterDelete(segmentIndex, firstOf(index), before);
    return null;
  };

  if (origin.title) {
    // A title card's title is the card itself, and the cue makes every title slide on the card at once, so only a lone one goes.
    const titles = origins.filter((o) => o.title).length;
    if (origin.item === 'card' || origin.source === 'title' || !segment.cues.titleFirst || titles > 1) return 'deleteSlideNone';
    updateSegment(segmentIndex, { cues: { ...segment.cues, titleFirst: false } });
    showAfterDelete(segmentIndex, step, before);
    return null;
  }

  if (origin.source === 'pictures' && typeof origin.item === 'number') {
    const item = segment.content.more?.[origin.item];
    if (item?.kind !== 'pictures') return 'deleteSlideNone';
    // The deck's slides are its pictures that have loaded, in order, so the k-th picture slide is the k-th loaded id.
    const shown = item.slideIds.filter((id) => state.pictures[id]?.src);
    const k = origins.slice(0, step).filter((o) => o.item === origin.item).length;
    const id = shown[k];
    if (id === undefined) return 'deleteSlideNone';
    const slideIds = item.slideIds.filter((x) => x !== id);
    if (slideIds.length === 0 || shown.length <= 1) return dropChain(origin.item);
    const more = [...(segment.content.more ?? [])];
    more[origin.item] = { ...item, slideIds };
    updateSegment(segmentIndex, withChain(segment, more));
    showAfterDelete(segmentIndex, step, before);
    return null;
  }

  if ((origin.source === 'prayer' || origin.source === 'reading') && origin.page !== null && origin.item !== 'songs' && origin.item !== 'card') {
    if (s.slide.kind === 'prayer' && s.slide.placeholder) return 'deleteSlideNone';
    const pages = pagesOfItem(steps, origins, origin.item);
    const next = pagesWithout(pages, origin.page);
    if (!next) return typeof origin.item === 'number' ? dropChain(origin.item) : 'deleteSlideLast';
    const target: CardTextTarget = origin.item === 'head' ? { kind: 'head' } : { kind: 'chain', index: origin.item };
    // Saved without moving the projector; the slide that took the deleted one's place goes up after.
    await saveCardText({ segmentIndex, target, pages: next, showPage: null, keep: null });
    showAfterDelete(segmentIndex, step, before);
    return null;
  }
  return 'deleteSlideNone';
}

/** Renames the card: its title slide shows the new name at once. The card belongs to this lineup, so nothing else changes. */
export function renameCard(segmentIndex: number, name: string) {
  const clean = cardNameOf(name);
  if (!clean) throw new Error('A title needs some words.');
  updateSegment(segmentIndex, { name: clean });
  const live = useLive.getState().state.pw;
  const segment = usePw.getState().session?.segments[segmentIndex];
  if (live?.onAir && segment && live.segmentKey === segment.key) jumpTo(segmentIndex, live.slide);
}

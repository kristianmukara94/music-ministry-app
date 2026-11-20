// What the console's slide editor (SlideEditorCard) can change, for each kind of slide, and the copy-on-write path each change takes. Nothing
// here writes Song Lyrics, the Lectionary or a Liturgical Content Hub entry:
// - a song's stanza is kept for this run of the app only (live/liveSongEdits.setLiveStanzas), as the old on-air editors did;
// - a Holy Mass item's slides go to this plan's own copy of the item (massSlideCopy.saveItemSlides);
// - a Praise & Worship song's slide is taken out of the card's own order of the song (lineupSlideCopy.deleteSongStep).
import type { Frame, QueueItem } from '../../../shared/live.js';
import { arrangementWithInsert, arrangementWithout, occurrenceOf, pagesWithout, slideAfterDelete } from '../../../shared/pw-hot-edit.js';
import { canDeleteSlide } from '../../../shared/stage-cue.js';
import { setLiveStanzas, type LiveStanza } from '../../live/liveSongEdits';
import type { Hymn } from '../../lyrics/types';
import type { Note } from '../../notes/types';
import { ADD_LABELS, labelFor } from '../../praise-worship/useLiveHotEditor';
import { deleteSongStep } from '../../praise-worship/lineupSlideCopy';
import { updateSegment, usePw } from '../../praise-worship/store';
import type { LiveStep } from '../../praise-worship/live';
import type { PwT } from '../../praise-worship/strings';
import { MAX_NOTE_BODY, saveItemSlides, slideIndexOf, slidePagesOf, slidesTooLong } from '../massSlideCopy';
import type { SlideEditTarget } from './SlideEditorCard';

/** Lines that would start a new section, which an edit must not slip into a stanza's words. */
const SECTION_LINE = /^\s*\[[^\]]+\]\s*$/m;

/** Why a stanza's new words are refused, or null when they can be saved. The same rules as the on-air stanza editor. */
export function stanzaProblem(text: string): string | null {
  if (!text.trim()) return 'A stanza needs some words. To take one out, use Delete Slide.';
  if (SECTION_LINE.test(text)) return 'A line in [brackets] starts a new section. Take it out, or add the section as its own slide.';
  return null;
}

/** The Section Tag menu for a song: its own sections, then a new verse number, Chorus, Bridge and Outro. */
export function songTags(hymn: Hymn): string[] {
  return [...new Set([...hymn.stanzas.map((s) => s.stanzaType), ...ADD_LABELS.map((label) => labelFor(label, hymn.stanzas))])];
}

const stanzaOf = (s: Hymn['stanzas'][number]): LiveStanza => ({ id: s.id, stanzaType: s.stanzaType, lyricsText: s.lyricsText });

interface SongTargetOptions {
  hymn: Hymn;
  /** The stanza on air (0-based in the song). A song's title card has no words of its own, so it has no target. */
  stanza: number;
  /** The slide's number in its item, for the editor's title. */
  number: number;
  /** Identifies the slide on air, so the draft starts over when it changes. */
  key: string;
  /** After a new stanza is saved: the console puts it in its own order (a Praise & Worship card that sings the song its own way). */
  onAdded?: (added: { id: number }) => void;
  /** Delete Slide for this slide, or null when it cannot be deleted. */
  remove: (() => Promise<void>) | null;
}

/** A song's slide: its stanza's words and section, a new stanza after it, and Delete Slide, all for this service only. */
export function songTarget({ hymn, stanza, number, key, onAdded, remove }: SongTargetOptions): SlideEditTarget | null {
  const own = hymn.stanzas[stanza];
  const add = async (text: string, tag: string | null) => {
    const problem = stanzaProblem(text);
    if (problem) throw new Error(problem);
    const at = Math.min(stanza + 1, hymn.stanzas.length);
    const fresh = await setLiveStanzas(hymn, [
      ...hymn.stanzas.slice(0, at).map(stanzaOf),
      { stanzaType: tag || labelFor('Verse', hymn.stanzas), lyricsText: text },
      ...hymn.stanzas.slice(at).map(stanzaOf),
    ]);
    const added = fresh.stanzas[at];
    if (added) onAdded?.(added);
  };
  if (!own) return null;
  return {
    key,
    number,
    text: own.lyricsText,
    tag: own.stanzaType,
    tagOptions: songTags(hymn),
    apply: async (text, tag) => {
      const problem = stanzaProblem(text);
      if (problem) throw new Error(problem);
      const type = tag || own.stanzaType;
      if (text === own.lyricsText && type === own.stanzaType) return;
      await setLiveStanzas(hymn, hymn.stanzas.map((s, i) => (i === stanza ? { id: s.id, stanzaType: type, lyricsText: text } : stanzaOf(s))));
    },
    add,
    remove,
  };
}

/** Delete Slide on a Holy Mass song's stanza: it leaves the song for this service only. The song's only stanza stays. */
export function massSongRemove(hymn: Hymn, stanza: number): (() => Promise<void>) | null {
  if (!hymn.stanzas[stanza] || !canDeleteSlide(hymn.stanzas.length)) return null;
  return async () => {
    await setLiveStanzas(hymn, hymn.stanzas.filter((_, i) => i !== stanza).map(stanzaOf));
  };
}

/**
 * A Praise & Worship song's slide on air: the stanza behind it. A new stanza is listed straight after this appearance in the card's own order,
 * and Delete Slide takes this appearance out of that order (the song keeps it).
 */
export function pwSongTarget({ t, segmentIndex, steps, onAir, hymn }: { t: PwT; segmentIndex: number; steps: LiveStep[]; onAir: number; hymn: Hymn }): SlideEditTarget | null {
  const s = steps[onAir];
  if (s?.kind !== 'slide' || s.slide.kind !== 'lyrics') return null;
  const slide = s.slide;
  const stanza = slide.position ?? hymn.stanzas.findIndex((x) => String(x.id) === slide.sectionId);
  const segment = usePw.getState().session?.segments[segmentIndex];
  const segmentKey = segment?.key ?? String(segmentIndex);
  // The card's only appearance of the song's only stanza stays: the card would sing nothing.
  const deletable = Boolean(segment && arrangementWithout(segment.arrangement, hymn, slide.sectionId, occurrenceOf(steps, onAir)));
  return songTarget({
    hymn,
    stanza,
    number: onAir + 1,
    key: `pw:${segmentKey}:${onAir}:${slide.sectionId}`,
    onAdded: (added) => {
      const segment = usePw.getState().session?.segments[segmentIndex];
      if (!segment) return;
      const arrangement = arrangementWithInsert(segment.arrangement, hymn.id, slide.sectionId, occurrenceOf(steps, onAir), added.id);
      if (arrangement !== segment.arrangement) updateSegment(segmentIndex, { arrangement });
    },
    remove: !deletable ? null : async () => {
      const refusal = deleteSongStep(segmentIndex, steps, onAir);
      if (refusal) throw new Error(t(refusal));
    },
  });
}

/**
 * A Holy Mass item that is not a song (a Mass part, a reading, a psalm, a prayer, a typed response, a passage): slide `page` of it (the slide on
 * screen or staged when `page` is left out), saved to this plan's own copy of the item. `frame` is the item's slide on screen or staged, and it
 * stays there: a change to another of the item's slides never moves the screen. Null for an item with no words to change here (a picture, a
 * missing item) or no such slide.
 */
export function massPagesTarget({ t, item, index, frame, note, page }: { t: PwT; item: QueueItem; index: number; frame: Frame; note: Note | null; page?: number }): SlideEditTarget | null {
  const pages = item.stale ? null : slidePagesOf(frame, note);
  const current = slideIndexOf(frame);
  const at = page ?? current;
  if (!pages || pages[at] === undefined || pages[current] === undefined) return null;
  const save = async (next: string[], showPage: number, inPlace: boolean) => {
    if (slidesTooLong(next)) throw new Error(t('slideTooLong', { max: MAX_NOTE_BODY }));
    await saveItemSlides({ index, item, note, pages: next, showPage, inPlace });
  };
  const rest = pagesWithout(pages, at);
  // The slide on screen after a slide is taken out: the next one when it was the one on screen, else the same slide, one place earlier when
  // the slide taken out came before it.
  const shownAfterDelete = (left: number) => (at === current ? slideAfterDelete(current, left) : at < current ? current - 1 : current);
  return {
    key: `mass:${item.id}:${at}`,
    number: at + 1,
    text: pages[at],
    tag: item.label,
    tagOptions: null,
    apply: async (text) => {
      if (!text.trim()) throw new Error('A slide needs some words. To take one out, use Delete Slide.');
      if (text === pages[at]) return;
      await save(pages.map((p, i) => (i === at ? text : p)), current, at === current);
    },
    // The new slide goes after this one. The slide on screen keeps its place on screen (one place later when the new slide comes before it).
    add: async (text) => {
      const after = Math.min(at + 1, pages.length);
      await save([...pages.slice(0, after), text, ...pages.slice(after)], after <= current ? current + 1 : current, false);
    },
    remove: rest && canDeleteSlide(pages.length) ? () => save(rest, shownAfterDelete(rest.length), false) : null,
  };
}

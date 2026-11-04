import { isAnyOutputLive } from '../../shared/live.js';
import type { Frame, QueueItem } from '../../shared/live.js';
import { bridge } from '../live/bridge';
import { dispatch, useLive } from '../live/store';
import { turnOnProjectorAndGo } from '../live/startup';
import { massPartFrame } from '../liturgy/massOrder';
import { pagesOf } from '../announcements/paginate';
import { loadPassage, scriptureSlides } from '../bible/projection';
import { parseSourceId } from '../../shared/bible-ref.js';
import { announcementSource } from '../../shared/flow-insert.js';
import { bibleT } from '../../shared/bible-i18n.js';
import { setUi, useUi } from '../state/ui';
import { stagePrayer, takePrayer } from '../notes/present';
import { songTitleFrame, textRowActions } from '../../shared/stage-plan-row.js';
import { slotById } from '../../shared/mass-slots.js';
import { announcementFrame } from '../announcements/frames';
import { frameForWhiteboardSlide } from '../whiteboard/projectSlide';

/** How a queue item is played. `inPlace` shows songs, announcements and media where the operator is (the Go Live console), without switching panels. */
export interface PlayOptions {
  inPlace?: boolean;
}

/**
 * Stages a Holy Mass song on its title card, with its slot's name above it. Next then goes to its first stanza. Resolves false when the song is gone
 * or has no stanzas.
 */
async function stageSong(item: QueueItem): Promise<boolean> {
  const hymn = await bridge.lyrics.getHymn(Number(item.sourceId));
  const frame = hymn && !hymn.deletedAt && hymn.stanzas.length > 0 ? songTitleFrame(hymn, slotById(item.slot)?.name) : null;
  if (!frame) return false;
  dispatch({ type: 'projector/stage', frame });
  return true;
}

/**
 * Stages an Announcements slide, with the pictures of its folder around it. Resolves false when the slide is gone. A PowerPoint slide from the
 * Whiteboard steps through its Whiteboard folder (its deck), not through every PowerPoint picture, which all share one Announcements folder.
 * A deck slice's row (see deckSlice) steps from its slide to the end of the deck, and an older single slide's row shows its picture alone.
 */
async function stageAnnouncement(sourceId: string): Promise<boolean> {
  const source = announcementSource(sourceId);
  if (!source) return false;
  const [list, board] = await Promise.all([bridge.announcements.slides(null), bridge.whiteboard.list().catch(() => [])]);
  const slide = list.find((s) => s.id === source.slideId);
  if (!slide) return false;
  const picture = board.find((w) => w.slideId === slide.id && w.image);
  /** The slides around `first` that the row plays: all of its deck, the deck from `first` on, or `first` alone. */
  const around = <T extends { folderId: number | null }>(first: T, deck: T[]) => {
    if (source.alone) return [first];
    const same = deck.filter((s) => s.folderId === first.folderId);
    return source.from ? same.slice(Math.max(0, same.indexOf(first))) : same;
  };
  const frame = picture
    ? frameForWhiteboardSlide(picture, around(picture, board.filter((w) => w.image)))
    : announcementFrame(slide, around(slide, list));
  dispatch({ type: 'projector/stage', frame });
  return true;
}

/** Puts a Media Library picture or video on the background layer. Audio plays in the Media Library, so it is skipped. */
async function showMedia(sourceId: string): Promise<void> {
  const asset = (await bridge.media.list()).find((m) => m.id === Number(sourceId));
  if (!asset || asset.mediaType === 'audio') return;
  dispatch({ type: 'background/stage', media: { kind: 'media', mediaType: asset.mediaType, src: asset.src, title: asset.filename } });
  dispatch({ type: 'background/take' });
}

/**
 * Opens a Service Queue entry in the module that owns it and stages it there. Resolves true when it staged a frame
 * that should go live now, so the caller takes it. A song takes its first stanza itself once the hymn has loaded.
 */
export async function openQueueItem(item: QueueItem, index: number, opts: PlayOptions = {}): Promise<boolean> {
  // A missing source has nothing to stage, so it cannot be opened.
  if (item.stale) return false;
  dispatch({ type: 'queue/cursor', index });
  switch (item.module) {
    case 'lyrics':
      if (opts.inPlace) return stageSong(item);
      // The song deck loads the hymn, then takes its first stanza live on the queue's account.
      setUi({ view: 'lyrics', pendingFocus: { kind: 'hymn', id: Number(item.sourceId) } });
      return false;

    case 'announcements':
      if (opts.inPlace) return stageAnnouncement(item.sourceId);
      // The deck switches to the slide's folder and stages it.
      setUi({ view: 'announcements', pendingFocus: { kind: 'slide', id: announcementSource(item.sourceId)?.slideId ?? NaN } });
      return false;

    case 'media':
      if (opts.inPlace) {
        await showMedia(item.sourceId);
        return false;
      }
      // Staged on the background layer; the library shows it as staged.
      setUi({ view: 'media', pendingFocus: { kind: 'media', id: Number(item.sourceId) } });
      return false;

    case 'lectionary': {
      const [date, readingType] = item.sourceId.split('|');
      setUi({ view: 'lectionary', pendingFocus: { kind: 'reading', date, readingType } });
      return stageReading(date, readingType);
    }

    case 'mass_order': {
      const frame = massPartFrame(item.sourceId, useUi.getState().lang);
      if (!frame) return false;
      dispatch({ type: 'projector/stage', frame });
      return true;
    }

    case 'custom': {
      // A typed response that fills a slot ("I confess to almighty God") is staged as its own slide, as the planner's ▷ does. A typed row
      // with no slot is an operator note and is never shown.
      const stage = textRowActions(item, index, slotById(item.slot)?.name ?? item.label)?.find((a) => a.type === 'projector/stage');
      if (!stage) return false;
      dispatch(stage);
      return true;
    }

    case 'notes': {
      // A prayer is staged the way its note is shown. Operator-only notes are never staged for the projector.
      const note = await bridge.notes.get(Number(item.sourceId));
      if (note) stagePrayer(note);
      return false;
    }

    case 'bible': {
      // The passage is staged here, in the slides the projector will show. The operator stays where they are.
      const ref = parseSourceId(item.sourceId);
      if (!ref) return false;
      try {
        const { book, chapter, verses } = await loadPassage(ref.translationId, ref.bookName, ref.chapter, ref.from, ref.to);
        const pageLabel = bibleT(useUi.getState().lang, 'pageLabel');
        const slides = scriptureSlides(verses, { bookName: book.name, chapter }, pageLabel);
        // The passage mark lets the Bible deck badge the verses that are live when it is next opened.
        const passage = { translationId: ref.translationId, bookNumber: book.number, chapter, verses: verses.map((v) => v.verse) };
        dispatch({ type: 'projector/stage', frame: { kind: 'deck', title: '', slides, index: 0, passage } });
        return true;
      } catch (err) {
        window.alert(err instanceof Error ? err.message : String(err));
        return false;
      }
    }
  }
  return false;
}

/**
 * Puts a queue item on the projector. Notes are looked up first, so an operator-only note never reaches the screen.
 * The take is tagged as coming from the Mass Queue, so the queue keeps its CURRENT selection.
 */
export async function takeQueueItem(item: QueueItem, index: number, opts: PlayOptions = {}): Promise<void> {
  if (item.module === 'notes') {
    const note = await bridge.notes.get(Number(item.sourceId));
    if (note?.display === 'full') {
      dispatch({ type: 'queue/cursor', index });
      takePrayer(note, 'MASS_QUEUE');
    } else if (note) {
      // A lower-third note goes to the lower third, not the projector, so it does not move the CURRENT selection.
      takePrayer(note);
    }
    return;
  }
  if (await openQueueItem(item, index, opts)) dispatch({ type: 'projector/take', source: 'MASS_QUEUE' });
}

/**
 * Plays the queue item at `index` on the projector: the entry point for the row buttons, the row itself and the steppers.
 * With no output live (the projector or the Remote view), the operator is asked to turn the projector on, and that prompt does the take.
 * A live Remote view is enough to go straight ahead.
 */
export async function playQueueAt(index: number, opts: PlayOptions = {}): Promise<void> {
  const state = useLive.getState().state;
  const item = state.queue[index];
  if (!item) return;
  if (!isAnyOutputLive(state)) {
    // The operator chose to skip for this session: go live in the app only, with no prompt and no projector window.
    if (useUi.getState().projectorPromptChoice === 'skip') {
      await takeQueueItem(item, index, opts);
      return;
    }
    setUi({
      projectorPrompt: {
        label: item.label,
        turnOnAndGo: () => {
          setUi({ projectorPrompt: null });
          turnOnProjectorAndGo(() => {
            void takeQueueItem(item, index, opts).catch((err) => window.alert(err instanceof Error ? err.message : String(err)));
          });
        },
        // Live without the projector: no window opens and the startup helper is not used. The preview shows the item.
        skip: () => {
          setUi({ projectorPrompt: null, projectorPromptChoice: 'skip' });
          void takeQueueItem(item, index, opts).catch((err) => window.alert(err instanceof Error ? err.message : String(err)));
        },
      },
    });
    return;
  }
  await takeQueueItem(item, index, opts);
}

/**
 * Moves the Service Queue position one entry forward (+1) or back (-1), skipping entries whose source is
 * missing, and puts that entry live. Used by Next, Previous and Ctrl+Up / Ctrl+Down.
 */
export async function stepQueue(delta: 1 | -1, opts: PlayOptions = {}): Promise<void> {
  const { queue, queueCursor } = useLive.getState().state;
  if (queue.length === 0) return;
  // Nothing is selected yet: Previous selects the top item. It does not take it live.
  if (queueCursor < 0 && delta < 0) {
    dispatch({ type: 'queue/cursor', index: 0 });
    return;
  }
  let index = queueCursor + delta;
  while (index >= 0 && index < queue.length && queue[index].stale) index += delta;
  if (index < 0 || index >= queue.length) return;
  await playQueueAt(index, opts);
}

/** Stages a saved reading straight from the database, so it works without the deck's editor state. Resolves true when staged. */
async function stageReading(date: string, readingType: string): Promise<boolean> {
  const day = await bridge.lectionary.getDay(date);
  const row = day.readings.find((r) => r.readingType === readingType);
  if (!row?.rawText) return false;

  const pages = pagesOf(row.rawText);
  const title = [day.seasonInfo, readingType, row.citation].map((s) => s.trim()).filter(Boolean).join(' · ');
  const frame: Frame =
    readingType === 'Responsorial Psalm'
      ? { kind: 'psalm', title, response: row.congregationResponse, pages, index: 0, style: row.style }
      : {
          kind: 'deck',
          title,
          // Blank lines stay in as empty reader lines, so paragraph spacing survives.
          slides: pages.map((page) => page.split('\n').map((text) => ({ role: 'reader' as const, text }))),
          index: 0,
          style: row.style,
        };
  dispatch({ type: 'projector/stage', frame });
  return true;
}

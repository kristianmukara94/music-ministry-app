import { isAnyOutputLive } from '../../shared/live.js';
import type { Frame, QueueItem } from '../../shared/live.js';
import { bridge } from '../live/bridge';
import { liveLyrics } from '../live/liveSongEdits';
import { dispatch, useLive } from '../live/store';
import { turnOnProjectorAndGo } from '../live/startup';
import { massPartFrame } from '../liturgy/massOrder';
import { readingKey, readingSlides } from '../lectionary/pages';
import { hasResponse } from '../../shared/daily-readings.js';
import { loadPassage, scriptureSlides } from '../bible/projection';
import { parseSourceId } from '../../shared/bible-ref.js';
import { announcementSource } from '../../shared/flow-insert.js';
import { bibleT } from '../../shared/bible-i18n.js';
import { setUi, useUi } from '../state/ui';
import { slideFramesOf, stagePrayer, takePrayer } from '../notes/present';
import type { Note } from '../notes/types';
import { stanzaFrame } from '../lyrics/frames';
import { openQuickLivePreview } from '../golive/quickLiveSession';
import { songTitleFrame, textRowActions } from '../../shared/stage-plan-row.js';
import { slotById } from '../../shared/mass-slots.js';
import { announcementFrame } from '../announcements/frames';
import { frameForWhiteboardSlide } from '../whiteboard/projectSlide';
import { uiLangOf } from '../../shared/mass-language.js';
import { goLiveNowActions } from '../../shared/lyrics-live.js';
import { quickLiveBand } from '../praise-worship/useQuickLiveController';
import { planLanguage } from './plan-api';
import { noteSource } from '../../shared/notes.js';
import { assetFrame } from '../media/frame';

/** How a queue item is played. `inPlace` shows songs, announcements and media where the operator is (the Go Live console), without switching panels. */
export interface PlayOptions {
  inPlace?: boolean;
}

/**
 * Stages a Holy Mass song on its title card, with its slot's name above it. Next then goes to its first stanza. Resolves false when the song is gone
 * or has no stanzas.
 */
async function songItemFrame(item: QueueItem): Promise<Frame | null> {
  const hymn = await liveLyrics.getHymn(Number(item.sourceId));
  return hymn && !hymn.deletedAt && hymn.stanzas.length > 0 ? songTitleFrame(hymn, slotById(item.slot)?.name) : null;
}

async function stageSong(item: QueueItem): Promise<boolean> {
  const frame = await songItemFrame(item);
  if (!frame) return false;
  dispatch({ type: 'projector/stage', frame });
  return true;
}

/**
 * Stages an Announcements slide, with the pictures of its folder around it. Resolves false when the slide is gone. A PowerPoint slide from the
 * Whiteboard steps through its Whiteboard folder (its deck), not through every PowerPoint picture, which all share one Announcements folder.
 * A deck slice's row (see deckSlice) steps from its slide to the end of the deck, and an older single slide's row shows its picture alone.
 */
async function announcementItemFrame(sourceId: string): Promise<Frame | null> {
  const source = announcementSource(sourceId);
  if (!source) return null;
  const [list, board] = await Promise.all([bridge.announcements.slides(null), bridge.whiteboard.list().catch(() => [])]);
  const slide = list.find((s) => s.id === source.slideId);
  if (!slide) return null;
  const picture = board.find((w) => w.slideId === slide.id && w.image);
  /** The slides around `first` that the row plays: all of its deck, the deck from `first` on, or `first` alone. */
  const around = <T extends { folderId: number | null }>(first: T, deck: T[]) => {
    if (source.alone) return [first];
    const same = deck.filter((s) => s.folderId === first.folderId);
    return source.from ? same.slice(Math.max(0, same.indexOf(first))) : same;
  };
  return picture ? frameForWhiteboardSlide(picture, around(picture, board.filter((w) => w.image))) : announcementFrame(slide, around(slide, list));
}

async function stageAnnouncement(sourceId: string): Promise<boolean> {
  const frame = await announcementItemFrame(sourceId);
  if (!frame) return false;
  dispatch({ type: 'projector/stage', frame });
  return true;
}

/** Puts a Media Library picture or video on the background layer. Audio plays in the Media Library, so it is skipped. */
async function showMedia(sourceId: string): Promise<void> {
  const asset = (await bridge.media.list()).find((m) => m.id === Number(sourceId));
  const frame = asset ? assetFrame(asset) : null;
  if (!frame) return;
  dispatch({ type: 'background/stage', media: frame });
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
      // In place (the Go Live console, the planner's ▷) the operator stays where they are, so stepping through the Mass never leaves it.
      if (!opts.inPlace) setUi({ view: 'lectionary', pendingFocus: { kind: 'reading', date, readingType } });
      return stageReading(date, readingType);
    }

    case 'mass_order': {
      // A part is shown in the language of the plan it belongs to (Kyrie in Cebuano for a Cebuano Mass), whatever the app's own language.
      const language = await planLanguage(useLive.getState().state.queuePlanId);
      const frame = massPartFrame(item.sourceId, language ? uiLangOf(language) : useUi.getState().lang);
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
      const source = noteSource(item.sourceId);
      const note = source ? await bridge.notes.get(source.id) : null;
      if (note) stagePrayer(note, 0, source?.slides);
      return false;
    }

    case 'bible': {
      // The passage is staged here, in the slides the projector will show. The operator stays where they are.
      try {
        return await stageBiblePassage(item.sourceId);
      } catch (err) {
        window.alert(err instanceof Error ? err.message : String(err));
        return false;
      }
    }
  }
  return false;
}

/**
 * The first slide a queue item would put on the projector, built without staging it: what the Go Live console shows when a lineup row is
 * selected but not played, so its slides can be checked and edited while the projector keeps what it shows. Null for an item with no slide of
 * its own (a missing item, a picture or video on the background layer, a lower-third or private note, an empty song).
 */
export async function queueItemFrame(item: QueueItem, index: number): Promise<Frame | null> {
  if (item.stale) return null;
  switch (item.module) {
    case 'lyrics':
      return songItemFrame(item);
    case 'announcements':
      return announcementItemFrame(item.sourceId);
    case 'lectionary': {
      const [date, readingType] = item.sourceId.split('|');
      return readingFrame(date, readingType);
    }
    case 'mass_order': {
      const language = await planLanguage(useLive.getState().state.queuePlanId);
      return massPartFrame(item.sourceId, language ? uiLangOf(language) : useUi.getState().lang);
    }
    case 'custom': {
      const stage = textRowActions(item, index, slotById(item.slot)?.name ?? item.label)?.find((a) => a.type === 'projector/stage');
      return stage && 'frame' in stage ? (stage.frame as Frame) : null;
    }
    case 'notes': {
      const source = noteSource(item.sourceId);
      const note = source ? await bridge.notes.get(source.id).catch(() => null) : null;
      return note?.display === 'full' ? slideFramesOf(note, source?.slides)[0] ?? null : null;
    }
    case 'bible':
      return (await biblePassageFrame(item.sourceId))?.frame ?? null;
  }
  return null;
}

/**
 * Puts a queue item on the projector. Notes are looked up first, so an operator-only note never reaches the screen.
 * The take is tagged as coming from the Mass Queue, so the queue keeps its CURRENT selection.
 */
export async function takeQueueItem(item: QueueItem, index: number, opts: PlayOptions = {}): Promise<void> {
  if (item.module === 'notes') {
    const source = noteSource(item.sourceId);
    const note = source ? await bridge.notes.get(source.id) : null;
    // Every note row becomes the CURRENT selection when it is played, as a Praise & Worship lineup row does, so Next walks on past it. A
    // lower-third note goes to the lower third and a private note shows nothing; the slide on screen stays up under either.
    if (note) dispatch({ type: 'queue/cursor', index });
    if (note?.display === 'full') takePrayer(note, 'MASS_QUEUE', 0, source?.slides);
    else if (note) takePrayer(note);
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

/** The slides of a saved reading, read straight from the database, so it works without the deck's editor state. Null when it has no text. */
async function readingFrame(date: string, readingType: string): Promise<Frame | null> {
  const day = await bridge.lectionary.getDay(date);
  const row = day.readings.find((r) => r.readingType === readingType);
  if (!row?.rawText) return null;

  const pages = readingSlides(readingType, row.rawText);
  const title = [day.seasonInfo, readingType, row.citation].map((s) => s.trim()).filter(Boolean).join(' · ');
  // The psalm and the Prayer of the Faithful keep their response pinned above every stanza or intention.
  const key = readingKey(date, readingType);
  return hasResponse(readingType)
    ? { kind: 'psalm', key, title, response: row.congregationResponse, pages, index: 0, style: row.style }
    : {
        kind: 'deck',
        key,
        title,
        // Blank lines stay in as empty reader lines, so paragraph spacing survives.
        slides: pages.map((page) => page.split('\n').map((text) => ({ role: 'reader' as const, text }))),
        index: 0,
        style: row.style,
      };
}

/** Stages a saved reading straight from the database, so it works without the deck's editor state. Resolves true when staged. */
export async function stageReading(date: string, readingType: string): Promise<boolean> {
  const frame = await readingFrame(date, readingType);
  if (!frame) return false;
  dispatch({ type: 'projector/stage', frame });
  return true;
}

/** The slides of a Bible passage row (its source id names the translation, book, chapter and verses), as the projector shows them. */
async function biblePassageFrame(sourceId: string): Promise<{ frame: Frame; title: string } | null> {
  const ref = parseSourceId(sourceId);
  if (!ref) return null;
  const { book, chapter, verses } = await loadPassage(ref.translationId, ref.bookName, ref.chapter, ref.from, ref.to);
  const pageLabel = bibleT(useUi.getState().lang, 'pageLabel');
  const slides = scriptureSlides(verses, { bookName: book.name, chapter }, pageLabel);
  // The passage mark lets the Bible deck badge the verses that are live when it is next opened.
  const passage = { translationId: ref.translationId, bookNumber: book.number, chapter, verses: verses.map((v) => v.verse) };
  const numbers = verses.map((v) => v.verse);
  const range = numbers.length > 1 ? `${numbers[0]}-${numbers[numbers.length - 1]}` : `${numbers[0] ?? ''}`;
  return { frame: { kind: 'deck', title: '', slides, index: 0, passage }, title: `${book.name} ${chapter}${range ? `:${range}` : ''}` };
}

/** Stages a Bible passage row as the slides the projector shows. Resolves true when staged. */
async function stageBiblePassage(sourceId: string): Promise<boolean> {
  const passage = await biblePassageFrame(sourceId);
  if (!passage) return false;
  dispatch({ type: 'projector/stage', frame: passage.frame });
  return true;
}

/** Every slide of a reading or passage frame, in order: what the Quick-Live popup's Back and Next step through. */
function slidesOf(frame: Frame): Frame[] {
  if (frame.kind === 'deck') return frame.slides.map((_, index) => ({ ...frame, index }));
  if (frame.kind === 'psalm') return frame.pages.map((_, index) => ({ ...frame, index }));
  return [frame];
}

/** What a library LIVE press did: shown, nothing to show (an empty song, an unsaved reading), or a private note that is never shown. */
export type LibraryLiveResult = 'shown' | 'empty' | 'operator';

/**
 * LIVE on a planner library row: puts a song, a prayer, a reading or a Bible passage straight on the projector "in case of need", without
 * adding it to the plan or the lineup. It is a direct show (DIRECT_DECK), so the Service Queue's CURRENT row and the Praise & Worship
 * lineup's place are left as they are (the reducer parks the run that had the screen). A song goes out on its first sung verse, through the
 * same shared actions as Song Lyrics' GO LIVE NOW, with its lower third staged (not turned on). A lower-third note goes to the lower third; a
 * private operator note shows nothing. Anything put on the projector opens the Quick-Live Mini Output Preview on every slide of the item.
 */
export async function goLiveLibraryItem(item: { module: string; sourceId: string }): Promise<LibraryLiveResult> {
  const before = useLive.getState().state;
  switch (item.module) {
    case 'lyrics': {
      const hymn = await liveLyrics.getHymn(Number(item.sourceId));
      const actions = hymn && !hymn.deletedAt ? goLiveNowActions({ hymn, band: quickLiveBand(hymn), bandStageOnly: true }) : null;
      if (!hymn || !actions) return 'empty';
      actions.forEach(dispatch);
      // The verses with words, as the song's own stepping walks them: blank ones are skipped.
      const frames = hymn.stanzas.flatMap((s, i) => (s.lyricsText.trim() ? [stanzaFrame(hymn, i)] : [])).filter((f): f is Frame => f !== null);
      openQuickLivePreview(before, { title: hymn.title, frames });
      return 'shown';
    }
    case 'notes': {
      const source = noteSource(item.sourceId);
      const note = source ? await bridge.notes.get(source.id) : null;
      if (!note) return 'empty';
      return goLiveNote(note, source?.slides);
    }
    case 'lectionary': {
      const [date, readingType] = item.sourceId.split('|');
      const frame = await readingFrame(date, readingType);
      if (!frame) return 'empty';
      dispatch({ type: 'projector/stage', frame });
      dispatch({ type: 'projector/take', source: 'DIRECT_DECK' });
      openQuickLivePreview(before, { title: frame.kind === 'deck' || frame.kind === 'psalm' ? frame.title : readingType, frames: slidesOf(frame) });
      return 'shown';
    }
    case 'bible': {
      const passage = await biblePassageFrame(item.sourceId);
      if (!passage) return 'empty';
      dispatch({ type: 'projector/stage', frame: passage.frame });
      dispatch({ type: 'projector/take', source: 'DIRECT_DECK' });
      openQuickLivePreview(before, { title: passage.title, frames: slidesOf(passage.frame) });
      return 'shown';
    }
  }
  return 'empty';
}

/**
 * LIVE on a prayer (the Holy Mass library's Notes & Prayers, the Praise & Worship Library's Prayers): a full-screen prayer goes on the
 * projector as a direct show and opens the Quick-Live popup on its slides. A lower-third note goes to the lower third, with nothing to
 * preview; a private operator note never reaches an output. `slides` keeps only those slides, for a Holy Mass row that plays part of it.
 */
export function goLiveNote(note: Note, slides?: readonly number[] | null): LibraryLiveResult {
  if (note.display === 'operator') return 'operator';
  const before = useLive.getState().state;
  takePrayer(note, 'DIRECT_DECK', 0, slides);
  if (note.display === 'full') openQuickLivePreview(before, { title: note.title, frames: slideFramesOf(note, slides) });
  return 'shown';
}

/**
 * LIVE on a single slide that is not a library record (the Praise & Worship Library's segment title card): a direct show, with the
 * Quick-Live popup on that one slide.
 */
export function goLiveFrame(title: string, frame: Frame): void {
  const before = useLive.getState().state;
  dispatch({ type: 'projector/show', frame, source: 'DIRECT_DECK' });
  openQuickLivePreview(before, { title, frames: [frame] });
}

import type { Frame, QueueItem } from '../../shared/live.js';
import { bridge } from '../live/bridge';
import { dispatch, useLive } from '../live/store';
import { massPartFrame } from '../liturgy/massOrder';
import { pagesOf } from '../announcements/paginate';
import { loadPassage, scriptureSlides } from '../bible/projection';
import { parseSourceId } from '../../shared/bible-ref.js';
import { bibleT } from '../../shared/bible-i18n.js';
import { setUi, useUi } from '../state/ui';
import { stagePrayer, takePrayer } from '../notes/present';

/**
 * Opens a Service Queue entry in the module that owns it and stages it there. Resolves true when it staged a frame
 * that should go live now, so the caller takes it. A song takes its first stanza itself once the hymn has loaded.
 */
export async function openQueueItem(item: QueueItem, index: number): Promise<boolean> {
  // A missing source has nothing to stage, so it cannot be opened.
  if (item.stale) return false;
  dispatch({ type: 'queue/cursor', index });
  switch (item.module) {
    case 'lyrics':
      // The song deck loads the hymn, then takes its first stanza live on the queue's account.
      setUi({ view: 'lyrics', pendingFocus: { kind: 'hymn', id: Number(item.sourceId) } });
      return false;

    case 'announcements':
      // The deck switches to the slide's folder and stages it.
      setUi({ view: 'announcements', pendingFocus: { kind: 'slide', id: Number(item.sourceId) } });
      return false;

    case 'media':
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
export async function takeQueueItem(item: QueueItem, index: number): Promise<void> {
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
  if (await openQueueItem(item, index)) dispatch({ type: 'projector/take', source: 'MASS_QUEUE' });
}

/**
 * Plays the queue item at `index` on the projector: the entry point for the row buttons, the row itself and the steppers.
 * With the projector off, nothing goes live. The operator is asked to turn it on, and that prompt does the take.
 */
export async function playQueueAt(index: number): Promise<void> {
  const { queue, outputs } = useLive.getState().state;
  const item = queue[index];
  if (!item) return;
  if (!outputs.projector) {
    setUi({
      projectorPrompt: {
        label: item.label,
        turnOnAndGo: () => {
          setUi({ projectorPrompt: null });
          dispatch({ type: 'output/set', output: 'projector', on: true });
          void takeQueueItem(item, index).catch((err) => window.alert(err instanceof Error ? err.message : String(err)));
        },
      },
    });
    return;
  }
  await takeQueueItem(item, index);
}

/**
 * Moves the Service Queue position one entry forward (+1) or back (-1), skipping entries whose source is
 * missing, and puts that entry live. Used by Next, Previous and Ctrl+Up / Ctrl+Down.
 */
export async function stepQueue(delta: 1 | -1): Promise<void> {
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
  await playQueueAt(index);
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

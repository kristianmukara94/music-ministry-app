import type { Lang, SlideLine } from '../../shared/live.js';
import type { TextStyle } from '../../shared/text-style';
import { parseSourceId } from '../../shared/bible-ref.js';
import { bibleT } from '../../shared/bible-i18n.js';
import { bridge } from '../live/bridge';
import { pagesOf } from '../announcements/paginate';
import { loadPassage, scriptureSlides } from '../bible/projection';
import { massPartFrame } from '../liturgy/massOrder';
import type { SourceModule } from '../planner/types';

/** The text of each slide of one source, and the style the projector applies to it. */
export interface PreviewSlides {
  pages: string[];
  style: TextStyle | null;
}

const lines = (slide: SlideLine[]) => slide.map((line) => line.text).join('\n');

/**
 * The slides one source would put on the screen, read the same way the planner and the decks read them. This only
 * reads: nothing is staged, shown or sent to the Mass Queue. Returns null for a source with no slides to preview.
 */
export async function previewFor(module: SourceModule, sourceId: string, lang: Lang): Promise<PreviewSlides | null> {
  switch (module) {
    case 'mass_order': {
      const frame = massPartFrame(sourceId, lang);
      if (!frame || frame.kind !== 'deck') return null;
      return { pages: frame.slides.map(lines), style: null };
    }

    case 'lyrics': {
      const hymn = await bridge.lyrics.getHymn(Number(sourceId));
      if (!hymn) return null;
      return { pages: hymn.stanzas.map((stanza) => stanza.lyricsText), style: hymn.style ?? null };
    }

    case 'lectionary': {
      const [date, readingType] = sourceId.split('|');
      const day = await bridge.lectionary.getDay(date);
      const row = day.readings.find((r) => r.readingType === readingType);
      if (!row?.rawText) return null;
      // The psalm's response stays on every page, as it does on the projector.
      const response = row.congregationResponse.trim();
      const pages = pagesOf(row.rawText).map((page) => (readingType === 'Responsorial Psalm' && response ? `${response}\n\n${page}` : page));
      return { pages, style: row.style ?? null };
    }

    case 'bible': {
      const ref = parseSourceId(sourceId);
      if (!ref) return null;
      const { book, chapter, verses } = await loadPassage(ref.translationId, ref.bookName, ref.chapter, ref.from, ref.to);
      const slides = scriptureSlides(verses, { bookName: book.name, chapter }, bibleT(lang, 'pageLabel'));
      return { pages: slides.map(lines), style: null };
    }

    case 'notes': {
      const note = await bridge.notes.get(Number(sourceId));
      if (!note) return null;
      return { pages: [note.body], style: note.style ?? null };
    }

    default:
      return null;
  }
}

import { paginateSection, pagesOf, withFitter } from '../announcements/paginate';
import { hasResponse, responsePagesOf } from '../../shared/daily-readings.js';

/** Psalm verses and intentions sit below the pinned response, so they get less of the slide's height. Auto-paginate measures them the same way. */
export const RESPONSE_HEIGHT_SHARE = 0.6;

/**
 * The slides a saved reading is shown as. A psalm or a Prayer of the Faithful has one slide per stanza or intention, and one too tall for the
 * screen is split again with the projector's own fit test, so no line is cut off. Other readings break at their --- lines, as they always have.
 */
export function readingPagesOf(readingType: string, rawText: string): string[] {
  if (!hasResponse(readingType)) return pagesOf(rawText);
  const pages = responsePagesOf(rawText);
  if (pages.length === 0) return [];
  // Readings and psalms are set in serif on the projector, so they are measured in serif too.
  return withFitter((fits) => pages.flatMap((page) => paginateSection(page, fits)), RESPONSE_HEIGHT_SHARE, 'serif');
}

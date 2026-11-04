// The day's own texts in a Holy Mass plan. The Responsorial Psalm (slot 4) and the Prayer of the Faithful (slot 6) change with the date, so
// a plan takes them from the Lectionary for its liturgical date; the other 15 slots stay as the operator or a template filled them. Pure data
// and rules, so they can be tested.
//
// The texts themselves are never shipped: the operator pastes the day's psalm and intentions into the Lectionary, and a plan points at them
// as `YYYY-MM-DD|Reading Type`, like any other reading.
import { indexOfSlot, placeInSlot } from './mass-slots.js';

export const PSALM = 'Responsorial Psalm';
export const PRAYER_OF_THE_FAITHFUL = 'Prayer of the Faithful';

/** The readings that carry a congregation response, pinned above every slide: the psalm's refrain, and the prayers' "Lord, hear our prayer". */
export const RESPONSE_READINGS = [PSALM, PRAYER_OF_THE_FAITHFUL];
export const hasResponse = (readingType) => RESPONSE_READINGS.includes(readingType);

/** The Holy Mass slots filled from the day's readings, and the Lectionary reading each takes. */
export const DAILY_READING_SLOTS = [
  { slot: 'psalm', readingType: PSALM },
  { slot: 'prayer-faithful', readingType: PRAYER_OF_THE_FAITHFUL },
];

/** A plan item for one of the day's readings. */
export const readingItem = (date, readingType) => ({ module: 'lectionary', sourceId: `${date}|${readingType}`, label: readingType });

const readingTypeOf = (item) => (item?.module === 'lectionary' ? String(item.sourceId).split('|')[1] : null);

/**
 * The plan's items with the day's psalm and prayers in their slots. `day` is the Lectionary's day for `date` (see getDay): a reading with no
 * text is not saved, and its slot is left as it is.
 *
 * By default only a slot with nothing usable in it takes the day's reading: an empty slot, an item whose source is gone (stale), or the same
 * reading from another date (a plan copied from last week). Anything else the operator chose, a sung psalm or a prayer from Notes & Prayers,
 * is kept. `replace` puts the day's reading in every slot that has one saved: the planner's Auto-fill button.
 *
 * Returns the items, and the slot ids by outcome: `filled` now hold the day's reading, `current` already did, `kept` hold the operator's own
 * choice, and `missing` have no reading saved for the date.
 */
export function withDailyReadings(items, date, day, { replace = false } = {}) {
  const outcome = { items, filled: [], current: [], kept: [], missing: [] };
  for (const { slot, readingType } of DAILY_READING_SLOTS) {
    const at = indexOfSlot(outcome.items, slot);
    const existing = at >= 0 ? outcome.items[at] : null;
    const wanted = readingItem(date, readingType);
    const saved = Boolean(day?.readings?.some((r) => r.readingType === readingType && String(r.rawText ?? '').trim()));
    if (!saved) outcome.missing.push(slot);
    else if (existing && !existing.stale && existing.module === wanted.module && existing.sourceId === wanted.sourceId) outcome.current.push(slot);
    else if (existing && !existing.stale && !replace && readingTypeOf(existing) !== readingType) outcome.kept.push(slot);
    else {
      outcome.items = placeInSlot(outcome.items, slot, wanted);
      outcome.filled.push(slot);
    }
  }
  return outcome;
}

/**
 * The slides of a reading with a response: one for each psalm stanza or each intention. A line of --- or a blank line starts a new slide.
 * A slide that is still too tall for the screen is split again where it is staged, by the projector's own fit test.
 */
export function responsePagesOf(rawText) {
  return String(rawText ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/^[ \t]*---[ \t]*$/m)
    .flatMap((page) => page.split(/\n[ \t]*\n/))
    .map((page) => page.trim())
    .filter(Boolean);
}

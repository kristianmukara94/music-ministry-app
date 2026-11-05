// The day's own texts in a Holy Mass plan. The readings (First Reading, Responsorial Psalm, Second Reading, Gospel) and the Prayer of the
// Faithful change with the date, so a plan takes them from the Lectionary for its liturgical date into their slots; the other slots stay as
// the operator or a template filled them. Pure data and rules, so they can be tested.
//
// The texts themselves are never shipped: the operator pastes the day's psalm and intentions into the Lectionary, and a plan points at them
// as `YYYY-MM-DD|Reading Type`, like any other reading.
import { clearSlot, indexOfSlot, isSlotId, moveToSlot, placeInSlot } from './mass-slots.js';

export const PSALM = 'Responsorial Psalm';
export const PRAYER_OF_THE_FAITHFUL = 'Prayer of the Faithful';
export const FIRST_READING = 'First Reading';
export const SECOND_READING = 'Second Reading';
export const GOSPEL = 'Gospel';

/** The readings that carry a congregation response, pinned above every slide: the psalm's refrain, and the prayers' "Lord, hear our prayer". */
export const RESPONSE_READINGS = [PSALM, PRAYER_OF_THE_FAITHFUL];
export const hasResponse = (readingType) => RESPONSE_READINGS.includes(readingType);

/** The Holy Mass slots filled from the day's readings, and the Lectionary reading each takes. */
export const DAILY_READING_SLOTS = [
  { slot: 'psalm', readingType: PSALM },
  { slot: 'prayer-faithful', readingType: PRAYER_OF_THE_FAITHFUL },
];

/** The spoken readings of the Liturgy of the Word, and the slot each is read in. */
export const WORD_READINGS = [
  { slot: 'first-reading', readingType: FIRST_READING },
  { slot: 'second-reading', readingType: SECOND_READING },
  { slot: 'gospel', readingType: GOSPEL },
];
const WORD_READING_TYPES = WORD_READINGS.map((r) => r.readingType);

/** Every slot the Lectionary fills, in Mass order: First Reading, psalm, Second Reading, Gospel, prayers. */
export const READING_SLOTS = [WORD_READINGS[0], DAILY_READING_SLOTS[0], WORD_READINGS[1], WORD_READINGS[2], DAILY_READING_SLOTS[1]];

/** The slot a Lectionary reading type is placed in, or null for one with no slot (the Gospel Acclamation). */
export const readingSlotOf = (readingType) => READING_SLOTS.find((r) => r.readingType === readingType)?.slot ?? null;

/** A plan item for one of the day's readings. */
export const readingItem = (date, readingType) => ({ module: 'lectionary', sourceId: `${date}|${readingType}`, label: readingType });

const readingTypeOf = (item) => (item?.module === 'lectionary' ? String(item.sourceId).split('|')[1] : null);

/**
 * Whether a plan row is one of the day's readings outside its slot: an additional item (no slot, or one this version does not know) in any
 * section. A plan from before the readings had slots, a reading dropped among a section's additional items, or one sent by the website
 * without a slot.
 */
const isLooseReading = (item) => !isSlotId(item.slot) && readingSlotOf(readingTypeOf(item)) !== null;

/**
 * The plan's items with each reading outside its slot (see isLooseReading) moved into its slot, when that slot is empty. Returns the items
 * and the slots that took one.
 */
export function intoReadingSlots(items) {
  let next = items;
  const moved = [];
  for (const { slot, readingType } of READING_SLOTS) {
    if (indexOfSlot(next, slot) >= 0) continue;
    const at = next.findIndex((item) => isLooseReading(item) && readingTypeOf(item) === readingType);
    if (at < 0) continue;
    next = moveToSlot(next, at, slot);
    moved.push(slot);
  }
  return { items: next, moved };
}

/**
 * The plan's items with the day's readings in their slots: by default the psalm and the prayers (`slots`: which ones). `day` is the
 * Lectionary's day for `date` (see getDay): a reading with no text is not saved, and its slot is left as it is. A spoken reading saved before
 * the readings had slots is first moved into its slot (see intoReadingSlots).
 *
 * By default only a slot with nothing usable in it takes the day's reading: an empty slot, an item whose source is gone (stale), or the same
 * reading from another date (a plan copied from last week). Anything else the operator chose, a sung psalm or a prayer from Notes & Prayers,
 * is kept. `replace` puts the day's reading in every slot that has one saved: the planner's Auto-fill button.
 *
 * Returns the items, and the slot ids by outcome: `filled` now hold the day's reading, `current` already did, `kept` hold the operator's own
 * choice, and `missing` have no reading saved for the date. `moved` took a reading saved before the readings had slots.
 */
export function withDailyReadings(items, date, day, { replace = false, slots = DAILY_READING_SLOTS } = {}) {
  const loose = intoReadingSlots(items);
  const outcome = { items: loose.items, filled: [], current: [], kept: [], missing: [], moved: loose.moved };
  for (const { slot, readingType } of slots) {
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

/**
 * The plan's items with one spoken reading (First Reading, Second Reading or Gospel) for `date` in its slot, replacing what was there. A
 * reading saved before the readings had slots is moved in first, so last week's Gospel never plays beside this week's. Any other reading type
 * returns the items as they were.
 */
export function withWordReading(items, date, readingType) {
  if (!WORD_READING_TYPES.includes(readingType)) return items;
  return placeInSlot(intoReadingSlots(items).items, readingSlotOf(readingType), readingItem(date, readingType));
}

/**
 * ⚡ Apply All Readings: the plan's items with every reading saved for `date` in the Lectionary, each in its slot (see withDailyReadings, which
 * `replace` is passed to). A spoken reading with no text saved for the date is taken out of its slot, so a weekday plan copied from a Sunday
 * loses its old Second Reading; the operator's own item in the slot stays. Any reading still outside its slot (see isLooseReading), in any
 * section, is taken out too, so no reading is left among the additional items. The Gospel Acclamation is left out: Holy Mass plans do not take it (it is for Praise & Worship).
 *
 * Returns the items, the reading types now in the plan (`placed`), the ones with no text saved (`missing`), and the slot outcome
 * (`slots`, as withDailyReadings returns it).
 */
export function withAllReadings(items, date, day, { replace = true } = {}) {
  const slots = withDailyReadings(items, date, day, { replace, slots: READING_SLOTS });
  let next = slots.items.filter((item) => !isLooseReading(item));
  for (const { slot } of WORD_READINGS) {
    const at = indexOfSlot(next, slot);
    if (slots.missing.includes(slot) && at >= 0 && WORD_READING_TYPES.includes(readingTypeOf(next[at]))) next = clearSlot(next, slot);
  }
  const placed = [];
  const missing = [];
  for (const { slot, readingType } of [...WORD_READINGS, ...DAILY_READING_SLOTS]) {
    if (slots.missing.includes(slot)) missing.push(readingType);
    else if (!slots.kept.includes(slot)) placed.push(readingType);
  }
  return { items: next, placed, missing, slots };
}

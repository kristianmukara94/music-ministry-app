// The day's Lectionary readings in a Holy Mass plan, as the church laptop's Planner fills them (shared/daily-readings.js): First Reading, Responsorial
// Psalm, Second Reading (Sundays and solemnities only: a day the Ordo gives no Second Reading has none) and Gospel, each in its slot of the Liturgy of
// the Word.
//
// What the website stores is the reading's NAME only ("First Reading"), as a reading item with the slot's number. That is exactly the item the laptop
// sends back, and the laptop turns it into the Lectionary reading for the plan's date (electron/plan-sync-store.js massRowFrom), showing the text it
// has saved or drafts from its own offline Bible. The reference ("Sample Book 1:1-5") is looked up from the date for display only and is never stored:
// no reading text, prayer or Bible passage is on the website. Pure, so the tests run it without a browser.
import { ORDO_CITATIONS } from './ordo-citations.js';
import { ORDO_NAMES } from './ordo-names.js';
import { ordoDayOf } from './liturgical-day.js';
import { MASS_PLAN } from './sample-data.js';
import { READING_NAMES, massRows, massToItems, slotEntries, withEntry, withEntryMoved, withoutEntry } from './plan-model.js';

/** The Ordo the web reads: names and citations, joined by day code. */
const ORDO = {
  days: Object.fromEntries(
    [...new Set([...Object.keys(ORDO_NAMES), ...Object.keys(ORDO_CITATIONS)])].map((code) => [code, { ...(ORDO_NAMES[code] ? { name: ORDO_NAMES[code] } : {}), ...ORDO_CITATIONS[code] }]),
  ),
};

/** The slot number (mass-slots.js) each reading fills. The numbers are the contract with the laptop; the positions 6, 7, 8 and 10 on screen are not. */
export const READING_SLOT_NUMBER = Object.freeze({ 'First Reading': 20, 'Responsorial Psalm': 4, 'Second Reading': 21, Gospel: 22 });

const ROWS = massRows(MASS_PLAN);
const rowOfSlot = (number) => ROWS.find((row) => row.slot === number);

/** The row id ("s20") a reading goes in. */
export const readingRowId = (type) => rowOfSlot(READING_SLOT_NUMBER[type])?.id ?? null;

/**
 * The readings of a date, in Mass order: { type, slot, rowId, citation }. `day` names the liturgical day and its cycles. A day the Ordo has no entry
 * for, or a bad date, has no readings.
 */
export function dayReadingsFor(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) return { day: { name: '', code: '', sundayCycle: '', weekdayCycle: '' }, readings: [] };
  const day = ordoDayOf(ORDO, date);
  const readings = READING_NAMES.filter((type) => day.citations[type]).map((type) => ({ type, slot: READING_SLOT_NUMBER[type], rowId: readingRowId(type), citation: day.citations[type] }));
  return { day: { name: day.name, code: day.code, sundayCycle: day.sundayCycle, weekdayCycle: day.weekdayCycle }, readings };
}

/** The entry a reading is stored as: its name, marked as scripture. */
export const readingEntry = (type) => ({ text: type, contentType: 'scripture' });

/** Whether an entry is any scripture reading (the day's by name, or a typed reference from another date). */
export const isScriptureEntry = (entry) => entry?.contentType === 'scripture';

/** The text a reading from another date is kept as: its name and reference, as words the laptop keeps (it has no reading of that name for this date). */
export const referenceText = (type, citation) => `${type}: ${citation}`.slice(0, 500);

/**
 * Puts one reading in its slot, in front, replacing a reading already there and leaving anything else the slot holds (a sung psalm, a cue) after it.
 * `date` is the date the reading is for and `planDate` the plan's: a reading of the plan's own date is stored by name, one of another date as a typed
 * reference, because the laptop finds a reading by the plan's date. Returns the new segments.
 */
export function withReading(segments, reading, date, planDate) {
  const id = reading.rowId;
  if (!id) return segments;
  let next = segments;
  const entries = slotEntries(next[id]);
  for (let at = entries.length - 1; at >= 0; at -= 1) if (isScriptureEntry(entries[at])) next = withoutEntry(next, id, at);
  const entry = date === planDate ? readingEntry(reading.type) : { text: referenceText(reading.type, reading.citation), contentType: 'scripture' };
  next = withEntry(next, id, entry);
  return withEntryMoved(next, id, slotEntries(next[id]).length - 1, 0);
}

/**
 * The plan's segments with the day's readings in their empty slots, as the laptop's Auto-fill does: a slot that holds anything is left alone.
 * Returns { segments, filled, kept, missing }: the row ids filled, the rows left as they were, and the readings the Ordo has none for.
 */
export function withDayReadings(segments, date, { replace = false } = {}) {
  const { readings } = dayReadingsFor(date);
  const outcome = { segments, filled: [], kept: [], current: [], missing: READING_NAMES.filter((type) => !readings.some((r) => r.type === type)) };
  for (const reading of readings) {
    const entries = slotEntries(outcome.segments[reading.rowId]);
    if (entries.some((e) => e.text === reading.type && e.contentType === 'scripture')) outcome.current.push(reading.rowId);
    else if (entries.length > 0 && !replace) outcome.kept.push(reading.rowId);
    else {
      outcome.segments = withReading(outcome.segments, reading, date, date);
      outcome.filled.push(reading.rowId);
    }
  }
  return outcome;
}

/** The items a new Holy Mass plan starts with: the day's readings, each in its slot, as the server takes them. */
export function dayReadingItems(date) {
  const { segments } = withDayReadings({}, date);
  return massToItems({ segments, notes: {}, extra: [], contentHubItems: [] }, ROWS);
}

/** Which of the day's readings the segments hold by name, and which are empty (the banner offers Populate when any is). */
export function readingStatus(segments, date) {
  const { readings } = dayReadingsFor(date);
  const held = readings.filter((r) => slotEntries(segments[r.rowId]).some((e) => e.text === r.type && e.contentType === 'scripture'));
  return { total: readings.length, held: held.length, empty: readings.filter((r) => slotEntries(segments[r.rowId]).length === 0).length };
}

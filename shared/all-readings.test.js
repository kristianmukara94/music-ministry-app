// ⚡ Apply All Readings: every reading saved for a date goes into a Holy Mass plan in Mass order, each reading in its own slot.
// Run with: node --test shared/all-readings.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intoReadingSlots, readingItem, readingSlotOf, withAllReadings, withDailyReadings, withWordReading } from './daily-readings.js';
import { indexOfSlot, placeInSlot } from './mass-slots.js';

const DATE = '2026-11-08';
const dayWith = (...types) => ({ date: DATE, seasonInfo: '', readings: types.map((readingType) => ({ readingType, rawText: 'Text.' })) });
const SUNDAY = dayWith('First Reading', 'Responsorial Psalm', 'Second Reading', 'Gospel Acclamation', 'Gospel', 'Prayer of the Faithful');
const hymn = (id) => ({ module: 'lyrics', sourceId: String(id), label: `Hymn ${id}` });
const reading = (date, type) => ({ ...readingItem(date, type), block: 'word', slot: null });
// What the queue plays in the Liturgy of the Word, as reading types or slot ids. A spoken reading is named by its type, in its slot or not.
const SPOKEN = { 'first-reading': 'First Reading', 'second-reading': 'Second Reading', gospel: 'Gospel' };
const wordOrder = (items) => items.filter((it) => it.block === 'word').map((it) => SPOKEN[it.slot] ?? it.slot ?? it.sourceId.split('|').at(-1));

test('an empty plan takes every reading in Mass order, and the acclamation is left out', () => {
  const out = withAllReadings([], DATE, SUNDAY);
  assert.deepEqual(wordOrder(out.items), ['First Reading', 'psalm', 'Second Reading', 'Gospel', 'prayer-faithful']);
  assert.deepEqual(out.placed.sort(), ['First Reading', 'Gospel', 'Prayer of the Faithful', 'Responsorial Psalm', 'Second Reading']);
  assert.deepEqual(out.missing, []);
  assert.ok(out.items.every((it) => !it.sourceId.endsWith('|Gospel Acclamation')));
});

test('the readings go around a sung acclamation in slot 5 and the other sections stay as they were', () => {
  let items = placeInSlot([], 'entrance', hymn(1));
  items = placeInSlot(items, 'gospel-acclamation', hymn(2));
  items = placeInSlot(items, 'offertory', hymn(3));
  const out = withAllReadings(items, DATE, SUNDAY);
  assert.deepEqual(wordOrder(out.items), ['First Reading', 'psalm', 'Second Reading', 'gospel-acclamation', 'Gospel', 'prayer-faithful']);
  assert.equal(out.items[0].slot, 'entrance');
  assert.equal(out.items.at(-1).slot, 'offertory');
});

test("last week's readings are replaced, and a weekday with no Second Reading drops the old one", () => {
  const old = '2026-11-01';
  const items = [reading(old, 'First Reading'), reading(old, 'Second Reading'), reading(old, 'Gospel')];
  const out = withAllReadings(items, DATE, dayWith('First Reading', 'Gospel'));
  assert.deepEqual(wordOrder(out.items), ['First Reading', 'Gospel']);
  assert.ok(out.items.every((it) => it.sourceId.startsWith(DATE)));
  assert.deepEqual(out.missing, ['Second Reading', 'Responsorial Psalm', 'Prayer of the Faithful']);
});

test("the operator's sung psalm stays in slot 4 unless replace is asked for", () => {
  const items = placeInSlot([], 'psalm', hymn(9));
  const kept = withAllReadings(items, DATE, SUNDAY, { replace: false });
  assert.equal(kept.items[indexOfSlot(kept.items, 'psalm')].module, 'lyrics');
  assert.ok(!kept.placed.includes('Responsorial Psalm'));
  const replaced = withAllReadings(items, DATE, SUNDAY);
  assert.equal(replaced.items[indexOfSlot(replaced.items, 'psalm')].sourceId, `${DATE}|Responsorial Psalm`);
});

test('applying twice changes nothing the second time', () => {
  const once = withAllReadings([], DATE, SUNDAY).items;
  assert.deepEqual(withAllReadings(once, DATE, SUNDAY).items, once);
});

test('one reading added on its own lands in its place, ahead of a note in the same section', () => {
  const note = { module: 'custom', sourceId: 'Note', label: 'Note', block: 'word', slot: null };
  const items = [...withAllReadings([], DATE, dayWith('Responsorial Psalm', 'Prayer of the Faithful')).items, note];
  const out = withWordReading(items, DATE, 'Gospel');
  assert.deepEqual(wordOrder(out), ['psalm', 'Gospel', 'prayer-faithful', 'Note']);
  // A response reading is not a spoken one: it belongs in its slot, so nothing changes.
  assert.equal(withWordReading(items, DATE, 'Responsorial Psalm'), items);
});

test('a plan saved before the readings had slots has them moved into their slots, once, and nothing is doubled', () => {
  const old = [reading(DATE, 'First Reading'), { ...placeInSlot([], 'psalm', hymn(4))[0] }, reading(DATE, 'Gospel')];
  const { items, moved } = intoReadingSlots(old);
  assert.deepEqual(moved, ['first-reading', 'gospel']);
  assert.deepEqual(items.map((it) => it.slot), ['first-reading', 'psalm', 'gospel']);
  assert.equal(intoReadingSlots(items).moved.length, 0, 'a second pass moves nothing');
  // Opening the plan (withDailyReadings) does the same, so the planner saves the moved plan.
  assert.deepEqual(withDailyReadings(old, DATE, null).moved, ['first-reading', 'gospel']);
  // A reading whose slot is already filled stays where it is, as an additional item, until Apply All Readings tidies it away.
  const twice = [...items, reading('2026-11-01', 'Gospel')];
  assert.equal(intoReadingSlots(twice).items.at(-1).slot, null);
  assert.equal(withAllReadings(twice, DATE, SUNDAY).items.filter((it) => it.sourceId.endsWith('|Gospel')).length, 1);
});

test("the operator's own text in a reading slot is kept unless replace is asked for, and a missing reading never clears it", () => {
  const own = placeInSlot([], 'second-reading', { module: 'custom', sourceId: 'Our own', label: 'Our own' });
  assert.equal(withAllReadings(own, DATE, SUNDAY, { replace: false }).items.find((it) => it.slot === 'second-reading').module, 'custom');
  assert.equal(withAllReadings(own, DATE, SUNDAY).items.find((it) => it.slot === 'second-reading').module, 'lectionary');
  assert.equal(withAllReadings(own, DATE, dayWith('Gospel')).items.find((it) => it.slot === 'second-reading').module, 'custom');
  assert.equal(readingSlotOf('Gospel'), 'gospel');
  assert.equal(readingSlotOf('Gospel Acclamation'), null);
});

test('auto-fill leaves no reading among the additional items: a stray psalm, prayer or reading in any section goes into its slot or out', () => {
  const stray = (date, type, block) => ({ ...readingItem(date, type), block, slot: null });
  const items = [
    stray(DATE, 'Gospel', 'introductory'),
    stray(DATE, 'Responsorial Psalm', 'word'),
    stray('2026-11-01', 'Prayer of the Faithful', 'word'),
    stray('2026-11-01', 'First Reading', 'concluding'),
    { module: 'custom', sourceId: 'Note', label: 'Note', block: 'word', slot: null },
  ];
  const out = withAllReadings(items, DATE, SUNDAY);
  assert.deepEqual(wordOrder(out.items), ['First Reading', 'psalm', 'Second Reading', 'Gospel', 'prayer-faithful', 'Note']);
  assert.ok(out.items.filter((it) => it.module === 'lectionary').every((it) => it.slot && it.sourceId.startsWith(DATE)));
  // Opening the plan moves a stray psalm into its empty slot as well.
  assert.deepEqual(intoReadingSlots([stray(DATE, 'Responsorial Psalm', 'word')]).moved, ['psalm']);
});

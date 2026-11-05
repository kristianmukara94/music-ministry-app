// The day's psalm and prayers in a Holy Mass plan: slots 4 and 6 come from the Lectionary for the plan's date, and they are shown a stanza or
// an intention to a slide. Run with: node --test shared/daily-readings.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DAILY_READING_SLOTS, hasResponse, readingItem, responsePagesOf, withDailyReadings } from './daily-readings.js';
import { indexOfSlot, MASS_SLOTS, placeInSlot } from './mass-slots.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const DATE = '2026-11-08';
const dayWith = (...types) => ({ date: DATE, seasonInfo: '', readings: types.map((readingType) => ({ readingType, rawText: 'Text.' })) });
const BOTH = dayWith('First Reading', 'Responsorial Psalm', 'Gospel', 'Prayer of the Faithful');
const hymn = (id) => ({ module: 'lyrics', sourceId: String(id), label: `Hymn ${id}` });
const inSlot = (items, slot) => items[indexOfSlot(items, slot)] ?? null;

test('slots 4 and 6 are the ones filled from the Lectionary, the psalm and the Prayer of the Faithful', () => {
  assert.deepEqual(
    DAILY_READING_SLOTS.map((d) => [MASS_SLOTS.find((s) => s.id === d.slot).number, d.readingType]),
    [[4, 'Responsorial Psalm'], [6, 'Prayer of the Faithful']],
  );
  assert.equal(hasResponse('Responsorial Psalm'), true);
  assert.equal(hasResponse('Prayer of the Faithful'), true);
  assert.equal(hasResponse('Gospel'), false);
});

test("an empty plan takes the day's psalm and prayers, and its other 15 slots stay empty", () => {
  const out = withDailyReadings([], DATE, BOTH);
  assert.deepEqual(out.filled, ['psalm', 'prayer-faithful']);
  assert.equal(out.items.length, 2);
  assert.deepEqual(inSlot(out.items, 'psalm'), { ...readingItem(DATE, 'Responsorial Psalm'), block: 'word', slot: 'psalm' });
  assert.deepEqual(inSlot(out.items, 'prayer-faithful'), { ...readingItem(DATE, 'Prayer of the Faithful'), block: 'word', slot: 'prayer-faithful' });
});

test('the other slots of a filled plan are never touched', () => {
  let items = placeInSlot([], 'entrance', hymn(1));
  items = placeInSlot(items, 'gospel-acclamation', hymn(2));
  items = placeInSlot(items, 'recessional', hymn(3));
  const out = withDailyReadings(items, DATE, BOTH);
  assert.deepEqual(out.items.filter((it) => it.module === 'lyrics'), items);
  // The psalm goes ahead of the Gospel Acclamation and the prayers after it, in slot order.
  assert.deepEqual(out.items.filter((it) => it.block === 'word').map((it) => it.slot), ['psalm', 'gospel-acclamation', 'prayer-faithful']);
});

test("the operator's own choice is kept, unless the reading is asked for with replace", () => {
  let items = placeInSlot([], 'psalm', hymn(7));
  items = placeInSlot(items, 'prayer-faithful', { module: 'notes', sourceId: '3', label: 'Parish intentions' });
  const kept = withDailyReadings(items, DATE, BOTH);
  assert.deepEqual(kept.kept, ['psalm', 'prayer-faithful']);
  assert.equal(kept.items, items, 'nothing changes');
  const replaced = withDailyReadings(items, DATE, BOTH, { replace: true });
  assert.deepEqual(replaced.filled, ['psalm', 'prayer-faithful']);
  assert.equal(inSlot(replaced.items, 'psalm').sourceId, `${DATE}|Responsorial Psalm`);
  assert.equal(replaced.items.length, 2, 'the old items are replaced, not added to');
});

test("a slot already holding the day's reading is left alone; a stale item or another date's reading is replaced", () => {
  let items = placeInSlot([], 'psalm', readingItem(DATE, 'Responsorial Psalm'));
  items = placeInSlot(items, 'prayer-faithful', readingItem('2026-11-01', 'Prayer of the Faithful'));
  const out = withDailyReadings(items, DATE, BOTH);
  assert.deepEqual(out.current, ['psalm']);
  assert.deepEqual(out.filled, ['prayer-faithful']);
  assert.equal(inSlot(out.items, 'prayer-faithful').sourceId, `${DATE}|Prayer of the Faithful`);

  const stale = placeInSlot([], 'psalm', { ...hymn(9), stale: true });
  assert.deepEqual(withDailyReadings(stale, DATE, BOTH).filled, ['psalm', 'prayer-faithful']);
});

test('a reading not saved for the date leaves its slot as it is, and is reported missing', () => {
  const items = placeInSlot([], 'prayer-faithful', { module: 'custom', sourceId: 'Lord, hear our prayer', label: 'Lord, hear our prayer' });
  const out = withDailyReadings(items, DATE, dayWith('Responsorial Psalm'), { replace: true });
  assert.deepEqual(out.filled, ['psalm']);
  assert.deepEqual(out.missing, ['prayer-faithful']);
  assert.equal(inSlot(out.items, 'prayer-faithful').module, 'custom');
  // A reading with only blank text is not saved.
  const blank = { readings: [{ readingType: 'Responsorial Psalm', rawText: '  \n ' }] };
  assert.deepEqual(withDailyReadings([], DATE, blank).missing, ['psalm', 'prayer-faithful']);
  assert.deepEqual(withDailyReadings([], DATE, null).items, []);
});

test('psalm stanzas and intentions are a slide each: a blank line or a --- line starts the next', () => {
  const psalm = 'R. Stanza one, line one.\nLine two.\n\nStanza two.\r\n\r\nStanza three.\n---\nStanza four.';
  assert.deepEqual(responsePagesOf(psalm), ['R. Stanza one, line one.\nLine two.', 'Stanza two.', 'Stanza three.', 'Stanza four.']);
  assert.deepEqual(responsePagesOf('  \n\n---\n  '), []);
  assert.deepEqual(responsePagesOf(null), []);
  // Every word is kept, in order.
  const intentions = ['For the Church.', 'For the world.', 'For the sick.', 'For the departed.'].join('\n   \n');
  assert.equal(responsePagesOf(intentions).length, 4);
  assert.equal(responsePagesOf(intentions).join(' '), intentions.replace(/\s+/g, ' '));
});

test('the planner auto-fills on opening a plan and from its button, and Go Live loads plans with the day\'s readings', () => {
  const api = read('src/planner/plan-api.ts');
  assert.match(api, /export async function autoPopulateDailyReadings\(items: PlanItem\[\], planDate: string/);
  assert.match(api, /export async function loadPlanToQueue\(planId: number\): Promise<void> \{\s+const \{ items \} = await fillDailyReadings\(planId\);/);
  const planner = read('src/planner/MassPlanner.tsx');
  assert.match(planner, /return fillDailyReadings\(planId\)\.then/, 'a plan opened or created fills its empty slots');
  assert.match(planner, /onClick=\{\(\) => void autoFill\(\)\}/);
  assert.match(planner, /<Zap size=\{14\} aria-hidden \/> \{t\('autoFill'\)\}/);
});

test('a reading played in place stays in the Go Live console, and the psalm and prayers keep their response pinned', () => {
  const routing = read('src/planner/routing.ts');
  assert.match(routing, /if \(!opts\.inPlace\) setUi\(\{ view: 'lectionary'/);
  assert.match(routing, /const pages = readingSlides\(readingType, row\.rawText\);/);
  assert.match(routing, /hasResponse\(readingType\)\s+\? \{ kind: 'psalm'/);
});

// The day's readings the website puts in a Holy Mass plan (web/js/day-readings.js) against the laptop's sync rules: each web reading item must become the
// Lectionary reading of the plan's date on the laptop (found and shown from its own Lectionary), and the laptop must send it back as the same item, so
// a pull and a push neither lose nor duplicate a reading. Synthetic dates and names only.
// Run with: node --test electron/web-readings-sync.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { massRowFrom } from './plan-sync-store.js';
import { massEntries, READING_TYPES } from './plan-sync-map.js';
import { MASS_SLOTS, slotIdOfNumber } from '../shared/mass-slots.js';
import { READING_SLOTS } from '../shared/daily-readings.js';
import { ordoDayOf } from '../shared/liturgical-day.js';
import { readFileSync } from 'node:fs';
import { dayReadingItems, dayReadingsFor, READING_SLOT_NUMBER } from '../web/js/day-readings.js';
import { READING_NAMES } from '../web/js/plan-model.js';

const ORDO = JSON.parse(readFileSync(new URL('../src/data/lectionary_ordo.json', import.meta.url), 'utf8'));
const SUNDAY = '2026-11-08';
const WEEKDAY = '2026-11-10';
const noSong = () => null;

test('the website names its readings as the laptop does, and numbers their slots as the laptop does', () => {
  assert.deepEqual([...READING_NAMES], READING_TYPES);
  for (const { slot, readingType } of READING_SLOTS) {
    if (readingType in READING_SLOT_NUMBER) assert.equal(slotIdOfNumber(READING_SLOT_NUMBER[readingType]), slot, readingType);
  }
  // The Prayer of the Faithful is the parish's own text and stays on the laptop: the website never sends it as a reading.
  assert.ok(!Object.keys(READING_SLOT_NUMBER).includes('Prayer of the Faithful'));
});

test('each reading the website makes is the Lectionary reading of the plan\'s date on the laptop', () => {
  for (const date of [SUNDAY, WEEKDAY]) {
    for (const item of dayReadingItems(date)) {
      assert.deepEqual(massRowFrom(item, date, noSong), { block: 'word', module: 'lectionary', sourceId: `${date}|${item.text}`, label: item.text });
    }
  }
});

test('the laptop sends a reading back as the same item: same name and slot, one per slot', () => {
  const items = dayReadingItems(SUNDAY);
  const rows = items.map((item, order) => ({ ...massRowFrom(item, SUNDAY, noSong), order, slot: slotIdOfNumber(item.slot) }));
  const sent = massEntries(rows, noSong).filter((e) => e.item).map((e) => e.item);
  assert.deepEqual(sent.map((i) => [i.kind, i.group, i.text, i.slot]), items.map((i) => [i.kind, i.group, i.text, i.slot]));
  assert.equal(new Set(sent.map((i) => i.slot)).size, sent.length);
});

test('the references the website shows are the ones the laptop\'s own Ordo gives for the date', () => {
  for (const date of [SUNDAY, WEEKDAY, '2026-12-08']) {
    const laptop = ordoDayOf(ORDO, date).citations;
    for (const { type, citation, slot } of dayReadingsFor(date).readings) {
      assert.equal(citation, laptop[type], `${date} ${type}`);
      assert.ok(MASS_SLOTS.some((s) => s.number === slot));
    }
  }
});

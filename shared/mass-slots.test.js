// The Holy Mass order of 17 slots: the slots, how an item is placed in one, and how the planner is wired to them.
// Run with: node --test shared/mass-slots.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BUILT_IN_TEMPLATES,
  MASS_SECTIONS,
  MASS_SLOTS,
  SLOT_IDS,
  additionalIn,
  clearSlot,
  filledIn,
  indexOfSlot,
  isSlotId,
  moveToSlot,
  placeInSlot,
  slotsOfBlock,
} from './mass-slots.js';
import { MASS_FLOW } from './mass-flow.js';
import { plannerT } from './planner-i18n.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const hymn = (id, extra = {}) => ({ module: 'lyrics', sourceId: String(id), label: `Hymn ${id}`, ...extra });

// ---- The slots ----

test('there are 17 numbered slots in five sections of 3, 3, 9, 1 and 1', () => {
  assert.equal(MASS_SLOTS.length, 17);
  assert.deepEqual(MASS_SLOTS.map((s) => s.number), Array.from({ length: 17 }, (_, i) => i + 1));
  assert.deepEqual(MASS_SECTIONS.map((s) => [s.block, slotsOfBlock(s.block).length]), [
    ['introductory', 3],
    ['word', 3],
    ['eucharist', 9],
    ['communion', 1],
    ['concluding', 1],
  ]);
  assert.equal(new Set(SLOT_IDS).size, 17, 'slot ids are unique');
});

test('the slots have the names and numbers of the Holy Mass order', () => {
  const names = Object.fromEntries(MASS_SLOTS.map((s) => [s.number, s.name]));
  assert.deepEqual(names, {
    1: 'Entrance Hymn',
    2: 'I Confess',
    3: 'Lord, Have Mercy',
    4: 'Responsorial Psalm',
    5: 'Gospel Acclamation',
    6: 'Prayer of the Faithful',
    7: 'Offertory Hymn',
    8: 'May the Lord Accept the Sacrifice',
    9: 'Holy, Holy, Holy',
    10: 'Memorial Acclamation',
    11: 'Great Amen',
    12: "The Lord's Prayer",
    13: 'Doxology',
    14: 'Lamb of God',
    15: 'Lord, I Am Not Worthy',
    16: 'Communion Hymn',
    17: 'Recessional Hymn',
  });
  assert.deepEqual(MASS_SECTIONS.map((s) => s.name), ['Introductory Rites', 'Liturgy of the Word', 'Liturgy of the Eucharist', 'Communion', 'Concluding Rites']);
});

test('each hymn slot is filtered by a song category the app has, and each Mass Order text it names is a real one', () => {
  const categories = new Set(MASS_FLOW.filter((step) => step.kind === 'song').map((step) => step.name));
  for (const slot of MASS_SLOTS.filter((s) => s.kind === 'song')) assert.ok(categories.has(slot.songCategory), `${slot.name}: ${slot.songCategory}`);
  const massOrder = read('src/liturgy/massOrder.ts');
  for (const slot of MASS_SLOTS.filter((s) => s.massOrderId)) assert.ok(massOrder.includes(`id: '${slot.massOrderId}'`), `${slot.name}: ${slot.massOrderId}`);
});

// ---- Placing an item ----

test('an item is placed in its slot, in the slot\'s block and in slot order, whatever order the slots are filled in', () => {
  let items = [];
  for (const id of ['great-amen', 'offertory', 'sanctus']) items = placeInSlot(items, id, hymn(id));
  assert.deepEqual(items.map((i) => i.slot), ['offertory', 'sanctus', 'great-amen']);
  assert.ok(items.every((i) => i.block === 'eucharist'));
});

test('blocks stay in Mass order when slots in different sections are filled out of order', () => {
  let items = [];
  for (const id of ['recessional', 'entrance', 'communion', 'psalm']) items = placeInSlot(items, id, hymn(id));
  assert.deepEqual(items.map((i) => i.block), ['introductory', 'word', 'communion', 'concluding']);
});

test('filling a slot again replaces its item, and nothing else moves', () => {
  const a = placeInSlot(placeInSlot([], 'entrance', hymn(1)), 'kyrie', hymn(2));
  const b = placeInSlot(a, 'entrance', hymn(3));
  assert.deepEqual(b.map((i) => [i.slot, i.sourceId]), [['entrance', '3'], ['kyrie', '2']]);
});

test('a slot goes ahead of the section\'s additional items and its later slots, never behind them', () => {
  const note = { block: 'introductory', module: 'custom', sourceId: 'Greeting', label: 'Greeting' };
  let items = [note];
  items = placeInSlot(items, 'kyrie', hymn(2));
  items = placeInSlot(items, 'entrance', hymn(1));
  assert.deepEqual(items.map((i) => i.slot ?? 'note'), ['entrance', 'kyrie', 'note']);
});

test('an unknown slot changes nothing', () => {
  const items = [hymn(1)];
  assert.equal(placeInSlot(items, 'nope', hymn(2)), items);
  assert.equal(isSlotId('nope'), false);
});

test('clearing a slot empties it and leaves the rest', () => {
  const items = placeInSlot(placeInSlot([], 'entrance', hymn(1)), 'kyrie', hymn(2));
  const cleared = clearSlot(items, 'entrance');
  assert.deepEqual(cleared.map((i) => i.slot), ['kyrie']);
  assert.equal(clearSlot(cleared, 'entrance'), cleared, 'an empty slot is already clear');
});

test('moving an item to another slot fills that slot, replaces what was there, and empties the one it left', () => {
  let items = placeInSlot(placeInSlot([], 'entrance', hymn(1)), 'communion', hymn(2));
  const moved = moveToSlot(items, indexOfSlot(items, 'entrance'), 'communion');
  assert.deepEqual(moved.map((i) => [i.slot, i.sourceId]), [['communion', '1']]);
  assert.equal(moveToSlot(items, 0, 'entrance'), items, 'onto its own slot changes nothing');
});

test('an additional item moved into a slot stops being an additional one', () => {
  const note = { block: 'word', module: 'custom', sourceId: 'x', label: 'x' };
  const moved = moveToSlot([note], 0, 'psalm');
  assert.equal(moved[0].slot, 'psalm');
  assert.deepEqual(additionalIn(moved, 'word'), []);
});

test('progress counts the slots filled in a section, and items of no slot are additional', () => {
  const note = { block: 'introductory', module: 'custom', sourceId: 'n', label: 'n' };
  const items = placeInSlot(placeInSlot([note], 'entrance', hymn(1)), 'confess', hymn(2));
  assert.deepEqual(filledIn(items, 'introductory'), { filled: 2, total: 3 });
  assert.deepEqual(filledIn(items, 'word'), { filled: 0, total: 3 });
  assert.deepEqual(additionalIn(items, 'introductory'), [2]);
});

test('the built-in templates: Standard Sunday is empty, and Weekday fills only slots that exist, with Mass Order texts', () => {
  assert.deepEqual(BUILT_IN_TEMPLATES.map((t) => t.id), ['standard', 'weekday']);
  assert.deepEqual(BUILT_IN_TEMPLATES[0].fills, []);
  for (const fill of BUILT_IN_TEMPLATES[1].fills) {
    assert.ok(isSlotId(fill.slot));
    assert.equal(fill.module, 'mass_order');
    assert.ok(read('src/liturgy/massOrder.ts').includes(`id: '${fill.sourceId}'`));
  }
});

// ---- The planner ----

test('the planner shows the five sections as collapsible, with a numbered slot each and a picker for each empty one', () => {
  const plan = read('src/planner/HolyMassPlanner.tsx');
  assert.match(plan, /aria-expanded=\{!closed\}/);
  assert.match(plan, /MASS_SECTIONS\.map\(\(section\) =>/);
  assert.match(plan, /slotsOfBlock\(section\.block\)\.map\(slotRow\)/);
  assert.match(plan, /<MassItemSelect/);
  assert.match(plan, /t\(slot\.kind === 'song' \? 'slotAddHymn' : 'slotAddItem'\)/);
  assert.match(plan, /onDrop=\{\(e\) => \{\s+e\.preventDefault\(\);\s+setOverSlot\(null\);\s+setPicking\(null\);\s+onDropOnSlot\(slot\.id\);/, 'a drop on a slot fills it');
  const planner = read('src/planner/MassPlanner.tsx');
  assert.match(planner, /<HolyMassPlan\b/);
  assert.match(planner, /<MassTemplates\b/);
  assert.match(planner, /\{t\('templates'\)\}/, 'the Templates button sits beside New plan');
  assert.ok(planner.indexOf("t('newPlan')") < planner.indexOf("t('templates')"));
});

test('the picker is a combobox filtered by the Holy Mass scope and the slot\'s song category', () => {
  const pick = read('src/planner/MassItemSelect.tsx');
  assert.match(pick, /role="combobox"/);
  assert.match(pick, /primaryCategory: PRIMARY\[filter\],/);
  assert.match(
    pick,
    /const PRIMARY: Record<Filter, [^>]+> = \{ slot: 'MASS', mass: 'MASS', pw: 'PRAISE_AND_WORSHIP', all: 'GENERAL' \};/,
    'the chips are This slot, Holy Mass songs, Praise & Worship and All songs',
  );
  assert.match(pick, /songCategory: filter === 'slot' \? slot\.songCategory : undefined,/);
  assert.match(pick, /e\.key === 'ArrowDown'/);
  assert.match(pick, /e\.key === 'Enter'/);
  assert.match(pick, /e\.key [!=]== 'Escape'/);
  assert.match(pick, /document\.addEventListener\('mousedown', onDown\)/, 'a click outside closes it');
});

test('every slot\'s picker has the Songs, Prayer Notes & Passages and Create Custom Note tabs', () => {
  const pick = read('src/planner/MassItemSelect.tsx');
  assert.match(pick, /role="tablist"/);
  for (const key of ['pickerTabSongs', 'pickerTabPrayers', 'pickerTabCustom']) assert.ok(pick.includes(`t('${key}')`), key);
  // A slot opens on the tab that suits it, but any slot can switch to any tab.
  assert.match(pick, /useState<Tab>\(slot\.kind === 'song' \? 'songs' : 'prayers'\)/);
  // The prayers tab offers every Mass Order part and the prayers in Notes & Prayers, never an operator-only note.
  assert.match(pick, /for \(const part of allMassParts\(\)\)/);
  assert.match(pick, /rows\.filter\(\(n\) => n\.display !== 'operator'\)/);
  // A custom note is a 'custom' row: its whole text is the source, within the database's 300 characters, named by its first line.
  assert.match(pick, /const MAX_TEXT = 300;/);
  assert.match(pick, /return \{ module: 'custom', sourceId: body, label:/);
  assert.match(pick, /maxLength=\{MAX_TEXT\}/);
  for (const key of ['pickerTabSongs', 'pickerTabPrayers', 'pickerTabCustom', 'pickerCustomAttach', 'pickerFilterPw']) {
    assert.notEqual(plannerT('tl', key), key, `${key} has a Tagalog label`);
  }
});

test('the labels exist in English and Tagalog, and the sections are named as the Holy Mass order names them', () => {
  for (const key of ['templates', 'slotAddHymn', 'slotAddItem', 'sectionsCollapseAll', 'pickerSearch', 'templateSave', 'additionalItems']) {
    assert.notEqual(plannerT('en', key), key, `en.${key}`);
    assert.notEqual(plannerT('tl', key), plannerT('en', key), `tl.${key} is its own text`);
  }
  assert.equal(plannerT('en', 'slotAddHymn'), '+ Add Hymn / Item');
  assert.equal(plannerT('en', 'block_communion'), 'Communion');
  assert.equal(plannerT('en', 'eyebrow'), 'Holy Mass Planner');
});

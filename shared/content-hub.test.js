// Tests the Liturgical Content Hub's model: three sections that follow from a note's category, the four entry types of the creation form, and
// the `---` text an edited note opens with.
// Run with: node --test shared/content-hub.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANNOUNCEMENT_CATEGORIES,
  MASS_FLOW_CATEGORIES,
  NOTE_CATEGORIES,
  NOTE_SECTIONS,
  NOTE_TYPES,
  OPERATOR_CATEGORIES,
  PRAYER_CATEGORIES,
  categoriesForType,
  cleanNote,
  dividedNote,
  dividedText,
  sectionOfCategory,
  typeOfNote,
  typeOfSection,
} from './notes.js';
import { stampSplit } from './prayer-split.js';

test('the eight categories saved before the Hub keep their names and order, so saved notes still validate', () => {
  assert.deepEqual(NOTE_CATEGORIES.slice(0, 8), [
    'Mass Intention', 'Oratio Imperata', 'Special Intercession', 'Novena', 'Community Prayer', 'Presider Note', 'Liturgical Cue', 'Choir / Booth Prompt',
  ]);
  assert.equal(new Set(NOTE_CATEGORIES).size, NOTE_CATEGORIES.length, 'no category is listed twice');
});

test('every category a type offers can be saved', () => {
  for (const type of NOTE_TYPES) {
    for (const category of categoriesForType(type)) {
      assert.ok(NOTE_CATEGORIES.includes(category), `${type} offers ${category}`);
      assert.doesNotThrow(() => cleanNote({ title: 'T', category, body: '', display: type === 'operator' ? 'operator' : 'full' }));
    }
  }
});

test('every category belongs to one of the three sections', () => {
  assert.deepEqual([...NOTE_SECTIONS], ['prayers', 'massFlow', 'announcements']);
  for (const c of NOTE_CATEGORIES) assert.ok(NOTE_SECTIONS.includes(sectionOfCategory(c)), c);
  for (const c of PRAYER_CATEGORIES) assert.equal(sectionOfCategory(c), 'prayers', c);
  for (const c of MASS_FLOW_CATEGORIES) assert.equal(sectionOfCategory(c), 'massFlow', c);
  for (const c of ANNOUNCEMENT_CATEGORIES) assert.equal(sectionOfCategory(c), 'announcements', c);
  for (const c of OPERATOR_CATEGORIES) assert.equal(sectionOfCategory(c), 'massFlow', `${c} is a booth cue for the Mass flow`);
  assert.equal(sectionOfCategory('Something else'), 'prayers', 'an unknown category is never lost from the Hub');
});

test('the spec\'s category tags are offered: Community Prayer, Creed, Mass Intention, Pastoral Notice', () => {
  assert.ok(categoriesForType('prayer').includes('Community Prayer'));
  assert.ok(categoriesForType('prayer').includes('Mass Intention'));
  assert.ok(categoriesForType('prayer').includes('Consecration'));
  assert.ok(categoriesForType('massFlow').includes('Creed'));
  assert.ok(categoriesForType('announcement').includes('Pastoral Notice'));
});

test('an operator note can take any category; booth cues come first', () => {
  const offered = categoriesForType('operator');
  assert.deepEqual(offered.slice(0, OPERATOR_CATEGORIES.length), [...OPERATOR_CATEGORIES]);
  assert.deepEqual([...offered].sort(), [...NOTE_CATEGORIES].sort());
});

test('a saved note opens in the form on the type it was made as', () => {
  assert.equal(typeOfNote({ display: 'full', category: 'Novena' }), 'prayer');
  assert.equal(typeOfNote({ display: 'lower', category: 'Creed' }), 'massFlow');
  assert.equal(typeOfNote({ display: 'full', category: 'Emergency Notice' }), 'announcement');
  assert.equal(typeOfNote({ display: 'operator', category: 'Pastoral Notice' }), 'operator', 'a private note is an operator note, whatever its category');
  // A note saved before the Hub with a booth category but shown full screen is still projectable.
  assert.equal(typeOfNote({ display: 'full', category: 'Presider Note' }), 'massFlow');
  assert.equal(typeOfSection('announcements'), 'announcement');
  assert.equal(typeOfSection('massFlow'), 'massFlow');
  assert.equal(typeOfSection('prayers'), 'prayer');
});

test('dividedText puts a --- line after each manual break, and typing it back gives the same note', () => {
  const body = 'One\nTwo\nThree\nFour';
  const split = stampSplit({ mode: 'manual', at: [1, 2] }, body);
  const text = dividedText(body, split);
  assert.equal(text, 'One\nTwo\n---\nThree\n---\nFour');
  const back = dividedNote(text);
  assert.equal(back.body, body);
  assert.deepEqual(back.split.at, [1, 2]);
});

test('dividedText leaves the text as it is for no split, an automatic split, or a split made for older text', () => {
  const body = 'One\nTwo';
  assert.equal(dividedText(body, null), body);
  assert.equal(dividedText(body, { mode: 'auto' }), body);
  const stale = stampSplit({ mode: 'manual', at: [0] }, 'Older\ntext');
  assert.equal(dividedText(body, stale), body, 'a stale split is not drawn as dividers');
  assert.equal(dividedText(body, { mode: 'manual', at: [1, 7] }), body, 'a break after the last line makes no divider');
});

// Multi-add from the Library: ticks are kept in the order they were made, the ticked songs and prayers fill the empty slots of their
// type in that order, items already in the lineup are skipped, and the Library's checkboxes and "Add selected" button call these
// functions. Run with: node --test shared/library-ticks.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TEMPLATE, segmentFromTemplate } from './pw.js';
import { addTicked, clickTick, tickRange, toggleTick } from './library-ticks.js';

const lineup = () => DEFAULT_TEMPLATE.groups.flatMap((g) => DEFAULT_TEMPLATE.segments.filter((s) => s.group === g.key)).map(segmentFromTemplate);
const at = (segments, key) => segments.find((s) => s.key === key);

test('ticked songs fill the empty song slots in the order they were ticked', () => {
  let ticked = [];
  ticked = toggleTick(ticked, 'song-9');
  ticked = toggleTick(ticked, 'song-3');
  const result = addTicked(lineup(), ticked, 'song');
  assert.deepEqual(at(result.segments, 'marian_song').content.hymnIds, [9], 'the first tick goes to the first empty song slot');
  assert.deepEqual(at(result.segments, 'joyful_song').content.hymnIds, [3], 'the second tick goes to the next empty song slot');
  assert.equal(result.added, 2);
  assert.equal(result.left, 0);
});

test('ticked prayers fill the empty prayer slots in the order they were ticked', () => {
  let ticked = [];
  ticked = toggleTick(ticked, 'prayer-12');
  ticked = toggleTick(ticked, 'prayer-11');
  const result = addTicked(lineup(), ticked, 'prayer');
  assert.equal(at(result.segments, 'prayer_authority').content.noteId, 12, 'the first prayer ticked goes to the first empty prayer slot');
  assert.equal(at(result.segments, 'consecration_mary').content.noteId, 11, 'the second ticked goes to the next');
  assert.equal(result.added, 2);
});

test('a tick toggled a second time is removed, and the add uses only what is still ticked', () => {
  let ticked = toggleTick([], 'song-9');
  ticked = toggleTick(ticked, 'song-3');
  ticked = toggleTick(ticked, 'song-9');
  assert.deepEqual(ticked, ['song-3']);
  const result = addTicked(lineup(), ticked, 'song');
  assert.deepEqual(at(result.segments, 'marian_song').content.hymnIds, [3]);
});

test('a song already in the lineup is skipped, not added twice', () => {
  const segments = lineup().map((s) => (s.key === 'marian_song' ? { ...s, content: { ...s.content, hymnIds: [9] } } : s));
  const result = addTicked(segments, ['song-9', 'song-3'], 'song');
  assert.equal(result.skipped, 1);
  assert.equal(result.added, 1);
  assert.deepEqual(at(result.segments, 'joyful_song').content.hymnIds, [3]);
});

test('ticks beyond the empty slots are reported as left over, and nothing is lost', () => {
  const full = lineup().map((s) => (s.type === 'song' ? { ...s, content: { ...s.content, hymnIds: [99] } } : s));
  const result = addTicked(full, ['song-1', 'song-2'], 'song');
  assert.equal(result.added, 0);
  assert.equal(result.left, 2);
});

test('ticks of one tab do not add items of the other', () => {
  const result = addTicked(lineup(), ['song-9', 'prayer-11'], 'song');
  assert.equal(at(result.segments, 'prayer_authority').content.noteId, null, 'the prayer tick is not added by the song add');
  assert.equal(result.added, 1);
});

test('the Library’s cards select through clickTick, and "Add selected" attaches to the selected card', () => {
  const library = readFileSync(fileURLToPath(new URL('../src/praise-worship/Library.tsx', import.meta.url)), 'utf8');
  assert.match(library, /clickTick\(\s*ticked,/, 'each song and prayer card is selected through clickTick');
  assert.match(library, /attachMany\(segment, drags\)/, '"Add selected" attaches through attachMany');
  assert.doesNotMatch(library, /no empty slot left/, 'a card is never refused for want of an empty slot');
});

const KEYS = ['song-1', 'song-2', 'song-3', 'song-4', 'song-5'];

test('Shift + click adds every row from the anchor to the clicked row, after what was already selected', () => {
  assert.deepEqual(tickRange(['song-5'], KEYS, 1, 3), ['song-5', 'song-2', 'song-3', 'song-4']);
});

test('a range works upward as well as downward, and a repeat is not added twice', () => {
  assert.deepEqual(tickRange([], KEYS, 3, 1), ['song-2', 'song-3', 'song-4']);
  assert.deepEqual(tickRange(['song-3', 'song-2'], KEYS, 1, 3), ['song-3', 'song-2', 'song-4']);
  assert.deepEqual(tickRange([], KEYS, 2, 2), ['song-3']);
});

test('the Library has no checkboxes: the card selects, Add is its own button, and a range starts from the last click', () => {
  const library = readFileSync(fileURLToPath(new URL('../src/praise-worship/Library.tsx', import.meta.url)), 'utf8');
  assert.doesNotMatch(library, /type="checkbox"/, 'no standalone checkbox');
  assert.match(library, /onClick=\{\(e\) => handleCardClick\(e, i, row\)\}/, 'the whole card is clickable');
  assert.match(library, /useState<number \| null>\(null\)/, 'the last clicked row is tracked');
  assert.match(library, /e\.stopPropagation\(\);\s+row\.insert\(\);/, 'Add inserts without touching the selection');
  assert.match(library, /border-l-accent/, 'a selected card has the accent edge');
});

const NONE = { shift: false, toggle: false };

test('a plain click selects only that card and drops every other selection', () => {
  const result = clickTick(['song-1', 'song-2', 'prayer-4'], KEYS, 0, 3, NONE);
  assert.deepEqual(result, { ticked: ['song-4'], anchor: 3 });
});

test('a plain click on the only selected card leaves it selected', () => {
  assert.deepEqual(clickTick(['song-2'], KEYS, 1, 1, NONE), { ticked: ['song-2'], anchor: 1 });
});

test('Ctrl or Cmd + click toggles one card and keeps the rest', () => {
  const on = clickTick(['song-1'], KEYS, 0, 2, { shift: false, toggle: true });
  assert.deepEqual(on, { ticked: ['song-1', 'song-3'], anchor: 2 });
  const off = clickTick(on.ticked, KEYS, on.anchor, 0, { shift: false, toggle: true });
  assert.deepEqual(off, { ticked: ['song-3'], anchor: 0 });
});

test('Shift + click adds the range from the anchor and keeps the anchor for the next one', () => {
  const first = clickTick(['song-1'], KEYS, 0, 2, { shift: true, toggle: false });
  assert.deepEqual(first, { ticked: ['song-1', 'song-2', 'song-3'], anchor: 0 });
  const second = clickTick(first.ticked, KEYS, first.anchor, 4, { shift: true, toggle: false });
  assert.deepEqual(second.ticked, ['song-1', 'song-2', 'song-3', 'song-4', 'song-5']);
});

test('Shift + click with no anchor selects only that card and sets the anchor there', () => {
  assert.deepEqual(clickTick(['song-5'], KEYS, null, 2, { shift: true, toggle: false }), { ticked: ['song-3'], anchor: 2 });
});

test('Shift wins when Shift and Ctrl are held together', () => {
  assert.deepEqual(clickTick([], KEYS, 1, 3, { shift: true, toggle: true }).ticked, ['song-2', 'song-3', 'song-4']);
});

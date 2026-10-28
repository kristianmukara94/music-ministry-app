// Multi-add from the Library: ticks are kept in the order they were made, the ticked songs and prayers fill the empty slots of their
// type in that order, items already in the lineup are skipped, and the Library's checkboxes and "Add selected" button call these
// functions. Run with: node --test shared/library-ticks.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TEMPLATE, segmentFromTemplate } from './pw.js';
import { addTicked, toggleTick } from './library-ticks.js';

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

test('the Library’s checkboxes and "Add selected" call toggleTick and addTicked', () => {
  const library = readFileSync(fileURLToPath(new URL('../src/praise-worship/Library.tsx', import.meta.url)), 'utf8');
  assert.match(library, /toggleTick\(ticked, row\.key\)/, 'each song and prayer row is ticked through toggleTick');
  assert.match(library, /addTicked\(session\.segments, ticked, tab/, '"Add selected" fills through addTicked');
  assert.match(library, /commitSegments\(result\.segments\)/, 'the result is written to the lineup');
});

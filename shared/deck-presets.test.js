// The deck's presentation presets, the speaker notes' text sizes, and which cards a drag carries.
// Run with: node --test shared/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_NOTES_SIZE, NOTES_SIZES, activePreset, applyPreset, dragItemKeys, parseNotesSize } from './deck-presets.js';

test('the announcement loop plays every 10 seconds, loops, and hides the count', () => {
  const next = applyPreset('loop', { interval: 4, loop: false, showCount: true });
  assert.deepEqual(next, { interval: 10, loop: true, showCount: false });
  assert.equal(activePreset(next, true), 'loop');
  // Paused, it is no longer the loop the preset started.
  assert.equal(activePreset(next, false), null);
});

test('the sermon deck stops looping, shows the count, and keeps the interval', () => {
  const next = applyPreset('sermon', { interval: 7, loop: true, showCount: false });
  assert.deepEqual(next, { interval: 7, loop: false, showCount: true });
  assert.equal(activePreset(next, false), 'sermon');
  assert.equal(activePreset(next, true), null);
});

test('settings changed by hand match no preset', () => {
  assert.equal(activePreset({ interval: 12, loop: true, showCount: false }, true), null);
  assert.equal(activePreset({ interval: 10, loop: false, showCount: false }, false), null);
});

test('an unknown preset changes nothing', () => {
  const current = { interval: 5, loop: true, showCount: true };
  assert.equal(applyPreset('nope', current), current);
});

test('the notes size is kept within the sizes there are', () => {
  assert.equal(parseNotesSize(null), DEFAULT_NOTES_SIZE);
  assert.equal(parseNotesSize(''), DEFAULT_NOTES_SIZE);
  assert.equal(parseNotesSize('abc'), DEFAULT_NOTES_SIZE);
  assert.equal(parseNotesSize('1.5'), DEFAULT_NOTES_SIZE);
  assert.equal(parseNotesSize('-3'), 0);
  assert.equal(parseNotesSize('99'), NOTES_SIZES.length - 1);
  assert.equal(parseNotesSize('2'), 2);
  assert.equal(NOTES_SIZES[0], 'text-xs');
  assert.equal(NOTES_SIZES.at(-1), 'text-xl');
});

test('a picked card drags every picked card, in deck order, from both libraries', () => {
  const order = ['a:1', 'w:2', 'a:3', 'w:4'];
  assert.deepEqual(dragItemKeys('a:3', new Set(['w:4', 'a:3', 'a:1']), order), ['a:1', 'a:3', 'w:4']);
});

test('a card that is not picked is dragged alone', () => {
  assert.deepEqual(dragItemKeys('w:2', new Set(['a:1', 'a:3']), ['a:1', 'w:2', 'a:3']), ['w:2']);
});

test('a picked card missing from the order is still carried', () => {
  assert.deepEqual(dragItemKeys('a:9', new Set(['a:9', 'a:1']), ['a:1']), ['a:9', 'a:1']);
});

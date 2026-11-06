// Tests picking Whiteboard slides: single ticks, Shift-click ranges, and the grid's keys.
// Run with: node --test shared/slide-selection.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clickSelection, dragSlideIds, parseDragSlideIds, parseGridColumns, selectionKey, toggled, without } from './slide-selection.js';

const sorted = (set) => [...set].sort((a, b) => a - b);
const order = [10, 11, 12, 13, 14, 15];

test('toggled and without return new sets and leave the original alone', () => {
  const start = new Set([1, 2]);
  assert.deepEqual(sorted(toggled(start, 3)), [1, 2, 3]);
  assert.deepEqual(sorted(toggled(start, 2)), [1]);
  assert.deepEqual(sorted(without(start, [1, 9])), [2]);
  assert.deepEqual(sorted(start), [1, 2]);
});

test('a click without Shift flips only the clicked slide', () => {
  assert.deepEqual(sorted(clickSelection(new Set([10]), order, 10, 13, false)), [10, 13]);
  assert.deepEqual(sorted(clickSelection(new Set([10, 13]), order, 10, 13, false)), [10]);
});

test('Shift-click picks every slide between the anchor and the target, in either direction', () => {
  assert.deepEqual(sorted(clickSelection(new Set([11]), order, 11, 14, true)), [11, 12, 13, 14]);
  assert.deepEqual(sorted(clickSelection(new Set([14]), order, 14, 11, true)), [11, 12, 13, 14]);
});

test('Shift-click keeps picks outside the range', () => {
  assert.deepEqual(sorted(clickSelection(new Set([10, 15, 12]), order, 12, 13, true)), [10, 12, 13, 15]);
});

test('Shift-click on a picked slide clears the whole range', () => {
  assert.deepEqual(sorted(clickSelection(new Set([10, 11, 12, 13, 14]), order, 11, 13, true)), [10, 14]);
});

test('Shift-click with no anchor, or an anchor no longer shown, acts as a plain click', () => {
  assert.deepEqual(sorted(clickSelection(new Set(), order, null, 12, true)), [12]);
  assert.deepEqual(sorted(clickSelection(new Set([99]), order, 99, 12, true)), [12, 99]);
});

test('Ctrl+A and Cmd+A select all, whether or not anything is picked', () => {
  assert.equal(selectionKey({ key: 'a', ctrlKey: true }, 0), 'selectAll');
  assert.equal(selectionKey({ key: 'A', metaKey: true }, 3), 'selectAll');
  assert.equal(selectionKey({ key: 'a', ctrlKey: true, shiftKey: true }, 3), null);
  assert.equal(selectionKey({ key: 'a', ctrlKey: true, altKey: true }, 3), null);
});

test('Escape, Delete and Backspace act only while something is picked', () => {
  assert.equal(selectionKey({ key: 'Escape' }, 2), 'clear');
  assert.equal(selectionKey({ key: 'Delete' }, 1), 'delete');
  assert.equal(selectionKey({ key: 'Backspace' }, 1), 'delete');
  assert.equal(selectionKey({ key: 'Escape' }, 0), null);
  assert.equal(selectionKey({ key: 'Delete' }, 0), null);
});

test('modified Escape or Delete, and other keys, are left alone', () => {
  assert.equal(selectionKey({ key: 'Delete', ctrlKey: true }, 2), null);
  assert.equal(selectionKey({ key: 'Delete', shiftKey: true }, 2), null);
  assert.equal(selectionKey({ key: 'Enter' }, 2), null);
  assert.equal(selectionKey({ key: 'a' }, 2), null);
});

test('a drag from a picked slide carries every picked slide, in deck order; an unpicked slide goes alone', () => {
  assert.deepEqual(dragSlideIds(13, new Set([14, 11, 13]), order), [11, 13, 14]);
  assert.deepEqual(dragSlideIds(12, new Set([14, 11]), order), [12]);
  assert.deepEqual(dragSlideIds(12, new Set(), order), [12]);
});

test('drag data is read back as slide ids, and anything else as none', () => {
  assert.deepEqual(parseDragSlideIds(JSON.stringify([3, 1, 3])), [3, 1]);
  assert.deepEqual(parseDragSlideIds(JSON.stringify([1, 'x', -2, 1.5, null])), [1]);
  assert.deepEqual(parseDragSlideIds('not json'), []);
  assert.deepEqual(parseDragSlideIds('{"a":1}'), []);
  assert.deepEqual(parseDragSlideIds(''), []);
  assert.deepEqual(parseDragSlideIds(null), []);
});

test('the grid density is 3, 4 or 6 columns, and 4 when nothing usable is stored', () => {
  assert.equal(parseGridColumns('3'), 3);
  assert.equal(parseGridColumns('6'), 6);
  assert.equal(parseGridColumns('5'), 4);
  assert.equal(parseGridColumns('wide'), 4);
  assert.equal(parseGridColumns(null), 4);
});

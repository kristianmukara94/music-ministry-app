// Tests how a Holy Mass row names a Liturgical Content Hub entry and the slides of it that it plays: the note id alone plays every slide,
// `<id>:<slides>` only those (0-based, in ranges). Run with: node --test shared/notes-source.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanNote, dividedNote, noteSource, noteSourceId, pickSlides } from './notes.js';
import { screenPagesOf } from './prayer-screen.js';

test('a row with no slides chosen names the note alone, as every row did before', () => {
  assert.equal(noteSourceId(12), '12');
  assert.equal(noteSourceId(12, []), '12');
  assert.equal(noteSourceId(12, null), '12');
  assert.deepEqual(noteSource('12'), { id: 12, slides: null });
});

test('chosen slides are kept in order, without repeats, and runs are written as ranges', () => {
  assert.equal(noteSourceId(12, [2, 1]), '12:1-2');
  assert.equal(noteSourceId(12, [5, 1, 2, 3, 3]), '12:1-3,5');
  assert.equal(noteSourceId(7, [0]), '7:0');
  assert.deepEqual(noteSource('12:1-3,5'), { id: 12, slides: [1, 2, 3, 5] });
  assert.deepEqual(noteSource(noteSourceId(9, [0, 4, 6, 7])), { id: 9, slides: [0, 4, 6, 7] });
});

test('a source id that names no note is refused, not misread', () => {
  for (const bad of ['', 'abc', '0', '-3', '12:', '12:a', '12:3-1', '12:1--2', '12:0-9999', ' 12 :1', null, undefined]) {
    assert.equal(noteSource(bad), null, String(bad));
  }
});

test('a row plays only its slides; a row whose slides were all cut from the note plays the whole note', () => {
  const pages = ['a', 'b', 'c', 'd'];
  assert.deepEqual(pickSlides(pages, null), pages);
  assert.deepEqual(pickSlides(pages, [1, 2]), ['b', 'c']);
  assert.deepEqual(pickSlides(pages, [2, 9]), ['c'], 'a slide past the end is dropped');
  assert.deepEqual(pickSlides(pages, [7, 9]), pages, 'nothing left: the whole note');
});

test('slides 2 and 3 of a 7-slide prayer typed with --- lines are exactly the 2nd and 3rd parts typed', () => {
  const parts = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'];
  const { body, split } = dividedNote(parts.join('\n---\n'));
  // As saved: the save stamps the split with the text it was made for.
  const pages = screenPagesOf(cleanNote({ title: 'Novena', category: 'Novena', display: 'full', body, split }));
  assert.equal(pages.length, 7);
  const { slides } = noteSource(noteSourceId(3, [1, 2]));
  assert.deepEqual(pickSlides(pages, slides).map((p) => p.text), ['Two', 'Three']);
});

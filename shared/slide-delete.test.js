// Go Live's Delete slide: the rules that take a slide out of an item or a card, and pick the slide to show after it.
// Run with: node --test shared/slide-delete.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrangementWithout, pagesWithout, slideAfterDelete } from './pw-hot-edit.js';

const hymn = { id: 7, stanzas: [{ id: 1 }, { id: 2 }, { id: 3 }] };

test('a card singing the song in its stored order gets an order of its own, without the stanza', () => {
  assert.deepEqual(arrangementWithout({}, hymn, '2', 1), { 7: ['1', '3'] });
  assert.deepEqual(arrangementWithout(undefined, hymn, 2, 1), { 7: ['1', '3'] });
});

test('only the asked-for appearance of a repeated chorus goes', () => {
  const arrangement = { 7: ['1', '2', '3', '2'], 9: ['5'] };
  assert.deepEqual(arrangementWithout(arrangement, hymn, '2', 2), { 7: ['1', '2', '3'], 9: ['5'] });
  assert.deepEqual(arrangementWithout(arrangement, hymn, '2', 1), { 7: ['1', '3', '2'], 9: ['5'] });
  // The card's order is not changed in place.
  assert.deepEqual(arrangement[7], ['1', '2', '3', '2']);
});

test('the song is never left with an empty order, and an unknown stanza changes nothing', () => {
  assert.equal(arrangementWithout({ 7: ['3'] }, hymn, '3', 1), null);
  assert.equal(arrangementWithout({ 7: ['1', '3'] }, hymn, '2', 1), null);
  assert.equal(arrangementWithout({}, { id: 8, stanzas: [{ id: 4 }] }, '4', 1), null);
});

test('an order holding stanzas the song no longer has is read without them', () => {
  assert.deepEqual(arrangementWithout({ 7: ['99', '1', '3'] }, hymn, '1', 1), { 7: ['3'] });
});

test('a page comes out of an item, which keeps at least one', () => {
  assert.deepEqual(pagesWithout(['a', 'b', 'c'], 1), ['a', 'c']);
  assert.deepEqual(pagesWithout(['a', 'b'], 1), ['a']);
  assert.equal(pagesWithout(['a'], 0), null);
  assert.equal(pagesWithout(['a', 'b'], 2), null);
  assert.equal(pagesWithout(['a', 'b'], -1), null);
});

test('after a delete the next slide moves up into place; deleting the last one shows the one before', () => {
  // Slide 2 of 4 deleted: 3 left, and the old slide 3 is now at index 1.
  assert.equal(slideAfterDelete(1, 3), 1);
  // The last of 4 deleted: the selection moves back to the new last slide.
  assert.equal(slideAfterDelete(3, 3), 2);
  assert.equal(slideAfterDelete(0, 1), 0);
  assert.equal(slideAfterDelete(5, 0), 0);
});

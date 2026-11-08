// Tests how a prayer typed in Go Live with `---` lines becomes its text and its slide breaks, and that those breaks give the slides typed.
// Run with: node --test shared/notes-divided.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanNote, dividedNote } from './notes.js';
import { manualParts } from './prayer-split.js';

test('each --- line is a slide break, and the divider lines are not in the text', () => {
  const { body, split } = dividedNote('First line\nSecond line\n---\nThird line\n---\nFourth');
  assert.equal(body, 'First line\nSecond line\nThird line\nFourth');
  assert.deepEqual(split, { mode: 'manual', at: [1, 2] });
  assert.deepEqual(manualParts(body, split.at), ['First line\nSecond line', 'Third line', 'Fourth']);
});

test('blank lines around a divider make no empty slide', () => {
  const { body, split } = dividedNote('One\n\n---\n\nTwo');
  assert.deepEqual(manualParts(body, split.at), ['One', 'Two']);
});

test('dividers at the start, at the end, or twice in a row make no empty slide', () => {
  const { body, split } = dividedNote('---\n\nOne\n---\n---\nTwo\n---\n');
  assert.equal(body, 'One\nTwo');
  assert.deepEqual(split, { mode: 'manual', at: [0] });
  assert.deepEqual(manualParts(body, split.at), ['One', 'Two']);
});

test('text with no divider is one slide, with no split', () => {
  assert.deepEqual(dividedNote('Lord, hear our prayer.\nAmen.'), { body: 'Lord, hear our prayer.\nAmen.', split: null });
  assert.deepEqual(dividedNote(''), { body: '', split: null });
});

test('only a line of dashes alone is a divider; dashes inside a line are text', () => {
  const { body, split } = dividedNote('Before -- after\n  -----  \nNext\nA --- B');
  assert.equal(body, 'Before -- after\nNext\nA --- B');
  assert.deepEqual(split, { mode: 'manual', at: [0] });
});

test('Windows line endings are read the same', () => {
  assert.deepEqual(dividedNote('One\r\n---\r\nTwo'), { body: 'One\nTwo', split: { mode: 'manual', at: [0] } });
});

test('the split survives the save rules unchanged', () => {
  const { body, split } = dividedNote('One\n---\nTwo\n---\nThree');
  const clean = cleanNote({ title: 'Prayer', category: 'Community Prayer', body, display: 'full', split });
  assert.deepEqual(clean.split.at, [0, 1]);
  assert.equal(clean.slot, undefined, 'a save that does not say the slot leaves it out');
});

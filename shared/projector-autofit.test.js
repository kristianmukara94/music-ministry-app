// Tests the projector's fit rules: the step-down sizes, and splitting a slide too long to read into labelled parts.
// Run with: node --test shared/projector-autofit.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIT_LEADING, FIT_STEPS, SAFE_AREA, SPLIT_LIMITS, pickFitStep, splitDeck, splitLongLine, splitSlide } from './projector-autofit.js';

const rem = (scale) => Math.round(scale * 3.5 * 100) / 100;

test('the steps are 3.5, 3.0, 2.5, 2.0 and 1.75rem, getting tighter as they shrink', () => {
  assert.deepEqual(FIT_STEPS.map(rem), [3.5, 3, 2.5, 2, 1.75]);
  assert.equal(FIT_LEADING[0], null, 'the first steps keep the slide\'s own spacing');
  assert.ok(FIT_LEADING[2] < 1.22 && FIT_LEADING[4] <= FIT_LEADING[2], 'leading-tight from the third step');
});

test('text that fits is left at its size, and each size is tried in turn until one fits', () => {
  assert.deepEqual(pickFitStep(() => true), { index: 0, scale: 1, leading: null, overflow: false });
  const tried = [];
  // Text 300px tall at its set size, in a box 200px tall: it fits once it is 2/3 the size or smaller.
  const picked = pickFitStep((scale) => {
    tried.push(rem(scale));
    return 300 * scale <= 200;
  });
  assert.deepEqual(tried, [3.5, 3, 2.5, 2]);
  assert.equal(rem(picked.scale), 2);
  assert.equal(picked.overflow, false);
  assert.equal(picked.leading, FIT_LEADING[3]);
});

test('text too long even at 1.75rem stays at the smallest step and says it overflows', () => {
  const picked = pickFitStep(() => false);
  assert.equal(rem(picked.scale), 1.75);
  assert.equal(picked.index, FIT_STEPS.length - 1);
  assert.equal(picked.overflow, true);
});

test('the safe margins clear the title and the badges: at least 56px top and 64px bottom on a 1080-line screen', () => {
  assert.ok(SAFE_AREA.top * 1080 >= 56);
  assert.ok(SAFE_AREA.bottom * 1080 >= 64);
});

const all = (text) => ({ role: 'all', text });
const length = (lines) => lines.reduce((n, l) => n + l.text.length, 0);

test('a slide within the limits is left as it is', () => {
  const sanctus = [all('Holy, Holy, Holy Lord God of hosts.'), all('Heaven and earth are full of your glory.'), all('Hosanna in the highest.')];
  assert.deepEqual(splitSlide(sanctus), [sanctus]);
  assert.deepEqual(splitDeck('Sanctus', [sanctus]), { slides: [sanctus], labels: null });
});

test('a long slide is cut into balanced parts labelled "Sanctus (1/2)" and "Sanctus (2/2)", in order, nothing lost', () => {
  // Twelve short lines: within the character limit, but more lines than one slide holds.
  const long = Array.from({ length: 12 }, (_, i) => all(`Hosanna, line ${i + 1}.`));
  const { slides, labels } = splitDeck('Sanctus', [long]);
  assert.equal(slides.length, 2);
  assert.deepEqual(labels, ['Sanctus (1/2)', 'Sanctus (2/2)']);
  assert.deepEqual(slides.flat(), long, 'the lines in order, none dropped');
  for (const part of slides) {
    assert.ok(length(part) <= SPLIT_LIMITS.maxChars && part.length <= SPLIT_LIMITS.maxLines);
  }
  assert.ok(Math.abs(slides[0].length - slides[1].length) <= 2, 'two halves, not a full slide and a line');
});

test('only the slides that were cut show a part number', () => {
  const short = [all('Amen.')];
  const long = [all('x '.repeat(200).trim())];
  const { labels } = splitDeck('Gloria', [short, long]);
  assert.equal(labels[0], 'Gloria');
  assert.match(labels[1], /^Gloria \(1\/\d\)$/);
  assert.match(labels.at(-1), /^Gloria \((\d)\/\1\)$/);
});

test('one very long line is cut at sentence ends first, then between words, and keeps its role', () => {
  const text = 'Lamb of God, you take away the sins of the world, have mercy on us. '.repeat(5).trim();
  const pieces = splitLongLine({ role: 'priest', text }, 140);
  assert.ok(pieces.length >= 3);
  assert.ok(pieces.every((p) => p.role === 'priest' && p.text.length <= 140));
  assert.ok(pieces.every((p) => /[.,]$/.test(p.text)), 'each piece ends where a sentence or clause ends');
  assert.equal(pieces.map((p) => p.text).join(' '), text);
  const word = splitLongLine({ role: 'all', text: 'word '.repeat(100).trim() }, 50);
  assert.ok(word.every((p) => p.text.length <= 50));
  assert.equal(word.map((p) => p.text).join(' '), 'word '.repeat(100).trim());
});

// Balanced line breaks for projected text (balanceLine, balanceProjectorLines in text-fit.js). Every character is one unit wide here, so
// widths are lengths. The real measuring runs in the projector window (src/output/useBalancedLines.ts). Run with: node --test shared/text-balance.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balanceLine, balanceProjectorLines } from './text-fit.js';

const mono = (s) => s.length;
const wordsOf = (line) => line.split(' ').length;

/** How many lines a plain greedy wrap at `max` gives, as the browser would draw it. */
function greedyCount(line, max) {
  let count = 1;
  let run = 0;
  for (const w of line.split(' ')) {
    if (run === 0) run = w.length;
    else if (run + 1 + w.length <= max) run += 1 + w.length;
    else (count += 1), (run = w.length);
  }
  return count;
}

test('a line that fits is left as it is', () => {
  assert.deepEqual(balanceLine('Sample lyric line', 40, mono), ['Sample lyric line']);
});

test('seven words that wrap six and one come out four and three: no lone word on the last line', () => {
  const line = 'word1 word2 word3 word4 word5 word6 word7';
  const max = 'word1 word2 word3 word4 word5 word6'.length;
  assert.equal(greedyCount(line, max), 2);
  const out = balanceLine(line, max, mono);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(wordsOf).sort(), [3, 4]);
  assert.equal(out.join(' '), line);
});

test('the line count is the browser\'s own, and every line fits, so the slide is no taller', () => {
  const line = 'Sample lyric line for projector reflow testing with several more words to share out evenly across lines';
  for (const max of [20, 30, 45, 60, 80]) {
    const out = balanceLine(line, max, mono);
    assert.equal(out.length, greedyCount(line, max), `width ${max}`);
    for (const l of out) assert.ok(l.length <= max, `"${l}" is wider than ${max}`);
    assert.equal(out.join(' '), line);
  }
});

test('between two equally even splits, the one after a comma wins', () => {
  // After "bbbb" or after "cccc,": nine and fifteen units either way. Balance alone takes the first; the comma takes the second.
  assert.deepEqual(balanceLine('aaaa bbbb cccc, dddd eeee', 20, mono), ['aaaa bbbb cccc,', 'dddd eeee']);
  assert.deepEqual(balanceLine('aaaa bbbb cccc dddd eeee', 20, mono), ['aaaa bbbb', 'cccc dddd eeee']);
});

test('a line does not end on a short word such as "the", "and" or "mga" when a clean break is near', () => {
  for (const weak of ['the', 'and', 'mga']) {
    // The evenest split ends the first line on the short word; one word further is nearly as even.
    assert.deepEqual(balanceLine(`aaaa ${weak} cccc dddd ee`, 16, mono), [`aaaa ${weak} cccc`, 'dddd ee']);
  }
  // Without the short word, the evenest split stands.
  assert.deepEqual(balanceLine('aaaa xyz cccc dddd ee', 16, mono), ['aaaa xyz', 'cccc dddd ee']);
});

test('short words match in any letter case, and a clause break after one is still a good break', () => {
  assert.deepEqual(balanceLine('aaaa The cccc dddd ee', 16, mono), ['aaaa The cccc', 'dddd ee']);
  assert.equal(balanceLine('aaaa and, cccc dddd e', 16, mono)[0], 'aaaa and,');
});

test('a word wider than the line is left for the browser to break', () => {
  const line = 'short Wordthatisfartoolongforanyline tail';
  assert.deepEqual(balanceLine(line, 20, mono), [line]);
});

test('a whole slide keeps its own line breaks and blank lines, and balances only the lines too wide', () => {
  const text = 'Short first line\n\nword1 word2 word3 word4 word5 word6 word7\nEnd';
  const out = balanceProjectorLines(text, 35, mono).split('\n');
  assert.equal(out[0], 'Short first line');
  assert.equal(out[1], '');
  assert.deepEqual([out[2], out[3]].map(wordsOf).sort(), [3, 4]);
  assert.equal(out[4], 'End');
});

test('no width (a box not laid out yet) leaves the text alone', () => {
  assert.equal(balanceProjectorLines('Sample lyric line for projector reflow testing', 0, mono), 'Sample lyric line for projector reflow testing');
});

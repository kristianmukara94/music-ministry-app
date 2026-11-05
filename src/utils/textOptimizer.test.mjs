// The Text Boundary Optimizer: where raw text is cut into slides, and that every slide fits. Run with: node --test src/utils/textOptimizer.test.mjs
// (Node runs the TypeScript source directly by stripping its types.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LIMITS, ON_AIR_LIMITS, autoSplitText, needsSplit, normalizeText, sentencesOf, slideFits, smartBreakParts, wrappedLineCount } from './textOptimizer.ts';

const fitsAll = (slides, limits = DEFAULT_LIMITS) => slides.every((s) => slideFits(s, limits));
// The words of a slide set, with every break and space made one space: what the optimizer must never change.
const words = (text) => text.split(/\s+/).filter(Boolean).join(' ');

test('text that already fits is left exactly as it was', () => {
  const text = 'First short line\nSecond short line\n\nA new slide';
  const result = autoSplitText(text);
  assert.equal(result.formattedText, text);
  assert.equal(result.slideCount, 2);
  assert.deepEqual(result.slides, ['First short line\nSecond short line', 'A new slide']);
  assert.equal(result.wasModified, false);
});

test('a long paragraph is cut at full stops into slides that fit, with no word lost or moved', () => {
  const sentence = (n) => `This is sentence number ${n} of the long pasted paragraph here.`;
  const raw = Array.from({ length: 8 }, (_, i) => sentence(i + 1)).join(' ');
  const result = autoSplitText(raw);
  assert.ok(result.slideCount > 1);
  assert.ok(fitsAll(result.slides));
  assert.equal(result.wasModified, true);
  assert.equal(words(result.formattedText), words(raw));
  // Every slide ends on a full stop: no cut falls mid-sentence when a sentence boundary would do.
  for (const slide of result.slides) assert.match(slide, /\.$/);
  assert.equal(result.formattedText, result.slides.join('\n\n'));
});

test('slides are kept about even: no slide is left with one stray line', () => {
  const lines = Array.from({ length: 5 }, (_, i) => `Short lyric line ${i + 1}`).join('\n');
  const { slides } = autoSplitText(lines);
  // Five lines over four-line slides make 3 + 2, not 4 + 1.
  assert.deepEqual(
    slides.map((s) => s.split('\n').length),
    [3, 2],
  );
});

test('a cut prefers the strongest pause: a full stop over a comma over mid-clause', () => {
  const raw = 'one two three four five six, seven eight nine ten eleven. Twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen.';
  const { slides } = autoSplitText(raw, { maxLinesPerSlide: 2, maxCharsPerLine: 45, maxCharsPerSlide: 90 });
  assert.equal(slides[0].endsWith('eleven.'), true);
});

test('a lyric line break counts as a pause, so lines are never joined into one', () => {
  const { slides } = autoSplitText(['Line a', 'Line b', 'Line c', 'Line d', 'Line e', 'Line f'].join('\n'));
  for (const slide of slides) for (const line of slide.split('\n')) assert.match(line, /^Line [a-f]$/);
});

test('a sentence too long for one slide is cut at clauses, then between words, and still fits', () => {
  const clause = 'and a clause that goes on for quite a while';
  const raw = `Begin ${Array.from({ length: 10 }, () => clause).join(', ')}.`;
  const result = autoSplitText(raw);
  assert.ok(fitsAll(result.slides));
  assert.equal(words(result.formattedText), words(raw));
  const unbroken = 'word '.repeat(120).trim();
  assert.ok(fitsAll(autoSplitText(unbroken).slides));
});

test('a full stop after a title, a book of the Bible or an initial does not end a sentence', () => {
  assert.deepEqual(sentencesOf('We read from Jn. 3 today. Then St. Paul speaks. John F. Doe came. So do I. Next.'), [
    'We read from Jn. 3 today.',
    'Then St. Paul speaks.',
    'John F. Doe came.',
    'So do I.',
    'Next.',
  ]);
});

test('the operator\'s blank lines are kept; only an overflowing block is cut', () => {
  const long = Array.from({ length: 7 }, (_, i) => `Overflowing line ${i + 1}`).join('\n');
  const result = autoSplitText(`Kept slide\n\n${long}`);
  assert.equal(result.slides[0], 'Kept slide');
  assert.ok(result.slideCount >= 3);
});

test('pasted text is tidied: Windows line ends, runs of spaces and extra blank lines', () => {
  assert.equal(normalizeText('  a   b\r\nc \t d\r\n\r\n\r\n\r\ne  '), 'a b\nc d\n\ne');
  assert.equal(autoSplitText('a  b').wasModified, true);
});

test('lines are counted as the projector wraps them', () => {
  assert.equal(wrappedLineCount('short', 45), 1);
  assert.equal(wrappedLineCount('aaaa bbbb cccc', 9), 2);
  assert.equal(wrappedLineCount('x'.repeat(100), 45), 3);
  assert.equal(wrappedLineCount('', 45), 1);
});

test('empty text makes no slides; bad options fall back to the defaults', () => {
  assert.deepEqual(autoSplitText('   \n\n '), { formattedText: '', slideCount: 0, slides: [], wasModified: true });
  assert.deepEqual(autoSplitText('a b c', { maxLinesPerSlide: 0, maxCharsPerLine: NaN }).slides, ['a b c']);
});

test('Smart Break cuts a stanza only when it is over the limits', () => {
  assert.equal(smartBreakParts('Line 1\nLine 2\nLine 3'), null);
  const parts = smartBreakParts(Array.from({ length: 8 }, (_, i) => `Line ${i + 1}`).join('\n'));
  assert.deepEqual(parts, ['Line 1\nLine 2\nLine 3\nLine 4', 'Line 5\nLine 6\nLine 7\nLine 8']);
});

test('the pre-air check only flags a slide the projector itself could not show', () => {
  const sixLines = Array.from({ length: 6 }, (_, i) => `A stanza line of moderate length ${i + 1}`).join('\n');
  assert.equal(needsSplit(sixLines), true);
  assert.equal(needsSplit(sixLines, ON_AIR_LIMITS), false);
  const huge = Array.from({ length: 12 }, (_, i) => `A stanza line of moderate length ${i + 1}`).join('\n');
  assert.equal(needsSplit(huge, ON_AIR_LIMITS), true);
  assert.ok(fitsAll(autoSplitText(huge, ON_AIR_LIMITS).slides, ON_AIR_LIMITS));
});

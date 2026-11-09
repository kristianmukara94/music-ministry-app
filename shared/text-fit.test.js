// Fitting a stanza to the slide: the largest size between the ceiling and the floor at which it fits, and tighter spacing for long stanzas.
// The real measuring runs in the projector window (src/output/useTextAutoFit.ts); these test its rules. Run with: node --test shared/text-fit.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fitFontSize, lineCountOf, lineHeightFor, titleFits } from './text-fit.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

/** A text that fits at `limit` px and below, as a box would measure it. */
const fitsUpTo = (limit) => (px) => px <= limit;

test('text that fits at its own size keeps it: a short chorus is never made bigger', () => {
  assert.equal(fitFontSize(88, 40, fitsUpTo(200)), 88);
});

test('a long verse is shrunk to the largest whole pixel that fits', () => {
  assert.equal(fitFontSize(88, 40, fitsUpTo(61)), 61);
  assert.equal(fitFontSize(88, 40, fitsUpTo(87)), 87);
  assert.equal(fitFontSize(88, 40, fitsUpTo(40)), 40);
});

test('a verse too long even at the floor stays at the floor, so it stays legible and the box clips the rest', () => {
  assert.equal(fitFontSize(88, 40, fitsUpTo(12)), 40);
});

test('the search measures a handful of times, not once per pixel', () => {
  let calls = 0;
  fitFontSize(200, 20, (px) => {
    calls += 1;
    return px <= 73;
  });
  assert.ok(calls <= 10, `measured ${calls} times`);
});

test('a floor above the ceiling, or no room at all, does not break the fit', () => {
  assert.equal(fitFontSize(30, 50, fitsUpTo(10)), 30, 'the ceiling wins');
  assert.equal(fitFontSize(0, 10, fitsUpTo(10)), 0);
});

test('line spacing tightens as a stanza gets longer, from 1.25 to 1.15', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 12].map(lineHeightFor), [1.25, 1.25, 1.2, 1.2, 1.18, 1.18, 1.15, 1.15]);
  assert.equal(lineCountOf('a\nb\n\nc'), 4, 'a blank line counts');
  assert.equal(lineCountOf(''), 1);
});

test('a title over a body keeps to two lines and a quarter of the room', () => {
  assert.equal(titleFits(220, 100, 1.1, 1000), true, 'two lines, within the share');
  assert.equal(titleFits(330, 100, 1.1, 2000), false, 'three lines is too many, whatever the room');
  assert.equal(titleFits(220, 100, 1.1, 800), false, 'two lines, but more than a quarter of the room');
});

test('a prayer or document slide is fitted title first, and stays inside its safe box', () => {
  const view = read('src/output/ProjectorView.tsx');
  assert.match(view, /useHeadedTextFit\(\{ boxRef, titleRef, bodyRef, titleSize, bodySize, deps: \[headline, body, style, slideFont\] \}\);/);
  assert.match(view, /\{before > 0 && <div aria-hidden style=\{\{ flex: `0 1 \$\{before\}cqh` \}\} \/>\}/, 'the space above gives way before the text shrinks');
  const hook = read('src/output/useHeadedTextFit.ts');
  assert.match(hook, /const room = roomHeight - titleBlock;/, 'the body gets what the title leaves');
  assert.match(hook, /const ceiling = Math\.min\(natural, titlePx\);/, 'the body is never larger than a shrunk title');
  assert.match(hook, /new ResizeObserver\(\(\) => fit\(\)\)/, 'it fits again when the window changes size');
});

test('the psalm, the lineup face and the rosary are bounded too, and the rosary floor follows the slide', () => {
  const view = read('src/output/ProjectorView.tsx');
  assert.match(view, /<TextLines safe inset=\{false\} serif /, 'a psalm page is fitted under its response');
  assert.match(view, /const min = width \* 0\.018;/, 'the rosary floor is a share of the slide, not of the window');
  assert.doesNotMatch(view, /window\.innerWidth/);
  assert.match(read('src/praise-worship/PwSlideFace.tsx'), /useProjectorTextAutoFit\(/, 'the lineup face steps down rather than running into the footer');
});

test('the page counts sit over the text margin and never take a click', () => {
  const view = read('src/output/ProjectorView.tsx');
  assert.equal((view.match(/pointer-events-none absolute right-\[4cqw\] bottom-\[\d+cqh\] z-20/g) ?? []).length, 4, 'psalm, prayer, deck and the preview count');
  assert.doesNotMatch(read('src/golive/MassLiveView.tsx'), /right-2 bottom-2/, 'the preview count is drawn inside the slide');
});

test('the projector, the mirror and the previews draw a song stanza through the fitted slide', () => {
  const view = read('src/output/ProjectorView.tsx');
  assert.match(view, /case 'lyrics':\s+return <SongLyricsSlide /);
  assert.match(view, /useTextAutoFit\(\{ boxRef, textRef, reservedRef: labelRef, naturalSize, deps: \[shown, style, slideFont, label\] \}\);/, 'it fits again when the label is hidden or shown');
  assert.match(view, /className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden px-\[6cqw\] py-\[4cqh\] text-center"/, 'centred both ways, padded 4% and 6%, and clipped');
  assert.match(view, /lineHeight: lineHeightFor\(lineCountOf\(shown\)\)/);
  const hook = read('src/output/useTextAutoFit.ts');
  assert.match(hook, /export const FIT_HEIGHT_SHARE = 0\.9;/, 'the text takes at most 90% of the room');
  assert.match(hook, /new ResizeObserver\(\(\) => fit\(\)\)/, 'it fits again when the window changes size');
  assert.match(hook, /text\.style\.fontSize = naturalSize;/, 'each fit starts from the size the song is set for');
  assert.match(hook, /text\.style\.maxHeight = `\$\{Math\.floor\(roomHeight\)\}px`;/, 'the fail-safe clips inside the room');
});

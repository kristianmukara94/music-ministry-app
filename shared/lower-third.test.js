// The Praise & Worship lower third: it sits in the lower band of the frame on the lyrics' margins, a long title and composer wrap inside the band by the
// shared rule, the live preview, the projector and the livestream draw it with one layout, and turning it on and off still works.
// Run with: node --test shared/lower-third.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SOFT_BREAK, slideText } from './text-wrap.js';
import { LOWER_THIRD_BAND, LOWER_THIRD_MIN, LYRIC_PX, bandComposerChars, bandTitleChars, composerFor } from './lower-third-layout.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const TITLE = 'Praise to the Lord, the Almighty, the King of Creation, O my soul, praise Him in every light and every tongue';
const COMPOSER = 'Joachim Neander, Composer and Translator of the Hymn';
const WIDE_WORD = 'qwewqewewqewqwqewqewqewqeasdsadasdasdasdsasd';
const withoutSoftBreaks = (s) => s.split(SOFT_BREAK).join('');

test('the band is anchored to the bottom of the frame, on the lyrics’ side margin and footer line', () => {
  const face = read('src/praise-worship/PwSlideFace.tsx');
  assert.match(face, /inset-x-\[6cqw\]/, 'the lyrics use a 6% side margin');
  assert.match(face, /bottom-\[3\.938cqw\]/, 'the slide footer sits 7% of the frame height from the bottom (3.938cqw on a 16:9 frame)');
  assert.equal(LOWER_THIRD_BAND.left, 6, 'the band uses the same side margin');
  assert.equal(LOWER_THIRD_BAND.bottom, 7, 'the band sits on the same bottom line');
});

test('the band is in the lower part of the frame, not the top centre', () => {
  assert.ok(LOWER_THIRD_BAND.bottom < 50, 'anchored to the bottom');
  assert.equal(LOWER_THIRD_BAND.left + LOWER_THIRD_BAND.width + LOWER_THIRD_BAND.left, 100, 'the band spans the frame between its margins');
});

test('the title and the composer are drawn at the lyric size’s proportions, and legibly', () => {
  assert.equal(LOWER_THIRD_BAND.titlePx, Math.round(LYRIC_PX * 0.75));
  assert.equal(composerFor(LOWER_THIRD_BAND.titlePx), 38, 'the composer at full size is about half the title');
  assert.ok(LOWER_THIRD_BAND.titlePx >= 60, 'the title is at least 60px on the 1920 stage');
  assert.ok(composerFor(LOWER_THIRD_BAND.titlePx) >= 30, 'the composer is at least 30px on the 1920 stage');
  assert.ok(LOWER_THIRD_MIN.composerPx >= 24, 'the smallest composer is at least 24px');
});

test('a title with a word too wide for the band breaks that word inside the band, and every part fits the band width', () => {
  const chars = bandTitleChars();
  const wide = `${TITLE} ${WIDE_WORD}${WIDE_WORD}`;
  const drawn = slideText(wide, chars);
  // Spaces wrap the browser's own way; within a word, only the break opportunities split it. Check each piece between either.
  const parts = drawn.split(/[ ​]/);
  assert.ok(drawn.split(SOFT_BREAK).length > 2, 'the wide word has break opportunities');
  for (const part of parts) assert.ok(part.length <= chars, `part "${part}" fits the band`);
  assert.equal(withoutSoftBreaks(drawn), wide, 'no characters are lost');
});

test('a title of normal words is unchanged: the browser wraps it at the spaces, inside the band', () => {
  assert.equal(slideText(TITLE, bandTitleChars()), TITLE);
});

test('a composer with a word too wide for the band breaks that word inside the band; a normal composer is unchanged', () => {
  const chars = bandComposerChars();
  const wide = `Joachim ${WIDE_WORD} Neander`;
  const drawn = slideText(wide, chars);
  for (const part of drawn.split(SOFT_BREAK)) assert.ok(part.length <= chars, `part "${part}" fits the band`);
  assert.equal(withoutSoftBreaks(drawn), wide);
  assert.equal(slideText(COMPOSER, chars), COMPOSER, 'a composer that fits is unchanged');
});

test('the live preview, the projector and the livestream draw the band with one layout', () => {
  const view = read('src/output/LowerThirdView.tsx');
  assert.match(view, /if \(value\.template === 'segment'\) \{[\s\S]*LOWER_THIRD_BAND\.bottom/, 'the segment band is placed in LowerThirdStage');
  assert.match(view, /export function LowerThirdView[\s\S]*<LowerThirdStage/, 'the livestream lower-third view draws through LowerThirdStage');
  assert.match(view, /export function LowerThirdOverlay[\s\S]*<LowerThirdStage/, 'the projector overlay draws through LowerThirdStage');
  assert.match(read('src/praise-worship/LiveView.tsx'), /<LowerThirdStage value=\{live\.lowerThird\.live\}/, 'the live preview draws through LowerThirdStage');
  assert.match(read('src/output/ProjectorView.tsx'), /<LowerThirdOverlay value=\{lowerThirdValue\}/, 'the projector draws the overlay');
});

test('turning the lower third on and off still works', () => {
  const view = read('src/output/LowerThirdView.tsx');
  assert.match(view, /export function LowerThirdOverlay[\s\S]*if \(!shown\) return null;/, 'nothing is drawn when no lower third is shown');
  assert.match(view, /export function useFadedLowerThird/, 'the fade in and out is unchanged');
  assert.match(view, /transition-opacity duration-300/, 'the lower third still fades');
});

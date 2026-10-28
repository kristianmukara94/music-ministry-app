// Slide text wrap: a word wider than a line is broken inside, only where it cannot fit; normal words break at spaces as before; a prayer
// with a long word splits without losing or repeating a character; the fit counts the broken word; and every screen that draws slide
// text uses the same rule. Run with: node --test shared/text-wrap.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SOFT_BREAK, charsPerLine, slideLine, slideText } from './text-wrap.js';
import { fitsPrayerSlide, LINEUP_PRAYER_FIT, prayerPages, prayerTextHeight, visualLinesOf } from './prayer-fit.js';

const LONG = 'qwewqewewqewqwqewqewqewqeasdsadasdasdsasd'; // 42 characters, wider than a 29-character line
const withoutSoftBreaks = (s) => s.split(SOFT_BREAK).join('');
const parts = (s) => s.split(SOFT_BREAK);

test('a single word wider than the line is broken, and every part fits the line width', () => {
  const chars = 29;
  const drawn = slideLine(LONG, chars);
  assert.ok(drawn.includes(SOFT_BREAK), 'the word has break opportunities');
  for (const part of parts(drawn)) assert.ok(part.length <= chars, `part "${part}" fits the line`);
  assert.equal(withoutSoftBreaks(drawn), LONG, 'no character is added or lost');
});

test('normal sentences still break at word boundaries, with no break inside any word', () => {
  const sentence = 'Lord God, we ask you to take authority over every power that would turn our hearts away';
  assert.equal(slideLine(sentence, 29), sentence, 'nothing changes for words that fit');
  assert.equal(slideLine('hold the words that fit', 29), 'hold the words that fit');
});

test('only the word that is too wide is broken; the words around it are untouched', () => {
  const drawn = slideLine(`before ${LONG} after`, 29);
  const words = drawn.split(' ');
  assert.equal(words[0], 'before');
  assert.equal(words[2], 'after');
  assert.ok(words[1].includes(SOFT_BREAK));
  assert.equal(withoutSoftBreaks(drawn), `before ${LONG} after`);
});

test('a word of exactly the line length is not broken', () => {
  const exact = 'a'.repeat(29);
  assert.equal(slideLine(exact, 29), exact);
});

test('slide text keeps its own line breaks, and breaks each long word on its own line', () => {
  const text = `first line\n${LONG}\nlast`;
  const drawn = slideText(text, 29).split('\n');
  assert.equal(drawn.length, 3);
  assert.equal(withoutSoftBreaks(drawn[1]), LONG);
});

test('a prayer with a long word splits without losing or repeating any character', () => {
  const prayer = `Lord, hear us.\n\n${'x'.repeat(40)}${LONG}${'y'.repeat(300)} amen.`;
  const pages = prayerPages(prayer);
  assert.ok(pages.length > 1);
  for (const page of pages) assert.ok(fitsPrayerSlide(page), 'each page fits the slide');
  const rejoined = pages.join('').replace(/\s/g, '');
  assert.equal(rejoined, prayer.replace(/\s/g, ''), 'every character appears once, in order');
});

test('the fit counts a broken word by the lines it takes', () => {
  const { charsPerLine: chars } = LINEUP_PRAYER_FIT;
  const word = 'z'.repeat(chars * 3 + 5);
  assert.equal(visualLinesOf(word, chars), 4, 'a word of three lines and a bit takes four lines');
  assert.equal(prayerTextHeight(word), 4 * LINEUP_PRAYER_FIT.lineHeightPx);
});

test('the live preview, the projector and the lineup use the same rule for the same text at the same size', () => {
  // The same call, with the same column share and size, gives the same lines on every screen.
  const projector = slideText(LONG, charsPerLine(0.86, 80));
  const preview = slideText(LONG, charsPerLine(0.86, 80));
  assert.equal(projector, preview);
  const lineup = slideText(LONG, charsPerLine(0.88, 96));
  assert.equal(withoutSoftBreaks(lineup), LONG);
});

test('each screen that draws slide text imports the shared rule', () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
  for (const file of ['src/output/ProjectorView.tsx', 'src/praise-worship/PwSlideFace.tsx', 'src/announcements/TextSlideModal.tsx']) {
    assert.match(read(file), /from '\.\.\/\.\.\/shared\/text-wrap\.js'/, `${file} uses the shared wrap rule`);
  }
});

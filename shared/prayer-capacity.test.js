// The prayer's real capacity on the 1920 x 1080 stage, at full size, and the split that uses it. The widths are the lineup face's measured
// widths (Cormorant Garamond, 600, 96px); the line counts are checked against the lines the browser drew. A split holds whole sentences,
// is balanced, keeps every word, and is the same on every surface. Run with: node --test shared/prayer-capacity.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrappedLineCount, textWidthEm } from './prayer-metrics.js';
import { prayerBlockHeightPx, prayerBoxPx, prayerSlidesFor, PRAYER_MAX_PX, PRAYER_WIDTH_SHARE } from './prayer-slides.js';
import { fitsScreen, screenPagesOf } from './prayer-screen.js';

const LINE_PX = PRAYER_MAX_PX * 1.25;
const words = (text) => String(text).split(/\s+/).filter(Boolean);

// The prayer as the lineup face drew it in the browser at 96px: its first paragraph in nine lines, the blank line, then four lines.
const SAMPLE = 'Lord God, we ask you to take authority over every power that would turn our hearts away from you and our families away from your house. Through the intercession of Saint Michael the Archangel, who stands before your throne, and of Our Lady, Queen of the Angels and the Saints, we pray that your Word be proclaimed without fear in this parish!\n\nHoly Spirit, fill this place with your presence and your peace; let every worship song lift the name of Jesus above all things. Who is like the Lord? No one. Amen.';
// Three copies of the sample, in paragraphs, for a prayer that takes many slides.
const LONG = [SAMPLE, SAMPLE, SAMPLE].join('\n\n');
const SAMPLE_FIRST_PARAGRAPH = SAMPLE.split('\n\n')[0];
const SAMPLE_SECOND_PARAGRAPH = SAMPLE.split('\n\n')[1];

const LINEUP_EM = (1920 * 0.88) / PRAYER_MAX_PX;
const SLIDE_EM = (1920 * PRAYER_WIDTH_SHARE) / PRAYER_MAX_PX;
const linesOfText = (text, maxEm = SLIDE_EM) => String(text).split('\n').reduce((n, line) => n + wrappedLineCount(line, maxEm), 0);
const SENTENCE = /[^.!?;:]+[.!?;:]+/g;

test('the widths are the measured widths: the first sentence is within 1% of the browser\'s 54.55em', () => {
  const sentence = 'Lord God, we ask you to take authority over every power that would turn our hearts away from you and our families away from your house.';
  const browserEm = 54.55;
  assert.ok(Math.abs(textWidthEm(sentence) - browserEm) / browserEm < 0.01, `${textWidthEm(sentence).toFixed(2)}em`);
});

test('the line count matches the browser: nine lines, a blank line, then four, at the lineup\'s width', () => {
  assert.equal(wrappedLineCount(SAMPLE_FIRST_PARAGRAPH, LINEUP_EM), 9);
  assert.equal(wrappedLineCount('', LINEUP_EM), 1, 'a blank line is one line');
  assert.equal(wrappedLineCount(SAMPLE_SECOND_PARAGRAPH, LINEUP_EM), 4);
});

test('the text box holds five full lines at full size, and not six', () => {
  const box = prayerBoxPx();
  assert.ok(box.height >= 5 * LINE_PX, `the box (${box.height}px) holds five lines (${5 * LINE_PX}px)`);
  assert.ok(box.height < 6 * LINE_PX, 'and not six, because the lower third\'s room is kept free');
  const five = Array.from({ length: 5 }, () => 'Amen.').join('\n');
  const six = Array.from({ length: 6 }, () => 'Amen.').join('\n');
  assert.equal(prayerBlockHeightPx(five, PRAYER_MAX_PX), 5 * LINE_PX);
  assert.ok(prayerBlockHeightPx(six, PRAYER_MAX_PX) > box.height);
});

test('(a) the prayer splits into the target count or fewer, and every sentence is whole unless it is longer than a slide', () => {
  const { pages } = prayerSlidesFor(SAMPLE, null);
  assert.ok(pages.length <= 8, `${pages.length} slides`);
  const box = prayerBoxPx().height;
  for (const [i, page] of pages.entries()) {
    if (i === pages.length - 1 || /[.!?;:]$/.test(page.text.trim())) continue;
    // The break is inside a sentence: that sentence must be too long for one slide.
    const tail = page.text.trim().slice(-20);
    const at = SAMPLE.indexOf(tail) + tail.length;
    const sentence = (SAMPLE.match(SENTENCE) || []).find((s) => SAMPLE.indexOf(s) <= at && at <= SAMPLE.indexOf(s) + s.length);
    assert.ok(prayerBlockHeightPx(sentence.trim(), PRAYER_MAX_PX) > box, `slide ${i + 1} breaks inside a sentence that fits a slide: "${sentence.trim()}"`);
  }
});

test('(b) every slide fills at least half the text area, except a short last slide', () => {
  const { pages } = prayerSlidesFor(SAMPLE, null);
  const half = prayerBoxPx().height / 2;
  for (const [i, page] of pages.entries()) {
    if (i === pages.length - 1) continue;
    assert.ok(prayerBlockHeightPx(page.text, PRAYER_MAX_PX) >= half, `slide ${i + 1} fills half the text area`);
  }
});

test('(c) no slide has more than seven lines', () => {
  for (const body of [SAMPLE, LONG]) {
    for (const page of prayerSlidesFor(body, null).pages) assert.ok(linesOfText(page.text) <= 7, `${linesOfText(page.text)} lines`);
  }
});

test('(d) no words are lost, repeated or reordered, in any split', () => {
  for (const body of [SAMPLE, LONG]) {
    const joined = prayerSlidesFor(body, null).pages.map((p) => p.text).join(' ');
    assert.deepEqual(words(joined), words(body));
  }
});

test('(e) every slide is drawn at the same size, and nothing shrinks', () => {
  for (const body of [SAMPLE, LONG]) {
    const { pages, fontPx } = prayerSlidesFor(body, null);
    assert.equal(fontPx, PRAYER_MAX_PX);
    for (const page of pages) assert.equal(page.fontPx, PRAYER_MAX_PX);
  }
});

test('(f) the Notes & Prayers full-screen view shows every slide of the split, and each one fits its screen', () => {
  const note = { title: 'Prayer to Take Authority', body: SAMPLE, style: null, split: null };
  const pages = screenPagesOf(note);
  assert.deepEqual(pages.map((p) => p.text), prayerSlidesFor(SAMPLE, null).pages.map((p) => p.text), 'the same break points');
  for (const page of pages) assert.ok(fitsScreen(page.text, note.title, page.fontPx), 'the slide fits the full-screen layout');
});

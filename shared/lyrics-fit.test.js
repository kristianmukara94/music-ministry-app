// Song lyrics on a lineup slide: a stanza of the Bible Enthronement size fits the slide with no overlap, every line sits inside the slide
// between the title badge and the footer, a longer stanza splits rather than overflows, the text is kept in order, and the preview and the
// projector draw the same layout. Run with: node --test shared/lyrics-fit.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TEMPLATE, segmentFromTemplate, slidesFor } from './pw.js';
import { LINEUP_LINE_HEIGHT, LINEUP_PRAYER_FIT, prayerTextHeight, fitsPrayerSlide, visualLinesOf } from './prayer-fit.js';

// The stage the lineup face is drawn on, in pixels: 1920 by 1080. The title badge sits at 7% of the height and the footer at 7% from the bottom.
const H = 1080;
const BADGE_BOTTOM = H * 0.07 + 40; // badge top plus its line (1.6% of the width, about 31px, with margin)
const FOOTER_TOP = H - H * 0.07 - 40;
const FONT = 96; // 5% of the width

// A stanza of the size on the Bible Enthronement slide: six lines, of which several wrap, twelve lines once drawn.
const STANZA = [
  'LINE ONE of the stanza that is fairly long so that it wraps across lines in the box',
  'LINE TWO sits here and is also quite long to test the wrap width of the lineup face',
  'LINE THREE',
  'LINE FOUR is another line of similar length to the others in this stanza',
  'LINE FIVE',
  'LINE SIX ends the stanza',
].join('\n');

const words = (text) => String(text).split(/\s+/).filter(Boolean);
const lyricsSlides = (text, n = 1) => {
  const hymn = { id: 5, title: 'Hail Mary', stanzas: Array.from({ length: n }, (_, i) => ({ id: i + 1, stanzaType: `Verse ${i + 1}`, lyricsText: text })) };
  const segment = { ...segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === 'marian_song')), content: { kind: 'song', hymnIds: [5], maxSongs: 1, category: null } };
  return slidesFor({ ...segment, cues: { ...segment.cues, titleFirst: false } }, { hymns: [hymn] }).filter((s) => s.kind === 'lyrics');
};

test('a stanza of the Bible Enthronement size is more than one lineup slide, and every slide fits the slide', () => {
  assert.ok(visualLinesOf(STANZA.split('\n')[0], LINEUP_PRAYER_FIT.charsPerLine) >= 3, 'the first line wraps');
  const slides = lyricsSlides(STANZA);
  assert.ok(slides.length > 1, `split into ${slides.length} slides`);
  for (const slide of slides) assert.ok(fitsPrayerSlide(slide.text), 'each slide fits the lineup slide');
});

test('the rendered block of every slide sits inside the slide, between the title badge and the footer', () => {
  for (const slide of lyricsSlides(STANZA)) {
    const height = prayerTextHeight(slide.text);
    const top = (H - height) / 2;
    const bottom = (H + height) / 2;
    assert.ok(height <= LINEUP_PRAYER_FIT.maxHeightPx, `height ${height} within the slide`);
    assert.ok(top > BADGE_BOTTOM, `top ${top} is below the title badge (${BADGE_BOTTOM})`);
    assert.ok(bottom < FOOTER_TOP, `bottom ${bottom} is above the footer (${FOOTER_TOP})`);
  }
});

test('the lines do not overlap: the line height is at least the font’s own ink (measured 1.10 em for this face)', () => {
  assert.ok(LINEUP_LINE_HEIGHT >= 1.1, `line height ${LINEUP_LINE_HEIGHT} em`);
  // The pitch between two lines is the line height times the font size.
  assert.ok(LINEUP_LINE_HEIGHT * FONT >= 1.1 * FONT);
});

test('a stanza with more lines splits, rather than overflowing or shrinking below the minimum', () => {
  const longer = Array.from({ length: 24 }, (_, i) => `Line ${i + 1} of a long stanza that wraps as well`).join('\n');
  const slides = lyricsSlides(longer);
  assert.ok(slides.length >= 3);
  for (const slide of slides) {
    assert.ok(fitsPrayerSlide(slide.text));
    assert.equal(slide.fontPx, 96, 'no shrinking: the lyrics keep the full size');
  }
});

test('no words are lost or repeated when a stanza is split', () => {
  const slides = lyricsSlides(STANZA);
  assert.deepEqual(words(slides.map((s) => s.text).join(' ')), words(STANZA));
});

test('a short stanza stays one slide, unchanged', () => {
  const short = 'Hail Mary, full of grace\nthe Lord is with thee';
  const slides = lyricsSlides(short);
  assert.equal(slides.length, 1);
  assert.equal(slides[0].text, short);
});

test('the preview and the projector draw song lyrics with the same layout, from one face and one line height', () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
  const face = read('src/praise-worship/PwSlideFace.tsx');
  assert.match(face, /LINEUP_LINE_HEIGHT/, 'the lineup face draws at the shared line height');
  assert.doesNotMatch(face, /leading-\[1\.18\]/, 'no separate line height for lyrics');
  // The live preview and the projector draw a lineup slide with that face. (The Library preview pane was removed earlier.)
  assert.match(read('src/output/ProjectorView.tsx'), /<PwSlideFace /, 'the projector draws lineup slides with it');
  assert.match(read('src/praise-worship/LiveView.tsx'), /PwSlideFace|SlideThumb|CurrentNextPreview/, 'the live console draws with it');
});

// Prayer slides: the split fits the slide, keeps every word once and in order, and leaves other segment types alone.
// Run with: node --test shared/prayer-pages.test.js
import { prayerSlidesFor } from './prayer-slides.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TEMPLATE, PRAYER_FIT_CHARS, PRAYER_FIT_LINES, PRAYER_PLACEHOLDER, fitsPrayerSlide, pagesOf, prayerPages, segmentFromTemplate, slidesFor } from './pw.js';

// A synthetic prayer of long lines, in two paragraphs. It is not the church's wording.
const LONG = [
  'Lord God, we ask you to take authority over every power that would turn our hearts away from you and our families away from your house,',
  'through the intercession of Saint Michael the Archangel, who stands before your throne, and of Our Lady, Queen of the Angels and the Saints,',
  'we pray that your Word be proclaimed without fear in this parish, and that every heart here be made ready to receive your mercy tonight.',
  'Amen.',
  '',
  'Holy Spirit, fill this place with your presence and your peace, and let every worship song lift the name of Jesus above all things.',
].join('\n');

const words = (text) => String(text).split(/\s+/).filter(Boolean);

test('the fit limits come from the fixed slide size: 29 characters a line, 6 lines a slide', () => {
  assert.equal(PRAYER_FIT_CHARS, 29);
  assert.equal(PRAYER_FIT_LINES, 6);
});

test('a long prayer splits into several slides, and every slide fits', () => {
  const pages = prayerPages(LONG);
  assert.ok(pages.length > 2, `split into ${pages.length} slides`);
  for (const [n, page] of pages.entries()) assert.ok(fitsPrayerSlide(page), `slide ${n + 1} fits`);
});

test('the old split would have left the first slide over the fit limit', () => {
  assert.equal(fitsPrayerSlide(pagesOf(LONG)[0]), false);
});

test('no words are lost or repeated across the split', () => {
  const pages = prayerPages(LONG);
  assert.deepEqual(words(pages.join('\n')), words(LONG));
});

test('a paragraph break always starts a new slide', () => {
  const pages = prayerPages(LONG);
  const beforeParagraph = pages.findIndex((p) => p.startsWith('Holy Spirit'));
  assert.ok(beforeParagraph > 0, 'the second paragraph is not on a slide with the first');
  assert.ok(!pages[beforeParagraph - 1].includes('Holy Spirit'));
});

test('a short prayer stays as one slide, unchanged', () => {
  const short = 'Lord, hear our prayer.\nGrant us your peace.\nAmen.';
  assert.deepEqual(prayerPages(short), [short]);
});

test('a single line too long for a slide is broken at word boundaries, and each piece fits', () => {
  const longLine = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
  const pages = prayerPages(longLine);
  assert.ok(pages.length > 1);
  for (const page of pages) {
    assert.ok(fitsPrayerSlide(page));
    for (const w of words(page)) assert.match(w, /^word\d+$/, 'no word is cut in half');
  }
  assert.deepEqual(words(pages.join(' ')), words(longLine));
});

test('a prayer segment shows one slide per page, and the preview navigation keeps working', () => {
  const seg = segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === 'prayer_authority'));
  // The title slide comes first when its cue is on; the prayer slides are the rest.
  const slides = slidesFor(seg, { prayer: { title: 'Prayer', body: LONG } }).filter((s) => s.kind === 'prayer');
  // The lineup shows the shared prayer split: the same slides, in the same order, at one size.
  const pages = prayerSlidesFor(LONG, null).pages;
  assert.equal(slides.length, pages.length);
  assert.deepEqual(slides.map((s) => s.text), pages.map((p) => p.text));
  assert.equal(new Set(slides.map((s) => s.fontPx)).size, 1);
});

test('an empty prayer shows the placeholder slide', () => {
  const seg = segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === 'prayer_authority'));
  const slides = slidesFor(seg, { prayer: { title: 'Prayer', body: '   ' } }).filter((s) => s.kind === 'prayer');
  assert.deepEqual(slides.map((s) => s.text), [PRAYER_PLACEHOLDER]);
  assert.equal(slides[0].placeholder, true);
});

test('readings keep their own split, unchanged', () => {
  const reading = Array.from({ length: 7 }, (_, i) => `Line ${i + 1}`).join('\n');
  const seg = segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === 'gospel_acclamation'));
  const slides = slidesFor(seg, { reading: { citation: 'Psalm 1', rawText: reading } }).filter((s) => s.kind === 'prayer');
  assert.deepEqual(slides.map((s) => s.text), pagesOf(reading));
});

// Prayer and song text at full size: no slide is shrunk; a page that does not fit is split, with no words lost or repeated; with the lower third on,
// the text stays at full size and the band sits below it; the alignment is the same on every surface; songs and prayers keep full size; and
// turning the band on or off does not change the text size. Run with: node --test shared/full-size.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TEMPLATE, segmentFromTemplate, slidesFor } from './pw.js';
import { prayerSlidesFor, PRAYER_MAX_PX } from './prayer-slides.js';
import { LOWER_THIRD_MIN, STAGE_H, bandHeightPx, fitBand } from './lower-third-layout.js';
import { bandSizesBelow, lyricBottomOf, roomBelowPx } from './lyric-area.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const words = (text) => String(text).split(/\s+/).filter(Boolean);
const BAND = { line1: 'Praise to the Lord, the Almighty, the King of Creation', line2: 'Joachim Neander' };

const LONG_PRAYER = Array.from(
  { length: 30 },
  (_, i) => `Lord, we ask you for sentence number ${i + 1}, and we pray that your mercy stays with this parish today.`,
).join(' ');
const STANZA = Array.from({ length: 14 }, (_, i) => `Line ${i + 1} of the stanza wraps across the box as it is drawn`).join('\n');

function songSlides(text, band) {
  const hymn = { id: 5, title: 'Hail Mary', stanzas: [{ id: 1, stanzaType: 'Verse 1', lyricsText: text }] };
  const segment = { ...segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === 'marian_song')), content: { kind: 'song', hymnIds: [5], maxSongs: 1, category: null } };
  return slidesFor({ ...segment, cues: { ...segment.cues, titleFirst: false } }, { hymns: [hymn] }, { band }).filter((s) => s.kind === 'lyrics');
}
function prayerSlides(text, band) {
  const segment = { ...segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === 'prayer_authority')) };
  return slidesFor({ ...segment, cues: { ...segment.cues, titleFirst: false } }, { prayer: { title: 'Prayer', body: text, split: null, align: 'center' } }, { band }).filter((s) => s.kind === 'prayer');
}

test('a long prayer has no shrunken slide: every slide is at full size', () => {
  const { pages, fontPx } = prayerSlidesFor(LONG_PRAYER, null);
  assert.equal(fontPx, PRAYER_MAX_PX);
  assert.ok(pages.length > 1, `split into ${pages.length} slides`);
  for (const page of pages) assert.equal(page.fontPx, PRAYER_MAX_PX, 'full size');
  const face = read('src/praise-worship/PwSlideFace.tsx');
  assert.doesNotMatch(face, /lyricFontPx|LYRIC_FLOOR_PX|fontPx \/ 19\.2\}cqw`\s*:\s*`/, 'the face does not shrink text to fit');
});

test('a page that does not fit at full size is split into more slides, and no words are lost or repeated', () => {
  const { pages } = prayerSlidesFor(LONG_PRAYER, null);
  assert.deepEqual(words(pages.map((p) => p.text).join(' ')), words(LONG_PRAYER));
  const single = prayerSlidesFor('A short prayer.', null).pages;
  assert.equal(single.length, 1, 'a short prayer stays one slide');
});

test('with the lower third on, the text stays at full size and the band sits below it, with no overlap', () => {
  for (const text of [STANZA, LONG_PRAYER]) {
    const slides = text === STANZA ? songSlides(text, BAND) : prayerSlides(text, BAND);
    assert.ok(slides.length >= 1);
    for (const slide of slides) {
      assert.equal(slide.fontPx, PRAYER_MAX_PX, 'the text is at full size');
      const bottom = lyricBottomOf({ kind: 'pw', slide });
      const sizes = bandSizesBelow(BAND, bottom);
      const band = fitBand(BAND, roomBelowPx(bottom * STAGE_H));
      assert.ok(band, 'the band fits below the text, down to its minimum');
      assert.ok(sizes.titlePx >= LOWER_THIRD_MIN.titlePx, 'the band never goes below its minimum');
      const bandTop = STAGE_H * (1 - 0.07) - bandHeightPx(BAND, sizes.titlePx);
      assert.ok(bottom * STAGE_H <= bandTop + 0.5, `the text ends (${bottom * STAGE_H}px) above the band (${bandTop}px)`);
    }
  }
});

test('the alignment is the same on every surface: the notes preview, the full-screen view, the lineup, the live preview and the projector', () => {
  assert.match(read('src/praise-worship/PwSlideFace.tsx'), /textAlign: slide\.align \?\? 'center'/, 'the lineup face, the live preview and the projector');
  assert.match(read('src/praise-worship/store.ts'), /align: note\.style\?\.textAlign \?\? 'center'/, 'the note\'s alignment reaches the lineup');
  assert.match(read('src/notes/present.ts'), /style: \{ \.\.\.note\.style, fontSize: page\.fontPx \}/, 'the full-screen view keeps the note\'s alignment');
  assert.match(read('src/notes/NotesPrayersView.tsx'), /style=\{\{ \.\.\.sanitizeTextStyle\(current\.style\), fontSize: screen\[shown\]\?\.fontPx \}\}/, 'the notes preview keeps the note\'s alignment');
  assert.match(read('src/output/ProjectorView.tsx'), /textAlign: style\?\.textAlign \?\? undefined/, 'the projector text keeps the note\'s alignment');
});

test('songs and prayers keep the full size', () => {
  for (const slide of songSlides(STANZA, null)) assert.equal(slide.fontPx, PRAYER_MAX_PX, 'a song page');
  for (const slide of prayerSlides(LONG_PRAYER, null)) assert.equal(slide.fontPx, PRAYER_MAX_PX, 'a prayer page');
});

test('turning the band on and off does not change the text size', () => {
  const offSongs = songSlides(STANZA, null).map((s) => s.fontPx);
  const onSongs = songSlides(STANZA, BAND).map((s) => s.fontPx);
  assert.deepEqual(new Set([...offSongs, ...onSongs]), new Set([PRAYER_MAX_PX]));
  const offPrayers = prayerSlides(LONG_PRAYER, null);
  const onPrayers = prayerSlides(LONG_PRAYER, BAND);
  assert.deepEqual(offPrayers.map((s) => s.fontPx), onPrayers.map((s) => s.fontPx));
  assert.deepEqual(offPrayers.map((s) => s.text), onPrayers.map((s) => s.text), 'the prayer split does not depend on the band');
});

// Pagination follows the operator's text size. At 70%, 100%, 120% and 150%, long lyrics and prayers split into pages that fit the 16:9 frame; a
// larger size makes more pages, a smaller one makes fewer; and at 100% the pages are the ones the app laid out before the control existed.
// Run with: node --test shared/pagination-scale.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TEMPLATE, segmentFromTemplate, slidesFor } from './pw.js';
import { PRAYER_MAX_PX, prayerSlidesFor } from './prayer-slides.js';
import { LINEUP_LINE_HEIGHT, prayerTextHeight, visualLinesOf } from './prayer-fit.js';
import { lineupFitAt, lyricPagesFor } from './lyric-area.js';
import { LYRIC_PX, STAGE_H } from './lower-third-layout.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const SCALES = [0.7, 1, 1.2, 1.5];
const STANZA = Array.from({ length: 14 }, (_, i) => `Line ${i + 1} of the stanza wraps across the box as it is drawn`).join('\n');
const LONG_PRAYER = Array.from(
  { length: 30 },
  (_, i) => `Lord, we ask you for sentence number ${i + 1}, and we pray that your mercy stays with this parish today.`,
).join(' ');

/** The most visual lines any one page of the split takes, at the scale. */
function maxLinesPerPage(pages, scale) {
  const fit = lineupFitAt(LYRIC_PX, undefined, scale);
  return Math.max(...pages.map((page) => page.split('\n').reduce((n, line) => n + visualLinesOf(line, fit.charsPerLine), 0)));
}

test('lyrics split into more pages as the size grows, and into fewer as it shrinks', () => {
  const counts = SCALES.map((s) => lyricPagesFor(STANZA, null, s).length);
  assert.ok(counts[0] <= counts[1], '70% is no more pages than 100%');
  assert.ok(counts[1] <= counts[2], '120% is no fewer pages than 100%');
  assert.ok(counts[2] <= counts[3], '150% is no fewer pages than 120%');
  assert.ok(counts[3] > counts[1], 'at 150% the stanza is split into more pages than at 100%');
});

test('every lyric page fits the frame at each scale, so nothing overflows', () => {
  for (const scale of SCALES) {
    for (const page of lyricPagesFor(STANZA, null, scale)) {
      const height = prayerTextHeight(page, lineupFitAt(LYRIC_PX, undefined, scale));
      assert.ok(height <= STAGE_H * 0.7, `a page at ${scale * 100}% is ${height}px, within the ${STAGE_H * 0.7}px limit`);
    }
  }
});

test('the lines a page holds fall with the size, in proportion: about the base count divided by the scale', () => {
  const base = maxLinesPerPage(lyricPagesFor(STANZA, null, 1), 1);
  for (const scale of [1.2, 1.5]) {
    const lines = maxLinesPerPage(lyricPagesFor(STANZA, null, scale), scale);
    assert.ok(lines <= Math.floor(base / scale) + 1, `at ${scale * 100}% a page holds ${lines} lines, about ${base}/${scale}`);
    assert.ok(lines < base, `at ${scale * 100}% a page holds fewer lines than at 100%`);
  }
});

test('at 100% the lyric pages are the same as before the control existed', () => {
  assert.deepEqual(lyricPagesFor(STANZA, null, 1), lyricPagesFor(STANZA, null));
});

test('prayers split into more pages as the size grows, and every page fits', () => {
  const counts = SCALES.map((s) => prayerSlidesFor(LONG_PRAYER, null, s).pages.length);
  assert.ok(counts[0] <= counts[1] && counts[1] <= counts[2] && counts[2] <= counts[3]);
  assert.ok(counts[3] > counts[1]);
  for (const scale of SCALES) {
    const result = prayerSlidesFor(LONG_PRAYER, null, scale);
    assert.equal(result.tooLong, false, `at ${scale * 100}% no page is too long for the slide`);
    assert.ok(result.pages.every((page) => page.fontPx === PRAYER_MAX_PX), 'each page keeps the normal size; the surface applies the scale');
  }
});

test('at 100% the prayer pages are the same as before the control existed', () => {
  assert.deepEqual(prayerSlidesFor(LONG_PRAYER, null, 1), prayerSlidesFor(LONG_PRAYER, null));
});

test('a song at 150% has more lyric slides than at 100%, and each one fits', () => {
  const hymn = { id: 5, title: 'Hail Mary', stanzas: [{ id: 1, stanzaType: 'Verse 1', lyricsText: STANZA }] };
  const segment = { ...segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === 'marian_song')), content: { kind: 'song', hymnIds: [5], maxSongs: 1, category: null } };
  const lyricsAt = (scale) => slidesFor({ ...segment, cues: { ...segment.cues, titleFirst: false } }, { hymns: [hymn] }, { scale }).filter((s) => s.kind === 'lyrics');
  assert.ok(lyricsAt(1.5).length > lyricsAt(1).length, 'more song slides at 150%');
  for (const slide of lyricsAt(1.5)) assert.ok(prayerTextHeight(slide.text, lineupFitAt(LYRIC_PX, undefined, 1.5)) <= STAGE_H * 0.7);
});

test('a prayer at 150% has more slides than at 100%, and the reading of a scripture slot follows the scale too', () => {
  const segment = segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === 'prayer_authority'));
  const prayerAt = (scale) =>
    slidesFor({ ...segment, cues: { ...segment.cues, titleFirst: false } }, { prayer: { title: 'Prayer', body: LONG_PRAYER, split: null, align: 'center' } }, { scale }).filter((s) => s.kind === 'prayer');
  assert.ok(prayerAt(1.5).length > prayerAt(1).length);
  assert.ok(prayerAt(0.7).length <= prayerAt(1).length);
});

test('the lineup and the Live panel page with the operator’s size, and the surfaces read it', () => {
  assert.match(read('src/praise-worship/live.ts'), /const scale = useLive\.getState\(\)\.state\.settings\.slideFontScale;/);
  assert.match(read('src/praise-worship/live.ts'), /slidesFor\(segment, resolvedFor\(segment, state\), \{ band, scale \}\)/);
  assert.match(read('src/operator/OperatorApp.tsx'), /useEffect\(\(\) => watchSlideScale\(\), \[\]\);/);
  // The line height grows with the size, so a larger page holds fewer lines.
  assert.equal(lineupFitAt(LYRIC_PX, undefined, 1.5).lineHeightPx, lineupFitAt(LYRIC_PX, undefined, 1).lineHeightPx * 1.5);
  assert.ok(LINEUP_LINE_HEIGHT > 1);
});

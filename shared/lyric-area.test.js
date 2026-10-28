// The lower third adapts to the lyrics; the lyrics never change size. With the band on: no lyric or prayer line sits under the band; the lyric size
// is the same with the band on and off; a page that leaves no room for the smallest band is split, and no words are lost or repeated; prayers
// follow the same rule; the preview and the projector use the same placement; turning the band on or off keeps the operator's place.
// Run with: node --test shared/lyric-area.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TEMPLATE, segmentFromTemplate, slidesFor } from './pw.js';
import { LOWER_THIRD_MIN, LYRIC_PX, STAGE_H, bandHeightPx, fitBand } from './lower-third-layout.js';
import { LYRIC_BAND_GAP_PX } from './lower-third-layout.js';
import { blockBottomPx, blockHeightPx, bandBeside, findSlideIndex, fitPagesToBand, lyricBottomOf, lyricPagesFor, maxBlockPx, roomBelowPx } from './lyric-area.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const words = (text) => String(text).split(/\s+/).filter(Boolean);
const BAND = { line1: 'Praise to the Lord, the Almighty, the King of Creation', line2: 'Joachim Neander' };
const SHORT = 'Hail Mary, full of grace\nthe Lord is with thee';
const LONG = Array.from({ length: 16 }, (_, i) => `Line ${i + 1} of the stanza wraps across the box as it is drawn`).join('\n');
const STANZA = [
  'LINE ONE of the stanza that is fairly long so that it wraps across lines in the box',
  'LINE TWO sits here and is also quite long to test the wrap width of the lineup face',
  'LINE THREE',
  'LINE FOUR is another line of similar length to the others in this stanza',
  'LINE FIVE',
  'LINE SIX ends the stanza',
].join('\n');

/** The stanza's slides as the live deck builds them, with the band on or off. */
function slidesWith(text, band) {
  const hymn = { id: 5, title: 'Hail Mary', stanzas: [{ id: 1, stanzaType: 'Verse 2', lyricsText: text }] };
  const segment = { ...segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === 'marian_song')), content: { kind: 'song', hymnIds: [5], maxSongs: 1, category: null } };
  return slidesFor({ ...segment, cues: { ...segment.cues, titleFirst: false } }, { hymns: [hymn] }, { band }).filter((s) => s.kind === 'lyrics');
}

test('the lyrics keep their size with the band on and off, and no slide carries a shrunken size', () => {
  const off = slidesWith(STANZA, null);
  const on = slidesWith(STANZA, BAND);
  for (const slide of [...off, ...on]) assert.equal(slide.fontPx, 96, 'the lyric size is the full size');
  assert.equal(blockHeightPx(off[0].text, LYRIC_PX), blockHeightPx(off[0].text, LYRIC_PX));
  assert.match(read('src/praise-worship/PwSlideFace.tsx'), /text-\[5cqw\] font-semibold/, 'the lyrics are drawn at the lineup size');
  assert.doesNotMatch(read('src/praise-worship/PwSlideFace.tsx'), /lyricFontPx|lyricArea/, 'nothing in the face shrinks the lyrics');
});

test('with the band on, every lyric line sits above the band', () => {
  for (const slide of slidesWith(STANZA, BAND)) {
    const bottom = blockBottomPx(slide.text, LYRIC_PX);
    const placed = bandBeside(slide.text, LYRIC_PX, BAND);
    assert.ok(placed, 'the band fits beside the page');
    assert.ok(bottom + LYRIC_BAND_GAP_PX + placed.heightPx <= STAGE_H - (7 / 100) * STAGE_H + 0.5, 'the band sits below the last line, inside the bottom margin');
    assert.ok(placed.heightPx <= roomBelowPx(bottom) + 0.5);
  }
});

test('a page that leaves no room for the smallest band is split, and no words are lost or repeated', () => {
  const pages = lyricPagesFor(LONG, BAND);
  assert.ok(pages.length > 1, `split into ${pages.length} slides`);
  for (const page of pages) assert.ok(blockHeightPx(page, LYRIC_PX) <= maxBlockPx(BAND) + 0.5, 'each part leaves room');
  assert.deepEqual(words(pages.join(' ')), words(LONG));
});

test('with the band off, the same stanza is split as it always was', () => {
  const off = slidesWith(LONG, null).map((s) => s.text);
  assert.deepEqual(words(off.join(' ')), words(LONG));
  assert.ok(off.length < slidesWith(LONG, BAND).length, 'the band adds parts only where the page needs room');
});

test('a short stanza stays one slide with the band on, unchanged', () => {
  assert.deepEqual(lyricPagesFor(SHORT, BAND), [SHORT]);
});

test('a prayer follows the same rule: its size is kept, and it is split only when a part leaves no room for the band', () => {
  const prayer = [{ text: LONG, fontPx: LYRIC_PX }];
  const fitted = fitPagesToBand(prayer, BAND);
  assert.ok(fitted.length > 1);
  for (const page of fitted) assert.equal(page.fontPx, LYRIC_PX, 'the prayer keeps its size');
  assert.deepEqual(words(fitted.map((p) => p.text).join(' ')), words(LONG));
  assert.deepEqual(fitPagesToBand([{ text: SHORT, fontPx: LYRIC_PX }], BAND), [{ text: SHORT, fontPx: LYRIC_PX }], 'a short prayer is unchanged');
  assert.equal(fitPagesToBand(prayer, null), prayer, 'without a band, nothing changes');
});

test('the band shrinks to fit the room, and never below the smallest size', () => {
  const big = fitBand(BAND, 10000);
  assert.equal(big.titlePx, 72, 'the full size when there is room');
  const tight = fitBand(BAND, bandHeightPx(BAND, LOWER_THIRD_MIN.titlePx));
  assert.equal(tight.titlePx, LOWER_THIRD_MIN.titlePx, 'the smallest size is the floor');
  assert.equal(fitBand(BAND, 10), null, 'no band fits in too little room');
});

test('the preview and the projector place the band from the same lyric bottom', () => {
  const frame = { kind: 'pw', slide: { kind: 'lyrics', text: SHORT, label: 'Verse 1', chip: 'V1', hymnId: 5, hymnTitle: 'Hail Mary', sectionId: '1', top: 0.3 } };
  assert.equal(lyricBottomOf(frame), 0.3 + blockHeightPx(SHORT, LYRIC_PX) / STAGE_H, 'the band sits below the text where it starts');
  assert.equal(lyricBottomOf({ kind: 'text' }), null, 'a note is not lyrics');
  assert.equal(lyricBottomOf({ kind: 'pw', slide: { kind: 'prayer', text: '', placeholder: true, label: 'x' } }), null, 'a placeholder has no text');
  assert.match(read('src/output/ProjectorView.tsx'), /lyricBottomShare=\{lyricBottomOf\(shownFrame\)\}/, 'the projector places the band from it');
  assert.match(read('src/praise-worship/LiveView.tsx'), /lyricBottomOf\(live\.projector\.live\)/, 'the live console places the band from it');
  assert.match(read('src/output/LowerThirdView.tsx'), /lyricBottomShare=\{lyricBottomOf\(onScreen\)\}/, 'the livestream places the band from it');
});

test('turning the band on or off keeps the operator’s place: the same stanza, and the same part of it', () => {
  const off = slidesWith(LONG, null);
  const on = slidesWith(LONG, BAND);
  const shown = off[Math.min(1, off.length - 1)];
  const index = findSlideIndex(on, shown);
  assert.notEqual(index, null);
  assert.equal(on[index].hymnId, shown.hymnId);
  assert.equal(on[index].position, shown.position, 'the same stanza');
  const back = findSlideIndex(off, on[index]);
  assert.equal(off[back].position, shown.position, 'and back again');
  assert.equal(findSlideIndex(on, { kind: 'lyrics', hymnId: 5, position: 99, part: 0 }), null, 'a stanza that is not there');
});

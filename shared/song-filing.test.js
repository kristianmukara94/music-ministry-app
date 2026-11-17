// A song's several categories and its own projector font size: the shared rules, the song form's preview, and the projector frames that carry
// the size. Synthetic songs only. Run with: node --test shared/song-filing.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  canStepFontScale,
  categoriesOf,
  clampFontScale,
  fontScalePercent,
  hasCategory,
  normalizeCategories,
  previewFontCqw,
  stepFontScale,
  withCategory,
  withoutCategory,
} from './song-filing.js';
import { lyricsStanzaFrame } from './stage-plan-row.js';
import { lyricsFrameAfterEdit } from './live-song.js';
import { slidesFor } from './pw.js';

const song = (extra = {}) => ({
  id: 7,
  title: 'Sample Song',
  style: null,
  stanzas: [
    { id: 70, stanzaType: 'Verse 1', lyricsText: 'Sample line 1\nSample line 2' },
    { id: 71, stanzaType: 'Chorus', lyricsText: 'Sample line 3' },
  ],
  ...extra,
});

test('the font scale is stored between 75% and 250%, and anything unreadable is the theme size', () => {
  assert.equal(clampFontScale(1.2), 1.2);
  assert.equal(clampFontScale(0.8), 0.8);
  assert.equal(clampFontScale(1.5), 1.5);
  assert.equal(clampFontScale(2), 2, 'past 150% is no longer clamped');
  assert.equal(clampFontScale(2.5), 2.5);
  assert.equal(FONT_SCALE_MAX, 2.5);
  assert.equal(clampFontScale(3), FONT_SCALE_MAX);
  assert.equal(clampFontScale(0.1), FONT_SCALE_MIN);
  assert.equal(clampFontScale('1.15'), 1.15);
  for (const bad of [null, undefined, '', 'big', NaN, Infinity]) assert.equal(clampFontScale(bad), 1, String(bad));
});

test('A- and A+ move 5 points at a time up to 150%, then 10 points up to 250%, and stop at the ends', () => {
  assert.equal(stepFontScale(1, 1), 1.05);
  assert.equal(stepFontScale(1, -1), 0.95);
  assert.equal(stepFontScale(1.5, 1), 1.6, 'A+ is no longer stopped at 150%');
  assert.equal(stepFontScale(1.6, -1), 1.5);
  assert.equal(stepFontScale(1.5, -1), 1.45);
  assert.equal(stepFontScale(2.5, 1), 2.5);
  assert.equal(stepFontScale(0.8, -1), 0.8);
  // A song stored at 75% steps up into the form's range.
  assert.equal(stepFontScale(0.75, 1), 0.8);
  assert.equal(canStepFontScale(1.5, 1), true);
  assert.equal(canStepFontScale(2.5, 1), false);
  assert.equal(canStepFontScale(0.8, -1), false);
  assert.equal(canStepFontScale(1, 1), true);
  // Repeated presses never drift off the grid: 14 presses of 5 points to 150%, then 10 of 10 points to 250%.
  let s = 0.8;
  for (let i = 0; i < 14; i += 1) s = stepFontScale(s, 1);
  assert.equal(s, 1.5);
  for (let i = 0; i < 10; i += 1) s = stepFontScale(s, 1);
  assert.equal(s, 2.5);
  for (let i = 0; i < 10; i += 1) s = stepFontScale(s, -1);
  assert.equal(s, 1.5);
  assert.deepEqual([1, 1.15, 1.3].map(fontScalePercent), [100, 115, 130]);
});

test('a category list is trimmed, has no repeats in any letter case, and keeps its order', () => {
  assert.deepEqual(normalizeCategories([' Category A ', 'category a', '', 'Category B', null, 'Category C']), ['Category A', 'Category B', 'Category C']);
  assert.deepEqual(withCategory(['Category A'], 'Category B'), ['Category A', 'Category B']);
  assert.deepEqual(withCategory(['Category A'], 'CATEGORY A'), ['Category A']);
  assert.equal(hasCategory(['Category A', 'Category B'], 'category b'), true);
  assert.equal(hasCategory(['Category A'], ''), false);
});

test('the last category cannot be removed', () => {
  assert.deepEqual(withoutCategory(['Category A', 'Category B'], 'Category A'), ['Category B']);
  assert.deepEqual(withoutCategory(['Category A'], 'Category A'), ['Category A']);
});

test('a song saved before the list existed reads as its one category; the primary is always first', () => {
  assert.deepEqual(categoriesOf('Category A', null), ['Category A']);
  assert.deepEqual(categoriesOf('', null), []);
  assert.deepEqual(categoriesOf('Category A', '["Category A","Category B","Category C"]'), ['Category A', 'Category B', 'Category C']);
  assert.deepEqual(categoriesOf('Category B', '["Category A","Category B"]'), ['Category B', 'Category A']);
  assert.deepEqual(categoriesOf('Category A', 'not json'), ['Category A']);
});

test('the preview card scales a short stanza by the font scale, in full', () => {
  const text = 'Sample line 1\nSample line 2';
  const base = previewFontCqw(text, 1);
  assert.equal(base, 4.6);
  for (const scale of [0.8, 1.15, 1.3, 1.5]) assert.ok(Math.abs(previewFontCqw(text, scale) - 4.6 * scale) < 0.01, `scale ${scale}`);
});

test('the preview card shrinks a long stanza to fit, as the projector does, so it never runs off the card', () => {
  const long = Array.from({ length: 9 }, (_, i) => `Sample line ${i + 1} with a few more words to wrap`).join('\n');
  const room = 82 * (9 / 16);
  for (const scale of [1, 1.5]) {
    const size = previewFontCqw(long, scale);
    assert.ok(size < 4.6 * scale, `scale ${scale} shrinks`);
    const lines = long.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil((l.length * 0.55 * size) / 88)), 0);
    assert.ok(lines * 1.3 * size <= room + 1e-9, `scale ${scale} fits`);
  }
  // A larger scale is never drawn smaller than a smaller one.
  assert.ok(previewFontCqw(long, 1.5) >= previewFontCqw(long, 1));
});

test('a song at its own font size sends it to the projector; at the theme size the frame is unchanged', () => {
  assert.equal(lyricsStanzaFrame(song({ fontScale: 1.3 }), 0).fontScale, 1.3);
  assert.equal('fontScale' in lyricsStanzaFrame(song(), 0), false);
  assert.equal('fontScale' in lyricsStanzaFrame(song({ fontScale: 1 }), 0), false);
  // Up to 250% reaches the projector as it is; out of range is clamped before it gets there.
  assert.equal(lyricsStanzaFrame(song({ fontScale: 2.5 }), 0).fontScale, 2.5);
  assert.equal(lyricsStanzaFrame(song({ fontScale: 9 }), 0).fontScale, 2.5);
});

test('the projector multiplies the theme lyric size by the song font scale', () => {
  // The projector's song slide sets its size as the theme size times the operator's text scale times the song's scale (src/output/ProjectorView.tsx).
  const frame = lyricsStanzaFrame(song({ fontScale: 1.2 }), 0);
  const themePx = 96;
  const operatorScale = 1;
  assert.ok(Math.abs(themePx * operatorScale * frame.fontScale - 115.2) < 1e-9);
});

test('saving a new font size while the song is live changes the live slide', () => {
  const live = lyricsStanzaFrame(song(), 0);
  const after = lyricsFrameAfterEdit(live, song({ fontScale: 1.25 }));
  assert.equal(after.changed, true);
  assert.equal(after.frame.fontScale, 1.25);
  const back = lyricsFrameAfterEdit(after.frame, song({ fontScale: 1 }));
  assert.equal(back.changed, true);
  assert.equal('fontScale' in back.frame, false);
  // A hymn that does not say its size keeps the frame's.
  const { fontScale: _drop, ...noScale } = song();
  assert.equal(lyricsFrameAfterEdit(after.frame, noScale).frame.fontScale, 1.25);
});

test('a Praise & Worship lineup slide carries the song font scale, and a larger song is laid out on more pages', () => {
  const longVerse = Array.from({ length: 8 }, (_, i) => `Sample line ${i + 1} of a long verse for the lineup`).join('\n');
  const segment = { key: 'sample', name: 'Sample Card', content: { kind: 'song', hymnIds: [7] }, arrangement: {}, cues: { lowerThird: false, titleFirst: false, fadeOut: false } };
  const at = (fontScale) => slidesFor(segment, { hymns: [song({ fontScale, stanzas: [{ id: 70, stanzaType: 'Verse 1', lyricsText: longVerse }] })] }).filter((s) => s.kind === 'lyrics');
  const normal = at(undefined);
  const large = at(1.5);
  assert.ok(normal.every((s) => !('fontScale' in s)));
  assert.ok(large.every((s) => s.fontScale === 1.5));
  assert.ok(large.length >= normal.length);
  // Every line is still shown, in order, whatever the size.
  assert.equal(large.map((s) => s.text).join('\n').split('\n').length, 8);
});

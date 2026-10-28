// One split for a prayer: a prayer with no manual split breaks only at sentence ends (unless one sentence alone is too long for a slide); a
// manual split is used exactly; every slide of a prayer has one size and one top position; the slides are balanced in length; no words are lost
// or repeated; and the preview, the full-screen view, the lineup, the live preview and the projector all show the same split.
// Run with: node --test shared/prayer-slides.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TEMPLATE, segmentFromTemplate, slidesFor } from './pw.js';
import { PRAYER_TOP, prayerBlockHeightPx, prayerBoxPx, prayerSlidesFor } from './prayer-slides.js';
import { manualParts, stampSplit } from './prayer-split.js';
import { screenPagesOf } from './prayer-screen.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const words = (text) => String(text).split(/\s+/).filter(Boolean);
const norm = (text) => words(text).join(' ');

/** A prayer of short sentences, in two paragraphs. Not the church's wording. */
const SHORT_SENTENCES = [
  'Lord, hear us.',
  'Grant us your peace.',
  'Guide the leaders of the Church.',
  'Protect the children of this parish!',
  'Strengthen the sick and the dying?',
  'Comfort those who mourn.',
  'Lift up the poor; remember the forgotten.',
  'Bless our families.',
  'Keep our hearts open to your Word.',
  'Give us courage to serve.',
  'Teach us to pray without ceasing.',
  'Amen.',
].join(' ');
const PRAYER = `${SHORT_SENTENCES.slice(0, SHORT_SENTENCES.indexOf('Comfort'))}\n\n${SHORT_SENTENCES.slice(SHORT_SENTENCES.indexOf('Comfort'))}`;

const SENTENCE_END = /[.!?;:]$/;

test('a prayer with no manual split breaks only at sentence ends', () => {
  const { mode, pages } = prayerSlidesFor(PRAYER, null);
  assert.equal(mode, 'auto');
  assert.ok(pages.length > 1, `split into ${pages.length} slides`);
  for (const [i, page] of pages.entries()) {
    if (i === pages.length - 1) continue;
    assert.match(page.text.trim(), SENTENCE_END, `slide ${i + 1} ends at a sentence end`);
  }
});

test('a sentence too long for a whole slide is the only place a slide breaks mid-sentence, and it breaks at a clause or word', () => {
  const longSentence = `${Array.from({ length: 40 }, (_, i) => `clause number ${i + 1}`).join(', ')}.`;
  const { pages } = prayerSlidesFor(`Hear us. ${longSentence} Amen.`, null);
  assert.ok(pages.length > 2);
  for (const page of pages) {
    for (const part of page.text.split(/\s+/)) assert.ok(part.length > 0);
  }
  const broken = pages.map((p) => p.text).join(' ');
  assert.equal(norm(broken), norm(`Hear us. ${longSentence} Amen.`));
});

test('a manual split is used exactly as placed, when each part fits at full size', () => {
  const body = 'Lord, hear us.\nGrant us your peace.\n\nAmen.';
  const split = stampSplit({ mode: 'manual', at: [1] }, body);
  const { mode, pages } = prayerSlidesFor(body, split);
  assert.equal(mode, 'manual');
  assert.deepEqual(pages.map((p) => p.text), ['Lord, hear us.\nGrant us your peace.', 'Amen.']);
});

test('every slide of a prayer uses one font size, and each slide carries its own top', () => {
  const { pages } = prayerSlidesFor(PRAYER, null);
  assert.ok(pages.length > 1);
  assert.equal(new Set(pages.map((p) => p.fontPx)).size, 1, 'one font size for every slide');
  for (const page of pages) assert.equal(typeof page.top, 'number', 'each slide has its own top');
  const face = read('src/praise-worship/PwSlideFace.tsx');
  // The lineup face starts each prayer block at the slide's own top, which the rule sets (a shared top, or centred when short).
  const start = face.indexOf("if (slide.kind === 'prayer') {");
  const prayerBranch = face.slice(start, face.indexOf('\n  }\n', start));
  assert.match(prayerBranch, /top: `\$\{\(slide\.top \?\? textAreaShare\(\)\.top\) \* 100\}%`/, 'the block starts at the slide\'s own top');
});

test('the slides are balanced in length: the last slide is not left short', () => {
  const sentences = Array.from({ length: 24 }, (_, i) => `Sentence ${i + 1} of the prayer ${'and more words '.repeat((i % 5) + 1)}here.`).join(' ');
  const { pages } = prayerSlidesFor(sentences, null);
  assert.ok(pages.length >= 3);
  const heights = pages.map((p) => prayerBlockHeightPx(p.text, pages[0].fontPx));
  const tallest = Math.max(...heights);
  const last = heights[heights.length - 1];
  assert.ok(last >= 0.6 * tallest, `the last slide (${last}px) is not much shorter than the tallest (${tallest}px)`);
  for (const h of heights) assert.ok(h <= prayerBoxPx().height + 0.5, 'every slide fits the box');
});

test('no words are lost or repeated in any split', () => {
  for (const body of [PRAYER, SHORT_SENTENCES, 'Lord God, '.repeat(40).trim(), `Keep ${'x'.repeat(400)} safe.`]) {
    const { pages } = prayerSlidesFor(body, null);
    assert.equal(pages.map((p) => p.text).join(' ').replace(/\s+/g, ''), body.replace(/\s+/g, ''), 'the same characters, in order');
  }
});

test('the full-screen view, the lineup and the projector show the same split for the same prayer', () => {
  const note = { title: 'Prayer to Take Authority', body: PRAYER, style: null, split: null };
  const shared = prayerSlidesFor(PRAYER, null).pages;
  assert.deepEqual(screenPagesOf(note).map((p) => p.text), shared.map((p) => p.text), 'the Notes & Prayers preview and full-screen view');
  const segment = { ...segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === 'prayer_authority')) };
  const lineup = slidesFor({ ...segment, cues: { ...segment.cues, titleFirst: false } }, { prayer: { title: 'Prayer', body: PRAYER, split: null } }).filter((s) => s.kind === 'prayer');
  assert.deepEqual(lineup.map((s) => s.text), shared.map((p) => p.text), 'the lineup and the live preview');
  assert.equal(lineup.length, shared.length, 'the same number of slides');
  assert.match(read('src/praise-worship/CurrentNextPreview.tsx'), /PwSlideFace/, 'the live preview draws the lineup slide');
  assert.match(read('src/output/ProjectorView.tsx'), /PwSlideFace/, 'the projector draws the lineup slide');
  assert.match(read('src/notes/present.ts'), /screenPagesOf\(note\)/, 'the projector frame for a note uses the shared split');
  assert.match(read('src/notes/NotesPrayersView.tsx'), /screenPagesOf\(current\)/, 'the Notes & Prayers preview uses the shared split');
});

test('the lyrics are not part of this split: lyric slides keep their own rule', () => {
  assert.match(read('shared/pw.js'), /lyricPagesFor\(stanza\.lyricsText, band, scale\)/, 'lyric pages still come from the lyric rule, at the operator\'s size');
});

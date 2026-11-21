// The Output Preview Editor and the live typography, end to end:
// 1. typing on the stage never moves a line: the text box takes the slide's own place, width, type and wrapping, and the slide's own words
//    are hidden underneath, so no grey copy shows;
// 2. A+ above 100% and MAX really draw the words larger, up to what the stage holds, instead of being held back by the widest whole line;
// 3. saving an edit or changing the size never adds a slide: the operator's pages are kept exactly, and only Add After / Duplicate add one.
// Synthetic strings only: no real song titles, lyrics or liturgical texts.
// Run with: node --test shared/slide-edit-keeps-slides.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stageWordsBox, stageWordsWhiteSpace } from './stage-words-box.js';
import { GROW_WRAP_GAIN, fitFontSize, fitWholeLines, growByWrapping } from './text-fit.js';
import { exactSlidesNote, slidesNote } from './notes.js';
import { prayerSlidesFor } from './prayer-slides.js';
import { normalizeSplit, stampSplit } from './prayer-split.js';
import { lyricPagesFor } from './lyric-area.js';
import { DEFAULT_TEMPLATE, segmentFromTemplate, slidesFor } from './pw.js';
import { lookChange } from './slide-look.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

// ── A synthetic stage: every letter is 0.55em wide, and the text area is 1690 × 700 px (a 1920 slide less its margins) ──────────────────

const EM = 0.55;
const ROOM = { width: 1690, height: 700 };
const LEADING = 1.2;
const READABLE_PX = 24;
const measure = (line, px) => line.length * px * EM;
const THREE_LINES = ['Sample Lyric Line One', 'Sample Lyric Line Two', 'And Sample Lyric Line Three Runs The Longest Of All'];

/** How many lines `line` takes when wrapped greedily at `width`. */
function wrappedCount(line, px, width) {
  let count = 1;
  let used = 0;
  for (const word of line.split(' ')) {
    const w = measure(word, px);
    const gap = used === 0 ? 0 : measure(' ', px);
    if (used + gap + w <= width) used += gap + w;
    else {
      count += 1;
      used = w;
    }
  }
  return count;
}

const wholeFits = (lines) => (px) => Math.max(...lines.map((l) => measure(l, px))) <= ROOM.width && lines.length * px * LEADING <= ROOM.height;
const wrapFits = (lines) => (px) =>
  lines.every((l) => l.split(' ').every((w) => measure(w, px) <= ROOM.width)) &&
  lines.reduce((n, l) => n + wrappedCount(l, px, ROOM.width), 0) * px * LEADING <= ROOM.height;

/** The size the stage draws `lines` at for a requested size, as the fit hooks do (useProjectorTextAutoFit / useTextAutoFit with `grow`). */
function drawnPx(lines, requestedPx, grow) {
  const whole = fitWholeLines(requestedPx, READABLE_PX, wholeFits(lines)) ?? READABLE_PX;
  if (!grow) return { px: whole, wrapped: false };
  const wrapped = wrapFits(lines)(requestedPx) ? requestedPx : fitFontSize(requestedPx, READABLE_PX, wrapFits(lines));
  return growByWrapping({ requestedPx, wholePx: whole, wrappedPx: wrapped }) ? { px: wrapped, wrapped: true } : { px: whole, wrapped: false };
}

// ── 1. Typing on the stage ──────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a 3-line slide typed on keeps its 3 lines: the box is at least as wide as the widest whole line, with no padding of its own', () => {
  const px = 60;
  const widest = Math.max(...THREE_LINES.map((l) => measure(l, px)));
  // The words sit centred in the text area, which starts 115px in from the monitor's left (a 1920 slide less its side margins).
  const left = 115 + (ROOM.width - widest) / 2;
  const box = stageWordsBox({ left, right: left + widest, fontSize: px, align: 'center', whole: true, monitorWidth: 1920 });
  assert.ok(box.width >= widest, 'never narrower than the slide’s widest line');
  assert.ok(Math.abs(box.left + box.width / 2 - (left + widest / 2)) < 0.01, 'centred on the slide’s own words, so nothing shifts sideways');
  const linesInBox = THREE_LINES.reduce((n, l) => n + wrappedCount(l, px, box.width), 0);
  assert.equal(linesInBox, 3, 'three lines on the slide are three lines in the box, never six');
  assert.equal(stageWordsWhiteSpace('pre'), 'pre', 'whole lines never wrap in the box');

  // A narrower padded box (the old editor) is what turned 3 lines into 6: the rule never gives one.
  const padded = widest * 0.6;
  assert.ok(THREE_LINES.reduce((n, l) => n + wrappedCount(l, px, padded), 0) > 3, 'the reflow this guards against');
});

test('wrapped words (a prayer, an enlarged lyric) wrap at exactly the slide’s width, and the box stays on the monitor', () => {
  const box = stageWordsBox({ left: 115, right: 1805, fontSize: 60, align: 'center', whole: false, monitorWidth: 1920 });
  assert.deepEqual(box, { left: 115, width: 1690 }, 'no room added: each line breaks where the slide breaks it');
  assert.equal(stageWordsWhiteSpace('pre-line'), 'pre-wrap', 'wraps as the slide does, and keeps the spaces typed');
  const left = stageWordsBox({ left: 100, right: 400, fontSize: 60, align: 'left', whole: true, monitorWidth: 1920 });
  assert.equal(left.left, 100, 'left-aligned words grow to the right only');
  const empty = stageWordsBox({ left: 960, right: 960, fontSize: 60, align: 'center', whole: true, monitorWidth: 1920 });
  assert.equal(empty.width, 360, 'an empty slide still gets a box to type in');
  const edge = stageWordsBox({ left: 0, right: 1920, fontSize: 60, align: 'center', whole: true, monitorWidth: 1920 });
  assert.deepEqual(edge, { left: 0, width: 1920 }, 'never past the monitor’s edges');
});

test('the slide’s own words are hidden completely while they are typed on, and the box copies their exact type', () => {
  const css = read('src/styles.css');
  assert.match(css, /\[data-stage-editing\] \[data-slide-words\] \{\s*visibility: hidden;\s*\}/, 'no grey copy of the words behind the box');
  const modal = read('src/golive/console/SlideEditorModal.tsx');
  assert.match(modal, /data-stage-editing=\{typing \? '' : undefined\}/, 'hidden only while typing');
  for (const prop of ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'wordSpacing', 'lineHeight', 'whiteSpace', 'textAlign', 'textTransform']) {
    assert.match(modal, new RegExp(`\\n\\s+${prop}[,:]`), `the box takes the slide’s ${prop}`);
  }
  assert.match(modal, /stageWordsBox\(\{/, 'placed by the shared rule');
  assert.match(modal, /const STAGE_BOX = 'm-0 [^']*border-0 bg-transparent p-0 /, 'no padding, border or fill of its own');
  for (const file of ['src/praise-worship/PwSlideFace.tsx', 'src/output/ProjectorView.tsx']) {
    assert.ok(read(file).split('data-slide-words').length - 1 >= 3, `${file} marks the words it draws`);
  }
});

// ── 2. A+ and MAX ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('A+ draws a long-lined slide larger at every step, up to what the stage holds', () => {
  const natural = 96;
  const at100 = drawnPx(THREE_LINES, natural, false);
  assert.equal(at100.wrapped, false, 'at 100% the slide keeps the lines it was laid out with');
  let before = at100.px;
  for (const scale of [1.5, 2, 2.5]) {
    const at = drawnPx(THREE_LINES, natural * scale, true);
    assert.ok(at.px >= before, `${scale * 100}% is no smaller than the step below`);
    assert.ok(wrapFits(THREE_LINES)(at.px), `${scale * 100}% still fits the stage: nothing is clipped`);
    before = at.px;
  }
  const at200 = drawnPx(THREE_LINES, natural * 2, true);
  assert.ok(at200.px >= at100.px * GROW_WRAP_GAIN, `200% is clearly larger than 100% (${at200.px}px against ${at100.px}px)`);
  // Without the rule the widest whole line holds every step at the 100% size: the bug this fixes.
  assert.equal(drawnPx(THREE_LINES, natural * 2, false).px, at100.px);
});

test('MAX fills the stage: larger than the operator’s 100% size, and inside the stage', () => {
  const maxCeiling = 22 * 19.2;
  const max = drawnPx(THREE_LINES, maxCeiling, true);
  assert.ok(max.px > drawnPx(THREE_LINES, 96, false).px * GROW_WRAP_GAIN, 'MAX is clearly larger than 100%');
  assert.ok(wrapFits(THREE_LINES)(max.px), 'and never runs off the stage');
});

test('short lines grow whole: lines are wrapped only when that draws the slide clearly larger', () => {
  const short = ['Sample One', 'Sample Two'];
  const at = drawnPx(short, 96 * 2, true);
  assert.equal(at.wrapped, false);
  assert.equal(at.px, 192, 'the full 200% size');
  assert.equal(growByWrapping({ requestedPx: 192, wholePx: 192, wrappedPx: 192 }), false, 'reaching the size whole never wraps');
  assert.equal(growByWrapping({ requestedPx: 192, wholePx: 100, wrappedPx: 105 }), false, 'a few pixels are not worth new line breaks');
  assert.equal(growByWrapping({ requestedPx: 192, wholePx: 100, wrappedPx: 150 }), true);
});

test('the faces ask to grow only above 100% or at MAX, on the preview and on the projector alike', () => {
  const face = read('src/praise-worship/PwSlideFace.tsx');
  assert.match(face, /grow=\{\(slideScale \?\? 1\) \* \(slide\.fontScale \?\? 1\) > 1\}/, 'a P&W lyric page, at A+ above 100%');
  assert.match(face, /heightShare: EDGE_TO_EDGE\.heightShare, grow: true/, 'a P&W lyric page at MAX');
  assert.match(read('src/output/ProjectorView.tsx'), /const grow = edgeToEdge \|\| slideScale \* fontScale > 1;/, 'a Holy Mass stanza');
  assert.match(read('src/output/useProjectorTextAutoFit.ts'), /growByWrapping\(\{ requestedPx, wholePx, wrappedPx \}\)/);
  assert.match(read('src/output/useTextAutoFit.ts'), /growByWrapping\(\{ requestedPx: ceiling, wholePx: whole, wrappedPx: wrapped \}\)/);
  // The editor's preview and the projector draw through the same faces, with the slide's own look (scale, MAX) over the settings.
  assert.match(read('src/praise-worship/CurrentNextPreview.tsx'), /const slideScale = look\?\.fontScale \?\? settingsScale;/);
  assert.match(read('src/output/ProjectorView.tsx'), /const slideScale = own\?\.fontScale \?\? settingsScale;/);
});

// ── 3. No slide is ever added by an edit or a size change ───────────────────────────────────────────────────────────────────────────

const LONG_PRAYER = Array.from({ length: 30 }, (_, i) => `Sample Prayer Line ${i + 1}, a sentence long enough to fill the slide.`).join(' ');
const LONG_STANZA = Array.from({ length: 14 }, (_, i) => `Sample Lyric Line ${i + 1} runs across the stage as it is drawn`).join('\n');

test('an edited prayer or reading page stays one slide, however long, where the old save split it again', () => {
  assert.ok(prayerSlidesFor(slidesNote([LONG_PRAYER]).body, slidesNote([LONG_PRAYER]).split).pages.length > 1, 'the split this guards against');
  const one = exactSlidesNote([LONG_PRAYER]);
  assert.equal(prayerSlidesFor(one.body, one.split).pages.length, 1, 'one page typed is one slide');
  const two = exactSlidesNote([LONG_PRAYER, 'Sample Prayer Line Short']);
  const pages = prayerSlidesFor(two.body, two.split).pages;
  assert.deepEqual(pages.map((p) => p.text), [LONG_PRAYER, 'Sample Prayer Line Short'], 'two pages are two slides, words exactly as typed');
  for (const scale of [0.5, 1, 1.5, 2.5]) {
    assert.equal(prayerSlidesFor(two.body, two.split, scale).pages.length, 2, `still two at ${scale * 100}%`);
  }
});

test('the exact split survives a save and a reload, and text changed elsewhere goes back to the usual split', () => {
  const { body, split } = exactSlidesNote(['Sample Segment One', 'Sample Segment Two']);
  assert.deepEqual(stampSplit(split, body), split, 'saved as it was made');
  assert.equal(normalizeSplit(JSON.parse(JSON.stringify(split)), body).exact, true, 'read back from the database with its flag');
  assert.equal(normalizeSplit({ mode: 'manual', at: [0], exact: 'yes' }, body).exact, undefined, 'only a real true is kept');
  assert.equal(prayerSlidesFor(`${body}\nSample Segment Three`, split).mode, 'stale', 'made for other words: not used');
  assert.equal(exactSlidesNote(['  ', '']).split, null, 'nothing typed has no split');
});

test('the lineup draws an edited card page as exactly the pages saved', () => {
  const segment = segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === 'prayer_authority'));
  const { body, split } = exactSlidesNote([LONG_PRAYER, 'Sample Prayer Line Added']);
  const slides = slidesFor({ ...segment, cues: { ...segment.cues, titleFirst: false } }, { prayer: { title: 'Sample Segment', body, split, align: 'center' } }).filter((s) => s.kind === 'prayer');
  assert.deepEqual(slides.map((s) => s.text), [LONG_PRAYER, 'Sample Prayer Line Added']);
});

test('an edited stanza keeps exactly its slides, at any size and with the lower third on', () => {
  const segment = { ...segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === 'marian_song')), content: { kind: 'song', hymnIds: [5], maxSongs: 1, category: null } };
  const card = { ...segment, cues: { ...segment.cues, titleFirst: false } };
  const lyrics = (stanza, options) => slidesFor(card, { hymns: [{ id: 5, title: 'Sample Song', stanzas: [stanza] }] }, options).filter((s) => s.kind === 'lyrics');
  assert.ok(lyricPagesFor(LONG_STANZA, null).length > 1, 'an unedited long stanza is paged as usual');
  assert.ok(lyrics({ id: 1, stanzaType: 'Verse 1', lyricsText: LONG_STANZA }).length > 1);
  const edited = { id: 1, stanzaType: 'Verse 1', lyricsText: LONG_STANZA, pages: [LONG_STANZA] };
  for (const options of [{}, { scale: 2.5 }, { band: { tag: 'Sample', line1: 'Sample Line', line2: '' } }]) {
    const slides = lyrics(edited, options);
    assert.equal(slides.length, 1, `one slide edited is one slide (${JSON.stringify(options)})`);
    assert.equal(slides[0].text, LONG_STANZA, 'with the operator’s exact line breaks');
  }
  const twoParts = { ...edited, pages: ['Sample Lyric Line One\nSample Lyric Line Two', 'Sample Lyric Line Three'] };
  assert.deepEqual(lyrics(twoParts).map((s) => s.text), twoParts.pages, 'a stanza left in two slides stays two');
});

test('every save path keeps the slide count: songs, card pages, Holy Mass items, and the size never pages', () => {
  const targets = read('src/golive/console/editTargets.ts');
  assert.match(targets, /const pages = shown\.pages\.map\(\(p, i\) => \(i === shown\.index \? text : p\)\);/, 'a song edit changes this slide only');
  assert.match(targets, /lyricsText: pages\.join\('\\n'\), pages \}/, 'and keeps the stanza’s slides');
  assert.match(targets, /lyricsText: text, pages: \[text\] \}/, 'Add After makes exactly one new slide');
  assert.match(targets, /page: \{ pages, index: slide\.part \?\? 0 \}/, 'a P&W stanza in several slides edits the one shown');
  assert.match(targets, /\.\.\.\(s\.pages \? \{ pages: s\.pages \} : \{\}\)/, 'other stanzas keep their slides through an edit');
  assert.match(read('src/live/liveSongEdits.ts'), /\.\.\.\(s\.pages\?\.length \? \{ pages: \[\.\.\.s\.pages\] \} : \{\}\)/);
  assert.match(read('src/praise-worship/lineupSlideCopy.ts'), /const \{ body, split \} = exactSlidesNote\(pages\);/, 'a card’s prayer or reading page');
  assert.match(read('src/golive/massSlideCopy.ts'), /=> exactSlidesNote\(pages\);/, 'a Holy Mass item');
  // Formatting is a look, never the words: a size or MAX change touches neither the text nor the pages.
  const change = lookChange(null, 'fontScale', 2, 'slide');
  assert.deepEqual(Object.keys(change.look).sort(), ['fontScale', 'maxFit']);
  assert.equal(change.settings, null);
});

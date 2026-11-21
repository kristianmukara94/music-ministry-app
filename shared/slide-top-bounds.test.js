// Every page of a slide (Slide 01, Slide 02 and on) starts at or below Title Safe's top, and the Output Preview Editor's inline text box stays
// inside Title Safe and above the footer on all four sides, its gold ring included. Only synthetic strings are used.
// Run with: node --test shared/slide-top-bounds.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TALLEST_BLOCK_SHARE, TEXT_TOP_MIN, TITLE_SAFE_TOP, blockTopShare, blockTops, textAreaPx } from './text-area.js';
import { PRAYER_MAX_PX, pageTops, prayerSlidesFor } from './prayer-slides.js';
import { screenPagesOf } from './prayer-screen.js';
import { exactSlidesNote } from './notes.js';
import { STAGE_WORDS_RING_PX, stageWordsBounds, stageWordsBox, stageWordsRows } from './stage-words-box.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const lines = (word, n) => Array.from({ length: n }, (_, i) => `${word} ${i + 1} of the sample page here`).join('\n');
const H = 1080;

test('the highest a block may start is below Title Safe, and is where the tallest paginated page is centred', () => {
  assert.equal(TITLE_SAFE_TOP, 0.05);
  assert.ok(TEXT_TOP_MIN >= TITLE_SAFE_TOP + 0.02, `room below Title Safe (${TEXT_TOP_MIN.toFixed(4)})`);
  assert.ok(Math.abs(TEXT_TOP_MIN - (textAreaPx().centre - (TALLEST_BLOCK_SHARE * H) / 2) / H) < 1e-12);
  for (const px of [0, 300, 604, TALLEST_BLOCK_SHARE * H, 900, 1100, 2000, 10000]) {
    assert.ok(blockTopShare(px) >= TEXT_TOP_MIN - 1e-12, `${px}px starts no higher than the floor`);
    assert.ok(blockTopShare(px) >= TITLE_SAFE_TOP, `${px}px never above Title Safe`);
  }
});

test('a page pagination lays out keeps its centred top exactly: only a block taller than any page is held down', () => {
  for (const px of [120, 300, 500, 604, TALLEST_BLOCK_SHARE * H]) {
    assert.ok(Math.abs(blockTopShare(px) - (textAreaPx().centre - px / 2) / H) < 1e-12, `${px}px unchanged`);
  }
  assert.equal(blockTopShare(1100), TEXT_TOP_MIN, 'a block taller than the stage starts at the floor, not above the slide');
});

test('Slide 02+ of a prayer kept whole on air never starts above Title Safe, nor do the pages that share its top', () => {
  // Slide 02 is the tallest page: an exact page typed on air is never split again, so the group's shared top is set from it.
  for (const long of [8, 12, 20, 40]) {
    const note = exactSlidesNote([lines('Sample Prayer Line', 4), lines('Sample Prayer Line', long), lines('Sample Prayer Line', 5)]);
    for (const scale of [1, 1.5, 2.5]) {
      const pages = prayerSlidesFor(note.body, note.split, scale).pages;
      assert.equal(pages.length, 3, 'the exact pages are kept');
      pages.forEach((p, i) => assert.ok(p.top >= TEXT_TOP_MIN - 1e-12 && p.top >= TITLE_SAFE_TOP, `${long} lines at ${scale * 100}%: Slide 0${i + 1} top ${p.top.toFixed(3)}`));
    }
    // The Holy Mass prayer screen (headline + body) shares the rule.
    screenPagesOf({ title: 'Sample Prayer', body: note.body, split: note.split }).forEach((p, i) => assert.ok(p.top >= TITLE_SAFE_TOP, `Holy Mass Slide 0${i + 1}`));
  }
});

test('song pages and every group of blocks start at or below Title Safe at 100%, 150% and 250%', () => {
  for (const scale of [1, 1.5, 2.5]) {
    const tops = pageTops([lines('Sample Song Line', 4), lines('Sample Song Line', 14), lines('Sample Song Line', 2)], PRAYER_MAX_PX * scale);
    tops.forEach((t, i) => assert.ok(t.top >= TITLE_SAFE_TOP, `${scale * 100}%: Slide 0${i + 1}`));
  }
  for (const t of blockTops([200, 2400, 900, 50])) assert.ok(t.top >= TEXT_TOP_MIN - 1e-12);
});

test('the slide faces draw the footer and page count with the markers the inline box measures its floor from', () => {
  const face = read('src/praise-worship/PwSlideFace.tsx');
  assert.equal(face.match(/<div data-slide-footer className="absolute bottom-\[3\.938cqw\] left-\[6cqw\]/g)?.length, 2, 'prayer and lyric footers');
  assert.equal(face.match(/<div data-slide-counter className="pointer-events-none absolute right-\[6cqw\] bottom-\[3\.938cqw\]/g)?.length, 2, 'prayer and lyric page counts');
  assert.equal(read('src/output/ProjectorView.tsx').match(/data-slide-counter/g)?.length, 4, 'psalm, text, deck and preview counters');
});

// ── The inline text box ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const MON = { monitorWidth: 960, monitorHeight: 540 };

test('the box’s room is Title Safe with its ring inside, 1.5%–98.5% across for MAX lyrics, and ends above the footer', () => {
  // The outline is drawn inside the box (inset), so it adds nothing past the box's edges; an outside ring is kept clear when passed.
  const r = STAGE_WORDS_RING_PX;
  assert.equal(r, 0);
  assert.deepEqual(stageWordsBounds({ ...MON, ring: 1 }), { top: 28, bottom: 512, left: 49, right: 911 });
  assert.deepEqual(stageWordsBounds(MON), { top: 27 + r, bottom: 513 - r, left: 48 + r, right: 912 - r });
  const edge = stageWordsBounds({ ...MON, edge: true });
  assert.ok(Math.abs(edge.left - (14.4 + r)) < 1e-9 && Math.abs(edge.right - (945.6 - r)) < 1e-9, 'MAX: 1.5% to 98.5%');
  assert.equal(edge.top, 27 + r, 'MAX still keeps Title Safe’s top');
  assert.equal(stageWordsBounds({ ...MON, floor: 480 }).bottom, 480 - r, 'a footer above Title Safe’s bottom is the floor');
  assert.equal(stageWordsBounds({ ...MON, floor: 530 }).bottom, 513 - r, 'Title Safe’s bottom when the footer is lower');
});

test('Slide 02+ words drawn above Title Safe: the box still starts inside it, and never grows past the footer', () => {
  const bounds = stageWordsBounds({ ...MON, floor: 490 });
  // The breach from the report: the words' rect starts above the stage itself and runs past its bottom.
  const rows = stageWordsRows({ top: -24, bottom: 560, pitch: 60, bounds });
  assert.equal(rows.top, bounds.top, 'top >= Title Safe top (ring included)');
  assert.ok(rows.top - STAGE_WORDS_RING_PX >= MON.monitorHeight * 0.05, 'the ring too');
  assert.ok(rows.top + rows.height <= bounds.bottom, 'bottom above the footer');
  assert.equal(rows.maxHeight, bounds.bottom - bounds.top, 'grows at most to the footer');
  // Words at the very bottom: the box keeps one line above the footer instead of starting below it.
  const low = stageWordsRows({ top: 500, bottom: 530, pitch: 40, bounds });
  assert.ok(low.top >= bounds.top && low.top + low.height <= bounds.bottom && low.height >= 40);
});

test('words drawn inside the room keep their exact place: opening the box never moves a line', () => {
  const bounds = stageWordsBounds({ ...MON, floor: 490 });
  for (const [top, bottom] of [[100, 300], [bounds.top, bounds.bottom], [200, 230]]) {
    const rows = stageWordsRows({ top, bottom, pitch: 30, bounds });
    assert.equal(rows.top, top, 'same top');
    assert.equal(rows.height, Math.max(30, bottom - top), 'same height');
  }
});

test('the room added past whole lines never takes the box out of Title Safe at the sides', () => {
  const bounds = stageWordsBounds(MON);
  for (const align of ['left', 'center', 'right']) {
    const box = stageWordsBox({ left: 52, right: 908, fontSize: 60, align, whole: true, monitorWidth: 960, minLeft: bounds.left, maxRight: bounds.right });
    assert.ok(box.left >= bounds.left && box.left + box.width <= bounds.right, `${align}: inside Title Safe`);
    assert.ok(box.width >= 908 - 52 - 1e-9 || box.left === bounds.left, 'still as wide as the words where the room allows');
  }
  // With no room given, the old rule holds: the monitor's edges.
  assert.deepEqual(stageWordsBox({ left: 0, right: 960, fontSize: 60, align: 'center', whole: true, monitorWidth: 960 }), { left: 0, width: 960 });
});

test('the editor places the box by the shared rules, caps its growth, and keeps the slide’s own words hidden while typing', () => {
  const modal = read('src/golive/console/SlideEditorModal.tsx');
  assert.match(modal, /stageWordsBounds\(\{\s*monitorWidth: box\.width,\s*monitorHeight: box\.height,\s*edge: stage\.querySelector\('\[data-edge-to-edge\]'\) !== null,/);
  assert.match(modal, /querySelectorAll<HTMLElement>\('\[data-slide-footer\], \[data-slide-counter\]'\)/, 'the floor is the footer and the page count');
  assert.match(modal, /stageWordsRows\(\{ top: /);
  assert.match(modal, /minLeft: bounds\.left,\s*maxRight: bounds\.right,/);
  assert.match(modal, /Math\.min\(el\.scrollHeight, type\.maxHeight\)/, 'grows to the footer at most');
  assert.match(modal, /maxHeight: type\.maxHeight/);
  assert.match(modal, /shadow-\[inset_0_0_0_1px_/, 'the gold outline is drawn inside the box, so it never crosses Title Safe');
  assert.match(modal, /left: outer\.left \+ monitor\.clientLeft, top: outer\.top \+ monitor\.clientTop, width: monitor\.clientWidth, height: monitor\.clientHeight/, 'measured from the padding edge the box is placed from: zero shift');
  assert.match(read('src/styles.css'), /\[data-stage-editing\] \[data-slide-words\] \{\s*visibility: hidden;\s*\}/, 'no ghost copy under the box');
});

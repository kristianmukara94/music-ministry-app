// The Title Card is centred on the full 16:9 canvas, with no box behind it. Its size is proportional to the operator's scale across the whole
// 70%-150% range: short titles at 4.4cqw and long titles (more than 25 characters, which wrap to three lines) at 3.6cqw, each times the scale,
// with no ceiling, so every A-/A+ step is visible. The compact icon sits above the heading, the header and footer badges are pinned to the
// edges, the slide canvas clips, the preview reads the scale from the store, and every preview surface is a 16:9 frame that clips.
// Run with: node --test shared/title-card-fit.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

/** The Title Card's size in cqw at a scale: proportional, with no ceiling, and smaller for a long title. */
const titleCqw = (label, scale) => (label.length > 25 ? 3.6 : 4.4) * scale;

const SHORT = 'Bible Enthronement';
const LONG = 'CONSECRATION TO MARY, OUR LADY OF NAZARETH';
const STEPS = [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5];

test('a short title is 4.4cqw at 100%, and it keeps growing to 150%, with no ceiling', () => {
  assert.equal(titleCqw(SHORT, 1), 4.4);
  assert.ok(Math.abs(titleCqw(SHORT, 1.5) - 6.6) < 1e-9, 'at 150% it is 6.6cqw');
});

test('a long title is 3.6cqw at 100%, and it stays smaller than a short one at every scale', () => {
  assert.equal(titleCqw(LONG, 1), 3.6);
  for (const scale of STEPS) assert.ok(titleCqw(LONG, scale) < titleCqw(SHORT, scale), `long is smaller at ${scale * 100}%`);
});

test('every A-/A+ step is a visible size change on a Title Card, for short and long titles', () => {
  for (const label of [SHORT, LONG]) {
    const sizes = STEPS.map((scale) => titleCqw(label, scale));
    for (let i = 1; i < sizes.length; i += 1) assert.ok(sizes[i] > sizes[i - 1], `${label}: ${STEPS[i] * 100}% is larger than ${STEPS[i - 1] * 100}%`);
  }
  // The visible difference at the four scales the spec names.
  assert.ok(titleCqw(SHORT, 1.2) - titleCqw(SHORT, 1) > 0.8, 'at 120% the short title is clearly bigger than at 100%');
  assert.ok(titleCqw(SHORT, 1.4) - titleCqw(SHORT, 1.2) > 0.8, 'at 140% it is clearly bigger than at 120%');
  assert.ok(titleCqw(SHORT, 1.5) - titleCqw(SHORT, 1.4) > 0.4, 'at 150% it is bigger again');
});

test('the Title Card code has no ceiling, the proportional formula, and a 65% height limit (36.563cqw on a 16:9 frame)', () => {
  const face = read('src/praise-worship/PwSlideFace.tsx');
  assert.match(face, /const long = slide\.label\.length > 25;/);
  assert.match(face, /const titleCqw = \(long \? 3\.6 : 4\.4\) \* \(slideScale \?\? 1\);/);
  assert.match(face, /const titleChars = charsPerLine\(0\.84, titleCqw \* 19\.2\);/, 'the line width follows the scaled size');
  assert.doesNotMatch(face, /Math\.min\(4\.8|Math\.min\(6\.0|5\.8\)|7\.0\)/, 'no ceiling is left on the title');
  assert.match(face, /<h2 className="max-h-\[36\.563cqw\] leading-\[1\.12\] tracking-\[0\.08em\] uppercase"/);
  assert.match(face, /fontSize: `\$\{titleCqw\}cqw`/);
  assert.doesNotMatch(face, /top-\[14cqh\] bottom-\[12cqh\]/, 'the sub-band box is gone');
});

test('the title is centred on the full frame, with the compact icon above the heading', () => {
  const face = read('src/praise-worship/PwSlideFace.tsx');
  assert.match(face, /<div className="absolute inset-0 flex flex-col items-center justify-center px-\[8cqw\] py-\[4\.5cqw\] text-center">/);
  assert.match(face, /className="mb-\[1\.406cqw\] h-\[4cqw\] w-\[4cqw\] shrink-0 text-gold opacity-80"/);
});

test('the header and footer badges are pinned to the top and bottom edges, above the title', () => {
  const face = read('src/praise-worship/PwSlideFace.tsx');
  assert.match(face, /<div className="absolute top-\[2\.813cqw\] left-\[6cqw\] right-\[6cqw\] z-10 flex items-center justify-between">/);
  assert.match(face, /<div className="absolute bottom-\[2\.813cqw\] left-\[6cqw\] right-\[6cqw\] z-10 flex items-center justify-between">/);
});

test('the preview reads the scale from the store, and passes it into the slide, so Current and Next re-render at once', () => {
  const next = read('src/praise-worship/CurrentNextPreview.tsx');
  assert.match(next, /const slideScale = useLive\(\(s\) => s\.state\.settings\.slideFontScale\);/);
  assert.match(next, /slideScale=\{slideScale\}/);
});

test('the slide canvas clips everything, so no text can draw outside the 16:9 frame', () => {
  const face = read('src/praise-worship/PwSlideFace.tsx');
  assert.match(face, /const rootClass = background\?\.media \? 'absolute inset-0 overflow-hidden text-fg' : 'absolute inset-0 overflow-hidden bg-canvas text-fg';/);
});

test('every slide preview is a strict 16:9 frame that clips its contents', () => {
  const next = read('src/praise-worship/CurrentNextPreview.tsx');
  assert.match(next, /const STAGE = 'relative aspect-video w-full overflow-hidden rounded-(xl|lg)/);
  const panel = read('src/operator/PreviewPanel.tsx');
  assert.match(panel, /<div className="relative overflow-hidden" style=\{\{ width: 'min\(100cqw, calc\(100cqh \* 16 \/ 9\)\)', height: 'min\(100cqh, calc\(100cqw \* 9 \/ 16\)\)' \}\}>/);
});

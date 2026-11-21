// Every slide stays inside its stage at any text size: a Title slide's words end above its gold rule and its footer, a long unbroken word never
// runs past its column's side, and the Edit Slide header keeps its stepper and close button on one row whatever the subtitle's length.
// Only synthetic strings are used. Run with: node --test shared/slide-fit-bounds.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TITLE_CARD_BOX } from './text-fit.js';
import { charsPerLine, slideLine } from './text-wrap.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const UNBROKEN = 'SampleLongUnbrokenString'.repeat(5).slice(0, 114);
const SOFT_BREAK = '​';

/** The slide is 100cqw wide and 56.25cqw tall; Title Safe (90%) keeps 5% of each side clear. */
const STAGE_H = 56.25;
const SAFE_Y = STAGE_H * 0.05;
const SAFE_X = 5;
/** The segment name and the footer: 1.6cqw text, 2.813cqw off the edge, at a generous 1.5 line height. */
const BADGE_EXTENT = 2.813 + 1.6 * 1.5;

test('the Title slide box sits inside Title Safe, below the segment name and above the footer and page count', () => {
  assert.equal(UNBROKEN.length, 114);
  assert.ok(TITLE_CARD_BOX.topCqw >= SAFE_Y && TITLE_CARD_BOX.topCqw >= BADGE_EXTENT, 'top clear of the edge and the segment name');
  assert.ok(TITLE_CARD_BOX.bottomCqw >= SAFE_Y && TITLE_CARD_BOX.bottomCqw >= BADGE_EXTENT, 'bottom clear of the edge, the footer and the 1 / 2 count');
  assert.ok(TITLE_CARD_BOX.sideCqw >= SAFE_X, 'sides inside Title Safe');
  assert.ok(STAGE_H - TITLE_CARD_BOX.topCqw - TITLE_CARD_BOX.bottomCqw > STAGE_H / 2, 'the box keeps most of the slide for the title');
});

test('a 114-character unbroken title is cut at soft breaks no longer than a line, at every text size', () => {
  for (const scale of [1, 1.5, 2.5]) {
    const cqw = 3.6 * scale;
    const chars = charsPerLine(0.84, cqw * 19.2);
    const parts = slideLine(UNBROKEN, chars).split(SOFT_BREAK);
    assert.ok(parts.length > 1, `${scale * 100}%: the word is broken`);
    assert.equal(parts.join(''), UNBROKEN, 'no letter is lost');
    for (const part of parts) assert.ok(part.length <= chars, `${scale * 100}%: each piece fits a line`);
  }
});

test('the Title slide is fitted to its box: icon, gold rule and subtitle reserved, no fixed height cap', () => {
  const face = read('src/praise-worship/PwSlideFace.tsx');
  assert.match(face, /<TitleCardText label=\{slide\.label\} subtitle=\{slide\.subtitle\} type=\{type\} slideFont=\{slideFont\} slideScale=\{slideScale\} \/>/);
  assert.match(face, /useTextAutoFit\(\{ boxRef, textRef, reservedRef: \[iconRef, ruleRef, subtitleRef\], naturalSize, deps: \[label, subtitle, slideFont\], heightShare: 1, keepLines: false \}\);/);
  assert.match(face, /const titleCardBoxStyle: CSSProperties = \{ top: `\$\{TITLE_CARD_BOX\.topCqw\}cqw`, bottom: `\$\{TITLE_CARD_BOX\.bottomCqw\}cqw`/);
  assert.doesNotMatch(face, /max-h-\[36\.563cqw\]/, 'the old cap let a wrapped title run under the rule and off the slide');
  // apcc-prose breaks a piece still wider than the box at the smallest size; the clip margin keeps accents that rise above the line box.
  assert.match(face, /<h2 ref=\{textRef\} data-slide-words className="apcc-prose w-full max-w-full leading-\[1\.12\] tracking-\[0\.08em\] uppercase \[overflow-clip-margin:0\.2em\] \[overflow:clip\]"/);
  assert.doesNotMatch(face, /overflowWrap: 'break-word'/, 'not inline: the fit clears inline overflow-wrap after each run');
  assert.match(face, /<div ref=\{ruleRef\} aria-hidden data-title-rule className="mt-\[1\.406cqw\] h-\[0\.197cqw\] w-\[12cqw\] shrink-0 bg-gold" \/>/);
});

test('the fit can reserve several elements', () => {
  const hook = read('src/output/useTextAutoFit.ts');
  assert.match(hook, /reservedRef\?: RefObject<HTMLElement \| null> \| RefObject<HTMLElement \| null>\[\];/);
  assert.match(hook, /\(Array\.isArray\(reservedRef\) \? reservedRef : \[reservedRef\]\)\.reduce\(/);
});

test('every fit measures a word against its own column as well as the box, so a narrower column never spills', () => {
  assert.match(read('src/output/useTextAutoFit.ts'), /text\.scrollWidth <= Math\.min\(roomWidth, text\.clientWidth\) \+ 1/);
  assert.match(read('src/output/useProjectorTextAutoFit.ts'), /text\.scrollWidth <= Math\.min\(roomWidth, text\.clientWidth\) \+ 1/);
  const headed = read('src/output/useHeadedTextFit.ts');
  assert.match(headed, /title\.scrollWidth <= Math\.min\(roomWidth, title\.clientWidth\) \+ 1/);
  assert.match(headed, /body\.scrollWidth <= Math\.min\(roomWidth, body\.clientWidth\) \+ 1/);
  const view = read('src/output/ProjectorView.tsx');
  assert.match(view, /const tooBig = \(\) => el\.offsetHeight > room \|\| el\.scrollWidth > el\.clientWidth \+ 1;/, 'the rosary prayer shrinks for width too');
  assert.match(view, /className=\{`apcc-prose relative flex max-w-\[86cqw\] flex-col gap-\[2\.2cqh\] leading-\[1\.22\] \$\{sizes/, 'a reading breaks a word still too wide at the floor');
});

test('lower thirds break an unbroken word inside the band', () => {
  const lt = read('src/output/LowerThirdView.tsx');
  assert.equal((lt.match(/\[overflow-wrap:anywhere\]/g) ?? []).length, 3, 'the segment band, the response pill and the styled card');
});

test('the Edit Slide header stays one row: the title side truncates, the stepper and close never wrap', () => {
  const modal = read('src/golive/console/SlideEditorModal.tsx');
  assert.match(modal, /<header data-editor-header className="flex flex-nowrap items-center justify-between gap-3/);
  assert.match(modal, /<div data-editor-heading className="min-w-0 flex-1">/);
  assert.match(modal, /<span data-editor-subtitle className="min-w-0 truncate" title=\{title\}>\{title\}<\/span>/);
  assert.match(modal, /<div data-editor-header-controls className="flex shrink-0 items-center gap-2">/);
  // The stepper and the close button are no-drag, so a click over the top bar never turns into a window drag.
  const header = modal.slice(modal.indexOf('<header data-editor-header'), modal.indexOf('</header>'));
  const buttons = header.match(/<button [^>]*>/g) ?? [];
  assert.equal(buttons.length, 3, 'Prev, Next and Close');
  for (const b of buttons) assert.match(b, /style=\{NO_DRAG\}/);
});

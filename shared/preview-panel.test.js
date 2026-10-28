// The operator's Live preview keeps its text inside the picture: the header is a band above the picture (never an overlay on it), the picture
// is the projector itself at 16:9, centred in the space under the header, and it is the same picture the projector draws. The measured check
// (long and short prayers, no text under the header or the Opening tag) was run in the headless browser; this test keeps the layout in place.
// Run with: node --test shared/preview-panel.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

test('the header is a band above the picture, not an overlay on the text', () => {
  const panel = read('src/operator/PreviewPanel.tsx');
  assert.match(panel, /<header\s[\s\S]*?className="flex h-14 shrink-0 /, 'the header is a flex band of fixed height');
  assert.doesNotMatch(panel, /absolute top-0 right-0 left-0 z-20/, 'the header is no longer laid over the picture');
  assert.doesNotMatch(panel, /bg-gradient-to-b from-stone-950\/90/, 'no translucent header lets the text show through');
});

test('the picture sits under the header, keeps 16:9 and is the projector itself', () => {
  const panel = read('src/operator/PreviewPanel.tsx');
  assert.match(panel, /<div className="relative flex min-h-0 flex-1 items-center justify-center \[container-type:size\]">/, 'the picture area takes the space left under the header');
  assert.match(panel, /width: 'min\(100cqw, calc\(100cqh \* 16 \/ 9\)\)'/, 'the picture keeps 16:9 and fits the area');
  assert.match(panel, /height: 'min\(100cqh, calc\(100cqw \* 9 \/ 16\)\)'/);
  assert.match(panel, /<ProjectorView mirror embedded \/>/, 'the same projector picture, live');
  assert.match(panel, /className="group fixed z-50 flex flex-col overflow-hidden/, 'the panel is a column, so the header and the picture stack');
});

test('the preview and the projector draw the same slide with the same fit rules', () => {
  // The preview is the projector itself, so the text, its size and its rules are the projector's.
  assert.match(read('src/output/ProjectorView.tsx'), /<PwSlideFace/, 'the projector draws the lineup face');
  assert.match(read('src/praise-worship/PwSlideFace.tsx'), /charsPerLine\(PRAYER_WIDTH_SHARE, slide\.fontPx \?\? 96\)/, 'the same wrap as the splitter');
});

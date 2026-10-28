// The Background button is in the Live panel's bottom row, beside Lower third and Blackout, and its panel opens inside the Live panel, above the
// row. The row fits a narrow Live panel on one line: the buttons do not wrap or overlap. Lower third and Blackout still work, and the Live slide
// background stays separate from the Welcome background. Run with: node --test shared/live-background-row.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const LIVE = () => read('src/praise-worship/LiveView.tsx');

test('the Background button is in the Live panel, not in the top toolbar', () => {
  assert.doesNotMatch(read('src/operator/TopBar.tsx'), /BackgroundPanel|top\.background|ImageIcon/, 'the top toolbar has no Background button or panel');
  assert.match(LIVE(), /\{tMain\('top\.background'\)\}/, 'the Live panel has the Background button');
});

test('the bottom row order is Back, Next slide, Background, Lower third, Blackout', () => {
  const live = LIVE();
  const row = live.slice(live.indexOf('<div className="flex w-full min-w-0 flex-nowrap items-center justify-between gap-1.5 overflow-hidden border-t border-line pt-4">'));
  const order = ["t('back')", "t('next')", "tMain('top.background')", "t('lowerThirdToggle')", "t('blackoutToggle')"];
  const at = order.map((s) => row.indexOf(s));
  assert.ok(at.every((i) => i >= 0), 'every button is in the row');
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'in that order');
});

test('the Background panel opens inside the Live panel, above the bottom row, and closes with its × or the Background button', () => {
  const live = LIVE();
  const panelAt = live.indexOf('{backgroundOpen && <BackgroundPanel onClose={() => setBackgroundOpen(false)} />}');
  const rowAt = live.indexOf('<div className="flex w-full min-w-0 flex-nowrap items-center justify-between gap-1.5 overflow-hidden border-t border-line pt-4">');
  assert.ok(panelAt > 0, 'the panel is rendered when open');
  assert.ok(panelAt < rowAt, 'and sits above the bottom row');
  assert.match(live, /const \[backgroundOpen, setBackgroundOpen\] = useState\(false\);/);
  assert.match(live, /aria-expanded=\{backgroundOpen\}[\s\S]*?onClick=\{\(\) => setBackgroundOpen\(\(open\) => !open\)\}/, 'the Background button toggles the panel');
  const panel = read('src/operator/BackgroundPanel.tsx');
  assert.match(panel, /onClick=\{onClose\} aria-label="Close background"/, 'the × closes it');
  assert.match(panel, /e\.key === 'Escape'\) onClose\(\)/, 'Escape closes it');
});

test('the panel content is the same: Colour, Image, Video clip, the file picker, Loop, Fill or Show whole picture, and Shade', () => {
  const controls = read('src/settings/BackgroundControls.tsx');
  for (const label of ["label: 'Colour'", "label: 'Image'", "label: 'Video clip'", "'Fill screen'", "'Show whole picture'", "'Loop on'", "'Shade on'"]) {
    assert.ok(controls.includes(label), `${label} is in the panel`);
  }
  assert.match(controls, /Choose a video file|Choose an image file/, 'the file picker');
});

test('the bottom row is one line with no scrollbar: it spans the panel, the buttons keep their size, and nothing wraps', () => {
  const live = LIVE();
  assert.match(live, /className="flex w-full min-w-0 flex-nowrap items-center justify-between gap-1\.5 overflow-hidden border-t border-line pt-4"/, 'one line, no scrollbar');
  assert.doesNotMatch(live, /overflow-x-auto|overflow-x-scroll/, 'no horizontal scrollbar on the bar');
  const rowStyles = live.slice(live.indexOf('const ROW_BTN'), live.indexOf('const ROW_TOGGLE'));
  assert.match(rowStyles, /shrink-0/, 'the buttons do not shrink into each other');
  assert.match(rowStyles, /h-8/, 'the buttons share one compact height');
  assert.match(rowStyles, /px-2\.5/, 'the compact padding that fits a narrow panel');
});

test('Lower 3rd and Blackout still work from the Live panel', () => {
  const live = LIVE();
  assert.match(live, /aria-pressed=\{lowerOn\} className=\{ROW_TOGGLE\(lowerOn\)\} onClick=\{\(\) => dispatch\(\{ type: 'lowerThird\/toggle' \}\)\}/);
  assert.match(live, /aria-pressed=\{blackout\} className=\{ROW_TOGGLE\(blackout\)\} onClick=\{\(\) => dispatch\(\{ type: 'projector\/blackout' \}\)\}/);
});

test('the Live slide background stays separate from the Welcome background', () => {
  assert.match(read('src/operator/BackgroundPanel.tsx'), /useLive\(\(s\) => s\.state\.welcome\.slideBackground\)/, 'the panel reads the Live slide background');
  assert.match(read('src/operator/BackgroundPanel.tsx'), /bridge\.welcome\.save\(\{ slideBackground: \{ \.\.\.slide, \.\.\.patch \} \}\)/, 'and saves only that');
});

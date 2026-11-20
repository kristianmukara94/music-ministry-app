// The Live slide background is reached from the console's Stage Typography & Backdrop card (Media Background and the quick themes), and its
// panel opens inside that card. Lower Third, Blackout and Hide Text sit on the transport bar under the monitors, which wraps on a narrow console
// rather than scrolling. The Live slide background stays separate from the Welcome background.
// Run with: node --test shared/live-background-row.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const CARD = () => read('src/golive/console/TypographyCard.tsx');
const BAR = () => read('src/golive/console/TransportBar.tsx');

test('the Background button is in the console, not in the top toolbar', () => {
  assert.doesNotMatch(read('src/operator/TopBar.tsx'), /BackgroundPanel|top\.background|ImageIcon/, 'the top toolbar has no Background button or panel');
  assert.match(CARD(), /\{t\('consoleMediaBg'\)\}/, 'the typography card has the Media Background button');
  for (const file of ['src/praise-worship/LiveView.tsx', 'src/golive/MassLiveView.tsx']) assert.match(read(file), /<TypographyCard \/>/, file);
});

test('the transport bar order is Back, Next Slide, the counter, then Lower Third, Blackout, Hide Text', () => {
  const bar = BAR();
  const order = ["t('consoleBack')", "t('consoleNext')", '{counter &&', "t('consoleLowerThird'", "t('consoleBlackout'", "t('consoleHideText'"];
  const at = order.map((s) => bar.indexOf(s));
  assert.ok(at.every((i) => i >= 0), 'every control is on the bar');
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'in that order');
});

test('the Background panel opens inside the typography card, and closes with its × or the Media Background button', () => {
  const card = CARD();
  assert.match(card, /\{mediaOpen && <BackgroundPanel onClose=\{\(\) => setMediaOpen\(false\)\} \/>\}/);
  assert.match(card, /const \[mediaOpen, setMediaOpen\] = useState\(false\);/);
  assert.match(card, /aria-expanded=\{mediaOpen\} onClick=\{\(\) => setMediaOpen\(\(o\) => !o\)\}/, 'the button toggles the panel');
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

test('the transport bar wraps on a narrow console instead of scrolling, and its buttons keep their size', () => {
  const bar = BAR();
  assert.match(bar, /className="flex flex-wrap items-center justify-between gap-2\.5 border-t border-line pt-3\.5"/);
  assert.doesNotMatch(bar, /overflow-x-auto|overflow-x-scroll/, 'no horizontal scrollbar on the bar');
  const styles = read('src/golive/console/styles.ts');
  const btn = styles.slice(styles.indexOf('export const BTN ='), styles.indexOf('export const BTN_PRIMARY'));
  assert.match(btn, /shrink-0/, 'the buttons do not shrink into each other');
  assert.match(btn, /h-8/, 'one compact height');
  assert.match(btn, /whitespace-nowrap/, 'no label wraps');
});

test('Lower 3rd, Blackout and Hide Text work from the transport bar and the B, L and H keys', () => {
  const bar = BAR();
  assert.match(bar, /lowerThird: \(\) => dispatch\(\{ type: 'lowerThird\/toggle' \}\)/);
  assert.match(bar, /blackout: \(\) => dispatch\(\{ type: 'projector\/blackout' \}\)/);
  assert.match(bar, /hideText: \(\) => dispatch\(\{ type: 'projector\/hideText' \}\)/);
  assert.match(bar, /onClick=\{\(\) => dispatch\(\{ type: 'lowerThird\/pause' \}\)\}/, 'a band on air keeps its split Pause');
  for (const file of ['src/praise-worship/LiveView.tsx', 'src/golive/MassLiveView.tsx']) {
    // E opens the Output Preview Editor; B, L and H run the output actions.
    assert.match(read(file), /useConsoleKeys\(\(action\) => \(action === 'edit' \? [^:]+ : consoleOutputActions\[action\]\(\)\),/, `${file} binds B, L and H`);
  }
});

test('the Live slide background stays separate from the Welcome background', () => {
  assert.match(read('src/operator/BackgroundPanel.tsx'), /useLive\(\(s\) => s\.state\.welcome\.slideBackground\)/, 'the panel reads the Live slide background');
  assert.match(read('src/operator/BackgroundPanel.tsx'), /bridge\.welcome\.save\(\{ slideBackground: \{ \.\.\.slide, \.\.\.patch \} \}\)/, 'and saves only that');
  assert.match(CARD(), /bridge\.welcome\.save\(\{ slideBackground: withBackdropTheme\(slideBackground, id\) \}\)/, 'a quick theme saves only that too');
});

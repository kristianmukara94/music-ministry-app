// The slide text size: 70% to 150% in steps of 10%, applied on every text surface, and shown in the Live panel and the thumbnails. At 100% the
// sizes are the ones the slides were laid out for. Run with: node --test shared/slide-scale.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initialLiveState, liveReducer } from './live.js';
import { PROJECTOR_SETTINGS_DEFAULTS, SLIDE_FONT_SCALES, sanitizeProjectorSettings } from './projector-settings.js';
import { scaledSize } from './text-style.js';
import { secondaryViewSnapshot } from './remote-view.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const run = (state, ...actions) => actions.reduce((s, a) => liveReducer(s, a), state);

test('the scale steps from 70% to 150%, and starts at 100%', () => {
  assert.deepEqual(SLIDE_FONT_SCALES, [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5]);
  assert.equal(PROJECTOR_SETTINGS_DEFAULTS.slideFontScale, 1);
});

test('a saved scale that is a step is kept; anything else falls back to 100%', () => {
  assert.equal(sanitizeProjectorSettings({ slideFontScale: 1.2 }).slideFontScale, 1.2);
  assert.equal(sanitizeProjectorSettings({ slideFontScale: '0.8' }).slideFontScale, 0.8);
  assert.equal(sanitizeProjectorSettings({ slideFontScale: 1.23 }).slideFontScale, 1.2, 'a value between steps rounds to the nearest step');
  assert.equal(sanitizeProjectorSettings({ slideFontScale: 2 }).slideFontScale, 1, 'above the range is refused');
  assert.equal(sanitizeProjectorSettings({ slideFontScale: 0.5 }).slideFontScale, 1, 'below the range is refused');
  assert.equal(sanitizeProjectorSettings({}).slideFontScale, 1);
});

test('a size is unchanged at 100%, and multiplied by the scale otherwise', () => {
  assert.equal(scaledSize('5cqw', 1), '5cqw');
  assert.equal(scaledSize('5cqw', undefined), '5cqw');
  assert.equal(scaledSize('5cqw', 1.2), 'calc(5cqw * 1.2)');
  assert.equal(scaledSize('clamp(28px,4.1cqw,88px)', 0.8), 'calc(clamp(28px,4.1cqw,88px) * 0.8)');
});

test('the TV snapshot carries the scale, so the TV draws the same size as the projector', () => {
  const s = run(initialLiveState(), { type: 'output/toggle', output: 'projector' }, { type: 'projector/show', frame: { kind: 'text', title: 'Notice', text: 'Welcome', bg: null }, source: 'DIRECT_DECK' }, { type: 'display/live', value: true }, { type: 'settings/projector', value: { slideFontScale: 1.3 } });
  assert.equal(secondaryViewSnapshot(s, 1).frame.fontScale, 1.3);
  assert.equal(secondaryViewSnapshot(initialLiveState(), 1).frame.fontScale, 1, 'off or idle frames carry the normal size');
});

test('every text surface takes the scale: the projector, the praise and worship face, the TV, and the thumbnails', () => {
  const view = read('src/output/ProjectorView.tsx');
  assert.ok((view.match(/scaledSize\(/g) ?? []).length >= 5, 'the headed text, slide, lyric and song text use the scale');
  assert.match(view, /const max = \(style\?\.fontSize \? \(width \* style\.fontSize\) \/ 1920 : width \* 0\.045\) \* slideScale;/, 'the fitted prayer grows with the scale and still shrinks to fit');

  const face = read('src/praise-worship/PwSlideFace.tsx');
  assert.ok((face.match(/scaledSize\(/g) ?? []).length >= 2, 'the prayer and lyric text take the scale');
  assert.match(face, /const titleCqw = \(long \? 3\.6 : 4\.4\) \* \(slideScale \?\? 1\);/, 'the title takes the scale in proportion, with no ceiling, smaller for long titles');

  const tv = read('src/tv/LargeScreen.tsx');
  assert.match(tv, /const scale = frame\.fontScale \?\? 1;/);
  assert.match(tv, /scaledSize\('5cqw', scale\)/);

  assert.match(read('src/praise-worship/CurrentNextPreview.tsx'), /slideScale=\{slideScale\}/, 'the thumbnails follow the size');
});

test('the Live panel control saves the same settings as the Settings page, and sits in the row beside Blackout', () => {
  const control = read('src/praise-worship/SlideTypography.tsx');
  assert.match(control, /bridge\.projector\.save\(patch\)/, 'the same save path as the Settings page');
  assert.match(control, /aria-label="Slide font"/);
  assert.match(control, /aria-label="Larger text"/);
  assert.match(control, /aria-label="Smaller text"/);
  assert.match(read('src/praise-worship/LiveView.tsx'), /<SlideTypography \/>/);
});

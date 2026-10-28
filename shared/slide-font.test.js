// The slide font: one choice for the slide text on the projector and the TV. Null keeps each slide's own face. Only the bundled fonts
// are offered, so no font is fetched from outside. Run with: node --test shared/slide-font.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PROJECTOR_SETTINGS_DEFAULTS, SLIDE_FONTS, sanitizeProjectorSettings } from './projector-settings.js';
import { TEXT_FONTS, slideFontCss } from './text-style.js';
import { initialLiveState, liveReducer } from './live.js';
import { secondaryViewSnapshot } from './remote-view.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const run = (state, ...actions) => actions.reduce((s, a) => liveReducer(s, a), state);
const TEXT = { kind: 'text', title: 'Notice', text: 'Welcome', bg: null };

test('the default keeps each slide\'s own face', () => {
  assert.equal(PROJECTOR_SETTINGS_DEFAULTS.slideFont, null);
  assert.equal(slideFontCss(null), undefined);
  assert.equal(sanitizeProjectorSettings({}).slideFont, null);
});

test('only a bundled font key is kept; anything else falls back to the default', () => {
  assert.equal(sanitizeProjectorSettings({ slideFont: 'roboto' }).slideFont, 'roboto');
  assert.equal(sanitizeProjectorSettings({ slideFont: 'Comic Sans' }).slideFont, null);
  assert.equal(sanitizeProjectorSettings({ slideFont: 'constructor' }).slideFont, null, 'an object key is not a font');
  assert.equal(sanitizeProjectorSettings({ slideFont: 'georgia' }).slideFont, null, 'Georgia is the system font, not a bundled one');
  assert.ok(SLIDE_FONTS.length > 0 && SLIDE_FONTS.every((key) => Object.hasOwn(TEXT_FONTS, key)), 'every offered font is a known one');
  assert.ok(!SLIDE_FONTS.includes('georgia'));
});

test('a font key gives its CSS stack, and an unknown key gives none', () => {
  assert.equal(slideFontCss('serif'), TEXT_FONTS.serif.css);
  assert.equal(slideFontCss('nope'), undefined);
});

test('the Secondary display carries the chosen font on a slide, and null before one is chosen', () => {
  let s = run(initialLiveState(), { type: 'output/toggle', output: 'projector' }, { type: 'projector/show', frame: TEXT, source: 'DIRECT_DECK' }, { type: 'display/live', value: true });
  assert.equal(secondaryViewSnapshot(s, 1).frame.font, null);
  s = run(s, { type: 'settings/projector', value: { slideFont: 'bodoni' } });
  assert.equal(secondaryViewSnapshot(s, 1).frame.font, 'bodoni');
});

test('the projector, the praise and worship face, the TV and the settings panel all use the one setting', () => {
  assert.match(read('src/output/ProjectorView.tsx'), /const useSlideFont = \(\): string \| undefined => useOutput\(\(s\) => slideFontCss\(s\.settings\.slideFont\)\);/);
  assert.match(read('src/praise-worship/PwSlideFace.tsx'), /fontFamily: slideFont/);
  assert.match(read('src/tv/LargeScreen.tsx'), /const fontFamily = slideFontCss\(frame\.font\);/);
  assert.match(read('src/settings/ProjectorSettings.tsx'), /aria-label="Slide font"/);
  assert.match(read('src/settings/ProjectorSettings.tsx'), /save\(\{ slideFont: e\.target\.value \|\| null \}\)/);
});

test('a slide\'s own font still wins: every styled text face falls back to the slide font, not over it', () => {
  const view = read('src/output/ProjectorView.tsx');
  const uses = view.match(/fontCss\((style|frame\.style)\) \?\? slideFont/g) ?? [];
  assert.equal(uses.length, 5, 'TextLines, HeadedText, Slide, FittedPrayer and the song text');
});

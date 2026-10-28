// The welcome image's fit: "Fill screen" covers the output with no bars and crops only the edges, centred; "Show whole picture" shows the
// whole picture inside the output with the background colour in the bars. The choice defaults to Fill, is kept with the welcome settings, and
// the projector and the settings preview draw it the same way. The text welcome type is unchanged. Run with: node --test shared/welcome-image.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { IMAGE_FITS, WELCOME_DEFAULTS, WELCOME_CONTENT_DEFAULTS, fittedPicture, sanitizeWelcomeSettings } from './welcome-settings.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const BOX = { w: 1920, h: 1080 };
const PORTRAIT = { w: 800, h: 1000 };
const LANDSCAPE = { w: 1600, h: 900 };
const COVER_CROP = { w: 3000, h: 1000 };

test('the choice defaults to Fill screen, and an existing welcome image without a choice is Fill too', () => {
  assert.deepEqual(IMAGE_FITS, ['FILL', 'FIT']);
  assert.equal(WELCOME_DEFAULTS.imageFit, 'FILL');
  assert.equal(sanitizeWelcomeSettings({}).imageFit, 'FILL', 'nothing saved');
  assert.equal(sanitizeWelcomeSettings({ welcomeType: 'IMAGE', imageUrl: 'apcc-media://a.png' }).imageFit, 'FILL', 'an image saved before the setting existed');
  assert.equal(sanitizeWelcomeSettings({ imageFit: 'STRETCH' }).imageFit, 'FILL', 'an unknown value falls back to Fill');
  assert.equal(WELCOME_CONTENT_DEFAULTS.imageFit, 'FILL', 'reset content puts Fill back');
});

test('the choice is kept as it is saved and read back', () => {
  assert.equal(sanitizeWelcomeSettings({ imageFit: 'FIT' }).imageFit, 'FIT');
  const saved = JSON.parse(JSON.stringify(sanitizeWelcomeSettings({ imageFit: 'FIT' })));
  assert.equal(sanitizeWelcomeSettings(saved).imageFit, 'FIT', 'a save and a reload keep Show whole picture');
});

test('Fill screen covers the whole output with no bars, and crops only the edges, centred', () => {
  for (const pic of [PORTRAIT, COVER_CROP, LANDSCAPE]) {
    const f = fittedPicture('FILL', BOX.w, BOX.h, pic.w, pic.h);
    assert.ok(f.width >= BOX.w - 1e-6 && f.height >= BOX.h - 1e-6, `the picture ${pic.w}x${pic.h} covers the output`);
    // Only one axis overflows, unless the picture has the output's own proportion; the overflow is cut equally at both ends.
    const overflowX = f.width - BOX.w;
    const overflowY = f.height - BOX.h;
    assert.ok(overflowX < 1e-6 || overflowY < 1e-6, 'it crops one pair of edges, not both');
    assert.ok(Math.abs(f.left + f.width / 2 - BOX.w / 2) < 1e-6, 'centred across the output');
    assert.ok(Math.abs(f.top + f.height / 2 - BOX.h / 2) < 1e-6, 'centred down the output');
  }
  // The portrait picture is cropped top and bottom, equally: no black bar on the sides.
  const portrait = fittedPicture('FILL', BOX.w, BOX.h, PORTRAIT.w, PORTRAIT.h);
  assert.equal(portrait.left, 0, 'no bar at the left');
  assert.ok(Math.abs(portrait.top + (portrait.height - BOX.h) / 2) < 1e-6 && portrait.top < 0, 'cropped equally at the top and the bottom');
  // A landscape picture of the output\'s own proportion fills it exactly.
  const landscape = fittedPicture('FILL', BOX.w, BOX.h, LANDSCAPE.w, LANDSCAPE.h);
  assert.deepEqual([landscape.width, landscape.height, landscape.left, landscape.top], [1920, 1080, 0, 0]);
});

test('Show whole picture shows the full picture inside the output, with the background colour in the bars and no cropping', () => {
  for (const pic of [PORTRAIT, COVER_CROP, LANDSCAPE]) {
    const f = fittedPicture('FIT', BOX.w, BOX.h, pic.w, pic.h);
    assert.ok(f.width <= BOX.w + 1e-6 && f.height <= BOX.h + 1e-6, `the whole ${pic.w}x${pic.h} picture is inside the output`);
    assert.ok(f.left >= -1e-6 && f.top >= -1e-6, 'nothing is cut off');
    assert.ok(Math.abs(f.width / f.height - pic.w / pic.h) < 1e-6, 'its proportion is kept');
  }
  const portrait = fittedPicture('FIT', BOX.w, BOX.h, PORTRAIT.w, PORTRAIT.h);
  assert.equal(portrait.top, 0, 'a portrait picture fills the height');
  assert.ok(portrait.left > 0 && Math.abs(portrait.left * 2 + portrait.width - BOX.w) < 1e-6, 'the bars are on both sides, equal');
});

test('the canvas draws the image the chosen way, on the background colour, in both modes', () => {
  const canvas = read('src/output/WelcomeScreen.tsx');
  assert.match(canvas, /settings\.imageFit !== 'FIT'/, 'Fill is the default; only Show whole picture keeps the padding');
  assert.match(canvas, /absolute inset-0 h-full w-full object-cover object-center/, 'Fill covers the output, centred');
  assert.match(canvas, /h-full w-full object-contain object-center/, 'Show whole picture fits the output, centred');
  assert.match(canvas, /backgroundColor: background\.color/, 'the background colour is behind the picture in both modes');
});

test('the text welcome type is unchanged: the same padding, the same size and the same text', () => {
  const canvas = read('src/output/WelcomeScreen.tsx');
  assert.match(canvas, /font-serif leading-tight font-semibold whitespace-pre-line/, 'the message is drawn as before');
  assert.match(canvas, /fontSize: `\$\{settings\.fontSize \/ 19\.2\}cqw`/, 'the size is the operator\'s size');
  assert.match(canvas, /'p-\[6cqw\]'/, 'the text keeps the padding');
});

test('the projector and the settings preview draw the same welcome canvas, and the settings offer both choices', () => {
  assert.match(read('src/output/WelcomeScreen.tsx'), /export function WelcomeFrame\(\)[\s\S]*<WelcomeCanvas settings=\{welcome\} \/>/, 'the projector draws the canvas');
  assert.match(read('src/settings/WelcomeScreenSettings.tsx'), /<WelcomeCanvas settings=\{welcome\} onBackgroundMissing/, 'the preview draws the same canvas');
  const settings = read('src/settings/WelcomeScreenSettings.tsx');
  assert.match(settings, /label: 'Fill screen'/);
  assert.match(settings, /label: 'Show whole picture'/);
  assert.match(settings, /onClick=\{\(\) => update\(\{ imageFit: id \}\)\}/, 'the choice is saved with the welcome settings');
  assert.match(read('src/output/ProjectorView.tsx'), /case 'welcome':[\s\S]*<WelcomeFrame \/>/, 'the projector shows the welcome screen from the same settings');
});

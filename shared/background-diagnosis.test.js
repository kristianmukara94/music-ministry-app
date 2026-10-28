// A background video that cannot play is never a silent fallback: its setting's panel says why, in words that name the cause. The Live slides'
// colour default is the design canvas (#100306), and the Colour swatch shows the colour the slides actually use. The media route answers
// byte-range requests itself (see electron/protocol-range.test.mjs). Run with: node --test shared/background-diagnosis.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MEDIA_ERR, describeMediaError } from './media-error.js';
import { SLIDE_CANVAS_COLOR, WELCOME_CANVAS_COLOR, WELCOME_DEFAULTS, sanitizeWelcomeSettings, welcomeBackground } from './welcome-settings.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

test('an unplayable video gives its reason: the format or codec, the decode, the file, or the stop', () => {
  assert.match(describeMediaError('video', MEDIA_ERR.SRC_NOT_SUPPORTED), /format or its codec is not supported.*HEVC\/H\.265, or MKV/);
  assert.match(describeMediaError('video', MEDIA_ERR.DECODE), /could not be decoded/);
  assert.match(describeMediaError('video', MEDIA_ERR.NETWORK), /could not be read from the Media Library/);
  assert.match(describeMediaError('video', MEDIA_ERR.ABORTED), /stopped/);
  assert.match(describeMediaError('video', null, 3), /could not be read from the Media Library/, 'a network state of no source is a missing file');
  assert.match(describeMediaError('video', null), /did not report a reason/, 'an unknown error still says so');
});

test('a picture that cannot be read gives its reason too', () => {
  assert.match(describeMediaError('image', null), /picture could not be read/);
});

test('the panel says the video cannot play, with the reason, and never falls back silently', () => {
  const controls = read('src/settings/BackgroundControls.tsx');
  assert.match(controls, /\{kind === 'video' \? 'This video cannot play' : 'This picture cannot be shown'\}: \{playFailed\}\./, 'the warning names the cause');
  assert.match(read('src/output/BackgroundMedia.tsx'), /reportMediaFailed\(src, reason\);/, 'the reason is recorded with the file');
  assert.match(read('src/output/BackgroundMedia.tsx'), /describeMediaError\('video', video\.error \? video\.error\.code : null, video\.networkState\)/);
});

test('the failure is logged with its URL, code, network and ready states, and a refused play() is logged with its reason', () => {
  const media = read('src/output/BackgroundMedia.tsx');
  assert.match(media, /console\.warn\('\[background\] video error', \{ url: video\.currentSrc, code: video\.error \? video\.error\.code : null, networkState: video\.networkState, readyState: video\.readyState \}\);/);
  assert.match(media, /console\.warn\('\[background\] play\(\) was refused', \{ url: video\.currentSrc, error:/);
});

test('the Live slides’ colour default is the design canvas, and the swatch shows it', () => {
  assert.equal(SLIDE_CANVAS_COLOR, '#100306', 'the default Live slide colour is the design canvas');
  assert.equal(WELCOME_CANVAS_COLOR, '#000000', 'the Welcome default is unchanged');
  assert.equal(sanitizeWelcomeSettings({}).slideBackground.backgroundColor, null, 'the colour is unset: the slides keep their canvas');
  assert.equal(welcomeBackground(sanitizeWelcomeSettings({}).slideBackground).color, null, 'so no colour is drawn over the canvas');
  assert.match(read('src/operator/BackgroundPanel.tsx'), /unsetColor=\{SLIDE_CANVAS_COLOR\}/, 'the Live panel swatch shows the slide colour when unset');
  assert.match(read('src/settings/BackgroundControls.tsx'), /value=\{\(colorDraft \?\? value\.backgroundColor \?\? unsetColor\)\.toLowerCase\(\)\}/);
});

test('the Welcome background is unchanged by the diagnosis: its default, its colour and its video', () => {
  assert.equal(WELCOME_DEFAULTS.backgroundColor, null);
  assert.equal(welcomeBackground(sanitizeWelcomeSettings({})).color, null);
  assert.match(read('src/output/WelcomeScreen.tsx'), /background\.color \?\? WELCOME_CANVAS_COLOR/);
  assert.doesNotMatch(read('src/output/WelcomeScreen.tsx'), /SlideBackgroundLayer/);
});

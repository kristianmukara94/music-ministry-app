// The background behind the text: a colour (unset by default, so each surface keeps its own dark colour), a picture, or a video clip. A picture or
// video covers the output with the Fill or Show whole picture setting; a video loops when Loop is on, and otherwise holds its last frame; audio is
// always off; a shade sits behind the text when that is on. A file that is missing falls back to the colour and is reported. The Welcome screen
// and the Praise & Worship slides draw it with the same shared component. Run with: node --test shared/welcome-background.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BACKGROUND_TYPES, WELCOME_CANVAS_COLOR, WELCOME_DEFAULTS, WELCOME_STYLE_DEFAULTS, backgroundMissing, sanitizeWelcomeSettings, welcomeBackground } from './welcome-settings.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const URL_IMAGE = 'apcc-media://media/3';
const URL_VIDEO = 'apcc-media://media/4';

test('the colour is unset by default, so the Welcome screen and the slides keep their own dark colours', () => {
  assert.deepEqual(BACKGROUND_TYPES, ['COLOR', 'IMAGE', 'VIDEO']);
  const settings = sanitizeWelcomeSettings({});
  assert.equal(settings.backgroundType, 'COLOR');
  assert.equal(settings.backgroundColor, null, 'unset');
  assert.equal(WELCOME_CANVAS_COLOR, '#000000', 'the Welcome screen keeps its black');
  assert.deepEqual(welcomeBackground(settings), { color: null, media: null, shade: false });
  assert.equal(WELCOME_DEFAULTS.videoLoop, true, 'a video loops by default');
  assert.equal(WELCOME_DEFAULTS.textShade, true, 'the shade is on by default');
  assert.equal(WELCOME_STYLE_DEFAULTS.backgroundType, 'COLOR', 'reset style puts the colour back');
});

test('a chosen colour is kept, and draws the colour and nothing else', () => {
  const settings = sanitizeWelcomeSettings({ backgroundType: 'COLOR', backgroundColor: '#1a3b6e', backgroundUrl: URL_IMAGE });
  assert.deepEqual(welcomeBackground(settings), { color: '#1A3B6E', media: null, shade: false }, 'a colour ignores any file kept with it, and no shade is drawn');
});

test('a picture background covers the output when Fill is chosen, and keeps the colour in the bars when Show whole picture is chosen', () => {
  const fill = sanitizeWelcomeSettings({ backgroundType: 'IMAGE', backgroundUrl: URL_IMAGE, backgroundColor: '#112233' });
  assert.deepEqual(welcomeBackground(fill), { color: '#112233', media: { kind: 'image', src: URL_IMAGE, fit: 'cover', loop: true }, shade: true });
  const fit = sanitizeWelcomeSettings({ backgroundType: 'IMAGE', backgroundUrl: URL_IMAGE, imageFit: 'FIT' });
  assert.equal(welcomeBackground(fit).media.fit, 'contain', 'Show whole picture: the whole picture shows, with the colour in the bars');
});

test('a video background loops by default, and plays once and holds its last frame when Loop is off', () => {
  const looping = sanitizeWelcomeSettings({ backgroundType: 'VIDEO', backgroundUrl: URL_VIDEO });
  assert.deepEqual(welcomeBackground(looping).media, { kind: 'video', src: URL_VIDEO, fit: 'cover', loop: true });
  const once = sanitizeWelcomeSettings({ backgroundType: 'VIDEO', backgroundUrl: URL_VIDEO, videoLoop: false });
  assert.equal(welcomeBackground(once).media.loop, false, 'Loop off: it plays once and stays on its last frame');
  assert.equal(sanitizeWelcomeSettings({ videoLoop: 'yes' }).videoLoop, true, 'a value that is not on or off falls back to on');
});

test('the shade is drawn behind the text only with a picture or a video, and only when it is on', () => {
  const on = sanitizeWelcomeSettings({ backgroundType: 'VIDEO', backgroundUrl: URL_VIDEO });
  assert.equal(welcomeBackground(on).shade, true, 'on by default with a video');
  const off = sanitizeWelcomeSettings({ backgroundType: 'VIDEO', backgroundUrl: URL_VIDEO, textShade: false });
  assert.equal(welcomeBackground(off).shade, false, 'the operator can switch it off');
  assert.equal(welcomeBackground(off).media.kind, 'video', 'the video itself is still there');
  const colour = sanitizeWelcomeSettings({ backgroundType: 'COLOR', textShade: true });
  assert.equal(welcomeBackground(colour).shade, false, 'a colour background keeps its look: no shade');
  assert.equal(sanitizeWelcomeSettings({ textShade: 'yes' }).textShade, true, 'a value that is not on or off falls back to on');
});

test('a missing file falls back to the colour, and is reported', () => {
  const settings = sanitizeWelcomeSettings({ backgroundType: 'VIDEO', backgroundUrl: URL_VIDEO, backgroundColor: '#445566' });
  // The file would not load: the screen shows the colour instead.
  assert.deepEqual(welcomeBackground(settings, true), { color: '#445566', media: null, shade: false });
  // The file is not in the library any more: it is reported, so the settings can warn.
  assert.equal(backgroundMissing(settings, []), true);
  assert.equal(backgroundMissing(settings, [URL_VIDEO]), false, 'a file that is there is not reported');
  assert.equal(backgroundMissing(settings, null), false, 'nothing is reported while the library is not known');
  assert.equal(backgroundMissing(sanitizeWelcomeSettings({}), []), false, 'a colour is never missing');
});

test('the choice is kept with the settings, and an old config reads as the colour', () => {
  const saved = JSON.parse(JSON.stringify(sanitizeWelcomeSettings({ backgroundType: 'VIDEO', backgroundUrl: URL_VIDEO, videoLoop: false, textShade: false })));
  const reloaded = sanitizeWelcomeSettings(saved);
  assert.equal(reloaded.backgroundType, 'VIDEO');
  assert.equal(reloaded.backgroundUrl, URL_VIDEO);
  assert.equal(reloaded.videoLoop, false);
  assert.equal(reloaded.textShade, false);
  const old = sanitizeWelcomeSettings({ welcomeType: 'TEXT', backgroundColor: '#000000' });
  assert.equal(old.backgroundType, 'COLOR');
  assert.equal(old.backgroundColor, '#000000', 'a colour saved before is kept as the chosen colour');
  assert.equal(sanitizeWelcomeSettings({ backgroundUrl: '/Users/me/Downloads/clip.mp4', backgroundType: 'VIDEO' }).backgroundUrl, null, 'a path into the downloads is not kept: only the media library');
});

test('the video is muted, has no controls, loops only when Loop is on, and the picture follows Fill or Show whole picture', () => {
  const media = read('src/output/BackgroundMedia.tsx');
  assert.match(media, /<video\s+ref=\{ref\}[\s\S]*?muted[\s\S]*?autoPlay[\s\S]*?playsInline[\s\S]*?loop=\{loop\}/, 'muted, autoplay, and loop from the setting');
  assert.doesNotMatch(media, /<video[^>]*controls/, 'no controls on the output');
  assert.match(media, /const fit = media\.fit === 'contain' \? 'object-contain' : 'object-cover';/, 'Fill covers, Show whole picture fits');
});

test('the Welcome screen draws the background from the same rule and the same component as the slides', () => {
  const canvas = read('src/output/WelcomeScreen.tsx');
  assert.match(canvas, /const background = welcomeBackground\(settings, failed\);/);
  assert.match(canvas, /<BackgroundMedia media=\{background\.media\}/, 'the same media component as the slides');
  assert.match(canvas, /backgroundColor: background\.color \?\? WELCOME_CANVAS_COLOR/, 'an unset colour keeps the Welcome black');
});

test('the text welcome type is unchanged', () => {
  const canvas = read('src/output/WelcomeScreen.tsx');
  assert.match(canvas, /font-serif leading-tight font-semibold whitespace-pre-line/);
  assert.match(canvas, /fontSize: `\$\{settings\.fontSize \/ 19\.2\}cqw`/);
});

test('the settings offer Colour, Image and Video; the Loop and Shade switches; and a warning for a missing file', () => {
  const settings = read('src/settings/BackgroundControls.tsx');
  assert.match(settings, /\{ id: 'COLOR', label: 'Colour' \}/);
  assert.match(settings, /\{ id: 'IMAGE', label: 'Image' \}/);
  assert.match(settings, /\{ id: 'VIDEO', label: 'Video clip' \}/);
  assert.match(settings, /role="switch"[\s\S]*?Loop on/, 'the Loop control is a switch');
  assert.match(settings, /Shade on/, 'the shade is a switch');
  assert.match(settings, /The background file is missing, so the screen shows the background colour instead/);
  assert.match(settings, /aria-label="Background colour picker"/, 'the colour picker is kept');
});

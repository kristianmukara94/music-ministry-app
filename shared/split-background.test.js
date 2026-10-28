// The Welcome background and the Live slide background are two saved settings. Changing one never changes the other: the Welcome screen reads the
// top-level background fields, and the Live set's slides (the Current and Next panels, the Live preview and the projector) read `slideBackground`.
// Each has its own type, colour, file, Loop and Fill or Show whole picture. An existing saved background is copied to the Welcome background on
// upgrade, and the Live slide background starts at its default. Run with: node --test shared/split-background.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initialLiveState, liveReducer } from './live.js';
import { BACKGROUND_DEFAULTS, WELCOME_DEFAULTS, backgroundMissing, sanitizeWelcomeSettings, welcomeBackground } from './welcome-settings.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const WELCOME_IMAGE = 'apcc-media://media/10';
const WELCOME_VIDEO = 'apcc-media://media/11';
const LIVE_IMAGE = 'apcc-media://media/20';
const LIVE_VIDEO = 'apcc-media://media/21';

/** Saves a change the way the app does: the same action the main process sends after `welcome:save`. */
const save = (state, value) => liveReducer(state, { type: 'settings/welcome', value });

test('the two backgrounds are separate: each has its own settings, and the Live slide background starts at its default', () => {
  const state = initialLiveState();
  assert.equal(state.welcome.backgroundType, 'COLOR', 'the Welcome background starts as the colour');
  assert.deepEqual(state.welcome.slideBackground, BACKGROUND_DEFAULTS, 'the Live slide background starts at its defaults');
  assert.equal(WELCOME_DEFAULTS.slideBackground.backgroundType, 'COLOR');
});

test('changing the Welcome background does not change the Live slides, the Current and Next panels or the projector slides', () => {
  let state = initialLiveState();
  const slideBefore = state.welcome.slideBackground;
  state = save(state, { backgroundType: 'IMAGE', backgroundUrl: WELCOME_IMAGE, backgroundColor: '#123456', videoLoop: false });
  state = save(state, { backgroundType: 'VIDEO', backgroundUrl: WELCOME_VIDEO, videoLoop: false });
  // The Live slides read their own setting, and it is untouched.
  assert.deepEqual(state.welcome.slideBackground, slideBefore, 'the Live slide background is the same object');
  assert.equal(welcomeBackground(state.welcome.slideBackground).media, null, 'the Live slides show no picture or video');
  assert.equal(welcomeBackground(state.welcome.slideBackground).color, null, 'and keep their own colour');
  // The Welcome screen does change.
  assert.equal(welcomeBackground(state.welcome).media.kind, 'video');
  assert.equal(welcomeBackground(state.welcome).media.loop, false);
});

test('changing the Live slide background does not change the Welcome screen', () => {
  let state = initialLiveState();
  state = save(state, { backgroundType: 'VIDEO', backgroundUrl: WELCOME_VIDEO });
  const welcomeBefore = { ...state.welcome };
  state = save(state, { slideBackground: { ...state.welcome.slideBackground, backgroundType: 'IMAGE', backgroundUrl: LIVE_IMAGE, backgroundFit: 'FIT', backgroundColor: '#654321' } });
  for (const key of Object.keys(welcomeBefore)) {
    if (key !== 'slideBackground') assert.deepEqual(state.welcome[key], welcomeBefore[key], `the Welcome setting ${key} is unchanged`);
  }
  assert.equal(welcomeBackground(state.welcome).media.src, WELCOME_VIDEO, 'the Welcome screen still shows its video');
  assert.equal(welcomeBackground(state.welcome.slideBackground).media.src, LIVE_IMAGE, 'the Live slides show their own picture');
  assert.equal(welcomeBackground(state.welcome.slideBackground).media.fit, 'contain', 'with Show whole picture of their own');
});

test('each background has its own Loop and Fill or Show whole picture', () => {
  let state = initialLiveState();
  state = save(state, { backgroundType: 'VIDEO', backgroundUrl: WELCOME_VIDEO, backgroundFit: 'FIT', videoLoop: false });
  state = save(state, { slideBackground: { ...state.welcome.slideBackground, backgroundType: 'VIDEO', backgroundUrl: LIVE_VIDEO, backgroundFit: 'FILL', videoLoop: true } });
  const welcome = welcomeBackground(state.welcome).media;
  const live = welcomeBackground(state.welcome.slideBackground).media;
  assert.deepEqual({ fit: welcome.fit, loop: welcome.loop }, { fit: 'contain', loop: false }, 'the Welcome video: Show whole picture, plays once');
  assert.deepEqual({ fit: live.fit, loop: live.loop }, { fit: 'cover', loop: true }, 'the Live video: Fill, loops');
});

test('the Welcome image keeps its own Fill or Show whole picture, separate from the Welcome background', () => {
  const state = sanitizeWelcomeSettings({ imageFit: 'FIT', backgroundFit: 'FILL' });
  assert.equal(state.imageFit, 'FIT', 'the Welcome image is shown whole');
  assert.equal(state.backgroundFit, 'FILL', 'the Welcome background still fills');
});

test('the existing saved background is copied to the Welcome background on upgrade, and the Live slide background starts at its default', () => {
  // A config saved before the split: one background, with the picture fit it was drawn with.
  const legacy = { welcomeType: 'TEXT', message: 'Welcome', backgroundType: 'VIDEO', backgroundUrl: WELCOME_VIDEO, videoLoop: false, imageFit: 'FIT', backgroundColor: '#0A0A0A', textShade: false };
  const upgraded = sanitizeWelcomeSettings(legacy);
  assert.equal(upgraded.backgroundType, 'VIDEO', 'the Welcome background keeps the video');
  assert.equal(upgraded.backgroundUrl, WELCOME_VIDEO);
  assert.equal(upgraded.videoLoop, false, 'with its Loop setting');
  assert.equal(upgraded.backgroundFit, 'FIT', 'with the fit it was drawn with');
  assert.equal(upgraded.backgroundColor, '#0A0A0A');
  assert.equal(upgraded.textShade, false);
  assert.deepEqual(upgraded.slideBackground, BACKGROUND_DEFAULTS, 'the Live slide background starts at its default');
});

test('each setting saves and reloads on its own', () => {
  let state = initialLiveState();
  state = save(state, { backgroundType: 'IMAGE', backgroundUrl: WELCOME_IMAGE });
  state = save(state, { slideBackground: { ...state.welcome.slideBackground, backgroundType: 'VIDEO', backgroundUrl: LIVE_VIDEO, videoLoop: false } });
  const reloaded = sanitizeWelcomeSettings(JSON.parse(JSON.stringify(state.welcome)));
  assert.equal(reloaded.backgroundUrl, WELCOME_IMAGE, 'the Welcome background is kept');
  assert.equal(reloaded.slideBackground.backgroundUrl, LIVE_VIDEO, 'the Live slide background is kept');
  assert.equal(reloaded.slideBackground.videoLoop, false);
});

test('a missing file falls back to that setting\'s colour; its warning is only on its own screen', () => {
  const welcome = sanitizeWelcomeSettings({ backgroundType: 'IMAGE', backgroundUrl: WELCOME_IMAGE, backgroundColor: '#111111' });
  const live = sanitizeWelcomeSettings({ slideBackground: { backgroundType: 'VIDEO', backgroundUrl: LIVE_VIDEO, backgroundColor: '#222222' } }).slideBackground;
  assert.equal(backgroundMissing(welcome, []), true, 'the Welcome file is missing');
  assert.equal(backgroundMissing(live, []), true, 'the Live file is missing');
  assert.deepEqual(welcomeBackground(welcome, true), { color: '#111111', media: null, shade: false });
  assert.deepEqual(welcomeBackground(live, true), { color: '#222222', media: null, shade: false });
  // Each warning is shown by its own screen: the Welcome page passes its own preview flag, and the Live panel reads its own setting.
  assert.match(read('src/settings/WelcomeScreenSettings.tsx'), /<BackgroundControls value=\{welcome\} save=\{\(patch\) => bridge\.welcome\.save\(patch\)\} previewMissing=\{previewMissing\} \/>/);
  assert.match(read('src/operator/BackgroundPanel.tsx'), /<BackgroundControls value=\{slide\} save=\{\(patch\) => bridge\.welcome\.save\(\{ slideBackground: \{ \.\.\.slide, \.\.\.patch \} \}\)\} unsetColor=\{SLIDE_CANVAS_COLOR\} \/>/);
});

test('the Current and Next panels and the projector read the Live slide background; the Welcome screen reads the Welcome background', () => {
  assert.match(read('src/praise-worship/CurrentNextPreview.tsx'), /welcomeBackground\(useLive\(\(s\) => s\.state\.welcome\.slideBackground\)\)/);
  assert.match(read('src/output/ProjectorView.tsx'), /welcomeBackground\(useOutput\(\(s\) => s\.welcome\.slideBackground\)\)/);
  assert.match(read('src/output/WelcomeScreen.tsx'), /const background = welcomeBackground\(settings, failed\);/, 'the Welcome screen reads the Welcome settings');
  assert.match(read('src/output/WelcomeScreen.tsx'), /<WelcomeFrame \/>|export function WelcomeFrame\(\)/);
});

test('the Lower 3rd and Blackout buttons are still there, now in the Live panel row beside the Background button', () => {
  const live = read('src/praise-worship/LiveView.tsx');
  assert.match(live, /dispatch\(\{ type: 'lowerThird\/toggle' \}\)/, 'Lower 3rd still toggles');
  assert.match(live, /dispatch\(\{ type: 'projector\/blackout' \}\)/, 'Blackout still toggles');
  assert.match(live, /\{tMain\('top\.background'\)\}/, 'the Background button is in the Live panel');
  assert.doesNotMatch(read('src/operator/TopBar.tsx'), /top\.background/, 'and no longer in the top toolbar');
});

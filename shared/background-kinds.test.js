// Each background keeps its own picture and its own video. Switching the type tab shows the file last chosen for that kind: Colour shows the
// colour, Video shows the video last chosen, and Image shows the picture last chosen, at once. Run with: node --test shared/background-kinds.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sanitizeWelcomeSettings, welcomeBackground } from './welcome-settings.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const PICTURE = 'apcc-media://media/21';
const VIDEO = 'apcc-media://media/22';

test('the picture and the video each keep their own file in the saved settings', () => {
  const s = sanitizeWelcomeSettings({ imageFile: PICTURE, videoFile: VIDEO, backgroundType: 'COLOR' });
  assert.equal(s.imageFile, PICTURE);
  assert.equal(s.videoFile, VIDEO);
  assert.equal(welcomeBackground(s).media, null, 'Colour shows the colour, not a file');
});

test('switching to Video shows the video last chosen, and switching to Image the picture last chosen', () => {
  const video = sanitizeWelcomeSettings({ backgroundType: 'VIDEO', backgroundUrl: VIDEO, videoFile: VIDEO, imageFile: PICTURE });
  assert.equal(welcomeBackground(video).media.kind, 'video');
  assert.equal(welcomeBackground(video).media.src, VIDEO);
  const picture = sanitizeWelcomeSettings({ backgroundType: 'IMAGE', backgroundUrl: PICTURE, videoFile: VIDEO, imageFile: PICTURE });
  assert.equal(welcomeBackground(picture).media.kind, 'image');
  assert.equal(welcomeBackground(picture).media.src, PICTURE);
});

test('the tab switch uses the remembered file of that kind, and remembers the file it leaves', () => {
  const controls = read('src/settings/BackgroundControls.tsx');
  assert.match(controls, /const returning = id === 'VIDEO' \? value\.videoFile : value\.imageFile;/, 'the tab brings back the file of its kind');
  assert.match(controls, /change\(\{ \.\.\.remembered, backgroundType: id, backgroundUrl: returning \}\);/, 'and shows it at once');
  assert.match(controls, /const remembered: Partial<BackgroundSettings> = leaving && value\.backgroundUrl \? \{ \[leaving\]: value\.backgroundUrl \} : \{\};/, 'the file being left is remembered first');
});

test('choosing or removing a file updates the remembered file of its kind', () => {
  const controls = read('src/settings/BackgroundControls.tsx');
  assert.match(controls, /const chooseFile = \(src: string \| null\) => \{/);
  assert.match(controls, /change\(\{ backgroundUrl: src, \.\.\.\(field \? \{ \[field\]: src \} : \{\}\) \}\);/);
  assert.match(controls, /change\(\{ backgroundUrl: null, backgroundType: 'COLOR', \.\.\.\(field \? \{ \[field\]: null \} : \{\}\) \}\);/);
});

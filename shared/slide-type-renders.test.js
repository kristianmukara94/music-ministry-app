// The type the operator selects is what the Live slide shows. A saved colour stays saved, but it is painted only when Colour is the type: with
// Image or Video selected, the slide must not paint the colour over the picture or video behind it. Colour, Image and Video show the same on the
// Current and Next panels, the Live preview and the projector, because they all draw the slide with the same face and the same layer.
// Run with: node --test shared/slide-type-renders.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sanitizeWelcomeSettings, welcomeBackground } from './welcome-settings.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const BASE = { backgroundColor: '#A32E2E', backgroundUrl: 'apcc-media://media/30', imageFile: 'apcc-media://media/31', videoFile: 'apcc-media://media/30' };

test('Colour selected: the slide shows the chosen colour and no picture or video', () => {
  const bg = welcomeBackground(sanitizeWelcomeSettings({ ...BASE, backgroundType: 'COLOR' }));
  assert.equal(bg.color, '#A32E2E');
  assert.equal(bg.media, null);
});

test('Image selected: the slide shows the picture, and the saved colour is not painted over it', () => {
  const bg = welcomeBackground(sanitizeWelcomeSettings({ ...BASE, backgroundType: 'IMAGE', backgroundUrl: BASE.imageFile }));
  assert.equal(bg.media.kind, 'image');
  assert.equal(bg.media.src, BASE.imageFile);
  assert.match(read('src/praise-worship/PwSlideFace.tsx'), /const colorStyle = background\?\.color && !background\.media \? \{ backgroundColor: background\.color \} : undefined;/);
});

test('Video selected: the slide shows the video, and the saved colour is not painted over it', () => {
  const bg = welcomeBackground(sanitizeWelcomeSettings({ ...BASE, backgroundType: 'VIDEO' }));
  assert.equal(bg.media.kind, 'video');
  assert.equal(bg.media.src, BASE.videoFile);
});

test('the same face and the same layer draw Colour, Image and Video on every surface', () => {
  const panels = read('src/praise-worship/CurrentNextPreview.tsx');
  assert.match(panels, /<Face shown=\{current\} blackLabel=\{t\('previewBlack'\)\} background=\{background\} \/>/);
  assert.match(panels, /<Face shown=\{next\} blackLabel=\{t\('previewBlack'\)\} background=\{background\} \/>/);
  assert.match(read('src/output/ProjectorView.tsx'), /<SlideBackgroundLayer media=\{slideMedia\}/);
  assert.match(read('src/output/ProjectorView.tsx'), /footer=\{frame\.footer\} background=\{pwBackground\} \/>/);
});

test('the Welcome background is unaffected by the slide type', () => {
  const welcome = sanitizeWelcomeSettings({ backgroundType: 'COLOR', backgroundColor: '#000000' });
  assert.equal(welcomeBackground(welcome).color, '#000000');
  assert.doesNotMatch(read('src/output/WelcomeScreen.tsx'), /SlideBackgroundLayer/);
});

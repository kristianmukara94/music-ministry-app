// A background video is one element for the whole slide sequence. It is mounted outside the slides, so Next and Back do not remount it: it keeps its
// position and play state, its file is not reloaded, and Loop on keeps looping. It restarts only when its file or Loop setting changes. The
// Welcome background is a separate element and is not affected. The playback itself was checked in a browser with a real clip (see the report);
// these tests keep the structure that makes it work. Run with: node --test shared/background-continuity.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

test('the Live set video is mounted once, outside the keyed slide wrapper, so a slide change does not remount it', () => {
  const projector = read('src/output/ProjectorView.tsx');
  const layerAt = projector.indexOf('<SlideBackgroundLayer media={slideMedia}');
  const keyedAt = projector.indexOf('key={serial}');
  assert.ok(layerAt > 0, 'the projector mounts the shared layer');
  assert.ok(keyedAt > 0, 'the slide wrapper is still keyed by the frame counter');
  assert.ok(layerAt < keyedAt, 'the layer is above the keyed wrapper, so the counter does not remount it');
});

test('the slides do not draw the video: the slide root is transparent over the layer, and only the shade and text sit on top', () => {
  const face = read('src/praise-worship/PwSlideFace.tsx');
  assert.doesNotMatch(face, /<BackgroundMedia/, 'no video inside a slide, which would be rebuilt per slide');
  assert.match(face, /const rootClass = background\?\.media \? 'absolute inset-0 text-fg' : 'absolute inset-0 bg-canvas text-fg';/, 'transparent over a picture or video');
  assert.match(face, /className=\{rootClass\}/);
});

test('the Current and Next panels each keep their own layer, outside the slide', () => {
  const panels = read('src/praise-worship/CurrentNextPreview.tsx');
  const current = panels.indexOf('<SlideBackgroundLayer media={background.media} visible={current.slide !== null} />');
  const currentFace = panels.indexOf('<Face shown={current}');
  const next = panels.indexOf('<SlideBackgroundLayer media={background.media} visible={next.slide !== null} />');
  const nextFace = panels.indexOf('<Face shown={next}');
  assert.ok(current > 0 && current < currentFace, 'the current panel mounts its layer before its slide');
  assert.ok(next > 0 && next < nextFace, 'the next panel mounts its layer before its slide');
});

test('the layer is hidden, not unmounted, when no slide is on screen, so the video keeps its place', () => {
  const media = read('src/output/BackgroundMedia.tsx');
  assert.match(media, /export function SlideBackgroundLayer/);
  assert.match(media, /\$\{visible \? 'opacity-100' : 'opacity-0'\}/, 'shown or hidden by opacity');
  assert.doesNotMatch(media.slice(media.indexOf('export function SlideBackgroundLayer'), media.indexOf('/** The dark shade')), /\bkey=/, 'no key that could change and remount it');
});

test('the source changes only with the file: the video src is the chosen file, and Loop is a property, not a remount', () => {
  const media = read('src/output/BackgroundMedia.tsx');
  assert.match(media, /const src = getSlideImageUrl\(media\.src\);/, 'the source is the chosen file');
  assert.match(media, /src=\{src\}/);
  assert.match(media, /loop=\{media\.loop\}/, 'Loop is set on the element');
});

test('the Welcome background is a separate element, untouched by the Live set layer', () => {
  const canvas = read('src/output/WelcomeScreen.tsx');
  assert.match(canvas, /<BackgroundMedia media=\{background\.media\}/, 'the Welcome screen draws its own background');
  assert.doesNotMatch(canvas, /SlideBackgroundLayer/, 'and not the Live set layer');
  assert.match(read('src/output/ProjectorView.tsx'), /const slideMedia = welcomeBackground\(useOutput\(\(s\) => s\.welcome\.slideBackground\)\)\.media;/, 'the Live set layer reads the Live slide background');
});

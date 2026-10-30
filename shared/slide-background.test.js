// The background behind the Praise & Worship slides is the Welcome screen's background, drawn the same way: a colour (unset keeps the slide's own
// dark colour), a picture or a video covering the slide, and a shade behind the text. The Live preview, the Current and Next slides and the
// projector all pass it to the same slide face. The text stays on top. A missing file falls back to the colour. Run with:
// node --test shared/slide-background.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sanitizeWelcomeSettings, welcomeBackground } from './welcome-settings.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const face = () => read('src/praise-worship/PwSlideFace.tsx');

test('unset, the slide keeps its own dark colour: the face adds no colour and no media', () => {
  const settings = sanitizeWelcomeSettings({});
  const bg = welcomeBackground(settings);
  assert.equal(bg.color, null, 'no colour is set on the slide');
  assert.equal(bg.media, null, 'no picture or video');
  assert.match(face(), /style=\{colorStyle\}/, 'the colour is only applied when one is set');
  assert.match(face(), /const colorStyle = background\?\.color && !background\.media \? \{ backgroundColor: background\.color \} : undefined;/);
  assert.match(face(), /\{!background\?\.media && <div className="absolute inset-0 bg-panel" \/>\}/, 'the prayer tint stays for a plain slide');
});

test('a chosen colour fills the whole slide', () => {
  const bg = welcomeBackground(sanitizeWelcomeSettings({ backgroundColor: '#224466' }));
  assert.equal(bg.color, '#224466');
  assert.match(face(), /backgroundColor: background\.color/, 'the slide takes the colour');
});

test('a picture or a video covers the slide, under the text', () => {
  const picture = welcomeBackground(sanitizeWelcomeSettings({ backgroundType: 'IMAGE', backgroundUrl: 'apcc-media://media/1' }));
  assert.equal(picture.media.kind, 'image');
  const clip = welcomeBackground(sanitizeWelcomeSettings({ backgroundType: 'VIDEO', backgroundUrl: 'apcc-media://media/2' }));
  assert.equal(clip.media.kind, 'video');
  const source = face();
  // The picture or video itself is one layer for the whole sequence (see background-continuity.test.js); the slide draws only the shade.
  assert.match(source, /const layers = background\?\.shade && background\.media \? <BackgroundShade area=\{textAreaStyle\(\)\} \/> : null;/, 'the slide draws the shade over the picture');
  // The media and the shade come before the text in the page, and the text is positioned, so it paints above them.
  assert.ok(source.indexOf('{layers}') < source.indexOf('font-serif text-[5cqw]'), 'the layers are drawn before the text');
  // A prayer or title in normal flow would paint under an absolute layer: each text block is positioned, or sits in a positioned wrapper.
  assert.match(source, /<div className="absolute inset-0 flex flex-col items-center justify-center px-\[8cqw\] py-\[4\.5cqw\] text-center">/, 'the title sits in a positioned full-frame wrapper');
  assert.doesNotMatch(source, /top-\[14cqh\] bottom-\[12cqh\]/, 'no sub-band box');
});

test('the shade is behind the text area when it is on, and not when it is off', () => {
  const on = welcomeBackground(sanitizeWelcomeSettings({ backgroundType: 'VIDEO', backgroundUrl: 'apcc-media://media/2' }));
  assert.equal(on.shade, true);
  const off = welcomeBackground(sanitizeWelcomeSettings({ backgroundType: 'VIDEO', backgroundUrl: 'apcc-media://media/2', textShade: false }));
  assert.equal(off.shade, false);
  const source = face();
  assert.match(source, /background\?\.shade && background\.media \? <BackgroundShade area=\{textAreaStyle\(\)\} \/> : null/, 'the shade covers the text area, only when it is on');
  assert.match(read('src/output/BackgroundMedia.tsx'), /rgb\(0 0 0 \/ \$\{TEXT_SHADE_OPACITY\}\)/, 'the shade is dark');
});

test('the Live preview, the Current and Next slides, and the projector all pass the same background', () => {
  const next = read('src/praise-worship/CurrentNextPreview.tsx');
  assert.match(next, /const background = welcomeBackground\(useLive\(\(s\) => s\.state\.welcome\.slideBackground\)\);/, 'the preview reads the Live slide background');
  assert.match(next, /<Face shown=\{current\} blackLabel=\{t\('previewBlack'\)\} background=\{background\} \/>/, 'the current slide');
  assert.match(next, /<Face shown=\{next\} blackLabel=\{t\('previewBlack'\)\} background=\{background\} \/>/, 'the next slide');
  assert.match(read('src/output/ProjectorView.tsx'), /const pwBackground = welcomeBackground\(useOutput\(\(s\) => s\.welcome\.slideBackground\)\);/, 'the projector reads the Live slide background');
  assert.match(read('src/output/ProjectorView.tsx'), /footer=\{frame\.footer\} background=\{pwBackground\} \/>/, 'the projector passes it to the slide');
  // The operator's Live preview is the projector itself (mirror), so it shows the same background.
  assert.match(read('src/operator/PreviewPanel.tsx'), /<ProjectorView mirror embedded \/>/);
});

test('the video is muted and loops only when Loop is on; off, it holds its last frame; audio is off', () => {
  const media = read('src/output/BackgroundMedia.tsx');
  assert.match(media, /loop=\{media\.loop\}/, 'Loop from the setting');
  assert.match(media, /muted/, 'muted');
  assert.doesNotMatch(media, /\scontrols[\s={/]/, 'no controls attribute');
  const once = welcomeBackground(sanitizeWelcomeSettings({ backgroundType: 'VIDEO', backgroundUrl: 'apcc-media://media/2', videoLoop: false }));
  assert.equal(once.media.loop, false, 'off: it plays once and holds its last frame');
});

test('a missing file falls back to the colour, and the settings say so', () => {
  const settings = sanitizeWelcomeSettings({ backgroundType: 'IMAGE', backgroundUrl: 'apcc-media://media/8', backgroundColor: '#334455' });
  assert.deepEqual(welcomeBackground(settings, true).media, null, 'a file that will not load shows the colour');
  assert.match(read('src/output/BackgroundMedia.tsx'), /const style: CSSProperties \| undefined = failedSrc === src \? \{ visibility: 'hidden' \} : undefined;/, 'a broken file is hidden, so the colour beneath shows');
  assert.match(read('src/output/BackgroundMedia.tsx'), /onFail\?\.\(\);/, 'and the failure is reported');
  assert.match(read('src/settings/BackgroundControls.tsx'), /missing, so the screen shows the background colour instead/, 'the settings warn');
});

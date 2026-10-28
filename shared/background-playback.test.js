// The Live set's background video starts by itself when it is chosen: it is muted (as a property and as an attribute), it is started when it is
// ready, and the first click on the output starts it if the browser still refuses. Choosing a new file loads it from its beginning and starts it.
// With Loop off a clip that has ended holds its last frame. A file that will not play is hidden (the colour shows) and its setting says so.
// The playback was checked in a browser with a real clip (see the report). Run with: node --test shared/background-playback.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const MEDIA = () => read('src/output/BackgroundMedia.tsx');
const video = () => {
  const source = MEDIA();
  return source.slice(source.indexOf('function BackgroundVideo('), source.indexOf('/**\n * The Live set'));
};

test('the video is muted as a property and as an attribute, so the autoplay rule allows it with no click', () => {
  const v = video();
  assert.match(v, /video\.muted = true;/);
  assert.match(v, /video\.defaultMuted = true;/);
  assert.match(v, /video\.setAttribute\('muted', ''\);/);
  assert.match(v, /video\.playsInline = true;/);
});

test('the video starts when it is mounted, when its data is ready, and when it can play', () => {
  const v = video();
  assert.match(v, /const start = \(\) => \{[\s\S]*?video\.play\(\)\.catch/, 'play() is called and its refusal is caught');
  assert.match(v, /\bstart\(\);\s*\n\s*video\.addEventListener\('loadeddata', loaded\);/, 'started at mount');
  assert.match(v, /video\.addEventListener\('canplay', start\);/, 'retried when it can play');
  assert.match(v, /document\.addEventListener\('pointerdown', start\);/, 'and at the first click, if the browser still refused');
});

test('a new file starts from its beginning: the source is the chosen file, and the start runs when the new data loads', () => {
  const v = video();
  assert.match(v, /\}, \[src\]\);/, 'the effect runs again for each new file');
  assert.match(MEDIA(), /const src = getSlideImageUrl\(media\.src\);/);
  assert.match(v, /<video[\s\S]*?src=\{src\}/);
});

test('Loop on keeps looping; Loop off holds the last frame: a clip that has ended is not started again', () => {
  const v = video();
  assert.match(v, /if \(video\.paused && !video\.ended\) \{/, 'an ended clip is not restarted');
  assert.match(v, /loop=\{loop\}/, 'Loop is set on the element');
});

test('a file that will not play is hidden for that file only, and its setting is told', () => {
  const m = MEDIA();
  assert.match(m, /const \[failedSrc, setFailedSrc\] = useState<string \| null>\(null\);/, 'the failed file is remembered');
  assert.match(m, /reportMediaFailed\(src, reason\);/, 'the failure is reported to the settings');
  assert.match(m, /clearMediaFailed\(src\);/, 'and cleared when the file plays');
  assert.match(m, /failedSrc === src \? \{ visibility: 'hidden' \} : undefined/, 'hidden only while it is the same file, so a new file shows');
});

test('the settings show the failure in their own panel', () => {
  const controls = read('src/settings/BackgroundControls.tsx');
  assert.match(controls, /import \{ useMediaFailed \} from '\.\.\/output\/mediaStatus';/);
  assert.match(controls, /const playFailed = useMediaFailed\(value\.backgroundType === 'COLOR' \? null : value\.backgroundUrl\);/);
  assert.match(controls, /This \{kind === 'video' \? 'video' : 'picture'\} cannot play|cannot be shown/);
});

test('the failure record is kept by file address, so only the file that failed is reported', () => {
  const status = read('src/output/mediaStatus.ts');
  assert.match(status, /export function reportMediaFailed\(src: string, reason: string\)/);
  assert.match(status, /export function clearMediaFailed\(src: string\)/);
  assert.match(status, /\(\) => \(src !== null \? failed\.get\(src\) \?\? null : null\)/);
});

test('the Welcome background draws its video with the same component and is not part of the Live set layer', () => {
  assert.match(read('src/output/WelcomeScreen.tsx'), /<BackgroundMedia media=\{background\.media\}/);
  assert.doesNotMatch(read('src/output/WelcomeScreen.tsx'), /SlideBackgroundLayer/);
});

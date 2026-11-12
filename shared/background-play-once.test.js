// A Media Library background set to "Play once" plays to its end and then leaves the screen as a clear would: the idle screen or the slide's
// own colour shows again, with no shade or dimmer left over. Taking the same clip again plays it again, because each staging carries a new cue.
// Run with: node --test shared/background-play-once.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const PROJECTOR = () => read('src/output/ProjectorView.tsx');
const layer = () => {
  const source = PROJECTOR();
  return source.slice(source.indexOf('function BackgroundLayer('), source.indexOf('const ENTER_ANIMATION'));
};

test('each staging of a "play once" clip carries a new cue, and only such a clip has one', () => {
  const view = read('src/media/MediaView.tsx');
  assert.match(view, /const nextCue = \(\) => \(lastCue = Math\.max\(Date\.now\(\), lastCue \+ 1\)\);/, 'the cue always moves forward');
  assert.match(view, /if \(frame\.playback === 'once'\) frame\.cue = nextCue\(\);/);
  assert.match(read('shared/live.d.ts'), /cue\?: number;/);
});

test('a showing is told apart by file, end behaviour and cue, never by the frame object that each state update replaces', () => {
  assert.match(PROJECTOR(), /const showingOf = \(media: MediaFrame\) => `\$\{media\.src\}\|\$\{media\.playback \?\? 'loop'\}\|\$\{media\.cue \?\? ''\}`;/);
  assert.match(layer(), /key=\{showingOf\(media\)\}/, 'a new showing remounts the video, so it plays from the start');
});

test('the clip reports its end, and the projector then draws no background at all, not an invisible one', () => {
  const l = layer();
  assert.match(l, /onEnded=\{\(\) => playback === 'once' && onEnded\(showingOf\(media\)\)\}/);
  assert.doesNotMatch(l, /invisible/, 'the ended clip is removed, not hidden behind its shade');
  const p = PROJECTOR();
  assert.match(p, /const background = liveBackground && showingOf\(liveBackground\) === endedShowing \? null : liveBackground;/);
  assert.match(p, /<BackgroundLayer media=\{background\} onEnded=\{setEndedShowing\} \/>/);
  // The idle screen, the slide colour, the shade and the dimmer all follow `background`, so they behave as after a clear.
  assert.match(p, /\{!background && shownFrame\.kind === 'idle' && <IdleScreen/);
  assert.match(p, /\{background && backgroundTint\(background\) > 0 &&/);
});

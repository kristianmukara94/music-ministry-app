// The Lower 3rd is under the operator's hand alone. Only the operator's controls turn it On or Off: the Lower 3rd toggle (top bar, Output
// Status, the hotkey), its Pause, and the Lower Third deck's Show. Go Live, Take Live, GO LIVE NOW and a slide's own cue never turn it on: they
// stage their band, or replace a band the operator already has on air. Run with:
// node --test shared/lower-third-choice.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initialLiveState, liveReducer } from './live.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const SEG_A = { template: 'segment', title: 'Opening' };
const SEG_B = { template: 'segment', title: 'Second' };
const run = (state, ...actions) => actions.reduce((s, a) => liveReducer(s, a), state);
/** What a Go Live, Take Live or slide change does to the Lower 3rd: a cue (lowerThird/show without `manual`), or a stage. */
const cue = (value) => ({ type: 'lowerThird/show', value });
const noCue = (value) => ({ type: 'lowerThird/stage', value });
const toggle = { type: 'lowerThird/toggle' };
/** The operator's own Show, from the Lower Third deck. */
const operatorShow = (value) => ({ type: 'lowerThird/show', value, manual: true });
/** A slide change that the projector shows (it does not touch the Lower 3rd). */
const slide = (title) => ({ type: 'projector/show', frame: { kind: 'idle' }, source: 'PW_SESSION', title });

test('with the Lower 3rd Off, a cue never turns it on: before any choice, and after the operator pressed Off', () => {
  const fresh = run(initialLiveState(), cue(SEG_A));
  assert.equal(fresh.lowerThird.choice, null);
  assert.equal(fresh.lowerThird.live, null, 'a Go Live from a fresh start leaves it Off');
  assert.equal(fresh.lowerThird.staged, SEG_A, 'the band waits staged for the toggle');

  let s = run(initialLiveState(), noCue(SEG_A), toggle, toggle); // On, then the operator presses it Off
  assert.equal(s.lowerThird.choice, 'off');
  s = run(s, slide('next'), cue(SEG_B), slide('prev'), cue(SEG_A));
  assert.equal(s.lowerThird.live, null, 'the cues do not turn it On');
  assert.equal(s.lowerThird.staged, SEG_A, 'the value is still staged for the operator to take On');
});

test('the operator\'s On stays On across slides and Take Lives, and the new cue is what shows', () => {
  let s = run(initialLiveState(), cue(SEG_A), toggle);
  assert.equal(s.lowerThird.choice, 'on');
  assert.equal(s.lowerThird.live, SEG_A, 'the toggle takes the staged band live');
  s = run(s, slide('next'), cue(SEG_B));
  assert.equal(s.lowerThird.live, SEG_B, 'On stays On, and shows the next item\'s band');
});

test('a Lower 3rd cleared without the toggle is Off, and the next cue does not bring it back', () => {
  const s = run(initialLiveState(), cue(SEG_A), toggle, { type: 'lowerThird/clear' }, cue(SEG_B));
  assert.equal(s.lowerThird.live, null);
  const stopped = run(initialLiveState(), cue(SEG_A), toggle, { type: 'stop' }, cue(SEG_B));
  assert.equal(stopped.lowerThird.live, null, 'after Stop, a new Go Live leaves it Off');
});

test('the operator\'s Show takes the band live and counts as On', () => {
  const s = run(initialLiveState(), operatorShow(SEG_A));
  assert.equal(s.lowerThird.live, SEG_A);
  assert.equal(s.lowerThird.choice, 'on');
  assert.equal(run(s, { type: 'lowerThird/pause' }, operatorShow(SEG_B)).lowerThird.live, SEG_A, 'while paused it only stages');
});

test('resuming a pause never turns an Off Lower 3rd on', () => {
  const off = run(initialLiveState(), cue(SEG_A), { type: 'lowerThird/pause' }, { type: 'lowerThird/pause' });
  assert.equal(off.lowerThird.live, null);
  const on = run(initialLiveState(), cue(SEG_A), toggle, { type: 'lowerThird/pause' }, cue(SEG_B), { type: 'lowerThird/pause' });
  assert.equal(on.lowerThird.live, SEG_B, 'a band that was on comes back with the latest value');
});

test('a slide with no Lower 3rd does not change the state, whether it is On or Off', () => {
  const on = run(initialLiveState(), noCue(SEG_A), toggle);
  assert.equal(run(on, noCue(SEG_B)).lowerThird.live, SEG_A, 'On stays On');
  const off = run(on, toggle);
  assert.equal(run(off, noCue(SEG_B)).lowerThird.live, null, 'Off stays Off');
  assert.equal(run(off, noCue(SEG_B)).lowerThird.choice, 'off');
});

test('the state survives a Live view refresh, a projector reopen and an edit: none of them changes it', () => {
  let s = run(initialLiveState(), noCue(SEG_A), toggle, toggle);
  const before = s.lowerThird;
  // A refresh re-reads the state; a projector reopen gets the same state; an edit of a lyric or prayer sends a live refresh.
  s = run(s, { type: 'projector/refresh', frames: [] }, { type: 'settings/welcome', value: {} }, { type: 'pw/cursor', segmentKey: 'x', slide: 0, now: 1 });
  assert.deepEqual(s.lowerThird, before, 'the Lower 3rd is unchanged');
});

test('stop keeps the operator\'s choice', () => {
  const s = run(initialLiveState(), noCue(SEG_A), toggle, toggle, { type: 'stop' });
  assert.equal(s.lowerThird.choice, 'off', 'the choice is not reset by stop');
});

test('live.ts no longer clears the Lower 3rd for a segment with no cue', () => {
  const live = read('src/praise-worship/live.ts');
  const start = live.indexOf('if (newSegment || newSong) {');
  const block = live.slice(start, live.indexOf('\n    }', start));
  assert.doesNotMatch(block, /lowerThird\/clear/, 'a slide change does not clear it');
  assert.match(block, /else dispatch\(\{ type: 'lowerThird\/stage', value \}\);/, 'a segment with no cue only stages its value');
});

test('only the operator\'s own Lower 3rd controls send a manual show', () => {
  const manualShows = (rel) => (read(rel).match(/lowerThird\/show',[^;]*manual: true/g) ?? []).length;
  assert.equal(manualShows('src/media/LowerThirdDrawer.tsx'), 1, 'the Lower Third drawer\'s Show');
  assert.equal(manualShows('src/operator/CommandPalette.tsx'), 1, 'the command palette\'s Lower 3rd entry');
  for (const rel of [
    'src/lectionary/LectionaryDeck.tsx',
    'shared/lyrics-live.js',
    'src/praise-worship/live.ts',
    'src/praise-worship/useQuickLiveController.ts',
    'src/golive/massLive.ts',
    'src/notes/present.ts',
    'src/planner/routing.ts',
  ]) {
    assert.doesNotMatch(read(rel), /manual: true/, `${rel} takes things live and must never turn the Lower 3rd on`);
  }
});

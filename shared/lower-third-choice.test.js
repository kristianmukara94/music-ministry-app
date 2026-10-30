// The Lower 3rd On or Off is the operator's choice. It changes only when the operator presses the control (or the hotkey). A slide's own cue, the
// slide changes (Next and Back), a segment with no Lower 3rd, a view refresh and a projector reopen do not change it. Run with:
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
/** What a slide change does to the Lower 3rd: a cue shows it, or a segment with no cue only stages it (live.ts). */
const cue = (value) => ({ type: 'lowerThird/show', value });
const noCue = (value) => ({ type: 'lowerThird/stage', value });
const toggle = { type: 'lowerThird/toggle' };
/** A slide change that the projector shows (it does not touch the Lower 3rd). */
const slide = (title) => ({ type: 'projector/show', frame: { kind: 'idle' }, source: 'PW_SESSION', title });

test('the operator\'s Off stays Off across next and previous slides, including a new segment with a Lower 3rd cue', () => {
  let s = run(initialLiveState(), cue(SEG_A), toggle); // On, then the operator presses it Off
  assert.equal(s.lowerThird.live, null);
  assert.equal(s.lowerThird.choice, 'off');
  s = run(s, slide('next'), cue(SEG_B), slide('prev'), cue(SEG_A));
  assert.equal(s.lowerThird.live, null, 'the cues do not turn it On');
  assert.equal(s.lowerThird.staged, SEG_A, 'the value is still staged for the operator to take On');
});

test('the operator\'s On stays On across slides, and the new slide\'s cue is what shows', () => {
  let s = run(initialLiveState(), cue(SEG_A), toggle, toggle); // Off, then On: the choice is On
  assert.equal(s.lowerThird.choice, 'on');
  s = run(s, slide('next'), cue(SEG_B));
  assert.equal(s.lowerThird.live, SEG_B, 'On stays On, and shows the next slide\'s value');
});

test('with no choice yet, a slide\'s cue still shows the Lower 3rd, as before', () => {
  const s = run(initialLiveState(), cue(SEG_A));
  assert.equal(s.lowerThird.choice, null);
  assert.equal(s.lowerThird.live, SEG_A);
});

test('a slide with no Lower 3rd does not change the state, whether it is On or Off', () => {
  const on = run(initialLiveState(), cue(SEG_A));
  assert.equal(run(on, noCue(SEG_B)).lowerThird.live, SEG_A, 'On stays On');
  const off = run(on, toggle);
  assert.equal(run(off, noCue(SEG_B)).lowerThird.live, null, 'Off stays Off');
  assert.equal(run(off, noCue(SEG_B)).lowerThird.choice, 'off');
});

test('the state survives a Live view refresh, a projector reopen and an edit: none of them changes it', () => {
  let s = run(initialLiveState(), cue(SEG_A), toggle);
  const before = s.lowerThird;
  // A refresh re-reads the state; a projector reopen gets the same state; an edit of a lyric or prayer sends a live refresh.
  s = run(s, { type: 'projector/refresh', frames: [] }, { type: 'settings/welcome', value: {} }, { type: 'pw/cursor', segmentKey: 'x', slide: 0, now: 1 });
  assert.deepEqual(s.lowerThird, before, 'the Lower 3rd is unchanged');
});

test('stop keeps the operator\'s choice', () => {
  const s = run(initialLiveState(), cue(SEG_A), toggle, { type: 'stop' });
  assert.equal(s.lowerThird.choice, 'off', 'the choice is not reset by stop');
});

test('live.ts no longer clears the Lower 3rd for a segment with no cue', () => {
  const live = read('src/praise-worship/live.ts');
  const start = live.indexOf('if (newSegment || newSong) {');
  const block = live.slice(start, live.indexOf('\n    }', start));
  assert.doesNotMatch(block, /lowerThird\/clear/, 'a slide change does not clear it');
  assert.match(block, /else dispatch\(\{ type: 'lowerThird\/stage', value \}\);/, 'a segment with no cue only stages its value');
});

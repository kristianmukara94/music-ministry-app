// The Welcome Screen while a Praise & Worship lineup or the Holy Mass is live: one output state at a time, no ping-pong.
// The welcome screen parks the run's output (the run stays on air at its place, its clock keeps going), a slide the run sends on its own waits
// under the cover, a repeated or late Welcome changes nothing, and Welcome off (or Back to Main Live) puts back the exact covered slide.
// Run with: node --test shared/welcome-cover.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initialLiveState, liveReducer, welcomeOverMass, welcomeOverPw } from './live.js';
import { mainLiveStatus, welcomeCover } from './main-live.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const run = (state, ...actions) => actions.reduce((s, a) => liveReducer(s, a), state);

const pwSlide = (n) => ({
  kind: 'pw',
  slide: { kind: 'lyrics', text: `Sample Slide Line ${n}` },
  segmentName: 'Sample Segment',
  type: 'praise',
  index: n,
  total: 4,
});
const massSlide = { kind: 'text', text: 'Sample Slide Line', key: 'note:1:0' };
const WELCOME = { kind: 'welcome', lang: 'en', shownAt: 1000, slide: 0, slideAt: 1000 };
const welcomeOn = (frame = WELCOME) => ({ type: 'projector/welcome', on: true, frame });
const WELCOME_OFF = { type: 'projector/welcome', on: false };
/** The operator's own step (showPosition), which lifts the welcome screen. */
const step = (frame, slide) => [
  { type: 'projector/show', frame, source: 'PW_SESSION', lift: true },
  { type: 'pw/cursor', segmentKey: 'seg-1', slide, now: 2000 + slide },
];
/** A slide the session sends on its own: a song edited elsewhere, a re-paging. No `lift`. */
const autoShow = (frame) => ({ type: 'projector/show', frame, source: 'PW_SESSION' });

const pwOnAir = () =>
  run(initialLiveState(), { type: 'output/set', output: 'projector', on: true }, { type: 'pw/load', sessionId: 4 }, ...step(pwSlide(1), 1));

const massOnAir = () =>
  run(
    initialLiveState(),
    { type: 'output/set', output: 'projector', on: true },
    { type: 'queue/set', planId: 7, items: [{ module: 'notes', sourceId: '1', label: 'Sample Segment' }, { module: 'notes', sourceId: '2', label: 'Sample Segment' }] },
    { type: 'queue/cursor', index: 1 },
    { type: 'projector/stage', frame: massSlide },
    { type: 'projector/take', source: 'MASS_QUEUE' },
  );

// ---- Praise & Worship ----

test('Welcome over a live Praise & Worship lineup parks its output: the session stays on air, at its place, with its clock', () => {
  const live = pwOnAir();
  const covered = run(live, welcomeOn());
  assert.equal(covered.projector.live, WELCOME);
  assert.equal(covered.projector.staged, live.projector.live, 'the slide on air waits under the cover');
  assert.equal(covered.projector.source, 'PW_SESSION');
  assert.equal(covered.pw.onAir, true);
  assert.equal(covered.pw.segmentKey, live.pw.segmentKey);
  assert.equal(covered.pw.slide, live.pw.slide);
  assert.equal(covered.pw.startedAt, live.pw.startedAt, 'the segment clock is not touched');
  assert.equal(covered.pw.liveSince, live.pw.liveSince, 'nor the session clock');
  assert.equal(welcomeOverPw(covered), true);
  assert.equal(welcomeCover(covered), 'pw');
});

test('a slide the session sends on its own waits under the welcome screen, and never pulls it down', () => {
  const covered = run(pwOnAir(), welcomeOn());
  const after = run(covered, autoShow(pwSlide(2)));
  assert.equal(after.projector.live, WELCOME, 'the welcome screen stays up');
  assert.deepEqual(after.projector.staged, pwSlide(2), 'the new slide is what comes back');
  assert.equal(after.pw.onAir, true);
});

test('no ping-pong: a run that keeps sending slides and a Welcome sent again and again leave one output state', () => {
  let s = run(pwOnAir(), welcomeOn());
  const seen = [s.projector.live.kind];
  for (let tick = 0; tick < 50; tick++) {
    s = run(s, autoShow(pwSlide(1 + (tick % 3))), welcomeOn(), welcomeOn({ ...WELCOME }));
    seen.push(s.projector.live.kind);
  }
  assert.ok(seen.every((kind) => kind === 'welcome'), 'the projector shows the welcome screen on every tick');
  assert.equal(s.pw.onAir, true);
});

test('Welcome off puts back the exact slide it covered, at the session’s place', () => {
  const live = pwOnAir();
  const back = run(live, welcomeOn(), WELCOME_OFF);
  assert.equal(back.projector.live, live.projector.live, 'the very same slide');
  assert.equal(back.projector.source, 'PW_SESSION');
  assert.equal(back.pw.onAir, true);
  assert.equal(back.pw.slide, live.pw.slide);
  assert.equal(welcomeCover(back), null);
});

test('the operator’s own step still takes the welcome screen down onto the slide stepped to', () => {
  const s = run(pwOnAir(), welcomeOn(), ...step(pwSlide(2), 2));
  assert.deepEqual(s.projector.live, pwSlide(2));
  assert.equal(welcomeOverPw(s), false);
});

// ---- Holy Mass ----

test('Welcome over the Holy Mass parks it, and Welcome off puts back the exact slide with the queue at its place', () => {
  const live = massOnAir();
  const covered = run(live, welcomeOn());
  assert.equal(covered.projector.live, WELCOME);
  assert.equal(covered.projector.staged, massSlide);
  assert.equal(covered.queueCursor, 1, 'the queue keeps its place');
  assert.equal(welcomeOverMass(covered), true);
  assert.equal(welcomeCover(covered), 'mass');
  assert.equal(mainLiveStatus(covered).onAir, 'mass', 'the Mass is still on air behind the cover');

  const back = run(covered, WELCOME_OFF);
  assert.equal(back.projector.live, massSlide);
  assert.equal(back.projector.source, 'MASS_QUEUE');
  assert.equal(back.queueCursor, 1);
  assert.equal(welcomeOverMass(back), false);
});

// ---- Idempotence ----

test('Welcome on while it is already up, or off while it is down, changes nothing and sends nothing', () => {
  for (const live of [pwOnAir(), massOnAir(), run(initialLiveState(), { type: 'output/set', output: 'projector', on: true })]) {
    const covered = run(live, welcomeOn());
    assert.equal(run(covered, welcomeOn()), covered, 'a second on is the same state, same revision');
    assert.equal(run(covered, welcomeOn({ ...WELCOME, shownAt: 9999, slideAt: 9999 })), covered, 'even with a later clock: on is on');
    assert.equal(run(live, WELCOME_OFF), live, 'off while it is down');
    const back = run(covered, WELCOME_OFF);
    assert.equal(run(back, WELCOME_OFF), back, 'a second off');
  }
});

test('the same welcome frame arriving twice (several windows, a repeated message) is one change', () => {
  const s = run(pwOnAir(), { type: 'projector/show', frame: WELCOME, source: 'DIRECT_DECK' });
  const again = run(s, { type: 'projector/show', frame: { ...WELCOME }, source: 'DIRECT_DECK' });
  assert.equal(again, s);
  assert.equal(again.rev, s.rev);
  // Stepping the carousel is a new frame (a new slide and clock), so it still goes through.
  const stepped = run(s, { type: 'projector/show', frame: { ...WELCOME, slide: 1, slideAt: 5000 } });
  assert.equal(stepped.projector.live.slide, 1);
  assert.equal(welcomeOverPw(stepped), true, 'still a cover over the session');
});

test('a double press read from a state that had not come back yet cannot flip Welcome on and straight off', () => {
  // Both presses saw the welcome screen down, so both send on.
  const s = run(pwOnAir(), welcomeOn(), welcomeOn({ ...WELCOME, shownAt: 1001, slideAt: 1001 }));
  assert.equal(s.projector.live, WELCOME);
});

// ---- Welcome over Blackout ----

test('Welcome over Blackout over a run takes the screen cleanly, and off puts back the covered slide', () => {
  for (const live of [pwOnAir(), massOnAir()]) {
    const dark = run(live, { type: 'projector/blackout' });
    const covered = run(dark, welcomeOn());
    assert.equal(covered.projector.live, WELCOME);
    assert.equal(covered.projector.beforeBlackout, null);
    assert.equal(covered.projector.staged, live.projector.live);
    assert.equal(welcomeCover(covered) !== null, true, 'the run stays on air behind the welcome screen');
    assert.equal(run(covered, WELCOME_OFF).projector.live, live.projector.live);
  }
});

test('with no run on air, Welcome off clears the projector as before', () => {
  const on = run(initialLiveState(), { type: 'output/set', output: 'projector', on: true }, welcomeOn());
  assert.equal(on.projector.live.kind, 'welcome');
  assert.equal(run(on, WELCOME_OFF).projector.live.kind, 'idle');
});

// ---- Wiring ----

test('the Welcome button and Back to Main Live send an explicit on or off, and the lineup marks only the operator’s step as a lift', () => {
  const actions = read('src/operator/actions.ts');
  assert.match(actions, /dispatch\(\{ type: 'projector\/welcome', on: false \}\);/);
  assert.match(actions, /dispatch\(\{ type: 'projector\/welcome', on: true, frame: \{ kind: 'welcome'/);
  assert.doesNotMatch(actions, /type: 'projector\/show', frame: \{ kind: 'welcome'/, 'never a bare show that a late press could repeat');
  const main = read('src/golive/mainLive.ts');
  assert.match(main, /const covered = welcomeCover\(state\);/);
  const bar = read('src/operator/TopBar.tsx');
  assert.match(bar, /if \(parked \|\| covered\) \{/, 'Back to Main Live is offered while the welcome screen covers the run');
  // Only showPosition (the operator's step) lifts the cover; the automatic re-shows do not.
  const lifts = ['src/praise-worship/live.ts', 'src/live/liveSongs.ts', 'src/praise-worship/useQuickLiveController.ts'].map((f) => read(f).split('lift: true').length - 1);
  assert.deepEqual(lifts, [1, 0, 0]);
});

test('the top bar holds every state-changing control at its widest, so toggles never wrap a row or move the workspace', () => {
  const bar = read('src/operator/TopBar.tsx');
  assert.match(bar, /function StableSlot\(/);
  assert.match(bar, /style=\{CELL\}/);
  assert.match(bar, /const CELL = \{ gridArea: '1 \/ 1' \} as const;/);
  // Welcome, Go Live / Back to Main Live, Lower 3rd, Blackout, Pause Projector and Announcements: each sits in a slot.
  for (const fn of ['function WelcomeControl()', 'export function GoLiveShortcut()', 'function LowerThirdControl()']) {
    const body = bar.slice(bar.indexOf(fn), bar.indexOf('\n}\n', bar.indexOf(fn)));
    assert.ok(body.split('<StableSlot ghosts={ghosts}>').length - 1 >= 2, `${fn} renders every state inside a slot`);
  }
  const zone = bar.slice(bar.indexOf('export function TopBar()'));
  assert.equal(zone.split('<StableSlot').length - 1, 3, 'Blackout, Pause Projector and Announcements');
  // Ghost copies carry no test ids, so tests and tools find only the real control.
  assert.match(bar, /data-testid=\{ghost \? undefined : 'welcome-compound'\}/);
  assert.match(bar, /data-testid=\{state \? 'top-go-live' : undefined\}/);
});

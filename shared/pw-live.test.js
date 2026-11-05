// Praise & Worship Go Live: the welcome screen and Blackout are covers that keep the session on air at its place, and Go Live never turns the
// lower third on. Run with: node --test shared/pw-live.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { blackoutOverMass, blackoutOverPw, initialLiveState, liveReducer, welcomeOverMass, welcomeOverPw } from './live.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const run = (state, ...actions) => actions.reduce((s, a) => liveReducer(s, a), state);

const slideA = { kind: 'pw', slide: { kind: 'lyrics', text: 'First line' }, segmentName: 'Opening', type: 'praise', index: 0, total: 3 };
const slideB = { kind: 'pw', slide: { kind: 'lyrics', text: 'Second line' }, segmentName: 'Opening', type: 'praise', index: 1, total: 3 };
const welcome = { kind: 'welcome', lang: 'en' };
const BAND = { template: 'segment', tag: 'Opening', line1: 'Joyful Song' };

/** What showPosition sends for one slide. */
const show = (frame, slide, now) => [
  { type: 'projector/show', frame, source: 'PW_SESSION' },
  { type: 'pw/cursor', segmentKey: 'seg-1', slide, now },
];

/** A session on air at its first slide, the way Go Live puts it there: the band is staged, not shown. */
const pwOnAir = () =>
  run(
    initialLiveState(),
    { type: 'output/set', output: 'projector', on: true },
    { type: 'pw/load', sessionId: 4 },
    ...show(slideA, 0, 1000),
    { type: 'lowerThird/stage', value: BAND },
  );

// ---- The lower third at Go Live ----

test('Praise & Worship Go Live starts with the lower third off', () => {
  const s = pwOnAir();
  assert.equal(s.pw.onAir, true);
  assert.equal(s.lowerThird.live, null, 'nothing is on the livestream');
  assert.deepEqual(s.lowerThird.staged, BAND, 'the segment\'s band waits for the toggle');
  assert.equal(s.outputs.lowerThird, false);
  assert.deepEqual(liveReducer(s, { type: 'lowerThird/toggle' }).lowerThird.live, BAND, 'only the operator\'s toggle shows it');
});

test('a segment\'s Lower 3rd cue (on by default) no longer turns the band on: it only updates a band already on screen', () => {
  const pw = read('src/praise-worship/live.ts');
  assert.match(read('shared/pw.js'), /DEFAULT_CUES = \{ lowerThird: true/, 'the cue is on by default, which is why it must not turn the band on');
  assert.match(pw, /const band = now\.lowerThird\.live;\s+if \(band && \(segment\.cues\.lowerThird \|\| band\.template === 'segment'\)\)/);
  assert.match(pw, /Go Live never turns the lower third on/);
});

// ---- Welcome over Praise & Worship ----

test('the welcome screen over Praise & Worship is a cover: the session stays on air at its place, with its timers', () => {
  const onAir = pwOnAir();
  const covered = run(onAir, { type: 'projector/show', frame: welcome, source: 'DIRECT_DECK' });
  assert.equal(covered.projector.live, welcome);
  assert.equal(covered.projector.staged, slideA, 'the covered slide waits staged');
  assert.equal(covered.projector.source, 'PW_SESSION');
  assert.deepEqual(covered.pw, onAir.pw, 'the place, the segment timer and the session clock are kept');
  assert.equal(welcomeOverPw(covered), true);
  assert.equal(welcomeOverMass(covered), false);
  // Showing it again keeps the covered slide.
  assert.equal(run(covered, { type: 'projector/show', frame: welcome, source: 'DIRECT_DECK' }).projector.staged, slideA);
  // Welcome again (the toggle) puts the covered slide back.
  const back = run(covered, { type: 'projector/take', source: 'PW_SESSION' });
  assert.equal(back.projector.live, slideA);
  assert.equal(back.pw.onAir, true);
  assert.equal(welcomeOverPw(back), false);
});

test('Next under the welcome screen takes it down onto the next slide, keeping the segment timer', () => {
  const covered = run(pwOnAir(), { type: 'projector/show', frame: welcome, source: 'DIRECT_DECK' });
  const next = run(covered, ...show(slideB, 1, 5000));
  assert.equal(next.projector.live, slideB);
  assert.equal(next.pw.slide, 1);
  assert.equal(next.pw.startedAt, 1000, 'the segment timer was not restarted');
  assert.equal(next.pw.liveSince, 1000);
});

test('anything else shown directly still takes Praise & Worship off air', () => {
  const s = run(pwOnAir(), { type: 'projector/show', frame: { kind: 'announcements', lang: 'en' }, source: 'DIRECT_DECK' });
  assert.equal(s.pw.onAir, false);
  assert.equal(s.pw.slide, 0, 'its place is kept for a take-over');
});

// ---- Blackout over Praise & Worship ----

test('Blackout over Praise & Worship is a cover: the session stays on air, and Blackout again puts the slide back', () => {
  const onAir = pwOnAir();
  const dark = run(onAir, { type: 'projector/blackout' });
  assert.equal(dark.projector.live.kind, 'blackout');
  assert.equal(dark.projector.staged, slideA);
  assert.deepEqual(dark.pw, onAir.pw);
  assert.equal(blackoutOverPw(dark), true);
  assert.equal(blackoutOverMass(dark), false);
  const back = run(dark, { type: 'projector/blackout' });
  assert.equal(back.projector.live, slideA);
  assert.equal(blackoutOverPw(back), false);
});

test('Next, Back or a jump under Blackout lifts it onto the slide stepped to', () => {
  const dark = run(pwOnAir(), { type: 'projector/blackout' });
  // showPosition: the show waits behind Blackout, the cursor moves, and Blackout goes down onto the new slide.
  const stepped = run(dark, ...show(slideB, 1, 5000));
  assert.equal(stepped.projector.live.kind, 'blackout', 'the slide never flashes before Blackout goes down');
  const shown = run(stepped, { type: 'projector/blackout' });
  assert.equal(shown.projector.live, slideB);
  assert.equal(shown.pw.slide, 1);
  assert.equal(shown.pw.startedAt, 1000);
  // Blackout over the welcome screen: Next goes straight to the slide, without the welcome screen on the way.
  const welcomeDark = run(pwOnAir(), { type: 'projector/show', frame: welcome, source: 'DIRECT_DECK' }, { type: 'projector/blackout' });
  assert.equal(blackoutOverPw(welcomeDark), true);
  assert.equal(welcomeDark.projector.staged, slideA);
  assert.equal(run(welcomeDark, ...show(slideB, 1, 5000), { type: 'projector/blackout' }).projector.live, slideB);
});

test('the console lifts the cover on every step, and the Welcome toggle puts the covered slide back', () => {
  const pw = read('src/praise-worship/live.ts');
  assert.match(pw, /const liftBlackout = blackoutOverPw\(now\) && s\.kind !== 'black';/);
  assert.match(pw, /if \(liftBlackout\) dispatch\(\{ type: 'projector\/blackout' \}\);/);
  assert.match(pw, /else if \(welcomeOverPw\(live\) \|\| blackoutOverPw\(live\)\) showPosition\(session, deck, at\);/, 'at either end, Next and Back put the covered slide back');
  assert.match(read('src/operator/actions.ts'), /else if \(welcomeOverPw\(state\)\) dispatch\(\{ type: 'projector\/take', source: 'PW_SESSION' \}\);/);
  const view = read('src/praise-worship/LiveView.tsx');
  assert.match(view, /const covered = welcomeOverPw\(live\) \|\| blackoutOverPw\(live\);/);
  assert.match(view, /const atEnd = !covered && /);
});

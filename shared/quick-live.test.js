// The Quick-Live Mini Output Preview: the compact popup a planner library LIVE press opens. It parks a Holy Mass or Praise & Worship run
// without losing its place or its clocks, steps the ad-hoc item with Back and Next, and on exit puts the parked run back on its exact slide
// (or clears the screen when nothing was running). The rules run here through the real live reducer. Synthetic strings only: no real song
// titles or lyrics. Run with: node --test shared/quick-live.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initialLiveState, liveReducer } from './live.js';
import { mainLiveStatus, restoreMassActions } from './main-live.js';
import {
  heldFrame,
  quickLiveCounter,
  quickLiveExit,
  quickLiveIndex,
  quickLiveNextFrame,
  quickLiveSession,
  quickLiveShouldClose,
  quickLiveStepAction,
  sameSlide,
} from './quick-live.js';
import { goLiveT, GOLIVE_LANGS } from './golive-i18n.js';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const run = (state, ...actions) => actions.reduce(liveReducer, state);

const MAIN_SLIDE = { kind: 'text', key: 'sample-main-segment', title: 'Sample Main Segment', text: 'Sample Main Segment' };
const row = (label) => ({ id: label, module: 'custom', sourceId: label, label, block: 'word', stale: false });

/** A two-slide prayer, as slideFramesOf builds one: the same key, one page per slide. */
const PRAYER = [0, 1].map((index) => ({
  kind: 'text',
  title: 'Sample Prayer',
  headline: 'Sample Prayer',
  text: `Sample Slide Line ${index + 1}`,
  bg: null,
  key: 'prayer:41',
  page: { index, total: 2 },
}));

/** A three-verse song, as stanzaFrame builds one. */
const SONG = [0, 1, 2].map((position) => ({
  kind: 'lyrics',
  title: 'Sample Song Title',
  label: `Verse ${position + 1}`,
  text: `Sample Slide Line ${position + 1}`,
  key: 'song:901',
  song: { hymnId: 901, position, count: 3 },
}));

const projectorOn = () => ({ ...initialLiveState(), outputs: { projector: true, lowerThird: false, preview: false } });

/** A Holy Mass on air at row 1, showing the sample main segment slide. */
function massOnAir() {
  return run(
    projectorOn(),
    { type: 'queue/set', items: [row('Sample Main Segment A'), row('Sample Main Segment B'), row('Sample Main Segment C')], planId: 7 },
    { type: 'queue/cursor', index: 1 },
    { type: 'projector/stage', frame: MAIN_SLIDE },
    { type: 'projector/take', source: 'MASS_QUEUE' },
  );
}

/** A Praise & Worship lineup on air at its second slide, its clocks started at 1000. */
function pwOnAir() {
  return run(
    projectorOn(),
    { type: 'pw/load', sessionId: 3 },
    { type: 'projector/show', frame: MAIN_SLIDE, source: 'PW_SESSION' },
    { type: 'pw/cursor', segmentKey: 'seg-1', slide: 1, now: 1000 },
  );
}

/** A library LIVE press, as goLiveLibraryItem does it: the first slide as a direct show, then the popup's session. */
function pressLive(before, frames, previous = null) {
  const state = run(before, { type: 'projector/stage', frame: frames[0] }, { type: 'projector/take', source: 'DIRECT_DECK' });
  return { state, session: quickLiveSession(before, { title: frames[0].title, frames }, previous) };
}

test('LIVE during a Holy Mass opens the popup, parks the Mass at its exact row and slide, and shows Current and Next', () => {
  const { state, session } = pressLive(massOnAir(), PRAYER);
  assert.equal(session.parked, 'mass');
  assert.equal(session.title, 'Sample Prayer');
  assert.deepEqual(state.queueParked, { index: 1, planId: 7, frame: MAIN_SLIDE }, 'the Mass place is kept, not reset');
  assert.deepEqual(mainLiveStatus(state), { onAir: null, parked: 'mass', override: true });
  assert.equal(quickLiveIndex(session, state.projector), 0);
  assert.deepEqual(heldFrame(state.projector), PRAYER[0], 'Current Slide is the slide on air');
  assert.deepEqual(quickLiveNextFrame(session, state.projector), PRAYER[1], 'Next Slide is the second slide');
  assert.equal(quickLiveCounter(session, state.projector), '01 / 02');
});

test('LIVE during Praise & Worship parks the lineup at its segment and slide with its clocks running', () => {
  const before = pwOnAir();
  const { state, session } = pressLive(before, SONG);
  assert.equal(session.parked, 'pw');
  assert.equal(state.pw.onAir, false);
  assert.equal(state.pw.segmentKey, 'seg-1');
  assert.equal(state.pw.slide, 1);
  assert.equal(state.pw.startedAt, 1000, 'the segment timer is not reset');
  assert.equal(state.pw.liveSince, 1000, 'the session clock is not reset');
  assert.equal(quickLiveIndex(session, state.projector), 0);
  assert.equal(quickLiveCounter(session, state.projector), '01 / 03');
});

test('LIVE with nothing running opens the popup with nothing parked', () => {
  const { state, session } = pressLive(projectorOn(), PRAYER);
  assert.equal(session.parked, null);
  assert.equal(quickLiveIndex(session, state.projector), 0);
});

test('Back and Next step through a multi-slide item within its bounds', () => {
  let { state, session } = pressLive(projectorOn(), SONG);
  assert.equal(quickLiveStepAction(session, state.projector, -1), null, 'Back is disabled on the first slide');

  const next = quickLiveStepAction(session, state.projector, 1);
  assert.deepEqual(next, { type: 'projector/show', frame: SONG[1], source: 'DIRECT_DECK' });
  state = run(state, next);
  assert.equal(quickLiveIndex(session, state.projector), 1);
  assert.equal(quickLiveCounter(session, state.projector), '02 / 03');

  state = run(state, quickLiveStepAction(session, state.projector, 1));
  assert.equal(quickLiveIndex(session, state.projector), 2);
  assert.equal(quickLiveNextFrame(session, state.projector), null, 'End of item');
  assert.equal(quickLiveStepAction(session, state.projector, 1), null, 'Next is disabled on the last slide');

  state = run(state, quickLiveStepAction(session, state.projector, -1));
  assert.equal(quickLiveIndex(session, state.projector), 1, 'Back steps back');
});

test('stepping never touches the parked Mass place', () => {
  let { state, session } = pressLive(massOnAir(), PRAYER);
  state = run(state, quickLiveStepAction(session, state.projector, 1));
  assert.equal(quickLiveIndex(session, state.projector), 1);
  state = run(state, quickLiveStepAction(session, state.projector, -1));
  assert.equal(quickLiveIndex(session, state.projector), 0);
  assert.deepEqual(state.queueParked, { index: 1, planId: 7, frame: MAIN_SLIDE });
  assert.equal(state.queueCursor, -1);
});

test('under Blackout the popup still knows its place, and a step waits behind the Blackout', () => {
  let { state, session } = pressLive(projectorOn(), PRAYER);
  state = run(state, { type: 'projector/blackout' });
  assert.equal(quickLiveIndex(session, state.projector), 0);
  state = run(state, quickLiveStepAction(session, state.projector, 1));
  assert.equal(state.projector.live.kind, 'blackout', 'the screen stays black');
  assert.equal(quickLiveIndex(session, state.projector), 1, 'the slide waits behind it');
});

test('an edited slide (new words, same place) still counts as the item on air', () => {
  assert.ok(sameSlide(PRAYER[0], { ...PRAYER[0], text: 'Sample Slide Line edited' }));
  assert.ok(!sameSlide(PRAYER[0], PRAYER[1]));
  assert.ok(!sameSlide(PRAYER[0], MAIN_SLIDE));
});

test('Return to Main Live restores the exact parked Holy Mass slide and row', () => {
  let { state, session } = pressLive(massOnAir(), PRAYER);
  state = run(state, quickLiveStepAction(session, state.projector, 1));
  assert.equal(quickLiveExit(session, state), 'restore');
  state = run(state, ...restoreMassActions(state));
  assert.equal(state.queueCursor, 1, 'the row is CURRENT again');
  assert.deepEqual(state.projector.live, MAIN_SLIDE, 'the exact slide it showed');
  assert.equal(state.projector.source, 'MASS_QUEUE');
  assert.deepEqual(mainLiveStatus(state), { onAir: 'mass', parked: null, override: false });
  assert.equal(quickLiveIndex(session, state.projector), -1, 'the ad-hoc item is dismissed');
});

test('Return to Main Live restores the lineup without resetting its timers', () => {
  let { state, session } = pressLive(pwOnAir(), SONG);
  assert.equal(quickLiveExit(session, state), 'restore');
  // resumeLive shows the lineup's slide at its place: the same segment, so its timer keeps its start.
  state = run(state, { type: 'projector/show', frame: MAIN_SLIDE, source: 'PW_SESSION', lift: true }, { type: 'pw/cursor', segmentKey: 'seg-1', slide: 1, now: 9000 });
  assert.equal(state.pw.onAir, true);
  assert.equal(state.pw.slide, 1);
  assert.equal(state.pw.startedAt, 1000);
  assert.equal(state.pw.liveSince, 1000);
  assert.deepEqual(state.projector.live, MAIN_SLIDE);
});

test('End Live & Close clears the screen when nothing was parked', () => {
  let { state, session } = pressLive(projectorOn(), PRAYER);
  assert.equal(quickLiveExit(session, state), 'clear');
  state = run(state, { type: 'projector/clear' });
  assert.equal(state.projector.live.kind, 'idle');
  assert.equal(quickLiveExit(session, state), 'none', 'a second exit has nothing left to do');
});

test('an exit leaves alone a screen something else has already taken', () => {
  let { state, session } = pressLive(projectorOn(), PRAYER);
  state = run(state, { type: 'projector/show', frame: MAIN_SLIDE, source: 'DIRECT_DECK' });
  assert.equal(quickLiveExit(session, state), 'none');
});

test('the popup closes by itself once the main run is back on air, but not while the LIVE press is still on its way', () => {
  const before = massOnAir();
  const { state, session } = pressLive(before, PRAYER);
  // Over IPC the state can still be the one from before the press: the Mass is on air and the item is not yet seen.
  assert.equal(quickLiveShouldClose(session, before, false), false);
  assert.equal(quickLiveShouldClose(session, state, true), false, 'the item is on air');
  const back = run(state, ...restoreMassActions(state));
  assert.equal(quickLiveShouldClose(session, back, true), true, 'Back to Main Live from the top bar');
});

test('a second LIVE over the open popup keeps the run the first one parked', () => {
  const first = pressLive(massOnAir(), PRAYER);
  const second = pressLive(first.state, SONG, first.session);
  assert.equal(second.session.parked, 'mass');
  assert.equal(second.session.title, 'Sample Song Title');
  assert.deepEqual(second.state.queueParked, { index: 1, planId: 7, frame: MAIN_SLIDE });
  assert.equal(quickLiveExit(second.session, second.state), 'restore');
});

// The wiring, read from the sources.
const popup = read('src/golive/QuickLivePreview.tsx');

test('the popup is a compact card over a light backdrop, not a full-screen view', () => {
  assert.match(popup, /max-w-\[680px\]/);
  assert.match(popup, /role="dialog"\n\s+aria-modal="true"/);
  assert.match(popup, /bg-black\/40/, 'the Planner stays in sight behind it');
  assert.match(popup, /<FramePreview frame=\{current\} \/>/, 'Current Slide is drawn by the projector renderer');
  assert.match(popup, /<FramePreview frame=\{next\} \/>/, 'so is Next Slide');
  assert.match(popup, /t\('quickLiveEndOfItem'\)/);
  assert.match(popup, /t\('quickLiveLive'\)/, 'the LIVE badge');
  assert.match(popup, /session\.parked \? t\('quickLiveReturn'\) : t\('quickLiveEnd'\)/);
});

test('every control in the popup is no-drag and clickable over the frameless window', () => {
  assert.match(popup, /const CONTROL = 'pointer-events-auto no-drag';/);
  // Each button's opening tag: from `<button` to the line that closes it (a lone `>`, or `>` after its last attribute).
  const buttons = popup.split('<button').slice(1).map((chunk) => chunk.slice(0, chunk.search(/\n\s*>|style=\{NO_DRAG\}>|\}>\n/) + 20));
  assert.ok(buttons.length >= 5, `Close, Next monitor, Back, Next, Exit (${buttons.length})`);
  for (const b of buttons) {
    assert.match(b, /style=\{NO_DRAG\}/, `no-drag style: ${b.slice(0, 80)}`);
    assert.match(b, /\$\{CONTROL\}/, `no-drag class: ${b.slice(0, 80)}`);
  }
  assert.match(popup, /data-quick-live-backdrop className="[^"]*pointer-events-auto[^"]*" style=\{NO_DRAG\}/);
  assert.match(popup, /data-testid="quick-live-preview"\n\s+className=\{`\$\{CONTROL\}/);
});

test('keys: ← / → step, Escape exits, typing keeps its keys', () => {
  assert.match(popup, /e\.key === 'ArrowRight' \|\| e\.key === 'PageDown'\) act = \(\) => step\(1\)/);
  assert.match(popup, /e\.key === 'ArrowLeft' \|\| e\.key === 'PageUp'\) act = \(\) => step\(-1\)/);
  assert.match(popup, /e\.key === 'Escape' && !e\.repeat\) act = exit/);
  assert.match(popup, /isTextEntry\(e\.target\)\) return;/);
  assert.match(popup, /window\.addEventListener\('keydown', onKey, true\)/);
});

test('the LIVE buttons open the popup; the top bar Back to Main Live closes it', () => {
  const routing = read('src/planner/routing.ts');
  const body = routing.slice(routing.indexOf('export async function goLiveLibraryItem'));
  assert.equal((body.match(/openQuickLivePreview\(before, /g) ?? []).length, 5, 'song, reading, passage, prayer, title card');
  assert.match(body, /const before = useLive\.getState\(\)\.state;/, 'the run on air is read before the take');
  const main = read('src/golive/mainLive.ts');
  assert.match(main, /export async function goToMainLive\(\): Promise<void> \{\n\s+closeQuickLivePreview\(\);/);
  assert.match(main, /export async function restoreMainLive\(\)/);
  assert.match(read('src/golive/quickLiveSession.ts'), /if \(exit === 'restore'\) await restore\(\);\n\s+else if \(exit === 'clear'\) dispatch\(\{ type: 'projector\/clear' \}\);/);
  assert.match(read('src/operator/OperatorApp.tsx'), /<QuickLivePreview \/>/);
  const pwLibrary = read('src/praise-worship/Library.tsx');
  assert.match(pwLibrary, /goLive: async \(\) => void goLiveNote\(p\),/);
  assert.match(pwLibrary, /goLiveFrame\(segment\.name, /);
});

test('every popup label is in English, Tagalog and Cebuano', () => {
  const used = new Set([...popup.matchAll(/\bt\('(quickLive[A-Za-z]*)'/g)].map((m) => m[1]));
  for (const key of ['quickLiveCurrent', 'quickLiveNext', 'quickLiveBack', 'quickLiveNextBtn', 'quickLiveReturn', 'quickLiveEnd', 'quickLiveEndOfItem', 'quickLiveTitle']) {
    assert.ok(used.has(key), `${key} is shown`);
  }
  const text = read('shared/golive-i18n.js');
  for (const key of used) {
    assert.equal([...text.matchAll(new RegExp(`^\\s+${key}: `, 'gm'))].length, GOLIVE_LANGS.length, `${key} once per language`);
    for (const lang of GOLIVE_LANGS) assert.notEqual(goLiveT(lang, key), key, `${key} in ${lang}`);
  }
  assert.equal(goLiveT('en', 'quickLiveCurrent'), 'Current Slide · Live');
  assert.equal(goLiveT('en', 'quickLiveReturn'), 'Return to Main Live');
  assert.equal(goLiveT('en', 'quickLiveEnd'), 'End Live & Close');
  assert.notEqual(goLiveT('tl', 'quickLiveReturn'), goLiveT('en', 'quickLiveReturn'));
  assert.notEqual(goLiveT('ceb', 'quickLiveEndOfItem'), goLiveT('en', 'quickLiveEndOfItem'));
});

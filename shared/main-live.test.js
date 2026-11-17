// The top bar's Go Live shortcut, which replaced Pause Lower 3rd: it opens the Go Live console from any workspace, and after an ad-hoc LIVE item
// (a song, prayer or reading sent straight to the projector) it reads Back to Main Live and puts the parked Holy Mass or Praise & Worship slide
// back on the screen. Pause Lower 3rd lives on in the Lower 3rd control. Synthetic data only.
// Run with: node --test shared/main-live.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initialLiveState, liveReducer } from './live.js';
import { bandFixAction, mainLiveStatus, mainLiveTab, restoreMassActions } from './main-live.js';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const run = (state, ...actions) => actions.reduce(liveReducer, state);

const SEGMENT_SLIDE = { kind: 'text', key: 'sample-segment', text: 'Sample Segment' };
const SAMPLE_SONG = { kind: 'lyrics', key: 'sample-song-1', title: 'Sample Song 1', lines: ['Sample line'], song: { hymnId: 901, position: 0 } };
const SAMPLE_PRAYER = { kind: 'text', key: 'sample-prayer', text: 'Sample Prayer' };
const row = (label) => ({ module: 'custom', sourceId: label, label, stale: false });

/** A Holy Mass on air at row 1, showing the sample segment slide. */
function massOnAir() {
  const base = { ...initialLiveState(), outputs: { projector: true, lowerThird: false, preview: false } };
  return run(
    base,
    { type: 'queue/set', items: [row('Sample Segment A'), row('Sample Segment B'), row('Sample Segment C')], planId: 7 },
    { type: 'queue/cursor', index: 1 },
    { type: 'projector/stage', frame: SEGMENT_SLIDE },
    { type: 'projector/take', source: 'MASS_QUEUE' },
  );
}

/** A Praise & Worship session on air at its second slide. */
function pwOnAir() {
  const base = { ...initialLiveState(), outputs: { projector: true, lowerThird: false, preview: false } };
  return run(
    base,
    { type: 'pw/load', sessionId: 3 },
    { type: 'projector/show', frame: SEGMENT_SLIDE, source: 'PW_SESSION' },
    { type: 'pw/cursor', segmentKey: 'seg-1', slide: 1, now: 1000 },
  );
}

test('a Holy Mass on air is the main run: Go Live, nothing parked', () => {
  const s = massOnAir();
  assert.deepEqual(mainLiveStatus(s), { onAir: 'mass', parked: null, override: false });
  assert.equal(mainLiveTab(s), 'mass');
  assert.equal(s.queueParked ?? null, null);
});

test('an ad-hoc LIVE song parks the Holy Mass at its row and slide, and lights Back to Main Live', () => {
  const s = run(massOnAir(), { type: 'projector/show', frame: SAMPLE_SONG, source: 'DIRECT_DECK' });
  assert.equal(s.queueCursor, -1, 'the CURRENT row ends, as before');
  assert.deepEqual(s.queueParked, { index: 1, planId: 7, frame: SEGMENT_SLIDE });
  assert.deepEqual(mainLiveStatus(s), { onAir: null, parked: 'mass', override: true });
  assert.equal(mainLiveTab(s), 'mass');

  // A second ad-hoc item (a prayer taken on a deck) keeps the same parked place.
  const again = run(s, { type: 'projector/stage', frame: SAMPLE_PRAYER }, { type: 'projector/take', source: 'DIRECT_DECK' });
  assert.deepEqual(again.queueParked, { index: 1, planId: 7, frame: SEGMENT_SLIDE });
});

test('Back to Main Live puts the parked Mass slide back on the queue take, and the Mass is the main run again', () => {
  const adhoc = run(massOnAir(), { type: 'projector/show', frame: SAMPLE_SONG, source: 'DIRECT_DECK' });
  const actions = restoreMassActions(adhoc);
  assert.deepEqual(actions, [
    { type: 'queue/cursor', index: 1 },
    { type: 'projector/stage', frame: SEGMENT_SLIDE },
    { type: 'projector/take', source: 'MASS_QUEUE' },
  ]);
  const back = run(adhoc, ...actions);
  assert.equal(back.queueCursor, 1);
  assert.equal(back.projector.live, SEGMENT_SLIDE);
  assert.equal(back.projector.source, 'MASS_QUEUE');
  assert.equal(back.queueParked, null);
  assert.deepEqual(mainLiveStatus(back), { onAir: 'mass', parked: null, override: false });
});

test('a Mass under Blackout parks the slide Blackout covered, not the black screen', () => {
  const dark = run(massOnAir(), { type: 'projector/blackout' });
  const s = run(dark, { type: 'projector/stage', frame: SAMPLE_PRAYER }, { type: 'projector/take', source: 'DIRECT_DECK' });
  assert.deepEqual(s.queueParked?.frame, SEGMENT_SLIDE);
});

test('after Clear the Mass stays parked but Back to Main Live is not lit as an override', () => {
  const s = run(massOnAir(), { type: 'projector/show', frame: SAMPLE_SONG, source: 'DIRECT_DECK' }, { type: 'projector/clear' });
  assert.deepEqual(mainLiveStatus(s), { onAir: null, parked: 'mass', override: false });
});

test('a parked Mass is forgotten by End session, another plan, a stale row, or Praise & Worship taking the screen', () => {
  const adhoc = run(massOnAir(), { type: 'projector/show', frame: SAMPLE_SONG, source: 'DIRECT_DECK' });
  assert.equal(run(adhoc, { type: 'queue/cursor', index: -1 }).queueParked, null, 'End session');
  assert.equal(run(adhoc, { type: 'queue/set', items: [row('Sample Segment')], planId: 8 }).queueParked, null, 'another plan');
  const stale = run(adhoc, { type: 'queue/set', items: adhoc.queue.map((q, i) => (i === 1 ? { ...q, stale: true } : q)), planId: 7 });
  assert.equal(mainLiveStatus(stale).parked, null, 'a row whose source is gone cannot be played');
  const pw = run(adhoc, { type: 'pw/load', sessionId: 3 }, { type: 'projector/show', frame: SEGMENT_SLIDE, source: 'PW_SESSION' });
  assert.equal(pw.queueParked, null, 'Praise & Worship took the screen');
});

test('an ad-hoc LIVE prayer over Praise & Worship parks the lineup at its place', () => {
  const s = run(pwOnAir(), { type: 'projector/show', frame: SAMPLE_PRAYER, source: 'DIRECT_DECK' });
  assert.equal(s.pw.onAir, false);
  assert.equal(s.pw.segmentKey, 'seg-1');
  assert.equal(s.pw.slide, 1);
  assert.deepEqual(mainLiveStatus(s), { onAir: null, parked: 'pw', override: true });
  assert.equal(mainLiveTab(s), 'pw');
  assert.equal(restoreMassActions(s), null, 'nothing of the Mass to put back');
  // The lineup's own show (resumeLive) puts it back on air.
  const back = run(s, { type: 'projector/show', frame: SEGMENT_SLIDE, source: 'PW_SESSION' }, { type: 'pw/cursor', segmentKey: 'seg-1', slide: 1, now: 2000 });
  assert.deepEqual(mainLiveStatus(back), { onAir: 'pw', parked: null, override: false });
});

test('with nothing loaded, Go Live has no run to open and nothing to put back', () => {
  assert.deepEqual(mainLiveStatus(initialLiveState()), { onAir: null, parked: null, override: false });
  assert.equal(mainLiveTab(initialLiveState()), null);
});

test('the song band an ad-hoc item left is replaced by the main run band; the operator’s own band is not', () => {
  const songBand = { template: 'segment', tag: 'Song', line1: 'Sample Song 1' };
  const massBand = { template: 'segment', tag: 'Holy Mass', line1: 'Sample Segment' };
  const withBand = (live) => ({ ...initialLiveState(), lowerThird: { live, staged: live, paused: false, choice: 'on' } });
  assert.deepEqual(bandFixAction(withBand(songBand), massBand), { type: 'lowerThird/show', value: massBand });
  assert.equal(bandFixAction(withBand(massBand), massBand), null, 'already right');
  assert.equal(bandFixAction(withBand({ template: 'nameplate', line1: 'Sample Speaker' }), massBand), null, 'a nameplate stays');
  assert.equal(bandFixAction(withBand(null), massBand), null, 'a lower third that is off stays off');
});

test('top bar: Go Live sits between Pause Projector and Stop, where Pause Lower 3rd was', () => {
  const bar = read('src/operator/TopBar.tsx');
  const zoneA = bar.slice(bar.indexOf("aria-label={t('top.groupState')}"), bar.indexOf('{!stacked && <Divider />}'));
  const pauseProjector = zoneA.indexOf("t('top.pauseProjector')");
  const goLive = zoneA.indexOf('<GoLiveShortcut />');
  const stop = zoneA.indexOf("t('top.stop')");
  assert.ok(pauseProjector > 0 && goLive > pauseProjector && stop > goLive, 'Pause Projector, then Go Live, then Stop');
  assert.doesNotMatch(zoneA, /top\.pauseLowerThird|lowerThird\/pause/, 'Pause Lower 3rd is no longer in the master transport');
  assert.match(bar, /import \{ ChevronRight, [^}]*Radio[^}]*\} from 'lucide-react';/);
  assert.match(bar, /onClick=\{run\}/);
  assert.match(bar, /const run = \(\) => void goToMainLive\(\)/);
  assert.match(bar, /t\('top\.backToMainLive'\)/);
  assert.match(bar, /active \? t\('top\.liveActive'\) : t\('top\.goLive'\)/);
  assert.match(bar, /data-state=\{override \? 'override' : 'parked'\}/);
});

test('top bar: Pause Lower 3rd is still there, as the second half of the Lower 3rd control while a band is on air', () => {
  const bar = read('src/operator/TopBar.tsx');
  const control = bar.slice(bar.indexOf('function LowerThirdControl()'), bar.indexOf('function MasterSwitch'));
  assert.match(control, /onClick=\{\(\) => dispatch\(\{ type: 'lowerThird\/pause' \}\)\}/);
  assert.match(control, /aria-label=\{paused \? t\('top\.lowerThirdPaused'\) : t\('top\.pauseLowerThird'\)\}/);
  assert.match(control, /withKey\(paused \? t\('top\.tipResumeLowerThird'\) : t\('top\.tipPauseLowerThird'\), pauseKey\)/);
  assert.match(control, /data-testid="lower-third-pause"/);
  assert.match(bar, /<LowerThirdControl \/>/);
});

test('Go Live from any workspace opens the console on the run, and restores a parked Mass or lineup', () => {
  const main = read('src/golive/mainLive.ts');
  assert.match(main, /setUi\(\{ view: 'goLive', \.\.\.\(tab \? \{ goLiveTabRequest: tab \} : \{\}\) \}\);\n\s+if \(!parked\) return;/);
  assert.match(main, /if \(parked === 'pw'\) \{\n\s+await resumeLive\(\);/);
  assert.match(main, /const actions = restoreMassActions\(state\);[\s\S]*if \(actions\) actions\.forEach\(dispatch\);/);
  assert.match(main, /setGoLiveFocused\(false\);/);
  const consoleSrc = read('src/golive/GoLiveConsole.tsx');
  assert.match(consoleSrc, /const requested = useUi\.getState\(\)\.goLiveTabRequest;\n\s+if \(requested\) return requested;/);
  assert.match(consoleSrc, /setTab\(tabRequest\);\n\s+setUi\(\{ goLiveTabRequest: null \}\);/);
  const pw = read('src/praise-worship/live.ts');
  assert.match(pw, /export async function resumeLive\(\): Promise<boolean> \{[\s\S]*?showPosition\(session, deck, at\);/);
});

test('Go Live, Live Active and Back to Main Live are localized in English, Tagalog and Cebuano', () => {
  const strings = read('src/i18n/strings.ts');
  const block = (start, end) => strings.slice(strings.indexOf(start), end ? strings.indexOf(end) : undefined);
  const en = block('const en = {', 'const tl');
  const tl = block('const tl', 'const ceb');
  const ceb = block('const ceb', null);
  const keys = ['top.goLive', 'top.liveActive', 'top.backToMainLive', 'top.tipGoLive', 'top.tipBackToMainLive', 'top.tipBackToMainLiveOverride', 'top.pauseLowerThird'];
  for (const [name, text] of [['en', en], ['tl', tl], ['ceb', ceb]]) {
    for (const key of keys) assert.match(text, new RegExp(`'${key.replace('.', '\\.')}': '`), `${name} has ${key}`);
  }
  assert.match(en, /'top\.backToMainLive': 'Back to Main Live'/);
  assert.match(tl, /'top\.backToMainLive': 'Bumalik sa Main Live'/);
  assert.match(ceb, /'top\.backToMainLive': 'Balik sa Main Live'/);
});

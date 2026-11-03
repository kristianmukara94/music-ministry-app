// "Holy Mass" in the labels, the lower third turning on at Go Live, and on-air editing closed while the Holy Mass is on air.
// Run with: node --test shared/holy-mass.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initialLiveState, liveReducer } from './live.js';
import { goLiveT as goT } from './golive-i18n.js';
import { lyT } from './lyrics-i18n.js';
import { plannerT as plT } from './planner-i18n.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const run = (state, ...actions) => actions.reduce((s, a) => liveReducer(s, a), state);
const BAND = { template: 'segment', tag: 'Praise', line1: 'Joyful Song', line2: 'Anon' };

// ---- Labels ----

test('the Mass tab, the song scope, the queue tag and the sidebar section read Holy Mass, in all three languages', () => {
  assert.equal(goT('en', 'tabMass'), 'Holy Mass');
  assert.equal(goT('tl', 'tabMass'), 'Banal na Misa');
  assert.equal(goT('ceb', 'tabMass'), 'Balaang Misa');
  assert.equal(lyT('en', 'scope_MASS'), 'Holy Mass');
  assert.equal(plT('en', 'module_mass_order'), 'Holy Mass');
  assert.match(read('src/planner/ServiceQueue.tsx'), /mass_order: \{ label: 'HOLY MASS'/);
  assert.match(read('src/golive/MassLiveView.tsx'), /mass_order: 'Holy Mass',/);
  assert.match(read('src/i18n/strings.ts'), /'nav\.planner': 'Holy Mass Planner',/);
});

test('only the labels changed: the saved identifiers (tab id, scope value, module name) are the ones existing files and sessions use', () => {
  const console = read('src/golive/GoLiveConsole.tsx');
  assert.match(console, /setTab\('mass'\)/);
  assert.match(read('shared/song-taxonomy.js'), /PRIMARY_CATEGORIES = \['GENERAL', 'MASS', 'PRAISE_AND_WORSHIP'\]/);
  assert.match(read('src/planner/ServiceQueue.tsx'), /mass_order:/);
});

// ---- The lower third at Go Live ----

test('Go Live shows the staged lower third and records the choice as On, so the toggle reads LIVE', () => {
  let s = run(initialLiveState(), { type: 'lowerThird/stage', value: BAND });
  assert.equal(s.lowerThird.live, null);
  s = liveReducer(s, { type: 'lowerThird/on' });
  assert.deepEqual(s.lowerThird.live, BAND);
  assert.equal(s.lowerThird.choice, 'on');
});

test('Go Live turns it on even when the operator had switched it off before', () => {
  let s = run(initialLiveState(), { type: 'lowerThird/show', value: BAND }, { type: 'lowerThird/toggle' });
  assert.equal(s.lowerThird.live, null);
  assert.equal(s.lowerThird.choice, 'off');
  s = liveReducer(s, { type: 'lowerThird/on', value: BAND });
  assert.deepEqual(s.lowerThird.live, BAND);
  assert.equal(s.lowerThird.choice, 'on');
});

test('a value given to Go Live replaces whatever was staged; with nothing to show, only the choice is recorded', () => {
  const other = { template: 'segment', tag: 'Holy Mass', line1: 'Sunday' };
  const s = run(initialLiveState(), { type: 'lowerThird/stage', value: BAND }, { type: 'lowerThird/on', value: other });
  assert.deepEqual(s.lowerThird.live, other);
  assert.deepEqual(s.lowerThird.staged, other);
  const bare = liveReducer(initialLiveState(), { type: 'lowerThird/on' });
  assert.equal(bare.lowerThird.live, null);
  assert.equal(bare.lowerThird.choice, 'on', 'a band staged later then shows');
});

test('a paused lower third is not put on screen by Go Live; the band waits staged', () => {
  const paused = run(initialLiveState(), { type: 'lowerThird/stage', value: BAND }, { type: 'lowerThird/pause', paused: true });
  const s = liveReducer(paused, { type: 'lowerThird/on' });
  assert.equal(s.lowerThird.live, null);
  assert.deepEqual(s.lowerThird.staged, BAND);
});

test('Go Live in Praise & Worship, the Holy Mass and Quick Live each turn the lower third on', () => {
  const pw = read('src/praise-worship/live.ts');
  assert.match(pw, /showPosition\(session, deck, pos, undefined, \{ lowerThirdOn: true \}\);/);
  assert.match(pw, /if \(options\.lowerThirdOn\) dispatch\(\{ type: 'lowerThird\/on' \}\);/);
  assert.match(pw, /\(newSong \|\| newSegment\) && now\.lowerThird\.live\?\.template === 'segment'/, 'a band on screen follows the segment it moves to');
  const mass = read('src/golive/massLive.ts');
  assert.match(mass, /dispatch\(\{ type: 'lowerThird\/on', value: holyMassBand\(planName\) \}\)/);
  assert.match(read('src/golive/GoLiveConsole.tsx'), /await goLiveMassAt\(resume, massPlan\.name\);/);
  assert.match(read('src/golive/MassLiveView.tsx'), /goLiveMassAt\(firstPlayable, planName\)/);
  const quick = read('src/praise-worship/useQuickLiveController.ts');
  assert.match(quick, /dispatch\(\{ type: 'lowerThird\/on', value: bandRef\.current \}\);/);
});

test('leaving Quick Live replaces its band with the lineup segment\'s, or takes it down when there is no lineup', () => {
  const quick = read('src/praise-worship/useQuickLiveController.ts');
  assert.match(quick, /dispatch\(\{ type: 'lowerThird\/show', value: lowerThirdFor\(session, segment, hymnId\) \}\);/);
  assert.match(quick, /if \(takeDownBand\(state\) === 'on'\) dispatch\(\{ type: 'lowerThird\/clear' \}\);/);
  assert.match(quick, /JSON\.stringify\(state\.lowerThird\.live\) === JSON\.stringify\(mine\)/, 'a band the operator changed is left alone');
});

// ---- Holy Mass restrictions ----

test('on-air editing is closed exactly while the Mass Queue has the projector', () => {
  const guard = read('src/praise-worship/holyMass.ts');
  assert.match(guard, /state\.queueCursor >= 0 && state\.projector\.source === 'MASS_QUEUE' && state\.projector\.live\.kind !== 'idle'/);
  const hot = read('src/praise-worship/useLiveHotEditor.ts');
  assert.match(hot, /const locked = useHolyMassOnAir\(\);/);
  // Every way in is stopped: the one place a song is written, the split, and the openers.
  assert.match(hot, /if \(locked\) \{\s+setError\(HOLY_MASS_LOCKED\);\s+return null;/);
  assert.match(hot, /if \(locked \|\| !hymn\?\.stanzas\[index\]\) return;/);
  assert.match(hot, /const startAdd = \(\) => \{\s+if \(locked\) return;/);
  assert.match(hot, /if \(locked\) \{\s+setError\(HOLY_MASS_LOCKED\);\s+return false;/);
});

test('while the Holy Mass is on air the edit, add and pencil controls are not shown, and the lineup editor renders nothing', () => {
  const panel = read('src/praise-worship/QuickCuePanel.tsx');
  assert.match(panel, /\{!hot\.locked && \(\s+<button type="button" onClick=\{hot\.startAdd\}/);
  assert.match(panel, /\{!hot\.locked && \(\s+<button\s+type="button"\s+onClick=\{\(\) => hot\.startEdit\(i\)\}/);
  assert.match(read('src/praise-worship/LineupHotEdit.tsx'), /if \(hot\.locked\) return null;/);
  assert.match(read('src/praise-worship/SplitStanzaDialog.tsx'), /\{hot\.locked \? \(/);
  assert.match(read('src/praise-worship/LiveView.tsx'), /const holyMassOnAir = useHolyMassOnAir\(\);/);
});

test('the Holy Mass planner and live view never had these controls, and still do not', () => {
  for (const file of ['src/golive/MassLiveView.tsx', 'src/planner/MassPlanner.tsx', 'src/golive/MassPlanHub.tsx', 'src/golive/GoLiveConsole.tsx']) {
    const source = read(file);
    assert.doesNotMatch(source, /useLiveHotEditor|LineupHotEdit|QuickCuePanel|HotEditForms|SplitStanzaDialog/, `${file} has no live editing`);
  }
});

test('Praise & Worship and Quick Live keep their live editing: the controls are there when the Holy Mass is not on air', () => {
  assert.match(read('src/praise-worship/LiveView.tsx'), /<LineupHotEdit /);
  assert.match(read('src/praise-worship/Library.tsx'), /<QuickCuePanel /);
  assert.match(read('src/praise-worship/useLiveHotEditor.ts'), /await bridge\.lyrics\.editHymn\(hymn\.id, \{/);
  for (const lang of ['en', 'tl']) assert.ok(read('shared/pw-i18n.js').includes('holyMassLocked'), lang);
});

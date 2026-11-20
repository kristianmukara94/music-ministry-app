// The Go Live console header's Planner tab, which replaced Prepare: PRAISE & WORSHIP | HOLY MASS | PLANNER. It opens the Planner of the run on
// air (or of the active tab while idle) on its plan and date, and never touches the live state. Synthetic data only.
// Run with: node --test shared/golive-planner-tab.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initialLiveState, liveReducer } from './live.js';
import { GOLIVE_LANGS, goLiveT } from './golive-i18n.js';
import { plannerTabTipKey, resolveMatchingPlannerTarget } from './planner-target.js';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const exists = (rel) => fs.existsSync(new URL(`../${rel}`, import.meta.url));
const run = (state, ...actions) => actions.reduce(liveReducer, state);

const SEGMENT_SLIDE = { kind: 'text', key: 'sample-segment', text: 'Sample Segment' };
const row = (label) => ({ module: 'custom', sourceId: label, label, stale: false });
const PLANS = [
  { id: 7, name: 'Sample Plan', liturgicalDate: '2026-11-22' },
  { id: 8, name: 'Sample Plan B', liturgicalDate: '2026-11-29' },
];
const SESSIONS = [
  { id: 3, name: 'Sample Plan', liturgicalDate: '2026-11-21' },
  { id: 4, name: 'Sample Plan B', liturgicalDate: '2026-12-05' },
];
const lists = { sessions: SESSIONS, plans: PLANS };

function idle() {
  return { ...initialLiveState(), outputs: { projector: true, lowerThird: false, preview: false } };
}
/** A Holy Mass on air from plan 7, showing a sample segment slide. */
function massOnAir() {
  return run(
    idle(),
    { type: 'queue/set', items: [row('Sample Segment A'), row('Sample Segment B')], planId: 7 },
    { type: 'queue/cursor', index: 1 },
    { type: 'projector/stage', frame: SEGMENT_SLIDE },
    { type: 'projector/take', source: 'MASS_QUEUE' },
  );
}
/** A Praise & Worship session 3 on air. */
function pwOnAir() {
  return run(
    idle(),
    { type: 'pw/load', sessionId: 3 },
    { type: 'projector/show', frame: SEGMENT_SLIDE, source: 'PW_SESSION' },
    { type: 'pw/cursor', segmentKey: 'seg-1', slide: 1, now: 1000 },
  );
}

// ---- The header ----

test('the Go Live header renders PRAISE & WORSHIP, HOLY MASS and PLANNER, with Prepare gone', () => {
  const src = read('src/golive/GoLiveConsole.tsx');
  const nav = src.slice(src.indexOf('<nav aria-label={t(\'consoleViews\')}'), src.indexOf('</nav>'));
  const labels = [...nav.matchAll(/aria-hidden \/> \{t\('(tab[A-Za-z]+)'\)\}/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['tabPw', 'tabMass', 'tabPlanner'], 'three tabs, in this order');
  assert.equal(goLiveT('en', 'tabPw'), 'Praise & Worship');
  assert.equal(goLiveT('en', 'tabMass'), 'Holy Mass');
  assert.equal(goLiveT('en', 'tabPlanner'), 'Planner');
  // The pill shows labels in capitals through its uppercase class, the same for all three tabs.
  assert.match(src, /const TAB = \(on: boolean\) =>\n\s+`[^`]*uppercase/);
  assert.match(nav, /<CalendarDays size=\{15\} aria-hidden \/> \{t\('tabPlanner'\)\}/, 'a calendar icon at the other tabs\' size');
  assert.match(nav, /className=\{TAB\(false\)\}/, 'the same tab styling, so the pill keeps its footprint');
  assert.doesNotMatch(src, /prepare|Prepare|ListChecks|GoLiveHub/, 'no trace of the old Prepare tab');
  assert.match(src, /type Tab = 'pw' \| 'mass';/);
});

test('the Prepare hub is gone: its files and strings are removed, and nothing still imports them', () => {
  for (const gone of ['src/golive/GoLiveHub.tsx', 'src/golive/MassPlanHub.tsx', 'src/golive/GoLiveAction.tsx', 'shared/golive.js']) {
    assert.equal(exists(gone), false, `${gone} is removed`);
  }
  const i18n = read('shared/golive-i18n.js');
  for (const key of ['tabPrepare', 'savedHeading', 'readyHeading', 'emptyDate']) assert.doesNotMatch(i18n, new RegExp(`^\\s+${key}: `, 'm'), key);
  const ui = read('src/state/ui.ts');
  assert.doesNotMatch(ui, /pendingMassPlanId|goLiveDate/, 'the hub-only state is gone');
  assert.match(ui, /plannerRequest: PlannerTarget \| null;/);
});

test('the Planner tab and its tooltips are in English, Tagalog and Cebuano', () => {
  const text = read('shared/golive-i18n.js');
  for (const key of ['tabPlanner', 'plannerTipMass', 'plannerTipPw']) {
    assert.equal([...text.matchAll(new RegExp(`^\\s+${key}: `, 'gm'))].length, GOLIVE_LANGS.length, `${key} once per language`);
    for (const lang of GOLIVE_LANGS) assert.ok(goLiveT(lang, key).trim() && goLiveT(lang, key) !== key, `${lang}.${key}`);
  }
  assert.equal(goLiveT('en', 'plannerTipMass'), 'Open Holy Mass Planner');
  assert.equal(goLiveT('en', 'plannerTipPw'), 'Open Praise & Worship Planner');
});

// ---- Where the Planner tab goes ----

test('Praise & Worship on air: the Planner tab opens the Praise & Worship Planner on the live session and its date', () => {
  const target = resolveMatchingPlannerTarget(pwOnAir(), { tab: 'mass', pickedPw: 4, pickedMass: 8, ...lists });
  assert.deepEqual(target, { kind: 'pw', id: 3, date: '2026-11-21' }, 'the run on air wins over the active tab and the picks');
  assert.equal(plannerTabTipKey(target), 'plannerTipPw');
  assert.equal(goLiveT('en', plannerTabTipKey(target)), 'Open Praise & Worship Planner');
});

test('Holy Mass on air: the Planner tab opens the Holy Mass Planner on the loaded plan and its date', () => {
  const target = resolveMatchingPlannerTarget(massOnAir(), { tab: 'pw', pickedPw: 4, pickedMass: 8, ...lists });
  assert.deepEqual(target, { kind: 'mass', id: 7, date: '2026-11-22' });
  assert.equal(goLiveT('en', plannerTabTipKey(target)), 'Open Holy Mass Planner');
});

test('nothing on air: the active Go Live tab decides, on the plan or session picked there', () => {
  assert.deepEqual(resolveMatchingPlannerTarget(idle(), { tab: 'pw', pickedPw: 4, pickedMass: 8, ...lists }), { kind: 'pw', id: 4, date: '2026-12-05' });
  assert.deepEqual(resolveMatchingPlannerTarget(idle(), { tab: 'mass', pickedPw: 4, pickedMass: 8, ...lists }), { kind: 'mass', id: 8, date: '2026-11-29' });
  // Nothing picked yet: that kind's calendar opens.
  assert.deepEqual(resolveMatchingPlannerTarget(idle(), { tab: 'mass' }), { kind: 'mass', id: null, date: null });
  // A plan the lists have not read yet still opens; the calendar keeps its month.
  assert.deepEqual(resolveMatchingPlannerTarget(idle(), { tab: 'pw', pickedPw: 99, ...lists }), { kind: 'pw', id: 99, date: null });
});

test('a parked run behind an ad-hoc item is not on air: the active tab decides', () => {
  const parked = run(massOnAir(), { type: 'projector/show', frame: { kind: 'text', key: 'sample-adhoc', text: 'Sample Prayer' }, source: 'DIRECT_DECK' });
  assert.deepEqual(resolveMatchingPlannerTarget(parked, { tab: 'pw', pickedPw: 3, ...lists }), { kind: 'pw', id: 3, date: '2026-11-21' });
});

// ---- The projector is never touched ----

test('resolving the target leaves the live state exactly as it was', () => {
  for (const state of [pwOnAir(), massOnAir(), idle()]) {
    const before = structuredClone(state);
    resolveMatchingPlannerTarget(state, { tab: 'mass', pickedMass: 7, ...lists });
    assert.deepEqual(state, before);
  }
});

test('the Planner tab only changes the operator view: no dispatch, no end, no blackout, and the Planner opens the requested plan', () => {
  const src = read('src/golive/GoLiveConsole.tsx');
  const button = src.slice(src.indexOf('data-testid="golive-planner-tab"'), src.indexOf('<CalendarDays'));
  assert.match(button, /onClick=\{\(\) => openMatchingPlanner\(plannerTarget\)\}/);
  assert.match(button, /title=\{plannerTip\}/, 'the dynamic tooltip names the destination');
  assert.match(src, /const plannerTarget = resolveMatchingPlannerTarget\(live, \{ tab, pickedPw, pickedMass, sessions, plans \}\);/);
  assert.match(src, /const plannerTip = t\(plannerTabTipKey\(plannerTarget\)\);/);

  // The code only, without its comments.
  const open = read('src/golive/openPlanner.ts').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.match(open, /setUi\(\{ plannerRequest: target, view: 'planner' \}\);/);
  assert.doesNotMatch(open, /dispatch|endSession|endMassSession|blackout|stop|bridge\./i);

  // The Planner takes the request once: the plan's calendar and month, then the plan in the editor (a session opens under its own view).
  const planner = read('src/planner/PlannerView.tsx');
  assert.match(planner, /if \(plannerRequest == null\) return;\n\s+setUi\(\{ plannerRequest: null \}\);/);
  assert.match(planner, /setNav\(\{ calendar: kind, \.\.\.\(date \? \{ month: monthOfIso\(date\) \} : \{\}\) \}\);\n\s+if \(id != null\) void openPlan\(\{ kind, id \}\);/);
  assert.doesNotMatch(planner, /dispatch\(|endSession|endMassSession/, 'the Planner never ends or changes what is on air');
});

test('the top bar Go Live shortcut stays in the bar on every view, so one click returns to the live console', () => {
  const top = read('src/operator/TopBar.tsx');
  assert.match(top, /<GoLiveShortcut \/>/);
  assert.match(read('src/golive/mainLive.ts'), /setUi\(\{ view: 'goLive', \.\.\.\(tab \? \{ goLiveTabRequest: tab \} : \{\}\) \}\);/);
});

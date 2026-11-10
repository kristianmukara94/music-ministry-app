// The unified Planner: one sidebar entry for the Holy Mass and Praise & Worship plans, a calendar that shows both, and a Plan Editor tab
// that stays locked until a plan is picked or created. Run with: node --test shared/planner-unified.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { plannerT } from './planner-i18n.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

test('the sidebar has one Planner, with the calendar icon, and no Praise & Worship entry', () => {
  const sidebar = read('src/operator/Sidebar.tsx');
  assert.match(sidebar, /\{ key: 'planner', icon: CalendarDays, label: 'nav\.planner' \}/);
  assert.doesNotMatch(sidebar, /key: 'praiseWorship'/, 'no Praise & Worship module entry');
  assert.match(sidebar, /items: \['goLive', 'lyrics', 'media', 'announcements'\]/);
  // A Praise & Worship plan opens under the 'praiseWorship' view, inside the Planner, which stays marked.
  assert.match(sidebar, /\(key === 'planner' && view === 'praiseWorship'\)/);
  assert.match(read('src/i18n/strings.ts'), /'nav\.planner': 'Planner',/);
});

test('both views render the one Planner, so the Go Live hub still reaches a Praise & Worship plan', () => {
  const app = read('src/operator/OperatorApp.tsx');
  assert.match(app, /\{\(view === 'planner' \|\| view === 'praiseWorship'\) && <PlannerView \/>\}/);
  assert.doesNotMatch(app, /<MassPlanner \/>|<PraiseWorship \/>/);
});

test('the Planner opens on the calendar and the Plan Editor is locked, with its tooltip, until a plan is active', () => {
  const view = read('src/planner/PlannerView.tsx');
  assert.match(view, /mode: 'calendar',\n  active: null,/, 'starts on the calendar with no plan');
  assert.match(view, /disabled=\{!active\}/);
  assert.match(view, /aria-describedby=\{active \? undefined : 'plan-editor-locked'\}/);
  assert.match(view, /role="tooltip"[\s\S]*?\{t\('editorLocked'\)\}/);
  // Opening or creating a plan sets it active and moves to the editor.
  assert.match(view, /setNav\(\{ mode: 'editor', active: plan \}\);/);
  assert.match(view, /setNav\(\{ mode: 'editor', active: \{ kind: 'pw', id: session\.id \} \}\);/);
  assert.match(view, /await openPlan\(\{ kind: 'mass', id: created\.id \}\);/);
});

test('a day cell shows a badge for each kind of plan, asks which when it has several, and offers both plans when it has none', () => {
  const cal = read('src/planner/PlannerCalendarView.tsx');
  assert.match(cal, /const badges = \[\.\.\.massOnDay\.map\(\(p\) => massBadge\(iso, p\)\), \.\.\.pwOnDay\.map\(pwBadge\)\];/);
  assert.match(cal, /if \(onDay\.length === 0\) \{\s+setCreateFor\(iso\);/);
  assert.match(cal, /if \(onDay\.length === 1\) \{\s+onOpen\(onDay\[0\]\);/);
  assert.match(cal, /<DayPlansPopover/);
  assert.match(cal, /\{busy === 'mass' \? t\('createBusy'\) : t\('calCreate'\)\}/);
  assert.match(cal, /\{busy === 'pw' \? t\('createBusy'\) : t\('createPw'\)\}/);
  // The liturgical colour is a 4px ribbon on the cell's left edge.
  assert.match(cal, /absolute inset-y-0 left-0 w-1 \$\{COLOR_SWATCH\[day\.color\]\}/);
  assert.match(read('src/styles.css'), /\.planner-cal \{\n  --cal-surface: #121212;[\s\S]*?--cal-border: #1e1e1e;[\s\S]*?--cal-date: #ffffff;\n  --cal-gold: #e5a93c;/);
});

test('the new Planner words exist in English, Tagalog and Cebuano', () => {
  const keys = ['plannerEyebrow', 'plannerTitle', 'plannerSubtitle', 'pwPlanTitle', 'editorLocked', 'calBadgeMass', 'calBadgePw', 'calMassReady', 'calPwReady',
    'calCreatePlan', 'calPickTitle', 'calOpenMass', 'calOpenPw', 'calAddPlan', 'createTitle', 'createName', 'createMassSub', 'createPw', 'createPwSub', 'createBusy'];
  for (const key of keys) for (const lang of ['en', 'tl', 'ceb']) assert.notEqual(plannerT(lang, key), key, `${key} in ${lang}`);
  assert.equal(plannerT('en', 'editorLocked'), 'Select a date on the calendar or create a plan first to open the editor.');
  assert.equal(plannerT('en', 'createPwSub', { n: 12 }), 'The 12-slot Praise & Worship lineup.');
});

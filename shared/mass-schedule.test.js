// Holy Mass schedules: reading typed times, ordering a day's Holy Masses, their labels, what a click on a calendar day does, and the wiring of
// the Available Holy Mass Schedules picker, the editor's schedule pills, Go Live and Print Lineup. Synthetic names only.
// Run with: node --test shared/mass-schedule.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SCHEDULE_LANGUAGES,
  TIME_PRESETS,
  cellScheduleBadges,
  compareMassSchedules,
  hasSchedule,
  massDayAction,
  normalizeMassLanguage,
  parseMassTime,
  planLanguageForSchedule,
  sameSchedule,
  scheduleLabel,
  scheduleLanguageCode,
  scheduleLanguageForPlan,
  schedulesOn,
  sortMassSchedules,
} from './mass-schedule.js';
import { PLANNER_LANGS, plannerT } from './planner-i18n.js';
import { initialLiveState, liveReducer } from './live.js';
import { resolveMatchingPlannerTarget } from './planner-target.js';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const DAY = '2026-12-06';
const plan = (id, massTime, massLanguage, liturgicalDate = DAY) => ({ id, name: 'Sample Mass Item', liturgicalDate, massTime, massLanguage });

test('typed times are read as minutes after midnight, in 12-hour and 24-hour forms', () => {
  const cases = {
    '6:00 AM': 360, '8:00 AM': 480, '9:30 AM': 570, '5:00 PM': 1020, '06:00': 360, '17:30': 1050, '1730': 1050, '6 am': 360, '6:00a.m.': 360,
    '5:00 p.m.': 1020, '9.30 PM': 1290, '12:00 AM': 0, '12:15 PM': 735, noon: 720, midnight: 0, '  7:15   pm ': 1155,
  };
  for (const [text, minutes] of Object.entries(cases)) assert.equal(parseMassTime(text), minutes, text);
  for (const text of ['', '6', '25:00', '13:00 PM', '6:75 AM', 'Sample time', null, undefined]) assert.equal(parseMassTime(text), null, String(text));
});

test("a day's Holy Masses sort chronologically, with unread times next and blank times last, ties by when they were made", () => {
  const list = [plan(1, '', ''), plan(2, '17:30', 'English'), plan(3, 'after the procession', 'Tagalog'), plan(4, '6:00 AM', 'English'), plan(5, '08:00', 'Cebuano'), plan(6, '', 'Tagalog'), plan(7, '9:30 AM', 'Tagalog')];
  assert.deepEqual([...list].sort(compareMassSchedules).map((p) => p.id), [4, 5, 7, 2, 3, 1, 6]);
  // Across days: newest day first by default (the plan list), oldest first when asked.
  const days = [plan(1, '9:30 AM', 'Tagalog'), plan(2, '6:00 AM', 'English', '2026-12-13'), plan(3, '6:00 AM', 'English')];
  assert.deepEqual(sortMassSchedules(days).map((p) => p.id), [2, 3, 1]);
  assert.deepEqual(sortMassSchedules(days, 'asc').map((p) => p.id), [3, 1, 2]);
  assert.deepEqual(schedulesOn(days, DAY).map((p) => p.id), [3, 1]);
});

test('schedule languages: the three pills, their codes and plan languages, and the operator\'s own', () => {
  assert.deepEqual(SCHEDULE_LANGUAGES, ['English', 'Cebuano', 'Tagalog']);
  assert.deepEqual(TIME_PRESETS, ['6:00 AM', '8:00 AM', '9:30 AM', '5:00 PM']);
  assert.equal(normalizeMassLanguage('  cebuano '), 'Cebuano');
  assert.equal(normalizeMassLanguage('TL'), 'Tagalog');
  assert.equal(normalizeMassLanguage('Sample Language'), 'Sample Language');
  assert.deepEqual(['English', 'Cebuano', 'Tagalog', 'Sample Language', ''].map(scheduleLanguageCode), ['EN', 'CEB', 'TL', 'SAM', '']);
  assert.deepEqual(['English', 'Cebuano', 'Tagalog', 'Sample Language'].map(planLanguageForSchedule), ['EN', 'CEB', 'TL', null]);
  assert.deepEqual(['EN', 'TL', 'CEB', 'XX'].map(scheduleLanguageForPlan), ['English', 'Tagalog', 'Cebuano', '']);
});

test('labels: "6:00 AM · English" in full, "6:00 AM · EN" on a calendar badge, and nothing for a plan without a schedule', () => {
  assert.equal(scheduleLabel(plan(1, '6:00 AM', 'English')), '6:00 AM · English');
  assert.equal(scheduleLabel(plan(1, '8:00 AM', 'Cebuano'), { short: true }), '8:00 AM · CEB');
  assert.equal(scheduleLabel(plan(1, '9:30 AM', 'Tagalog'), { languageLabel: (name) => plannerT('ceb', `lang_${name}`) }), '9:30 AM · Tagalog');
  assert.equal(scheduleLabel(plan(1, '6:00 AM', 'English'), { languageLabel: (name) => plannerT('tl', `lang_${name}`) }), '6:00 AM · Ingles');
  assert.equal(scheduleLabel(plan(1, '', 'Sample Language')), 'Sample Language');
  assert.equal(scheduleLabel(plan(1, '', '')), '');
  assert.equal(hasSchedule(plan(1, '', '')), false);
  assert.equal(hasSchedule(plan(1, '6:00 AM', '')), true);
});

test('the same schedule is the same time as read and the same language; blank parts never clash', () => {
  assert.equal(sameSchedule(plan(1, '6:00 AM', 'English'), plan(2, '06:00', 'english')), true);
  assert.equal(sameSchedule(plan(1, '6:00 AM', 'English'), plan(2, '6:00 AM', 'Cebuano')), false);
  assert.equal(sameSchedule(plan(1, 'after the procession', 'English'), plan(2, 'After the procession', 'English')), true);
  assert.equal(sameSchedule(plan(1, '', 'English'), plan(2, '', 'English')), false);
  assert.equal(sameSchedule(plan(1, '6:00 AM', ''), plan(2, '6:00 AM', '')), false);
});

test('a calendar day with no Holy Mass opens the new form; a day with one or more lists its schedules; a cell shows two badges then "+N more"', () => {
  assert.equal(massDayAction([]), 'create');
  assert.equal(massDayAction(undefined), 'create');
  assert.equal(massDayAction([plan(1, '6:00 AM', 'English')]), 'pick');
  assert.equal(massDayAction([plan(1, '6:00 AM', 'English'), plan(2, '8:00 AM', 'Cebuano')]), 'pick');
  const three = [plan(1, '6:00 AM', 'English'), plan(2, '8:00 AM', 'Cebuano'), plan(3, '9:30 AM', 'Tagalog')];
  assert.deepEqual(cellScheduleBadges(three.slice(0, 2)), { shown: three.slice(0, 2), more: 0 });
  assert.deepEqual(cellScheduleBadges(three), { shown: three.slice(0, 2), more: 1 });
});

test('the Go Live Planner tab opens the exact plan on air, not the day\'s schedule picker, when two Holy Masses share a date', () => {
  const plans = [plan(11, '6:00 AM', 'English'), plan(12, '8:00 AM', 'Cebuano')];
  const row = (label) => ({ module: 'custom', sourceId: label, label, stale: false });
  const idle = { ...initialLiveState(), outputs: { projector: true, lowerThird: false, preview: false } };
  const onAir = [
    { type: 'queue/set', items: [row('Sample Mass Item'), row('Sample Liturgical Title')], planId: 12 },
    { type: 'queue/cursor', index: 1 },
    { type: 'projector/stage', frame: { kind: 'text', key: 'sample', text: 'Sample Mass Item' } },
    { type: 'projector/take', source: 'MASS_QUEUE' },
  ].reduce(liveReducer, idle);
  assert.deepEqual(resolveMatchingPlannerTarget(onAir, { tab: 'mass', pickedMass: 11, plans }), { kind: 'mass', id: 12, date: DAY });
  assert.deepEqual(resolveMatchingPlannerTarget(idle, { tab: 'mass', pickedMass: 11, plans }), { kind: 'mass', id: 11, date: DAY });

  // The Planner takes the request straight to openPlan with that id: the calendar's day picker is never in the way.
  const view = read('src/planner/PlannerView.tsx');
  const request = view.slice(view.indexOf('if (plannerRequest == null) return;'), view.indexOf('}, [plannerRequest]);'));
  assert.match(request, /if \(id != null\) void openPlan\(\{ kind, id \}\);/);
  assert.doesNotMatch(request, /pickDay|setSchedulesFor|DaySchedulesDialog/);
});

test('the Liturgical Calendar lists a day\'s Available Holy Mass Schedules with Add Another, and Praise & Worship days work as before', () => {
  const cal = read('src/planner/PlannerCalendarView.tsx');
  const pick = cal.slice(cal.indexOf('const pickDay = '), cal.indexOf('const massBadge = '));
  assert.match(pick, /if \(kind === 'mass'\) \{\s*if \(massDayAction\(massByDate\.get\(iso\)\) === 'create'\) setCreateFor\(iso\);\s*else setSchedulesFor\(iso\);\s*return;\s*\}/);
  // Praise & Worship: one session opens, several ask in the popover, none offers Create.
  assert.match(pick, /if \(onDay\.length === 1\) \{\s*onOpen\(onDay\[0\]\);/);
  // The picker opens a schedule's own plan, and Add Another opens the create form for the same day.
  assert.match(cal, /<DaySchedulesDialog[\s\S]*?onOpen=\{\(id\) => \{\s*setSchedulesFor\(null\);\s*onOpen\(\{ kind: 'mass', id \}\);[\s\S]*?onAdd=\{\(\) => \{\s*setCreateFor\(schedulesFor\);/);
  // The create form asks for the time and language for a Holy Mass only, and passes them on.
  assert.match(cal, /\{kinds\.includes\('mass'\) && <ScheduleFields t=\{t\} value=\{schedule\} onChange=\{setSchedule\} \/>\}/);
  assert.match(cal, /await onCreate\(kind, name\.trim\(\), kind === 'mass' \? schedule : undefined\);/);

  const ui = read('src/planner/MassSchedule.tsx');
  // The picker and the form are modal and never a window drag region.
  for (const name of ['DaySchedulesDialog', 'ScheduleFormDialog']) {
    const body = ui.slice(ui.indexOf(`export function ${name}`));
    assert.match(body.slice(0, body.indexOf('\n}\n')), /aria-modal="true"[\s\S]*?style=\{NO_DRAG\}/, name);
  }
  assert.match(ui, /placeholder=\{t\('massTimePlaceholder'\)\}/);
  assert.equal(plannerT('en', 'massTimePlaceholder'), 'e.g. 6:00 AM, 8:00 AM, 9:30 AM');
});

test('the editor switches between the day\'s Holy Masses, and Go Live and Print Lineup carry the time and language', () => {
  const editor = read('src/planner/MassPlanner.tsx');
  assert.match(editor, /<ScheduleSwitcher[\s\S]*?plans=\{dayPlans\}[\s\S]*?onPick=\{\(id\) => onPlanChange\(id\)\}/);
  assert.match(editor, /schedulesOn\(plans, currentPlan\.liturgicalDate\)/);
  assert.match(editor, /subtitle: \[formatIsoDay\(currentPlan\.liturgicalDate, region\), scheduleText\(t, currentPlan\)\]\.filter\(Boolean\)\.join\(' · '\)/);
  const goLive = read('src/golive/GoLiveConsole.tsx');
  assert.match(goLive, /\[dateOf\(p\.liturgicalDate\), scheduleLabel\(p, \{ languageLabel: \(name\) => plannerT\(lang, `lang_\$\{name\}`\) \}\), p\.name\]\.filter\(Boolean\)\.join\(' · '\)/);
  // Praise & Worship's selector is unchanged.
  assert.match(goLive, /\{dateOf\(s\.liturgicalDate\)\} · \{s\.name\}/);
});

test('every schedule string is in English, Tagalog and Cebuano, and English says Holy Mass', () => {
  const keys = ['massTime', 'massTimePlaceholder', 'massTimeHint', 'scheduleLanguage', 'lang_English', 'lang_Cebuano', 'lang_Tagalog', 'lang_Other', 'langCustomPlaceholder',
    'scheduleTextsHint', 'schedulesTitle', 'schedulesHint', 'addSchedule', 'addTime', 'scheduleNoTime', 'scheduleItems', 'scheduleEdit', 'scheduleEditTitle',
    'scheduleAddTitle', 'scheduleSave', 'scheduleSaving', 'scheduleSaved', 'scheduleCleared', 'scheduleSwitch', 'calOpenSchedule'];
  const source = read('shared/planner-i18n.js');
  for (const key of keys) {
    // Defined once in each of the three language blocks.
    assert.equal(source.match(new RegExp(`^    ${key}: `, 'gm'))?.length, PLANNER_LANGS.length, key);
    for (const lang of PLANNER_LANGS) assert.notEqual(plannerT(lang, key), key, `${lang}.${key}`);
  }
  assert.equal(plannerT('en', 'massTime'), 'Holy Mass time');
  assert.equal(plannerT('en', 'schedulesTitle'), 'Available Holy Mass Schedules');
  assert.equal(plannerT('en', 'addSchedule'), 'Add Another Holy Mass Schedule');
  assert.equal(plannerT('tl', 'massTime'), 'Oras ng Misa');
  assert.equal(plannerT('ceb', 'massTime'), 'Oras sa Misa');
});

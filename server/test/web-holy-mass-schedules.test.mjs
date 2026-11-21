// The web planner's Holy Mass schedules, as the church laptop has them: the shared rules copied byte for byte, the create and save requests,
// the taken-time warning with Open Existing, the month calendar's badges and day picker, and the editor's switcher. Synthetic names only.
// Run with: node --test server/test/web-holy-mass-schedules.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const load = (...rel) => import(pathToFileURL(path.join(root, ...rel)).href);
const readWeb = (rel) => fs.readFileSync(path.join(root, 'web', rel), 'utf8');

const ui = await load('web', 'js', 'schedule-ui.js');
const calendar = await load('web', 'js', 'plan-calendar.js');
const model = await load('web', 'js', 'plan-model.js');

const DAY = '2026-12-06';
const SIX = '10000000-0000-4000-8000-000000000006';
const EIGHT = '10000000-0000-4000-8000-000000000008';
const listed = (id, massTime, massLanguage, over = {}) => ({ id, name: 'Sample Liturgical Title', liturgical_date: DAY, kind: 'mass', massTime, massLanguage, itemCount: 0, ...over });

test('the web uses the laptop\'s schedule rules: holy-mass-schedule.js is a byte-for-byte copy of shared/mass-schedule.js', () => {
  const shared = fs.readFileSync(path.join(root, 'shared', 'mass-schedule.js'));
  const copy = fs.readFileSync(path.join(root, 'web', 'js', 'holy-mass-schedule.js'));
  assert.ok(shared.equals(copy), 'copy shared/mass-schedule.js over web/js/holy-mass-schedule.js');
});

test('a new Holy Mass plan sends its time and schedule language; blanks and Praise & Worship send none', () => {
  const id = '10000000-0000-4000-8000-0000000000aa';
  const input = { name: ' Sample Mass Item ', date: DAY, language: 'CEB', massTime: ' 6:00  AM ', massLanguage: 'Cebuano' };
  assert.deepEqual(model.newPlanRequest({ ...input, kind: 'mass' }, id), {
    id, name: 'Sample Mass Item', date: DAY, kind: 'mass', items: [], language: 'CEB', massTime: '6:00 AM', massLanguage: 'Cebuano',
  });
  const blank = model.newPlanRequest({ ...input, kind: 'mass', massTime: '', massLanguage: '  ' }, id);
  assert.equal('massTime' in blank || 'massLanguage' in blank, false);
  assert.deepEqual(model.newPlanRequest({ ...input, kind: 'pw' }, id), { id, name: 'Sample Mass Item', date: DAY, kind: 'pw', items: [] });
  // English, Tagalog and Cebuano draft the readings in that language; the parish's own language drafts in English.
  assert.deepEqual(['English', 'Tagalog', 'Cebuano', 'Sample Language', ''].map((l) => ui.textsLanguageFor(l)), ['EN', 'TL', 'CEB', 'EN', 'EN']);
});

test('"06:00" on a date that already has a 6:00 AM Holy Mass is a conflict, with that plan\'s id, time, language and title', () => {
  const plans = [listed(SIX, '6:00 AM', 'English'), listed(EIGHT, '8:00 AM', 'Cebuano', { name: 'Sample Mass Item' })];
  assert.deepEqual(ui.conflictIn(plans, DAY, '06:00'), { id: SIX, name: 'Sample Liturgical Title', massTime: '6:00 AM', massLanguage: 'English', date: DAY });
  for (const typed of ['6 am', '6:00a.m.', '6:00 AM']) assert.equal(ui.conflictIn(plans, DAY, typed)?.id, SIX, typed);
  assert.equal(ui.conflictIn(plans, DAY, '06:00', SIX), null, 'a plan never clashes with itself');
  assert.equal(ui.conflictIn(plans, '2026-12-13', '06:00'), null, 'another day is free');
  assert.equal(ui.conflictIn(plans, DAY, '9:30 AM'), null, 'another time is free');
  assert.equal(ui.conflictIn(plans, DAY, ''), null, 'a blank time never clashes');
  assert.equal(ui.conflictIn([listed(SIX, '6:00 AM', '', { kind: 'pw' })], DAY, '06:00'), null, 'Praise & Worship has no schedule');
});

test('the warning says which Holy Mass is there and puts Open Existing beside it; typed names are escaped', () => {
  const html = ui.conflictBannerHtml({ id: SIX, name: 'Sample <Parish>', massTime: '6:00 AM', massLanguage: 'English', date: DAY });
  assert.match(html, /role="alert"/);
  assert.match(html, /A Holy Mass at 6:00 AM \(English\) already exists on this date\./);
  assert.match(html, new RegExp(`<button type="button" class="bc-btn-gold" data-open-existing="${SIX}">Open Existing`));
  assert.match(html, /Sample &lt;Parish&gt;/);
  assert.doesNotMatch(html, /<Parish>/);
  assert.match(ui.conflictBannerHtml({ id: SIX, name: '', massTime: '6:00 AM', massLanguage: '' }), /A Holy Mass at 6:00 AM already exists on this date\./);
  assert.equal(ui.conflictBannerHtml(null), '');
});

test('Open Existing opens that plan\'s Holy Mass editor', () => {
  // The binder both pages use: a press on the button inside the warning hands over the plan's id.
  let listener = null;
  const box = { addEventListener: (type, fn) => { if (type === 'click') listener = fn; } };
  const opened = [];
  ui.onOpenExisting(box, (id) => opened.push(ui.openExistingHref(id, '../')));
  listener({ target: { closest: (sel) => (sel === '[data-open-existing]' ? { dataset: { openExisting: SIX } } : null) } });
  listener({ target: { closest: () => null } });
  assert.deepEqual(opened, [`../plan/mass.html?id=${SIX}`], 'one press, one navigation; a press elsewhere does nothing');
  assert.equal(ui.openExistingHref(SIX), model.editorPathFor({ id: SIX, kind: 'mass' }), 'the same page the plan list opens');

  // The New Plan form (page and modal) and the editor wire it, and the editor asks before leaving unsaved changes.
  assert.match(readWeb('js/new-plan-form.js'), /onOpenExisting\(conflictBox, \(id\) => openExisting\?\.\(id\)\);/);
  assert.match(readWeb('js/new-plan.js'), /onOpenExisting: \(id\) => location\.assign\(openExistingHref\(id, root\)\)/);
  assert.match(readWeb('js/plans.js'), /onOpenExisting: \(id\) => location\.assign\(openExistingHref\(id\)\)/);
  assert.match(readWeb('js/mass.js'), /onOpenExisting\(document\.getElementById\('schedule-conflict'\), \(id\) => \{\s*if \(state\.dirty && !window\.confirm/);
  // A taken time disables the create and save buttons until it changes.
  assert.match(readWeb('js/new-plan-form.js'), /submit\.disabled = !card\.canCreate;/);
  assert.match(readWeb('js/mass.js'), /saveEl\.disabled = !plan \|\| !canEdit \|\| save\.disabled \|\| takenBy\(\) !== null;/);
});

test('a 409 from the server keeps the plan already there on the error, for Open Existing', async () => {
  const api = await load('web', 'js', 'plan-api.js');
  const realFetch = globalThis.fetch;
  const conflict = { id: SIX, name: 'Sample Liturgical Title', massTime: '6:00 AM', massLanguage: 'English', date: DAY };
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'A Holy Mass at 6:00 AM (English) already exists on this date.', conflict }), { status: 409 });
  try {
    await assert.rejects(api.createPlan({ id: EIGHT }), (err) => {
      assert.equal(err.status, 409);
      assert.deepEqual(err.conflict, conflict);
      return true;
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the schedule fields: the time box with its placeholder and presets, and English / Cebuano / Tagalog / Other', () => {
  const html = ui.scheduleFieldsHtml({ massTime: '8:00 AM', massLanguage: 'Cebuano', id: 't' });
  assert.match(html, /placeholder="e\.g\. 6:00 AM, 8:00 AM, 9:30 AM"/);
  for (const preset of ['6:00 AM', '8:00 AM', '9:30 AM', '5:00 PM']) assert.match(html, new RegExp(`data-time-preset="${preset}" aria-pressed="${preset === '8:00 AM'}"`));
  for (const name of ['English', 'Cebuano', 'Tagalog']) assert.match(html, new RegExp(`data-schedule-lang="${name}" aria-pressed="${name === 'Cebuano'}"`));
  assert.match(html, /data-schedule-lang="other" aria-pressed="false"/);
  const own = ui.scheduleFieldsHtml({ massLanguage: 'Sample "Language"', id: 't' });
  assert.match(own, /data-schedule-lang="other" aria-pressed="true"/);
  assert.match(own, /id="t-lang-other"[^>]*value="Sample &quot;Language&quot;"/);
  assert.match(ui.scheduleFieldsHtml({ disabled: true }), /data-role="mass-time"[^>]*disabled/);
});

test('the calendar: six weeks from Sunday, each day\'s Holy Masses as badges in the order they are celebrated, then +N more', () => {
  const grid = calendar.monthGrid('2026-12');
  assert.equal(grid.length, 42);
  assert.deepEqual(grid[0], { iso: '2026-11-29', day: 29, inMonth: false }, 'December 2026 starts on a Tuesday; the grid starts the Sunday before');
  assert.ok(grid.some((d) => d.iso === DAY && d.inMonth));
  assert.equal(calendar.shiftMonth('2026-12', 1), '2027-01');
  assert.equal(calendar.shiftMonth('2026-01', -1), '2025-12');
  assert.equal(calendar.monthTitle('2026-12'), 'December 2026');

  const plans = [
    listed('c', '5:00 PM', 'Tagalog'), listed('a', '06:00', 'English'), listed('b', '8:00 AM', 'Cebuano'), listed('d', '', ''),
    listed('p', '', '', { kind: 'pw', name: 'Sample Mass Item' }), listed('x', '6:00 AM', 'English', { liturgical_date: '2026-12-13' }),
  ];
  const day = calendar.plansOnDay(plans, DAY);
  assert.deepEqual(day.mass.map((p) => p.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(day.pw.map((p) => p.id), ['p']);
  const { shown, more } = calendar.dayBadges(day.mass);
  assert.deepEqual(shown.map(ui.badgeText), ['06:00 · EN', '8:00 AM · CEB']);
  assert.equal(more, 2);
  assert.equal(ui.badgeText(listed('z', '', '')), 'Holy Mass');
});

test('a click on a day: a day with a Holy Mass lists its schedules; an empty day goes to New plan with that date', () => {
  const plans = [listed(SIX, '6:00 AM', 'English')];
  assert.equal(calendar.dayAction(calendar.plansOnDay(plans, DAY), true), 'pick');
  assert.equal(calendar.dayAction(calendar.plansOnDay(plans, DAY), false), 'pick', 'a viewer can still see the day\'s Holy Masses');
  assert.equal(calendar.dayAction(calendar.plansOnDay(plans, '2026-12-07'), true), 'create');
  assert.equal(calendar.dayAction(calendar.plansOnDay(plans, '2026-12-07'), false), 'none');
  assert.equal(calendar.newPlanHref(DAY), `plan/new.html?date=${DAY}&kind=mass`);
  assert.equal(calendar.newPlanHref(DAY, 'pw'), `plan/new.html?date=${DAY}&kind=pw`);

  const page = readWeb('index.html');
  assert.match(page, /<button type="button" data-view="calendar"/);
  assert.match(page, /<dialog id="day-dialog" class="bc-dialog"[\s\S]*?Available Holy Mass Schedules/);
  const js = readWeb('js/plans.js');
  assert.match(js, /Add Another Holy Mass Schedule/);
  assert.equal(model.viewModeOf('calendar'), 'calendar');
  // The New plan form takes the date and the type from the address.
  assert.match(readWeb('js/new-plan.js'), /const date = params\.get\('date'\);/);
});

test('the editor\'s switcher: a pill per Holy Mass on the day, the open one marked, then + Add Time', () => {
  const day = [ui.asSchedulePlan(listed(SIX, '6:00 AM', 'English')), ui.asSchedulePlan(listed(EIGHT, '8:00 AM', 'Cebuano'))];
  const html = ui.switcherHtml(day, SIX, { pathOf: (p) => `mass.html?id=${p.id}`, addHref: `new.html?date=${DAY}&kind=mass` });
  assert.match(html, /<span class="bc-switch is-on" aria-current="page"[^>]*>6:00 AM · English<\/span>/);
  assert.match(html, new RegExp(`<a class="bc-switch" href="mass.html\\?id=${EIGHT}"[^>]*>8:00 AM · Cebuano</a>`));
  assert.match(html, /<a class="bc-switch is-add" href="new\.html\?date=2026-12-06&amp;kind=mass"><span aria-hidden="true">\+<\/span> Add Time<\/a>/);
  assert.doesNotMatch(ui.switcherHtml(day, SIX, { pathOf: () => '' }), /Add Time/, 'a viewer gets no + Add Time');
});

test('the broadcast colours follow the laptop theme tokens, and every label says Holy Mass', () => {
  const css = readWeb('css/planner.css');
  // One value each, taken from the theme, so the calendar matches whichever theme the laptop is in, light or dark.
  const declared = [...css.matchAll(/^\s*(--bc-[a-z-]+):\s*([^;]+);/gm)];
  assert.ok(declared.length >= 12);
  for (const [, name, value] of declared) assert.match(value, /var\(--color-[\w-]+\)/, `${name} comes from a theme token`);
  assert.equal(new Set(declared.map((m) => m[1])).size, declared.length);
  // The labels this adds say "Holy Mass", never "Mass" alone.
  assert.match(ui.scheduleFieldsHtml(), /<label class="bc-label" for="schedule-time"><svg class="bc-label-icon"[^>]*>[\s\S]*?<\/svg>Holy Mass time<\/label>/);
  assert.match(ui.switcherHtml([ui.asSchedulePlan(listed(SIX, '', ''))], SIX, { pathOf: () => '' }), /Holy Masses on this day/);
  assert.match(readWeb('js/new-plan-form.js'), /title: 'Create Holy Mass Plan'/);
  assert.match(readWeb('plan/mass.html'), /aria-label="Holy Mass time and language"/);
});

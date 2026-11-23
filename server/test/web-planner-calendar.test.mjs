// The web Planner, as the church laptop's SERVICE PLANNING → Planner: the shared liturgical rules (byte-for-byte copies), the Liturgical and
// Praise & Worship calendars' months, Holy Mass schedules grouped on a day, what a click on a day does, the header's three tabs, the New Plan
// form, and the Plan Editor's slot helpers. Synthetic names only.
// Run with: node --test server/test/web-planner-calendar.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const load = (...rel) => import(pathToFileURL(path.join(root, ...rel)).href);
const readWeb = (rel) => fs.readFileSync(path.join(root, 'web', rel), 'utf8');

const cal = await load('web', 'js', 'planner-calendar.js');
const header = await load('web', 'js', 'planner-header.js');
const model = await load('web', 'js', 'plan-model.js');
const form = await load('web', 'js', 'new-plan-form.js');
const schedule = await load('web', 'js', 'schedule-ui.js');
const webSlots = await load('web', 'js', 'mass-slots.js');
const workspace = await load('web', 'js', 'mass-workspace.js');
const webCalendar = await load('web', 'js', 'liturgical-calendar.js');
const laptopCalendar = await load('shared', 'liturgical-calendar.js');
const laptopSlots = await load('shared', 'mass-slots.js');
const { ORDO_NAMES } = await load('web', 'js', 'ordo-names.js');

const SUNDAY = '2026-11-08';
const SOLEMNITY = '2026-11-01';
const WEEKDAY = '2026-11-10';
const ids = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mass = (n, date, over = {}) => ({ id: ids(n), name: 'Sample Plan Title', liturgical_date: date, kind: 'mass', massTime: '', massLanguage: '', filledSlots: [], itemCount: 0, ...over });
const pw = (n, date, over = {}) => ({ id: ids(n), name: 'Sample Praise Night', liturgical_date: date, kind: 'pw', itemCount: 0, ...over });
const cellOf = (model, iso) => model.weeks.flat().find((c) => c.iso === iso);

// ---- The laptop's own rules ----

test('the web runs the laptop\'s liturgical rules: three byte-for-byte copies of shared/', () => {
  for (const file of ['liturgical-day.js', 'liturgical-season.js', 'liturgical-calendar.js']) {
    const shared = fs.readFileSync(path.join(root, 'shared', file));
    const copy = fs.readFileSync(path.join(root, 'web', 'js', file));
    assert.ok(shared.equals(copy), `copy shared/${file} over web/js/${file}`);
  }
});

test('ordo-names.js holds every day name the laptop\'s Ordo has, and nothing else from it', () => {
  const ordo = JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'lectionary_ordo.json'), 'utf8'));
  const names = Object.fromEntries(Object.entries(ordo.days).filter(([, d]) => typeof d.name === 'string').map(([code, d]) => [code, d.name]));
  assert.deepEqual(ORDO_NAMES, names);
  // Only names: no citations reach the website.
  assert.doesNotMatch(readWeb('js/ordo-names.js'), /"(r1|r2|ps|gos|acc)"\s*:/);
});

test('the web slots carry the laptop\'s ids and flags, so a day needs the same slots on both', () => {
  assert.deepEqual(
    webSlots.MASS_SLOTS.map((s) => [s.number, s.id, Boolean(s.optional), Boolean(s.sundayOnly)]),
    laptopSlots.MASS_SLOTS.map((s) => [s.number, s.id, Boolean(s.optional), Boolean(s.sundayOnly)]),
  );
  for (const iso of [SUNDAY, SOLEMNITY, WEEKDAY, '2026-12-25', '2027-03-28', '2027-04-01']) {
    assert.deepEqual(webCalendar.requiredSlotsFor(iso), laptopCalendar.requiredSlotsFor(iso), iso);
  }
  // A Sunday also needs the parts marked sundayOnly (the Gloria and the Second Reading); a plain weekday does not.
  assert.equal(webCalendar.requiredSlotsFor(WEEKDAY).length + webSlots.MASS_SLOTS.filter((s) => s.sundayOnly).length, webCalendar.requiredSlotsFor(SUNDAY).length);
});

test('a day is named, ranked and coloured as the laptop names it', () => {
  const sunday = cal.liturgicalDay(SUNDAY);
  assert.equal(sunday.name, '32nd Sunday in Ordinary Time');
  assert.equal(sunday.color, 'green');
  assert.equal(sunday.rank, 'sunday');
  const allSaints = cal.liturgicalDay(SOLEMNITY);
  assert.equal(allSaints.rank, 'solemnity');
  assert.equal(allSaints.name, ORDO_NAMES['11-01']);
  // A weekday's cell drops the weekday its column already names.
  const weekday = cal.liturgicalDay(WEEKDAY);
  assert.equal(weekday.name, 'Tuesday of the 32nd Week in Ordinary Time');
  assert.equal(weekday.title, '32nd Week in Ordinary Time');
  assert.equal(cal.longDate(SUNDAY), 'Sunday, 8 November 2026');
});

// ---- The Liturgical Calendar ----

test('the Liturgical Calendar: the banner, the weeks Sunday to Saturday, ranks, memos and Holy Mass pills with their progress', () => {
  const required = webCalendar.requiredSlotsFor(SUNDAY).length;
  const plans = [
    mass(1, SUNDAY, { massTime: '9:30 AM', massLanguage: 'English', filledSlots: [1, 3, 4, 99] }),
    pw(2, SUNDAY, { itemCount: 7 }),
    { ...mass(3, WEEKDAY), kind: null },
  ];
  const month = cal.calendarMonth({ kind: 'mass', month: '2026-11', plans, notes: { [SUNDAY]: '  Sample Slot Note  ' }, today: '2026-11-22' });
  assert.equal(month.monthName, 'November');
  assert.equal(month.year, 2026);
  assert.equal(month.dedication, 'Month of the Holy Souls in Purgatory');
  assert.deepEqual(month.seasons.map((s) => [s.label, s.color]), [['Ordinary Time', 'green'], ['Advent', 'violet']]);
  assert.deepEqual(month.weekdays, ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']);
  assert.ok(month.weeks.every((w) => w.length === 7));
  assert.equal(month.weeks[0][0].iso, SOLEMNITY, 'November 2026 starts on a Sunday');
  assert.equal(month.isTodayMonth, true);
  assert.equal(cellOf(month, '2026-11-22').isToday, true);
  assert.equal(cellOf(month, SOLEMNITY).rankLabel, 'Solemnity');

  const sunday = cellOf(month, SUNDAY);
  assert.equal(sunday.memo, 'Sample Slot Note');
  assert.equal(sunday.title, '32nd Sunday in Ordinary Time');
  // The Praise & Worship plan is not on this calendar; slot 99 is not a slot.
  assert.equal(sunday.count, 1);
  assert.deepEqual(sunday.badges.map((b) => [b.label, b.count, b.ready]), [['9:30 AM · EN', `3/${required}`, false]]);
  // A plan with no type is a Holy Mass plan, shown without a time as Holy Mass.
  assert.deepEqual(cellOf(month, WEEKDAY).badges.map((b) => b.label), ['Holy Mass']);
});

test('a Holy Mass with every slot its day needs is ready', () => {
  const all = webSlots.MASS_SLOTS.filter((s) => webCalendar.requiredSlotsFor(WEEKDAY).includes(s.id)).map((s) => s.number);
  assert.deepEqual(cal.massProgress({ filledSlots: all }, WEEKDAY), { done: all.length, total: all.length, ready: true });
  assert.equal(cal.massBadge(mass(1, WEEKDAY, { filledSlots: all }), WEEKDAY).ready, true);
  assert.equal(cal.massProgress({ filledSlots: all }, SUNDAY).ready, false, 'a Sunday needs more');
});

test('several Holy Masses on one day: in the order they are celebrated, two pills and +N more, and a click lists them all', () => {
  const evening = mass(1, SUNDAY, { massTime: '5:00 PM', massLanguage: 'Cebuano' });
  const early = mass(2, SUNDAY, { massTime: '6:00 AM', massLanguage: 'English' });
  const mid = mass(3, SUNDAY, { massTime: '8:00 AM', massLanguage: 'Tagalog' });
  const plans = [evening, early, mid, pw(4, SUNDAY)];
  const cell = cellOf(cal.calendarMonth({ kind: 'mass', month: '2026-11', plans }), SUNDAY);
  assert.deepEqual(cell.badges.map((b) => b.label), ['6:00 AM · EN', '8:00 AM · TL']);
  assert.equal(cell.more, 1);
  assert.equal(cell.count, 3);

  const click = cal.dayClick('mass', plans, SUNDAY, true);
  assert.equal(click.action, 'pick');
  assert.deepEqual(click.plans.map((p) => p.massTime), ['6:00 AM', '8:00 AM', '5:00 PM']);
  // The chooser rows: time, language and slots filled, every name escaped.
  const row = cal.chooserRowHtml({ ...early, name: 'Sample <b>Plan</b>' }, SUNDAY, 'mass', 'plan/mass.html?id=x');
  assert.match(row, /bc-schedule-time">6:00 AM</);
  assert.match(row, /bc-lang">English</);
  assert.match(row, new RegExp(`0/${webCalendar.requiredSlotsFor(SUNDAY).length} slots`));
  assert.match(row, /Sample &lt;b&gt;Plan&lt;\/b&gt;/);
});

test('a click on a day: an empty day starts New Plan, one plan opens it in the Plan Editor, a viewer on an empty day does nothing', () => {
  const only = mass(1, SUNDAY, { massTime: '9:30 AM' });
  assert.deepEqual(cal.dayClick('mass', [only], SUNDAY, true).action, 'open');
  assert.equal(cal.dayClick('mass', [only], SUNDAY, true).plan.id, only.id);
  assert.equal(cal.dayClick('mass', [only], SUNDAY, false).action, 'open', 'a viewer can still open it');
  assert.equal(cal.dayClick('mass', [only], WEEKDAY, true).action, 'create');
  assert.equal(cal.dayClick('mass', [only], WEEKDAY, false).action, 'none');
  // Each calendar counts only its own plans.
  assert.equal(cal.dayClick('pw', [only], SUNDAY, true).action, 'create');
});

// ---- The Praise & Worship Calendar ----

test('the Praise & Worship Calendar: only its own plans, each named with its item count, three to a day then +N more', () => {
  const plans = [pw(1, SUNDAY, { name: 'Sample Night A', itemCount: 12 }), pw(2, SUNDAY, { name: 'Sample Night B', itemCount: 1 }), pw(3, SUNDAY, { name: 'Sample Night C' }), pw(4, SUNDAY, { name: 'Sample Night D' }), mass(5, SUNDAY)];
  const month = cal.calendarMonth({ kind: 'pw', month: '2026-11', plans });
  assert.equal(month.hint, 'Praise & Worship plans only. Pick a day to open its plan, or to start one.');
  const cell = cellOf(month, SUNDAY);
  assert.equal(cell.count, 4);
  assert.deepEqual(cell.badges.map((b) => [b.kind, b.label, b.count]), [['pw', 'Sample Night A', '12'], ['pw', 'Sample Night B', '1'], ['pw', 'Sample Night C', '0']]);
  assert.equal(cell.more, 1);
  assert.equal(cal.dayClick('pw', plans, SUNDAY, true).action, 'pick');
  assert.match(cal.chooserRowHtml(plans[0], SUNDAY, 'pw', 'plan/praise.html?id=x'), /12 items/);
});

test('the calendar markup: SUN to SAT, a button for each day, plan pills that open the plan, memo and add tools for planners only', () => {
  const plans = [mass(1, SUNDAY, { name: 'Sample <i>Title</i>', massTime: '9:30 AM', massLanguage: 'English' })];
  const month = cal.calendarMonth({ kind: 'mass', month: '2026-11', plans, notes: { [WEEKDAY]: 'Sample <memo>' }, today: SUNDAY });
  const planner = cal.calendarHtml(month, { canEdit: true });
  assert.match(planner, /role="grid"/);
  for (const day of ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']) assert.match(planner, new RegExp(`role="columnheader"[^>]*>${day}<`));
  assert.match(planner, new RegExp(`data-open-plan="${ids(1)}"`));
  assert.match(planner, /pc-badge-label">9:30 AM · EN</);
  assert.match(planner, new RegExp(`data-day="${SUNDAY}"`));
  assert.match(planner, new RegExp(`data-memo-day="${WEEKDAY}"`));
  assert.match(planner, new RegExp(`data-add-day="${SUNDAY}"[^>]*Add another Holy Mass schedule`));
  assert.match(planner, /class="pc-memo">Sample &lt;memo&gt;</);
  assert.match(planner, /Sample &lt;i&gt;Title&lt;\/i&gt;/);
  assert.doesNotMatch(planner, /<i>Title|<memo>/, 'nothing typed goes in as markup');
  assert.match(planner, /class="pc-season" data-color="green"/);
  assert.match(planner, /data-cal-nav="0" disabled/, 'Today is off on this month');
  assert.match(planner, /aria-current="date"/);

  const viewer = cal.calendarHtml(month, { canEdit: false });
  assert.doesNotMatch(viewer, /data-memo-day|data-add-day/);
  assert.doesNotMatch(viewer, new RegExp(`data-day="${WEEKDAY}"`), 'a viewer cannot start a plan on an empty day');
  assert.match(viewer, new RegExp(`data-day="${SUNDAY}"`), 'a viewer still opens a day that has a plan');
});

test('the layout is the calendar unless the list or the grid was chosen, and a calendar key is mass unless it is pw', () => {
  assert.deepEqual(['list', 'grid', 'calendar', '', null, 'other'].map(cal.plannerViewOf), ['list', 'grid', 'calendar', 'calendar', 'calendar', 'calendar']);
  assert.deepEqual(['pw', 'mass', null, 'x'].map(cal.calendarKindOf), ['pw', 'mass', 'mass', 'mass']);
  assert.equal(cal.calendarOfPlan({ kind: 'pw' }), 'pw');
  assert.equal(cal.calendarOfPlan({}), 'mass');
});

// ---- The header ----

test('the header: SERVICE PLANNING, Planner, the three tabs with one on, and + New Plan for planners', () => {
  const html = header.plannerHeaderHtml({ tab: 'mass', canCreate: true });
  assert.match(html, /class="ph-eyebrow">Service Planning</);
  assert.match(html, /<h1 class="ph-title">Planner<\/h1>/);
  assert.match(html, /data-planner-subtitle>Holy Mass plans on the liturgical calendar\.</);
  assert.match(html, /<span class="ph-tab is-on" aria-current="page" data-planner-tab="mass">Liturgical Calendar<\/span>/);
  assert.match(html, /<a class="ph-tab" href="index\.html\?cal=pw" data-planner-tab="pw">Praise &amp; Worship Calendar<\/a>/);
  assert.match(html, /class="ph-tab is-locked" aria-disabled="true" data-planner-tab="editor"/, 'no plan opened yet');
  assert.match(html, /<button type="button" class="btn-primary ph-new" data-new-plan>/);
  assert.doesNotMatch(header.plannerHeaderHtml({ tab: 'mass', canCreate: false }), /ph-new/, 'a viewer gets no New Plan');
  assert.match(header.plannerHeaderHtml({ tab: 'pw' }), /data-planner-subtitle>Praise &amp; Worship plans on the calendar\.</);

  // In the Plan Editor: its tab on, the plan's title as the line, the calendars linked on the plan's month, New Plan as a link.
  const plan = { id: ids(9), kind: 'mass', name: 'Sample Plan Title', date: SUNDAY };
  const editor = header.plannerHeaderHtml({ tab: 'editor', subtitle: 'Sample Plan Title · Sunday 8 November', root: '../', editorPlan: plan, canCreate: true, newPlan: header.newPlanFlowHref({ kind: 'mass', date: SUNDAY }, '../') });
  assert.match(editor, /aria-current="page" data-planner-tab="editor">Plan Editor</);
  assert.match(editor, /data-planner-subtitle>Sample Plan Title · Sunday 8 November</);
  assert.match(editor, /href="\.\.\/index\.html\?cal=mass&amp;month=2026-11" data-planner-tab="mass"/);
  assert.match(editor, /href="\.\.\/index\.html\?cal=pw" data-planner-tab="pw"/);
  assert.match(editor, /<a class="btn-primary ph-new" href="\.\.\/index\.html\?cal=mass&amp;new=mass&amp;date=2026-11-08">/);
  // From a calendar, Plan Editor reopens the last plan.
  assert.match(header.plannerHeaderHtml({ tab: 'pw', editorPlan: { ...plan, kind: 'pw' } }), new RegExp(`<a class="ph-tab" href="plan/praise\\.html\\?id=${plan.id}" data-planner-tab="editor"`));
  assert.match(header.plannerHeaderHtml({ tab: 'mass', subtitle: '<b>x</b>' }), /&lt;b&gt;x&lt;\/b&gt;/);
});

test('the Plan Editor tab remembers the last plan opened in this browser, and forgets a deleted one', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  assert.equal(header.lastPlan(storage), null);
  header.rememberPlan({ id: ids(1), kind: 'pw', name: 'Sample Praise Night', date: SUNDAY, items: ['dropped'] }, storage);
  assert.deepEqual(header.lastPlan(storage), { id: ids(1), kind: 'pw', name: 'Sample Praise Night', date: SUNDAY });
  header.forgetPlan(ids(2), storage);
  assert.ok(header.lastPlan(storage), 'another plan\'s delete leaves it');
  header.forgetPlan(ids(1), storage);
  assert.equal(header.lastPlan(storage), null);
  // Anything malformed is nothing, and a store that throws is nothing too.
  store.set(header.LAST_PLAN_KEY, JSON.stringify({ id: 'not-an-id' }));
  assert.equal(header.lastPlan(storage), null);
  store.set(header.LAST_PLAN_KEY, '{');
  assert.equal(header.lastPlan(storage), null);
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(header.lastPlan(broken), null);
  assert.doesNotThrow(() => header.rememberPlan({ id: ids(1) }, broken));
  assert.equal(header.editorHrefFor({ id: ids(1), kind: 'pw' }, '../'), model.editorPathFor({ id: ids(1), kind: 'pw' }).replace(/^/, '../'));
});

// ---- New Plan ----

test('New Plan from a day: the Holy Mass is named after the liturgical day, as on the laptop', () => {
  assert.equal(form.dayNameOf(SUNDAY), '32nd Sunday in Ordinary Time');
  assert.equal(form.dayNameOf('2026-13-40'), '');
  assert.equal(form.dayNameOf('2026-02-30'), '', 'not a day');
  assert.equal(model.suggestPlanName({ kind: 'mass', date: SUNDAY, dayName: form.dayNameOf(SUNDAY) }), '32nd Sunday in Ordinary Time');
  assert.equal(model.suggestPlanName({ kind: 'pw', date: SUNDAY, dayName: 'Sample Liturgical Day' }), 'Praise & Worship Night (8 Nov)', 'Praise & Worship keeps its own');
  assert.equal(model.suggestPlanName({ kind: 'mass', date: SUNDAY }), 'Sunday Holy Mass (8 Nov)', 'without a day name, as before');
  // The time chips and languages come from the schedule fields the laptop asks for.
  assert.match(readWeb('js/new-plan-form.js'), /mountScheduleFields\(byId\('schedule-fields'\)/);
});

test('CREATE A PLAN is one card: the eyebrow, the date heading, the italic day, the × button, and no template boxes or live preview', () => {
  const html = form.newPlanFormHtml();
  assert.match(html, /<form id="new-plan-form" class="np-card" data-color="none" data-kind="mass"/);
  assert.match(html, /<span class="np-ribbon" aria-hidden="true"><\/span>/);
  assert.match(html, /<p class="np-eyebrow">Create a plan<\/p>/);
  assert.match(html, /<h2 id="np-heading" class="np-heading"><\/h2>/);
  assert.match(html, /<p id="np-subtitle" class="np-subtitle"><\/p>/);
  assert.match(html, /id="new-plan-close" class="np-close" aria-label="Close"/);
  assert.match(html, /<label class="np-label" for="plan-name">Plan name<\/label>/);
  assert.doesNotMatch(html, /Live preview|preview-card-box|template-card|name="kind"/);
  assert.equal(html.match(/type="submit"/g).length, 1, 'the action card is the one submit button, so Enter makes the plan');
  // The picker row (kind toggle, date, Today / This Saturday / Next Sunday) is hidden until the card is opened without a day.
  assert.match(html, /<div id="np-picker" class="np-picker" hidden>/);
  assert.deepEqual([...html.matchAll(/data-date-shortcut="(\w+)"[^>]*>([^<]+)</g)].map((m) => [m[1], m[2]]), [['today', 'Today'], ['saturday', 'This Saturday'], ['sunday', 'Next Sunday']]);
  assert.match(html, /data-plan-kind="mass" aria-pressed="true">Holy Mass</);
  assert.match(html, /data-plan-kind="pw" aria-pressed="false">Praise &amp; Worship</);
  // The Planner's modal holds only the card, which brings its own heading; plan/new.html shows the same card.
  const page = readWeb('index.html');
  assert.match(page, /<dialog id="new-plan-dialog" class="np-dialog" aria-labelledby="np-heading">\s*<!--[^>]*-->\s*<div id="new-plan-layout" class="new-plan-layout"><\/div>\s*<\/dialog>/);
  const css = readWeb('css/planner.css');
  assert.match(css, /dialog\.np-dialog \{\s*width: min\(520px, calc\(100vw - 32px\)\);/);
  assert.match(css, /\.new-plan-layout \{\s*width: 100%;\s*max-width: 520px;/);
  assert.doesNotMatch(css, /\.preview-card-box|\.template-card/, 'the old two-column layout is gone');
});

test('the heading is the full date, the subtitle the day\'s Ordo name, and the ribbon its vestment colour', () => {
  assert.equal(form.fullDate('2026-11-07'), 'Saturday, November 7, 2026');
  assert.equal(form.fullDate(SUNDAY), 'Sunday, November 8, 2026');
  assert.equal(form.fullDate('2026-02-30'), '');
  const colours = { [SUNDAY]: 'green', '2026-12-06': 'violet', '2026-12-13': 'rose', [SOLEMNITY]: 'white', '2026-05-24': 'red', '2026-12-26': 'red' };
  for (const [iso, colour] of Object.entries(colours)) {
    assert.equal(form.ribbonColorOf(iso), colour, iso);
    assert.equal(form.ribbonColorOf(iso), cal.liturgicalDay(iso).color, 'the calendar\'s own colour');
  }
  assert.equal(form.ribbonColorOf(''), 'none');
  const card = form.newPlanCard({ kind: 'mass', date: '2026-12-06', name: 'Sample Plan Title' });
  assert.equal(card.heading, 'Sunday, December 6, 2026');
  assert.equal(card.subtitle, form.dayNameOf('2026-12-06'));
  assert.equal(card.color, 'violet');
  assert.equal(form.newPlanCard({ date: '' }).heading, 'Choose a date');
  assert.equal(form.newPlanCard({ date: '' }).canCreate, false);
  // Every colour the calendar uses has a ribbon swatch, 5px down the card's left edge.
  const css = readWeb('css/planner.css');
  for (const colour of ['green', 'violet', 'white', 'red', 'rose']) assert.match(css, new RegExp(`\\.np-card\\[data-color="${colour}"\\] \\{ --swatch: var\\(--lit-${colour}\\); \\}`));
  assert.match(css, /\.np-ribbon \{[^}]*width: 5px;[^}]*background: var\(--swatch\);/);
  assert.match(css, /\.np-subtitle \{[^}]*font-family: var\(--font-serif\);[^}]*font-style: italic;/);
});

test('the action card: Create Holy Mass Plan or Create Praise & Worship Plan, in the laptop\'s words, Creating… while it works', () => {
  const massCard = form.newPlanCard({ kind: 'mass', date: SUNDAY, name: 'Sample Plan Title' });
  assert.deepEqual(massCard.action, { title: 'Create Holy Mass Plan', text: "The four parts of the Holy Mass, with the day's readings from the Lectionary." });
  assert.equal(massCard.canCreate, true);
  const pwCard = form.newPlanCard({ kind: 'pw', date: SUNDAY, name: 'Sample Plan Title' });
  assert.deepEqual(pwCard.action, { title: 'Create Praise & Worship Plan', text: 'Opening, Praise & Worship, and Word & Offering sets.' });
  assert.equal(pwCard.kind, 'pw');
  assert.equal(form.newPlanCard({ kind: 'mass', date: SUNDAY, name: '   ' }).canCreate, false, 'a plan needs a name');
  const busy = form.newPlanCard({ kind: 'mass', date: SUNDAY, name: 'Sample Plan Title', busy: true });
  assert.equal(busy.action.title, 'Creating…');
  assert.equal(busy.canCreate, false, 'one press makes one plan');
  // The card shows only the Holy Mass fields for a Holy Mass, and the glyph of the kind on show.
  const css = readWeb('css/planner.css');
  assert.match(css, /\.np-card\[data-kind="mass"\] \.np-action-glyph\.is-pw,\s*\.np-card\[data-kind="pw"\] \.np-action-glyph\.is-mass \{\s*display: none;/);
  assert.match(readWeb('js/new-plan-form.js'), /massFields\.hidden = card\.kind !== 'mass';/);
});

test('HOLY MASS TIME: the four quick chips, a typed time of its own, and a taken time warned of with creation held back', () => {
  const html = schedule.scheduleFieldsHtml({ massTime: '9:30 AM', id: 'np' });
  assert.match(html, /<label class="bc-label" for="np-time"><svg class="bc-label-icon"[\s\S]*?<\/svg>Holy Mass time<\/label>/, 'clock icon and label');
  assert.match(html, /placeholder="e\.g\. 6:00 AM, 8:00 AM, 9:30 AM"/);
  assert.match(html, /Type any time, or tap one of these\./);
  const pressed = (h) => [...h.matchAll(/data-time-preset="([^"]+)" aria-pressed="(true|false)"/g)].map((m) => [m[1], m[2] === 'true']);
  assert.deepEqual(pressed(html), [['6:00 AM', false], ['8:00 AM', false], ['9:30 AM', true], ['5:00 PM', false]]);
  // A time of the operator's own presses no chip.
  assert.ok(pressed(schedule.scheduleFieldsHtml({ massTime: '7:15 AM' })).every(([, on]) => !on));

  // A Holy Mass already at that time on that date ("06:00" is "6:00 AM"): warned of, and the card cannot make the plan.
  const plans = [mass(1, SUNDAY, { massTime: '6:00 AM', massLanguage: 'English' })];
  const taken = form.newPlanCard({ kind: 'mass', date: SUNDAY, name: 'Sample Plan Title', massTime: '06:00', plans });
  assert.equal(taken.conflict?.id, ids(1));
  assert.equal(taken.canCreate, false);
  assert.match(schedule.conflictBannerHtml(taken.conflict), new RegExp(`data-open-existing="${ids(1)}"`));
  // Another time, another day, or Praise & Worship: free.
  assert.equal(form.newPlanCard({ kind: 'mass', date: SUNDAY, name: 'Sample Plan Title', massTime: '8:00 AM', plans }).canCreate, true);
  assert.equal(form.newPlanCard({ kind: 'mass', date: WEEKDAY, name: 'Sample Plan Title', massTime: '6:00 AM', plans }).conflict, null);
  assert.equal(form.newPlanCard({ kind: 'pw', date: SUNDAY, name: 'Sample Plan Title', massTime: '6:00 AM', plans }).conflict, null);
  assert.match(readWeb('js/new-plan-form.js'), /submit\.disabled = !card\.canCreate;/);
});

test('LANGUAGE: English, Cebuano, Tagalog and Other / Custom, which opens a box for the parish\'s own language', () => {
  const html = schedule.scheduleFieldsHtml({ massLanguage: 'Tagalog', id: 'np' });
  assert.match(html, /<span class="bc-label" id="np-lang-label"><svg class="bc-label-icon"[\s\S]*?<\/svg>Language<\/span>/, 'language icon and label');
  assert.deepEqual([...html.matchAll(/data-schedule-lang="[^"]+" aria-pressed="(true|false)"[^>]*>([^<]+)</g)].map((m) => [m[2], m[1] === 'true']), [
    ['English', false], ['Cebuano', false], ['Tagalog', true], ['Other / Custom', false],
  ]);
  assert.doesNotMatch(html, /data-role="lang-other"/, 'no box until Other / Custom');
  assert.match(html, /English, Tagalog and Cebuano also set the language of the readings and responses\./);
  const own = schedule.scheduleFieldsHtml({ massLanguage: 'Sample Custom Language', id: 'np' });
  assert.match(own, /data-schedule-lang="other" aria-pressed="true"[^>]*>Other \/ Custom</);
  assert.match(own, /id="np-lang-other"[^>]*aria-label="Custom language"[^>]*value="Sample Custom Language"/);
  assert.match(schedule.scheduleFieldsHtml({ otherOpen: true, id: 'np' }), /id="np-lang-other"[^>]*value=""/, 'Other / Custom opens an empty box');
  // English, Tagalog and Cebuano draft the readings in that language; the parish's own drafts in English.
  assert.equal(schedule.textsLanguageFor('Cebuano'), 'CEB');
  assert.equal(schedule.textsLanguageFor('Tagalog'), 'TL');
  assert.equal(schedule.textsLanguageFor('Sample Custom Language'), 'EN');
});

test('a calendar day opens the card in its calendar\'s kind; + New Plan adds the picker; Esc and × close it; a new plan opens in the Plan Editor', () => {
  const plans = readWeb('js/plans.js');
  assert.match(plans, /if \(click\.action === 'create'\) openNewPlan\(\{ kind: state\.cal, date: iso \}\);/, 'Liturgical → Holy Mass, Praise & Worship → Praise & Worship');
  assert.match(plans, /openNewPlan\(\{ kind: state\.cal \}\)/, '+ New Plan has no day, so the card shows its picker');
  assert.match(plans, /newPlanDialog\.addEventListener\('cancel', \(event\) => \{\s*if \(newPlanForm\?\.busy\) event\.preventDefault\(\);/, 'Esc closes it, except while creating');
  assert.match(plans, /onClose: \(\) => newPlanDialog\.close\(\)/);
  // A made plan shows on the calendar at once, then opens in the Plan Editor.
  assert.match(plans, /function planCreated\(plan\) \{[\s\S]*?state\.plans = \[[\s\S]*?renderRows\(\);[\s\S]*?newPlanDialog\.close\(\);\s*openPlan\(plan\);/);
  assert.match(plans, /onCreated: planCreated/);
  const script = readWeb('js/new-plan-form.js');
  assert.match(script, /picker\.hidden = day !== '';/, 'the picker shows only without a day');
  assert.match(script, /const result = await submitNewPlan\(input, \{ known \}\);\s*if \(result\.plan\) \{\s*onCreated\?\.\(result\.plan\);/);
  assert.match(readWeb('js/new-plan.js'), /onClose: \(\) => location\.assign\(`\$\{root\}index\.html\?cal=\$\{form\.kind \?\? kind\}`\)/);
  assert.equal(model.editorPathFor({ id: ids(9), kind: 'mass' }), `plan/mass.html?id=${ids(9)}`);
  assert.equal(model.editorPathFor({ id: ids(9), kind: 'pw' }), `plan/praise.html?id=${ids(9)}`);
});

test('the Planner page: the header slot, the New Plan modal, the memo dialog and the schedule chooser; plan/new.html still works', () => {
  const page = readWeb('index.html');
  assert.match(page, /<title>Planner · APCCMMA Web Planner<\/title>/);
  assert.match(page, /<div data-planner-header><\/div>/);
  assert.match(page, /<dialog id="new-plan-dialog"/);
  assert.match(page, /<dialog id="memo-dialog"/);
  assert.match(page, /<input id="memo-input"[^>]*maxlength="200"/);
  assert.match(page, /<dialog id="day-dialog" class="bc-dialog"[\s\S]*?Available Holy Mass Schedules/);
  assert.doesNotMatch(page, /<script(?![^>]*\bsrc=)/);
  assert.doesNotMatch(page, /\son[a-z]+=/);
  const script = readWeb('js/plans.js');
  assert.match(script, /params\.get\('new'\)/, '?new= opens the New Plan modal');
  assert.match(script, /Add Another Holy Mass Schedule/);
  // plan/new.html keeps working for older links: the same header and form.
  const old = readWeb('plan/new.html');
  assert.match(old, /<div data-planner-header><\/div>/);
  assert.match(old, /<div id="new-plan-layout" class="new-plan-layout" hidden><\/div>/);
  assert.match(readWeb('js/new-plan.js'), /mountNewPlanForm\(layout,/);
  for (const editor of ['plan/mass.html', 'plan/praise.html']) {
    const html = readWeb(editor);
    // The Holy Mass editor draws Duplicate and Save plan into the header (headerActionsHtml); the rest is in the page.
    const own = editor === 'plan/mass.html' ? html + workspace.headerActionsHtml() : html;
    for (const id of ['plan-title', 'date-badge', 'fill-badge', 'duplicate', 'delete', 'delete-dialog', 'save']) assert.match(own, new RegExp(`id="${id}"`), `${editor} has #${id}`);
    assert.match(html, /<div data-planner-header><\/div>/);
  }
});

// ---- The Plan Editor's slot helpers ----

test('Move up, Move down and Clear slot keep everything else in the step', () => {
  const A = '40000000-0000-4000-8000-00000000000a';
  const B = '40000000-0000-4000-8000-00000000000b';
  let segments = model.withEntry({ s1: { minutes: 5 } }, 's1', { songId: A, contentType: 'song' });
  segments = model.withEntry(segments, 's1', { songId: B, contentType: 'song', keyTransposed: 'G' });
  segments = model.withEntry(segments, 's1', { text: 'Sample Slot Note' });
  const order = (segs) => model.slotEntries(segs.s1).map((e) => e.songId ?? e.text);
  assert.deepEqual(order(segments), [A, B, 'Sample Slot Note']);
  const moved = model.withEntryMoved(segments, 's1', 1, 0);
  assert.deepEqual(order(moved), [B, A, 'Sample Slot Note']);
  assert.equal(model.slotEntries(moved.s1)[0].keyTransposed, 'G', 'a song keeps its key when it moves');
  assert.deepEqual(order(model.withEntryMoved(segments, 's1', 0, 2)), [B, 'Sample Slot Note', A]);
  assert.equal(model.withEntryMoved(segments, 's1', 0, 3), segments, 'nothing moves past the end');
  assert.equal(model.withEntryMoved(segments, 's1', 0, -1), segments);
  const cleared = model.withoutEntries(segments, 's1');
  assert.deepEqual(model.slotEntries(cleared.s1), []);
  assert.equal(cleared.s1.minutes, 5, 'a segment keeps its minutes');
});

test('the title is checked as the server checks it, and sent only when it changed', () => {
  assert.equal(model.checkPlanName('  '), 'Give the plan a title.');
  assert.equal(model.checkPlanName('x'.repeat(121)), 'Keep the plan title to 120 characters.');
  assert.equal(model.checkPlanName(' Sample Plan Title '), '');
  const plan = { id: ids(1), updatedAt: '2026-11-01T00:00:00.000Z', name: 'Sample Plan Title' };
  assert.equal('name' in model.savePayload(plan, [], { name: 'Sample Plan Title' }), false);
  assert.equal(model.savePayload(plan, [], { name: '  Sample Renamed Title ' }).name, 'Sample Renamed Title');
  assert.equal('name' in model.savePayload(plan, []), false, 'an editor that sends no name leaves it');
});

// ---- The Holy Mass Plan Editor as the laptop's Liturgical Plan ----

const { MASS_PLAN } = await load('web', 'js', 'sample-data.js');
const { requiredSlotsFor } = webCalendar;
const ROWS = model.massRows(MASS_PLAN);
const rowOfSlot = (n) => ROWS.find((r) => r.slot === n);
const SONG_ENTRANCE = '50000000-0000-4000-8000-000000000001';
const SONG_KYRIE = '50000000-0000-4000-8000-000000000002';
const SONG_PRAISE = '50000000-0000-4000-8000-000000000003';
const SONG_GENERAL = '50000000-0000-4000-8000-000000000004';
const LIBRARY = [
  { id: SONG_ENTRANCE, title: 'Sample Song Title', category: 'Entrance Procession', scope: 'MASS', language: 'English', key: 'D' },
  { id: SONG_KYRIE, title: 'Sample Kyrie Setting', category: 'Kyrie', scope: 'MASS', language: 'Tagalog', key: '' },
  { id: SONG_PRAISE, title: 'Sample Praise Song', category: 'Joyful Song', scope: 'PRAISE_AND_WORSHIP', language: 'Cebuano', key: 'G' },
  { id: SONG_GENERAL, title: 'Sample General Hymn', category: 'Communion Procession', scope: 'GENERAL', language: 'English', key: 'C' },
];

test('the header says SERVICE PLANNING → Liturgical Plan with the laptop\'s line, Plan Editor on, and Duplicate and Save plan (Ctrl + S)', () => {
  const html = header.plannerHeaderHtml({ tab: 'editor', title: workspace.PAGE_TITLE, subtitle: workspace.PAGE_SUBTITLE, actions: workspace.headerActionsHtml() });
  assert.match(html, /<span class="ph-eyebrow">Service Planning<\/span>/);
  assert.match(html, /<h1 class="ph-title">Liturgical Plan<\/h1>/);
  assert.match(html, /Build the Holy Mass block by block\. Load it to the Service Queue when it is ready\./);
  assert.match(html, /<span class="ph-tab is-on" aria-current="page" data-planner-tab="editor">Plan Editor<\/span>/);
  assert.match(html, /data-planner-tab="mass">Liturgical Calendar</);
  assert.match(html, /data-planner-tab="pw">Praise &amp; Worship Calendar</);
  assert.match(html, /<div class="ph-page-actions">[\s\S]*id="status"[\s\S]*id="duplicate"[^>]*>Duplicate<[\s\S]*id="save"[^>]*aria-keyshortcuts="Control\+S Meta\+S"[^>]*>Save plan</);
  assert.doesNotMatch(html, /New Plan/, 'the editor shows no + New Plan beside Save');
  // The calendars keep their heading, and a title is escaped.
  assert.match(header.plannerHeaderHtml({ tab: 'mass' }), /<h1 class="ph-title">Planner<\/h1>/);
  assert.doesNotMatch(header.plannerHeaderHtml({ tab: 'mass' }), /ph-page-actions/);
  assert.match(header.plannerHeaderHtml({ title: 'Sample <b>' }), /Sample &lt;b&gt;/);
  // The page wires Ctrl + S and Save plan to the same save.
  const page = readWeb('js/mass.js');
  assert.match(page, /\(event\.ctrlKey \|\| event\.metaKey\) && !event\.altKey && event\.key\.toLowerCase\(\) === 's'/);
  assert.match(page, /title: PAGE_TITLE,\s*subtitle: PAGE_SUBTITLE,/);
});

test('the readiness banner counts songs and readings/notes, lists what the day still needs, and turns green when it is ready', () => {
  const nameOf = (row) => row.name;
  const empty = workspace.readiness({ rows: ROWS, segments: {}, notes: {}, date: SUNDAY, nameOf });
  assert.deepEqual([empty.songs, empty.texts, empty.slots], [{ done: 0, total: 13 }, { done: 0, total: 16 }, { done: 0, total: 28 }]);
  assert.equal(empty.missing.length, requiredSlotsFor(SUNDAY).length);
  assert.equal(empty.missing[0].name, 'Entrance Hymn', 'in Holy Mass order');
  assert.equal(empty.ready, false);
  const html = workspace.readinessBannerHtml(empty, { dateText: 'Sample Liturgical Day', max: 3 });
  assert.match(html, /Songs: 0 of 13 chosen · Readings\/Notes: 0 of 16 entered/);
  assert.match(html, new RegExp(`Still empty for Sample Liturgical Day \\(${empty.missing.length} of ${empty.needed.total}\\)`));
  assert.equal(html.match(/data-jump-row=/g).length, 3, 'three slot names, then the rest counted');
  assert.match(html, new RegExp(`and ${empty.missing.length - 3} more\\.`));

  // It updates as items are added and removed: a song, a cue on a spoken part.
  let segments = model.withEntry({}, rowOfSlot(1).id, { songId: SONG_ENTRANCE, contentType: 'song' });
  const notes = { [rowOfSlot(2).id]: 'Sample Musician Cue' };
  const some = workspace.readiness({ rows: ROWS, segments, notes, date: SUNDAY, nameOf });
  assert.deepEqual([some.songs.done, some.texts.done], [1, 1]);
  assert.equal(some.missing.length, empty.missing.length - 2);
  segments = model.withoutEntry(segments, rowOfSlot(1).id, 0);
  assert.equal(workspace.readiness({ rows: ROWS, segments, notes, date: SUNDAY }).songs.done, 0);

  // Every slot the weekday needs filled: ready, though the Sunday-only parts and optional ones are empty.
  const filled = Object.fromEntries(ROWS.filter((r) => r.slot && requiredSlotsFor(WEEKDAY).includes(webSlots.MASS_SLOTS.find((s) => s.number === r.slot).id)).map((r) => [r.id, 'Sample Musician Cue']));
  const ready = workspace.readiness({ rows: ROWS, segments: {}, notes: filled, date: WEEKDAY });
  assert.equal(ready.ready, true);
  assert.equal(ready.missing.length, 0);
  assert.match(workspace.readinessBannerHtml(ready), /Every slot this day needs is filled\./);
  // A slot name is escaped like everything else.
  assert.match(workspace.readinessBannerHtml({ ...empty, missing: [{ id: 's1', n: 1, name: '<b>x</b>' }] }), /&lt;b&gt;x&lt;\/b&gt;/);
});

test('the control strip: Back to Calendar, the plan switcher, EN / TL / CEB / Other, PRINT LINEUP, TEMPLATES, HOLY MASSES ON THIS DAY, the progress and COLLAPSE ALL', () => {
  const html = readWeb('plan/mass.html');
  assert.match(html, /<section class="lp-strip" aria-label="Holy Mass time and language">/);
  assert.match(html, /<a id="back-to-calendar" class="lp-back" href="\.\.\/index\.html\?cal=mass"><span aria-hidden="true">←<\/span> Back to Calendar<\/a>/);
  assert.match(html, /<select id="plan-switch"/);
  assert.match(html, /<div id="language" class="lp-lang-group" role="radiogroup"/);
  assert.match(html, /id="lang-other"[^>]*>Other</);
  assert.match(html, /id="print-lineup"[\s\S]*?Print lineup/);
  assert.match(html, /id="open-templates"[^>]*>Templates</);
  assert.match(html, /<nav id="schedule-switcher" class="bc-switcher" aria-label="Holy Masses on this day">/);
  assert.match(html, /id="collapse-all"[^>]*>Collapse all</);
  assert.match(html, /<section id="setlist-print" class="setlist-print" aria-hidden="true">/, 'the printed lineup');
  assert.match(html, /id="browse-songs"[^>]*>Browse songs</, 'phones and tablets jump to the library');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/);
  assert.doesNotMatch(html, /\son[a-z]+=/);
  // The language pills read EN, TL and CEB, as on the laptop.
  assert.match(readWeb('js/mass.js'), />\$\{esc\(l\.code\)\}<\/button>/);

  assert.equal(workspace.mdyDate('2026-11-07'), '11/07/2026');
  assert.equal(workspace.mdyDate('not a date'), '');
  assert.equal(workspace.stripSubtitle(SUNDAY, 8), '32nd Sunday in Ordinary Time · Sunday Cycle A · 8 items');
  assert.match(workspace.stripSubtitle(WEEKDAY, 1), / · Weekday Cycle II · 1 item$/);
  assert.equal(workspace.collapseLabel(0, 4), 'Collapse all');
  assert.equal(workspace.collapseLabel(2, 4), 'Collapse all');
  assert.equal(workspace.collapseLabel(4, 4), 'Expand all');

  // The plan switcher: "MM/DD/YYYY · title · time", newest first, the open plan selected with its title as being edited.
  const current = schedule.asSchedulePlan({ id: ids(2), name: 'Sample <Renamed> Title', date: SUNDAY, massTime: '9:30 AM', kind: 'mass' });
  const options = workspace.planSwitchOptionsHtml([mass(1, SOLEMNITY), mass(2, SUNDAY), mass(3, WEEKDAY, { massTime: '6:00 AM' }), pw(4, SUNDAY)].map(schedule.asSchedulePlan), current);
  assert.deepEqual([...options.matchAll(/<option value="([^"]+)"( selected)?>([^<]*)</g)].map((m) => [m[1], Boolean(m[2]), m[3]]), [
    [ids(3), false, '11/10/2026 · Sample Plan Title · 6:00 AM'],
    [ids(2), true, '11/08/2026 · Sample &lt;Renamed&gt; Title · 9:30 AM'],
    [ids(1), false, '11/01/2026 · Sample Plan Title'],
  ], 'no Praise & Worship plans');
});

test('HOLY MASSES ON THIS DAY: the open one opens the time popover, the others open their plan, then Edit Time and + Add Time', () => {
  const six = schedule.asSchedulePlan(mass(1, SUNDAY, { massTime: '6:00 AM', massLanguage: 'Cebuano' }));
  const nine = schedule.asSchedulePlan(mass(2, SUNDAY, { massTime: '9:30 AM', massLanguage: 'English' }));
  const html = workspace.scheduleRowHtml([six, nine], ids(2), { pathOf: (p) => `plan/mass.html?id=${p.id}`, addHref: 'index.html?cal=mass&new=mass', popoverOpen: true });
  assert.match(html, /<span class="bc-switch-label">Holy Masses on this day<\/span>/);
  assert.match(html, new RegExp(`<a class="bc-switch" href="plan/mass\\.html\\?id=${ids(1)}"[^>]*>6:00 AM · Cebuano</a>`));
  assert.match(html, /<button type="button" class="bc-switch is-on" aria-current="page" data-edit-time aria-expanded="true"[^>]*>9:30 AM · English<\/button>/);
  assert.match(html, /data-edit-time aria-expanded="true" aria-controls="time-popover">Edit Time<\/button>/);
  assert.match(html, /<a class="bc-switch is-add" href="index\.html\?cal=mass&amp;new=mass"><span aria-hidden="true">\+<\/span> Add Time<\/a>/);
  // A viewer sees the pills only.
  const viewer = workspace.scheduleRowHtml([{ ...nine, massTime: '', massLanguage: '' }], ids(2), { pathOf: () => '', canEdit: false });
  assert.match(viewer, /<span class="bc-switch is-on" aria-current="page">No time set<\/span>/);
  assert.doesNotMatch(viewer, /data-edit-time|Add Time/);

  // The popover: the four quick times, and a taken time holds Set time back with the laptop's words.
  const free = workspace.timePopoverHtml({ value: '8:00 AM' });
  assert.deepEqual([...free.matchAll(/data-tp-preset="([^"]+)" aria-pressed="(true|false)"/g)].map((m) => `${m[1]}=${m[2]}`), ['6:00 AM=false', '8:00 AM=true', '9:30 AM=false', '5:00 PM=false']);
  assert.match(free, /<button type="button" class="btn-primary" data-tp="apply">Set time<\/button>/);
  const conflict = schedule.conflictIn([six, nine], SUNDAY, '06:00', ids(2));
  assert.equal(conflict.id, ids(1), '6:00 AM and 06:00 are one time');
  const taken = workspace.timePopoverHtml({ value: '06:00', conflict });
  assert.match(taken, /A Holy Mass at 6:00 AM[\s\S]*already exists on this date\./);
  assert.match(taken, /data-tp="apply" disabled>Set time/);
  assert.equal(schedule.conflictIn([six, nine], SUNDAY, '9:30 AM', ids(2)), null, 'its own time is not a clash');
  assert.match(workspace.timePopoverHtml({ value: '"><b>' }), /value="&quot;&gt;&lt;b&gt;"/);
});

test('the library: Search, Holy Mass / Praise & Worship / All, SONG CATEGORY, and song cards with title, category and language only', () => {
  const titles = (list) => list.map((s) => s.title);
  // Holy Mass is the default: its own songs and General ones.
  assert.deepEqual(titles(workspace.librarySongs(LIBRARY)), ['Sample Song Title', 'Sample Kyrie Setting', 'Sample General Hymn']);
  assert.deepEqual(titles(workspace.librarySongs(LIBRARY, { service: 'praise_worship' })), ['Sample Praise Song', 'Sample General Hymn']);
  assert.equal(workspace.librarySongs(LIBRARY, { service: 'all' }).length, 4);
  assert.deepEqual(titles(workspace.librarySongs(LIBRARY, { category: 'entrance' })), ['Sample Song Title']);
  assert.deepEqual(titles(workspace.librarySongs(LIBRARY, { category: 'kyrie' })), ['Sample Kyrie Setting']);
  assert.deepEqual(titles(workspace.librarySongs(LIBRARY, { service: 'all', category: 'Joyful Song' })), ['Sample Praise Song']);
  // Search matches the title, the category and the language.
  assert.deepEqual(titles(workspace.librarySongs(LIBRARY, { query: 'kyrie' })), ['Sample Kyrie Setting']);
  assert.deepEqual(titles(workspace.librarySongs(LIBRARY, { query: 'communion' })), ['Sample General Hymn']);
  assert.deepEqual(titles(workspace.librarySongs(LIBRARY, { query: 'tagalog' })), ['Sample Kyrie Setting']);
  assert.deepEqual(workspace.librarySongs(LIBRARY, { query: 'nothing like this' }), []);

  const categories = workspace.libraryCategories(LIBRARY, 'mass');
  assert.deepEqual(categories[0], { id: 'all', label: 'All categories', count: 3 });
  assert.deepEqual(categories.slice(1, 4).map((c) => [c.label, c.count]), [['Entrance', 1], ['Kyrie', 1], ['Gloria', 0]]);
  assert.ok(categories.some((c) => c.label === 'Recessional'));
  assert.deepEqual(workspace.libraryCategories(LIBRARY, 'all').map((c) => c.label), ['All categories', 'Communion Procession', 'Entrance Procession', 'Joyful Song', 'Kyrie']);

  const controls = workspace.songControlsHtml({ service: 'mass', category: 'kyrie', query: 'Sample "q"' }, LIBRARY);
  assert.match(controls, /placeholder="Search" value="Sample &quot;q&quot;"/);
  assert.deepEqual([...controls.matchAll(/data-lib-service="([^"]+)" aria-pressed="(true|false)">([^<]+)</g)].map((m) => `${m[3]}=${m[2]}`), ['Holy Mass=true', 'Praise &amp; Worship=false', 'All=false']);
  assert.match(controls, /<span>Song category<\/span>\s*<select data-lib-category><option value="all">All categories \(3\)<\/option>/);
  assert.match(controls, /<option value="kyrie" selected>Kyrie \(1\)<\/option>/);

  assert.equal(workspace.songMeta(LIBRARY[0]), 'Entrance · EN · Key D');
  assert.equal(workspace.songMeta(LIBRARY[2]), 'Joyful / Fast Praise · CEB · Key G');
  const cards = workspace.songListHtml([{ ...LIBRARY[0], title: 'Sample <i>Song</i> Title' }], { chosen: new Set([SONG_ENTRANCE]), hasTarget: true });
  assert.match(cards, /<strong>Sample &lt;i&gt;Song&lt;\/i&gt; Title<\/strong><span>Entrance · EN · Key D<\/span>/);
  assert.match(cards, new RegExp(`data-lib-add="${SONG_ENTRANCE}" aria-pressed="true" aria-label="Remove Sample &lt;i&gt;Song&lt;/i&gt; Title"[^>]*>✓</button>`));
  assert.match(workspace.songListHtml(LIBRARY.slice(0, 1)), /aria-pressed="false" aria-label="Add Sample Song Title"[^>]*>\+<\/button>/);
  assert.match(workspace.songListHtml(LIBRARY.slice(0, 1), { canEdit: false }), / disabled>\+<\/button>/);
  assert.match(workspace.songListHtml([], { songs: [] }), /Songs are added on the church laptop/);
  assert.match(workspace.songListHtml([], { songs: LIBRARY }), /No songs match/);
  // Titles and metadata only: nothing of a song's words reaches the library.
  assert.doesNotMatch(readWeb('js/mass-workspace.js'), /lyrics?\s*[:=]|\.words\b|\.lyrics\b/i);
});

test('+ on a library song goes into the active target slot, otherwise the slot of its category, and the target shows ✓ to take it out', () => {
  const entrance = rowOfSlot(1);
  const kyrie = rowOfSlot(3);
  const communion = rowOfSlot(16);
  // No target: the song's own category picks the slot.
  assert.equal(workspace.slotForSong(LIBRARY[0], ROWS, {}), entrance.id);
  assert.equal(workspace.slotForSong(LIBRARY[1], ROWS, {}), kyrie.id);
  assert.equal(workspace.slotForSong(LIBRARY[3], ROWS, {}), communion.id);
  assert.equal(workspace.slotForSong(LIBRARY[2], ROWS, {}), null, 'a praise song has no Holy Mass slot of its own: pick one first');
  // The active target wins, whatever the song's category.
  assert.equal(workspace.slotForSong(LIBRARY[2], ROWS, {}, kyrie.id), kyrie.id);
  assert.equal(workspace.slotForSong(LIBRARY[0], ROWS, {}, rowOfSlot(17).id), rowOfSlot(17).id);
  assert.equal(workspace.slotForSong(LIBRARY[0], ROWS, {}, 'not-a-row'), entrance.id);

  // One click puts it in, as the page does it (withEntry), and a second song in the same slot comes after it.
  let segments = model.withEntry({}, workspace.slotForSong(LIBRARY[0], ROWS, {}, entrance.id), { songId: SONG_ENTRANCE, contentType: 'song' });
  segments = model.withEntry(segments, workspace.slotForSong(LIBRARY[3], ROWS, segments, entrance.id), { songId: SONG_GENERAL, contentType: 'song' });
  assert.deepEqual(model.slotEntries(segments[entrance.id]).map((e) => e.songId), [SONG_ENTRANCE, SONG_GENERAL]);

  assert.match(workspace.targetLineHtml({ n: 1, name: 'Entrance Hymn' }), /Adding to<\/span><strong class="lp-target-name">1 · Entrance Hymn<\/strong><button[^>]*data-clear-target/);
  assert.match(workspace.targetLineHtml(null), /\+ puts a song in the slot of its category\. Click a slot to choose it instead\./);
  const page = readWeb('js/mass.js');
  assert.match(page, /const target = slotForSong\(song, ROWS, state\.segments, state\.sel\);/);
  assert.match(page, /flashRow\(target\);/, 'the slot that changed is highlighted');
});

test('the four parts with numbered slot rows: song pills with keys, cues, Move up / Move down, ×, and + ADD HYMN / ITEM or + ADD ITEM', () => {
  const sections = model.massSections(MASS_PLAN);
  assert.deepEqual(sections.map((s) => `${s.number}. ${s.title}`), ['1. Introductory Rites', '2. Liturgy of the Word', '3. Liturgy of the Eucharist', '4. Concluding Rites']);
  assert.deepEqual(sections.map((s) => s.rows.filter((r) => r.slot).map((r) => r.n)), [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10, 11, 12, 13], [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25], [26, 27, 28]], 'numbered 1 to 28 in Holy Mass order');

  const card = workspace.sectionCardHtml(sections[0], { title: 'Introductory Rites', open: true, filled: 1, total: 5, rowsHtml: '<p>rows</p>' });
  assert.match(card, /data-toggle="introductory" aria-expanded="true" aria-controls="section-introductory"/);
  assert.match(card, /<span>1\. Introductory Rites<\/span>/);
  assert.match(card, /<span class="lp-section-count">1 of 5<\/span>/);
  const closed = workspace.sectionCardHtml(sections[3], { title: 'Concluding Rites', open: false, filled: 3, total: 3 });
  assert.match(closed, /class="lp-section is-closed"/);
  assert.match(closed, /aria-expanded="false"/);
  assert.match(closed, /class="lp-section-body" hidden>/);
  assert.match(closed, /lp-section-count is-done/);

  const entries = [
    { index: 0, songId: SONG_ENTRANCE, title: 'Sample Song Title', source: 'list', key: 'E' },
    { index: 1, songId: null, title: 'Sample <Typed> Note', source: 'text', key: '' },
  ];
  const row = { ...rowOfSlot(1), name: 'Entrance Hymn', english: 'Entrance Hymn', entries };
  const html = workspace.slotRowHtml(row, { active: true, note: 'Sample Musician Cue' });
  assert.match(html, /class="lp-slot is-active" data-row="s1" data-slot="1"/);
  assert.match(html, /data-select-row="s1" aria-pressed="true"/);
  assert.match(html, /<span class="lp-slot-num"><span class="sr-only">Slot <\/span>1<\/span>/);
  assert.match(html, /<span class="lp-slot-name">Entrance Hymn<\/span>/);
  assert.match(html, /<li class="lp-pill is-list"><span class="lp-pill-icon" aria-hidden="true">♪<\/span><span class="lp-pill-title">Sample Song Title<\/span><span class="lp-pill-key">E<\/span>/);
  assert.match(html, /<span class="lp-pill-title">Sample &lt;Typed&gt; Note<\/span>/);
  assert.match(html, /data-move-entry="0" data-delta="-1" data-for="s1" aria-label="Move up: Sample Song Title" disabled>↑/);
  assert.match(html, /data-move-entry="0" data-delta="1" data-for="s1" aria-label="Move down: Sample Song Title">↓/);
  assert.match(html, /data-move-entry="1" data-delta="1"[^>]* disabled>↓/);
  assert.match(html, /data-remove-entry="1" data-for="s1" aria-label="Remove Sample &lt;Typed&gt; Note">×/);
  assert.match(html, /<li class="lp-cue"[^>]*><span aria-hidden="true">✎<\/span><span class="sr-only">Note: <\/span>Sample Musician Cue<\/li>/);
  assert.match(html, /data-open-row="s1" aria-expanded="false"><span aria-hidden="true">\+<\/span> Add hymn \/ item<\/button>/);
  // A spoken part says ADD ITEM; one item has no Move buttons; the open slot carries its quick-assign panel.
  const confiteor = workspace.slotRowHtml({ ...rowOfSlot(2), name: 'I Confess (Confiteor)', entries: [entries[1]] }, { open: true, panelHtml: '<div data-inline-picker="s2"></div>' });
  assert.match(confiteor, /\+<\/span> Add item<\/button>/);
  assert.doesNotMatch(confiteor, /data-move-entry/);
  assert.match(confiteor, /<div class="lp-slot-panel" data-panel="s2"><div data-inline-picker="s2"><\/div><\/div>/);
  // A viewer: nothing to press but the slot itself.
  const viewer = workspace.slotRowHtml(row, { canEdit: false });
  assert.doesNotMatch(viewer, /data-move-entry/);
  assert.match(viewer, /aria-label="Remove Sample Song Title" disabled>×/);
  assert.match(viewer, /data-open-row="s1" aria-expanded="false" disabled>/);
  // The slot's name is shown in the plan's language with the English beneath.
  assert.match(workspace.slotRowHtml({ ...row, name: 'Sample Liturgical Day', english: 'Entrance Hymn', entries: [] }), /<span class="lp-slot-english">Entrance Hymn<\/span>/);
});

test('Notes & Cues add to the target slot\'s note, and Templates replace what the plan holds as the laptop\'s Standard and Weekday do', () => {
  assert.equal(workspace.withCue('', 'Sample Musician Cue'), 'Sample Musician Cue');
  assert.equal(workspace.withCue('Capo 2', 'Sample Musician Cue'), 'Capo 2\nSample Musician Cue');
  assert.equal(workspace.withCue('Capo 2\nsample musician cue', 'Sample Musician Cue'), 'Capo 2\nsample musician cue', 'not twice');
  assert.equal(workspace.withCue('x'.repeat(999), 'Sample Musician Cue').length, workspace.MAX_NOTE);
  assert.match(workspace.cuesPanelHtml({ target: { n: 1, name: 'Entrance Hymn' } }), /added to the note of <strong>1 · Entrance Hymn<\/strong>/);
  assert.match(workspace.cuesPanelHtml({ target: null }), /Click a slot on the right first/);
  assert.match(workspace.cuesPanelHtml({ target: null }), /data-action="add-cue" disabled/);
  assert.equal([...workspace.cuesPanelHtml({ target: { n: 1, name: 'x' } }).matchAll(/data-cue="/g)].length, workspace.CUE_PRESETS.length);

  let segments = model.withEntry({ s1: { minutes: 4 } }, 's1', { songId: SONG_ENTRANCE, contentType: 'song' });
  segments = model.withEntry(segments, 's3', { text: 'Sample Slot Note' });
  const standard = workspace.templateState('standard', ROWS, segments);
  assert.ok(ROWS.every((r) => model.slotEntries(standard.segments[r.id]).length === 0), 'every slot empty');
  assert.equal(standard.segments.s1.minutes, 4, 'a row keeps its other fields');
  assert.deepEqual(standard.notes, {});
  const weekday = workspace.templateState('weekday', ROWS, segments);
  assert.deepEqual(Object.keys(weekday.notes).sort(), ['s12', 's14', 's3', 's9', 's10'].sort());
  assert.ok(Object.values(weekday.notes).every((note) => note === workspace.WEEKDAY_CUE));
  // The laptop's Weekday template fills the same slots (shared/mass-slots.js).
  const laptopWeekday = laptopSlots.BUILT_IN_TEMPLATES.find((t) => t.id === 'weekday').fills.map((f) => laptopSlots.slotNumberOf(f.slot)).sort((a, b) => a - b);
  assert.deepEqual([...workspace.WEEKDAY_SAID_SLOTS].sort((a, b) => a - b), laptopWeekday);
  // A template's state saves like any other: no item, only the cues.
  const items = model.massToItems({ ...weekday, extra: [], contentHubItems: [] }, ROWS);
  assert.deepEqual(items.filter((i) => i.songId || i.text).length, 0);

  const panel = workspace.templatesPanelHtml({ otherPlans: [schedule.asSchedulePlan(mass(5, SUNDAY, { name: 'Sample <Other> Plan', massTime: '6:00 AM' }))] });
  assert.match(panel, /Standard Sunday \/ Solemnity[\s\S]*Weekday Holy Mass[\s\S]*Clear All Slots/);
  assert.match(panel, /data-template="clear"[^>]*>Clear</);
  assert.match(panel, new RegExp(`<option value="${ids(5)}">11/08/2026 · Sample &lt;Other&gt; Plan · 6:00 AM</option>`));
  assert.match(workspace.templatesPanelHtml({ otherPlans: [] }), /No other Holy Mass plans to copy from yet\./);
  // Clear All Slots asks first.
  assert.match(readWeb('js/mass.js'), /if \(\(id === 'clear' \|\| holdsAnything\(\)\) && !window\.confirm\(question\)\) return;/);
});

test('PRINT LINEUP prints every part with its numbered slots, titles, keys and cues, and nothing more', () => {
  const html = workspace.printLineupHtml({
    eyebrow: 'Holy Mass lineup',
    name: 'Sample <Plan> Title',
    when: 'Sample Liturgical Day · 9:30 AM',
    sections: [{ title: '1. Introductory Rites', rows: [
      { n: 1, name: 'Entrance Hymn', entries: [{ songId: SONG_ENTRANCE, title: 'Sample Song Title', key: 'D' }], note: 'Sample Musician Cue' },
      { n: 2, name: 'I Confess (Confiteor)', entries: [], note: '' },
    ] }],
  });
  assert.match(html, /<h1>Sample &lt;Plan&gt; Title<\/h1>/);
  assert.match(html, /<tr class="lineup-part"><th colspan="4" scope="colgroup">1\. Introductory Rites<\/th><\/tr>/);
  assert.match(html, /<tr><td>1<\/td><td>Entrance Hymn<\/td><td>Sample Song Title <em>\(Key D\)<\/em><\/td><td>Sample Musician Cue<\/td><\/tr>/);
  assert.match(html, /<tr><td>2<\/td><td>I Confess \(Confiteor\)<\/td><td>—<\/td><td><\/td><\/tr>/);
  assert.match(readWeb('js/mass.js'), /document\.body\.classList\.add\('is-printing-setlist'\);\s*[\s\S]*?window\.print\(\);/);
});

// ---- The day's readings: Lectionary citations, auto-population, the Lectionary tab and the reading rows ----

const dayReadings = await load('web', 'js', 'day-readings.js');
const { ORDO_CITATIONS } = await load('web', 'js', 'ordo-citations.js');
const laptopDay = await load('shared', 'liturgical-day.js');
const laptopReadings = await load('shared', 'daily-readings.js');
const ORDO_JSON = JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'lectionary_ordo.json'), 'utf8'));
const READING_TYPES_OF_PLAN = ['First Reading', 'Responsorial Psalm', 'Second Reading', 'Gospel'];

test('ordo-citations.js holds every reference of the laptop\'s Ordo and nothing else: no names, no texts', () => {
  const fields = ['r1', 'ps', 'r2', 'acc', 'gos'];
  const pick = (e) => Object.fromEntries(fields.filter((f) => typeof e[f] === 'string' && e[f].trim()).map((f) => [f, e[f]]));
  const expected = {};
  for (const [code, entry] of Object.entries(ORDO_JSON.days)) {
    const day = pick(entry);
    for (const cycle of ['A', 'B', 'C', 'I', 'II']) if (entry[cycle] && Object.keys(pick(entry[cycle])).length) day[cycle] = pick(entry[cycle]);
    if (Object.keys(day).length) expected[code] = day;
  }
  assert.deepEqual(ORDO_CITATIONS, expected);
  assert.doesNotMatch(readWeb('js/ordo-citations.js'), /"name"\s*:/);
  assert.ok(Object.keys(ORDO_CITATIONS).length > 300);
});

test('the web finds the same readings as the laptop for every day of a year, with the Second Reading only where the Ordo gives one', () => {
  let sundays = 0;
  let weekdays = 0;
  for (let d = new Date(Date.UTC(2026, 10, 1)); d < new Date(Date.UTC(2027, 10, 1)); d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const laptop = laptopDay.ordoDayOf(ORDO_JSON, iso).citations;
    const web = dayReadings.dayReadingsFor(iso).readings;
    assert.deepEqual(web.map((r) => [r.type, r.citation]), READING_TYPES_OF_PLAN.filter((t) => laptop[t]).map((t) => [t, laptop[t]]), iso);
    if (d.getUTCDay() === 0) sundays += 1; else weekdays += 1;
  }
  assert.ok(sundays > 50 && weekdays > 300);
  // An ordinary weekday has three readings, an ordinary Sunday and a solemnity four.
  const types = (iso) => dayReadings.dayReadingsFor(iso).readings.map((r) => r.type);
  assert.deepEqual(types(WEEKDAY), ['First Reading', 'Responsorial Psalm', 'Gospel']);
  assert.deepEqual(types(SUNDAY), READING_TYPES_OF_PLAN);
  assert.deepEqual(types('2026-12-08'), READING_TYPES_OF_PLAN, 'a weekday solemnity has the Second Reading');
  assert.deepEqual(dayReadings.dayReadingsFor('not a date').readings, []);
  assert.deepEqual(dayReadings.dayReadingsFor(SUNDAY).readings.map((r) => r.slot), [20, 4, 21, 22], 'the slot numbers, not the positions 6, 7, 8 and 10');
  assert.equal(dayReadings.dayReadingsFor(SUNDAY).day.name, '32nd Sunday in Ordinary Time');
});

test('the readings are named and numbered as the laptop names and numbers them', () => {
  assert.deepEqual([...model.READING_NAMES], READING_TYPES_OF_PLAN);
  for (const { slot, readingType } of laptopReadings.READING_SLOTS) {
    if (!READING_TYPES_OF_PLAN.includes(readingType) || readingType === 'Prayer of the Faithful') continue;
    assert.equal(dayReadings.READING_SLOT_NUMBER[readingType], laptopSlots.slotNumberOf(slot), readingType);
  }
  // The rows are the Liturgy of the Word's, numbered 6, 7, 8 and 10 on screen.
  assert.deepEqual(Object.values(dayReadings.READING_SLOT_NUMBER).map((n) => ROWS.find((r) => r.slot === n).n).sort((a, b) => a - b), [6, 7, 8, 10]);
});

test('a new Holy Mass starts with the day\'s readings by name, in their slots, and a Sunday and a weekday differ only by the Second Reading', () => {
  const sunday = dayReadings.dayReadingItems(SUNDAY);
  assert.deepEqual(sunday.map((i) => [i.slot, i.kind, i.text, i.group, i.contentType]), [
    [20, 'reading', 'First Reading', 'word', 'scripture'],
    [4, 'reading', 'Responsorial Psalm', 'word', 'scripture'],
    [21, 'reading', 'Second Reading', 'word', 'scripture'],
    [22, 'reading', 'Gospel', 'word', 'scripture'],
  ], 'the Responsorial Psalm row is a song row, but its item is a reading');
  assert.deepEqual(dayReadings.dayReadingItems(WEEKDAY).map((i) => i.slot), [20, 4, 22]);
  assert.deepEqual(sunday.map((i) => i.order), [1, 2, 3, 4]);
  // Names only: no reference, no words in what is sent.
  const sent = JSON.stringify(sunday);
  for (const { citation } of dayReadings.dayReadingsFor(SUNDAY).readings) assert.ok(!sent.includes(citation));
  assert.ok(sunday.every((i) => !('note' in i) && !i.songId));
  // The readiness the editor shows: four slots filled, and the Gospel Acclamation and the Prayer of the Faithful left to the laptop.
  const model2 = { segments: model.massFromItems(sunday, ROWS).segments, notes: {} };
  const fresh = workspace.readiness({ rows: ROWS, ...model2, date: SUNDAY });
  assert.deepEqual(fresh.slots, { done: 4, total: 28 });
  assert.deepEqual([fresh.songs.done, fresh.texts.done], [0, 4], 'a new plan has readings and no songs: the psalm reading is not a song');
  assert.equal(dayReadings.readingStatus(model2.segments, SUNDAY).empty, 0);
  assert.equal(dayReadings.readingStatus({}, SUNDAY).empty, 4);
});

test('creating a Holy Mass from the New Plan card sends the readings; a Praise & Worship plan sends none', async () => {
  const sent = [];
  const create = async (request) => { sent.push(request); return { plan: { id: request.id, items: request.items } }; };
  const base = { name: 'Sample Plan Title', date: SUNDAY, language: 'EN', massTime: '', massLanguage: '' };
  const mass = await form.submitNewPlan({ ...base, kind: 'mass' }, { create });
  assert.ok(mass.plan);
  assert.deepEqual(sent[0].items.map((i) => i.slot), [20, 4, 21, 22]);
  const praise = await form.submitNewPlan({ ...base, kind: 'pw' }, { create });
  assert.ok(praise.plan);
  assert.deepEqual(sent[1].items, []);
  assert.deepEqual(model.newPlanRequest({ ...base, kind: 'mass' }, ids(1)).items, [], 'newPlanRequest alone stays empty');
});

test('Populate day\'s readings fills only empty reading slots, + puts a reading in front of what the slot holds, and another date is a typed reference', () => {
  const psalm = 's4';
  const sung = '60000000-0000-4000-8000-000000000001';
  let segments = model.withEntry({}, psalm, { songId: sung, contentType: 'song' });
  segments = model.withEntry(segments, 's22', { text: 'Sample Slot Note' });
  const outcome = dayReadings.withDayReadings(segments, SUNDAY);
  assert.deepEqual(outcome.filled, ['s20', 's21'], 'the slots that were empty');
  assert.deepEqual(outcome.kept, ['s4', 's22'], 'a sung psalm and a typed note are the operator\'s own choice');
  assert.deepEqual(model.slotEntries(outcome.segments.s4).map((e) => e.songId), [sung]);
  // Again: nothing to do.
  const again = dayReadings.withDayReadings(outcome.segments, SUNDAY);
  assert.deepEqual([again.filled, again.current], [[], ['s20', 's21']]);
  assert.equal(again.segments, outcome.segments);
  assert.deepEqual(dayReadings.withDayReadings({}, WEEKDAY).missing, ['Second Reading']);

  // + puts the reading first and keeps the sung psalm after it; pressed again it does not add a second one.
  const reading = dayReadings.dayReadingsFor(SUNDAY).readings.find((r) => r.type === 'Responsorial Psalm');
  const added = dayReadings.withReading(segments, reading, SUNDAY, SUNDAY);
  assert.deepEqual(model.slotEntries(added.s4).map((e) => e.songId ?? e.text), ['Responsorial Psalm', sung]);
  assert.deepEqual(model.slotEntries(dayReadings.withReading(added, reading, SUNDAY, SUNDAY).s4).map((e) => e.songId ?? e.text), ['Responsorial Psalm', sung]);
  // From another date: a typed reference with the reading's name and reference, which the laptop keeps as words; never the plan's by-name reading.
  const elsewhere = dayReadings.withReading(segments, dayReadings.dayReadingsFor(WEEKDAY).readings[0], WEEKDAY, SUNDAY);
  assert.match(model.slotEntries(elsewhere.s20)[0].text, /^First Reading: /);
  assert.equal(model.isReadingName(model.slotEntries(elsewhere.s20)[0]), false);
  // The Psalm row saves a reading as a reading, the Gospel Acclamation row never does.
  const items = model.massToItems({ segments: added, notes: {}, extra: [], contentHubItems: [] }, ROWS);
  assert.deepEqual(items.filter((i) => i.slot === 4).map((i) => [i.kind, i.text ?? null, i.songId ?? null]), [['reading', 'Responsorial Psalm', null], ['song', null, sung]]);
});

test('the Lectionary tab: Populate, Search, the DATE picker, and READING cards with the day and reference and a + for each', () => {
  const day = dayReadings.dayReadingsFor(SUNDAY);
  const html = workspace.lectionaryPanelHtml({ date: SUNDAY, planDate: SUNDAY, dayName: day.day.name, readings: day.readings, held: new Set(['Gospel']), empty: 3 });
  assert.match(html, /data-populate-readings>Populate day's readings \(3 empty\)<\/button>/);
  assert.match(html, /<input type="search" data-lect-search[^>]*placeholder="Search"/);
  assert.match(html, /<span>Date<\/span>\s*<input type="date" data-lect-date[^>]*value="2026-11-08"/);
  assert.equal(html.match(/<span class="lp-reading-badge">Reading<\/span>/g).length, 4);
  assert.match(html, /<strong>First Reading<\/strong><span>32nd Sunday in Ordinary Time · Wis 6:12-16<\/span>/);
  assert.match(html, /data-lib-reading="Gospel" aria-pressed="true"[^>]*>✓</);
  assert.match(html, /data-lib-reading="First Reading" aria-pressed="false"[^>]*>\+</);
  assert.doesNotMatch(html, /data-lect-today/, 'on the plan\'s own date');
  // Another date says why its readings are typed references, and offers the way back.
  const other = workspace.lectionaryPanelHtml({ date: WEEKDAY, planDate: SUNDAY, dayName: 'Sample Liturgical Day', readings: dayReadings.dayReadingsFor(WEEKDAY).readings, held: new Set(['Gospel']) });
  assert.match(other, /typed reference/);
  assert.match(other, /data-lect-today/);
  assert.match(other, /data-lib-reading="Gospel" aria-pressed="false"/, 'held only counts on the plan\'s date');
  // Search: reading title, liturgical day, reference; the title in the plan's language too.
  const rs = day.readings;
  const names = (q, titleOf) => workspace.filterReadings(rs, day.day.name, q, titleOf).map((r) => r.type);
  assert.deepEqual(names('gospel'), ['Gospel']);
  assert.deepEqual(names('Wis 6'), ['First Reading']);
  assert.deepEqual(names('32nd').length, 4);
  assert.deepEqual(names('salmo', (t) => (t === 'Responsorial Psalm' ? 'Salmong Tugunan' : t)), ['Responsorial Psalm']);
  assert.deepEqual(names('no such reading'), []);
  assert.match(workspace.lectionaryPanelHtml({ date: SUNDAY, planDate: SUNDAY, readings: [], query: '' }), /The Ordo has no readings for this date\./);
  // The tab sits right after Songs, and a reading card is escaped.
  assert.deepEqual(workspace.LIBRARY_TABS.map((t) => t.label), ['Songs', 'Lectionary', 'Prayers', 'Scripture', 'Notes & Cues', 'Templates']);
  assert.match(workspace.lectionaryPanelHtml({ date: SUNDAY, planDate: SUNDAY, dayName: 'Sample <Day>', readings: day.readings }), /Sample &lt;Day&gt; · Wis/);
});

test('a reading slot shows a gold badge, its title and reference with Edit and Clear, and the Sunday and Optional condition badges', () => {
  const rows = model.massSections(MASS_PLAN).flatMap((s) => s.rows).filter((r) => r.slot);
  const flags = Object.fromEntries(rows.map((r) => [r.slot, [r.sundayOnly, r.optional]]));
  // The laptop's own flags (shared/mass-slots.js) are what the badges and the slot counts follow: the Gloria and the Second Reading.
  assert.deepEqual([18, 21].map((n) => flags[n]), [[true, false], [true, false]], 'Gloria and Second Reading');
  assert.deepEqual(flags[24], [false, false], 'the Creed carries no condition on the laptop');
  assert.deepEqual(flags[23], [false, true], 'the Homily');
  assert.deepEqual(rows.filter((r) => r.sundayOnly).map((r) => r.slot), [18, 21]);
  assert.deepEqual(rows.filter((r) => r.optional).map((r) => r.slot), [23, 25, 27], 'Homily, Sign of Peace, Announcements');

  const entry = { index: 0, songId: null, title: 'First Reading', source: 'text', contentType: 'scripture', key: '' };
  const row = { ...rowOfSlot(20), name: 'Sample Reading Title', english: 'First Reading', entries: [entry] };
  const html = workspace.slotRowHtml(row, { readingLabel: () => 'Sample Reading Title', referenceOf: () => 'Sample Liturgical Day · Sample Scripture Ref' });
  assert.match(html, /class="lp-slot is-reading"/);
  assert.match(html, /<span class="lp-slot-name">Sample Reading Title<\/span><\/span>/, 'the First Reading has no condition');
  assert.match(workspace.slotRowHtml({ ...rowOfSlot(21), name: 'Second Reading', entries: [] }), /<span class="lp-slot-name">Second Reading<\/span><span class="lp-cond">Sundays &amp; Solemnities<\/span>/);
  assert.match(workspace.slotRowHtml({ ...rowOfSlot(18), name: 'Glory to God (Gloria)', entries: [] }), /lp-cond">Sundays &amp; Solemnities/);
  assert.match(html, /<strong class="lp-reading-title">Sample Reading Title<\/strong><span class="lp-reading-ref">Sample Liturgical Day · Sample Scripture Ref<\/span>/);
  assert.match(html, /data-open-row="s20"[^>]*aria-label="Edit reference or note: Sample Reading Title"/);
  assert.match(html, /data-remove-entry="0" data-for="s20" aria-label="Clear Sample Reading Title"/);
  assert.match(html, /data-open-row="s20" aria-expanded="false"><span aria-hidden="true">\+<\/span> Add item/);
  const homily = workspace.slotRowHtml({ ...rowOfSlot(23), name: 'Homily', entries: [] });
  assert.match(homily, /<span class="lp-cond">Optional<\/span>/);
  assert.doesNotMatch(homily, /Sundays/);
  // A sung psalm beside the reading keeps its own pill; a typed reference is a plain pill, not a reading.
  const both = workspace.slotRowHtml({ ...rowOfSlot(4), name: 'Responsorial Psalm', entries: [{ ...entry, title: 'Responsorial Psalm' }, { index: 1, songId: SONG_ENTRANCE, title: 'Sample Song Title', source: 'list', key: 'D' }] });
  assert.match(both, /lp-reading-title">Responsorial Psalm/);
  assert.match(both, /class="lp-pill is-list"/);
  assert.doesNotMatch(workspace.slotRowHtml({ ...rowOfSlot(20), name: 'First Reading', entries: [{ ...entry, title: 'First Reading: Sample Scripture Ref' }] }), /lp-reading-title/);
  // The banner offers Populate while a reading slot is empty.
  const ready = workspace.readiness({ rows: ROWS, segments: {}, notes: {}, date: SUNDAY });
  assert.match(workspace.readinessBannerHtml(ready, { populate: true }), /data-populate-readings>Populate day's readings</);
  assert.doesNotMatch(workspace.readinessBannerHtml(ready), /data-populate-readings/);
});

test('a reading read back from the laptop without its type is still the day\'s reading, and the Responsorial Psalm saves as a reading', () => {
  const fromLaptop = [
    { key: 'h1', group: 'word', order: 1, kind: 'reading', text: 'Responsorial Psalm', slot: 4 },
    { key: 'h2', group: 'word', order: 2, kind: 'reading', text: 'Gospel', slot: 22 },
  ];
  const state = model.massFromItems(fromLaptop, ROWS);
  assert.equal(model.slotEntries(state.segments.s4)[0].contentType, 'scripture');
  assert.equal(model.isReadingName(model.slotEntries(state.segments.s4)[0]), true);
  const back = model.massToItems({ ...state, contentHubItems: [] }, ROWS);
  assert.deepEqual(back.map((i) => [i.key, i.slot, i.kind, i.text]), [['h1', 4, 'reading', 'Responsorial Psalm'], ['h2', 22, 'reading', 'Gospel']], 'keys are kept: no duplicate');
  // A song in the Psalm row is still a song, and typed text there keeps the song row's kind, as before.
  assert.equal(model.massToItems({ segments: model.withEntry({}, 's4', { songId: SONG_ENTRANCE, contentType: 'song' }), notes: {}, extra: [], contentHubItems: [] }, ROWS)[0].kind, 'song');
  assert.equal(model.massToItems({ segments: model.withEntry({}, 's4', { text: 'Sample Slot Note' }), notes: {}, extra: [], contentHubItems: [] }, ROWS)[0].kind, 'song');
  assert.doesNotMatch(readWeb('js/day-readings.js') + readWeb('js/mass-workspace.js'), /rawText|raw_text|lyrics\s*[:=]/);
});

test('the Lectionary tab and the reading rows are wired in the page', () => {
  const page = readWeb('js/mass.js');
  assert.match(page, /data-lib-reading|data\.libReading/);
  assert.match(page, /if \(id !== 'clear'\) next\.segments = withDayReadings\(next\.segments, plan\.date\)\.segments;/, 'Standard and Weekday keep the day\'s readings');
  assert.match(page, /const tabs = \['songs', 'lectionary', 'cues', 'templates'\];/);
  assert.match(page, /readingLabel,\s*referenceOf,/);
  assert.match(page, /populate: canEdit && status\.empty > 0/);
});

// ---- Prayers and Scripture ----

const ps = await load('web', 'js', 'prayer-scripture.js');
// slot-ui.js imports the page shell, which listens on the document when it loads: a stub with nothing in it is all the markup builders need.
globalThis.document ??= { addEventListener() {}, querySelectorAll: () => [], documentElement: { dataset: {} } };
const slotUi = await load('web', 'js', 'slot-ui.js');
const laptopParts = await load('shared', 'mass-parts.js');
const laptopBibleRef = await load('shared', 'bible-ref.js');
const laptopWebRef = await load('shared', 'bible-web-ref.js');
const { checkItems } = await load('server', 'lib', 'plan-sync.js');
const { MASS_PLAN: SAMPLE_MASS } = await load('web', 'js', 'sample-data.js');
const PS_ROWS = model.massRows(SAMPLE_MASS);

test('the Prayers catalog names slots by id, and a prayer with a Holy Mass Order part carries exactly the laptop name for it', () => {
  const slotIds = new Set(webSlots.MASS_SLOTS.map((s) => s.id));
  const laptopIds = new Set(laptopSlots.MASS_SLOTS.map((s) => s.id));
  for (const prayer of ps.PRAYER_CATALOG) {
    if (prayer.slotId) assert.ok(slotIds.has(prayer.slotId) && laptopIds.has(prayer.slotId), `${prayer.id} names a real slot`);
    if (prayer.part) assert.equal(prayer.title, laptopParts.MASS_PARTS[prayer.part], `${prayer.id} is the laptop's ${prayer.part}`);
  }
  assert.equal(new Set(ps.PRAYER_CATALOG.map((p) => p.id)).size, ps.PRAYER_CATALOG.length);
  // The numbers are the laptop's own: Confiteor 2, Kyrie 3, Gloria 18, Creed 24, Prayer of the Faithful 6, Sanctus 9, Our Father 12, Lamb of God 14.
  const numberOf = (prayerId) => PS_ROWS.find((r) => r.massSlotId === ps.PRAYER_CATALOG.find((p) => p.id === prayerId).slotId).slot;
  assert.deepEqual(['confiteor', 'kyrie', 'gloria', 'apostles-creed', 'prayer-faithful', 'sanctus', 'lords-prayer', 'agnus-dei'].map(numberOf), [2, 3, 18, 24, 6, 9, 12, 14]);
  // Titles and search only: no prayer words are in the catalog.
  assert.ok(ps.PRAYER_CATALOG.every((p) => Object.keys(p).every((k) => ['id', 'title', 'slotId', 'part', 'group'].includes(k))));
});

test('a prayer goes to the target slot, else to its own Holy Mass slot, and a devotional prayer needs a slot', () => {
  const gloria = ps.PRAYER_CATALOG.find((p) => p.id === 'gloria');
  assert.equal(ps.slotForPrayer(gloria, PS_ROWS), 's18', 'auto-matched');
  assert.equal(ps.slotForPrayer(gloria, PS_ROWS, 's1'), 's1', 'the target wins');
  assert.equal(ps.slotForPrayer(gloria, PS_ROWS, 'nope'), 's18', 'an unknown target is ignored');
  const hail = ps.PRAYER_CATALOG.find((p) => p.id === 'hail-mary');
  assert.equal(ps.slotForPrayer(hail, PS_ROWS), null);
  assert.equal(ps.slotForPrayer(hail, PS_ROWS, 's1'), 's1');
  assert.deepEqual(ps.filterPrayers('lamb').map((p) => p.id), ['agnus-dei']);
  assert.ok(ps.filterPrayers('', 'devotional').every((p) => p.group === 'devotional'));
  assert.deepEqual(ps.filterPrayers('zzz'), []);
});

test('the Scripture builder makes one reference form, which the laptop reads back, with the versions the laptop Bible has', () => {
  assert.deepEqual(ps.SCRIPTURE_VERSIONS.map((v) => v.id), laptopBibleRef.BIBLE_TRANSLATION_IDS);
  assert.deepEqual(ps.buildScripture({ book: 'Sample Book', chapter: 3, verses: '1-6', version: 'WEB' }), { text: 'Sample Book 3:1-6 (WEB)', reference: 'Sample Book 3:1-6', version: 'WEB' });
  assert.equal(ps.buildScripture({ book: 'Sample Book', chapter: '2', verses: '16', version: 'tgl' }).text, 'Sample Book 2:16 (TGL)');
  assert.equal(ps.buildScripture({ book: '', chapter: 1, verses: '1' }).error, 'Choose a book.');
  assert.match(ps.buildScripture({ book: 'Sample Book', chapter: 0, verses: '1' }).error, /chapter/);
  assert.match(ps.buildScripture({ book: 'Sample Book', chapter: 1, verses: '6-1' }).error, /after the first/);
  assert.match(ps.buildScripture({ book: 'Sample Book', chapter: 1, verses: 'x' }).error, /verse/);
  assert.match(ps.buildScripture({ book: 'Sample Book', chapter: 1, verses: '1', version: 'NIV' }).error, /version/, 'a copyrighted version the laptop does not have is not offered');
  // Typed references, with or without a version.
  assert.equal(ps.scriptureFromTyped('Sample Book 1:1-6').text, 'Sample Book 1:1-6 (WEB)');
  assert.equal(ps.scriptureFromTyped('Sample Book 1:1-6 (CEB)').text, 'Sample Book 1:1-6 (CEB)');
  assert.match(ps.scriptureFromTyped('not a reference').error, /Type a reference/);
  // The website and the laptop read every reference the same way.
  for (const text of ['Sample Book 1:1-6 (WEB)', '1 Sample Book 12:4 (TGL)', 'Sample Book 3:16']) {
    const web = ps.parseScripture(text);
    const laptop = laptopWebRef.parseWebReference(text);
    assert.deepEqual([web.book, web.chapter, web.version], [laptop.book, laptop.chapter, laptop.translationId], text);
    assert.equal(laptopWebRef.webReferenceText(laptop), text);
  }
  // Every book it offers is one the laptop Bible knows by name.
  assert.equal(ps.SCRIPTURE_BOOKS.length, 73);
  for (const book of ps.SCRIPTURE_BOOKS) assert.ok(laptopBibleRef.resolveBookCode(book.name), `${book.name} is a book the laptop knows`);
  assert.equal(new Set(ps.SCRIPTURE_BOOKS.map((b) => laptopBibleRef.resolveBookCode(b.name))).size, 73, 'each book is a different one');
});

test('prayers and Scripture saved from the editor are items the server accepts, on any kind of slot, and read back with their badges', () => {
  const state = { ...model.massFromItems([], PS_ROWS), contentHubItems: [] };
  state.segments = model.withEntry(state.segments, 's18', ps.prayerEntry(ps.PRAYER_CATALOG.find((p) => p.id === 'gloria')));
  state.segments = model.withEntry(state.segments, 's2', ps.prayerEntry(ps.PRAYER_CATALOG.find((p) => p.id === 'confiteor')));
  state.segments = model.withEntry(state.segments, 's3', ps.prayerEntry(ps.PRAYER_CATALOG.find((p) => p.id === 'kyrie')));
  state.segments = model.withEntry(state.segments, 's2', ps.scriptureEntry('Sample Book 3:1-6 (WEB)'));
  state.segments = model.withEntry(state.segments, 's1', ps.scriptureEntry('Sample Book 1:1 (CEB)'));
  const items = model.massToItems(state, PS_ROWS);
  const bySlot = (n) => items.filter((i) => i.slot === n);
  assert.deepEqual([bySlot(18)[0].kind, bySlot(18)[0].text, bySlot(18)[0].contentType], ['rite', 'Gloria', 'prayer']);
  assert.deepEqual(bySlot(2).map((i) => [i.kind, i.text, i.contentType]), [['rite', 'I Confess (Confiteor)', 'prayer'], ['reading', 'Sample Book 3:1-6 (WEB)', 'scripture']]);
  assert.deepEqual([bySlot(3)[0].kind, bySlot(3)[0].contentType], ['rite', 'prayer'], 'a prayer on a song slot is never a song');
  assert.deepEqual([bySlot(1)[0].kind, bySlot(1)[0].contentType], ['reading', 'scripture'], 'a reference on a song slot is a reading');
  // The server takes every one of them, and a prayer type on a song is still refused.
  assert.doesNotThrow(() => checkItems(items, new Set()));
  assert.throws(() => checkItems([{ key: 'a', group: 'word', order: 1, kind: 'song', text: 'Sample Prayer Title', contentType: 'prayer' }], new Set()));
  assert.throws(() => checkItems([{ key: 'a', group: 'word', order: 1, kind: 'rite', text: 'Sample Scripture Ref', contentType: 'scripture' }], new Set()), 'a reference is always a reading');
  // Read back: the same entries, badged, one per place.
  const back = model.massFromItems(items, PS_ROWS);
  const described = model.describeEntries(back.segments.s2, [], []);
  assert.deepEqual(described.map((e) => [e.title, e.badge]), [['I Confess (Confiteor)', 'prayer'], ['Sample Book 3:1-6 (WEB)', 'scripture']]);
  assert.deepEqual(model.massToItems({ ...back, contentHubItems: [] }, PS_ROWS).map((i) => [i.key, i.slot, i.text, i.contentType]), items.map((i) => [i.key, i.slot, i.text, i.contentType]), 'saving again changes nothing');
});

test('an item the laptop sent back with no type is still told apart: a Holy Mass part name is a prayer, a reference with a version is Scripture', () => {
  assert.equal(ps.entryBadge({ text: 'Gloria' }), 'prayer');
  assert.equal(ps.entryBadge({ text: 'Gloria', contentType: 'text_note' }), 'prayer');
  assert.equal(ps.entryBadge({ text: 'Sample Book 1:1-6 (WEB)' }), 'scripture');
  assert.equal(ps.entryBadge({ text: 'Sample Book 1:1-6' }), '', 'a bare reference is left as the typed text it is');
  assert.equal(ps.entryBadge({ text: 'Sample Note' }), '');
  assert.equal(ps.entryBadge({ songId: 'x', text: 'Gloria' }), '');
  assert.equal(ps.entryBadge({ contentHubId: 'h', contentType: 'hub_item', text: 'Gloria' }), '');
});

test('a slot shows its prayers and Scripture with PRAYER and SCRIPTURE badges, language tags, reorder and remove', () => {
  let segments = {};
  segments = model.withEntry(segments, 's2', ps.prayerEntry(ps.PRAYER_CATALOG.find((p) => p.id === 'confiteor')));
  segments = model.withEntry(segments, 's2', ps.scriptureEntry('Sample Book 3:1-6 (TGL)'));
  const row = { ...PS_ROWS.find((r) => r.id === 's2'), english: 'x', entries: model.describeEntries(segments.s2, [], []) };
  const html = workspace.slotRowHtml(row, { canEdit: true, language: 'CEB' });
  assert.match(html, /<span class="lp-kind-badge is-prayer">Prayer<\/span><span class="lp-lang-tag">CEB<\/span><span class="lp-pill-title">I Confess \(Confiteor\)/);
  assert.match(html, /<span class="lp-kind-badge is-scripture">Scripture<\/span><span class="lp-lang-tag">TL<\/span><span class="lp-pill-title">Sample Book 3:1-6 \(TGL\)/, 'a reference shows the language of its version');
  assert.match(html, /data-move-entry="0" data-delta="1"/);
  assert.match(html, /data-move-entry="1" data-delta="-1"/);
  assert.equal((html.match(/data-remove-entry/g) ?? []).length, 2);
  // Typed words are escaped, and a plain note keeps its own look with no badge.
  const note = workspace.slotRowHtml({ ...row, entries: [{ index: 0, source: 'text', title: '<b>Sample Note</b>', badge: '' }] }, { canEdit: true });
  assert.ok(!note.includes('lp-kind-badge') && note.includes('&lt;b&gt;Sample Note'));
  // The slot panel and the Praise & Worship summary use the same badges.
  assert.match(slotUi.entryListHtml(row.entries, 's2', true), /lp-kind-badge is-prayer/);
  assert.match(slotUi.entrySummaryHtml(row.entries), /lp-kind-badge is-scripture/);
  assert.ok(!slotUi.entrySummaryHtml(row.entries).includes('lp-lang-tag">CEB'), 'a plan with no language shows none');
});

test('the Prayers and Scripture tabs: search, groups, + on each card, the reference builder, and a held prayer shown as added', () => {
  const html = ps.prayersPanelHtml({ query: '', group: 'mass', held: new Set(['gloria']), planLanguage: 'EN', slotNameOf: (id) => `Slot ${id}` });
  assert.match(html, /data-prayer-search/);
  assert.match(html, /data-prayer-group="devotional"/);
  assert.match(html, /data-lib-prayer="gloria" aria-pressed="true"[^>]*>✓<\/button>/);
  assert.match(html, /data-lib-prayer="kyrie" aria-pressed="false"[^>]*>\+<\/button>/);
  assert.ok(!html.includes('data-lib-prayer="hail-mary"'), 'the Holy Mass group leaves the devotional prayers out');
  assert.match(html, /Goes to Slot confess/);
  assert.match(ps.prayersPanelHtml({ query: 'zzz' }), /No prayers match/);
  assert.match(ps.prayersPanelHtml({ into: 's5' }), /data-lib-prayer="confiteor" data-into="s5"/, 'inside a slot the + names its slot');
  assert.match(ps.prayersPanelHtml({ canEdit: false }), /data-lib-prayer="confiteor"[^>]*disabled/);

  const sf = ps.scripturePanelHtml({ draft: { book: 'John', chapter: '3', verses: '16-17', version: 'TGL' }, into: 's5' });
  assert.match(sf, /<option value="John" selected>/);
  assert.match(sf, /<optgroup label="Old Testament">[\s\S]*<optgroup label="New Testament">/);
  assert.match(sf, /data-sf-version="TGL" aria-pressed="true"/);
  assert.match(sf, /data-sf-version="WEB" aria-pressed="false"/);
  assert.match(sf, /Adds <strong>John 3:16-17 \(TGL\)<\/strong>/);
  assert.match(sf, /data-add-scripture data-into="s5"/);
  assert.match(ps.scripturePanelHtml({ draft: {} }), /data-sf-preview hidden/);
  assert.match(ps.scripturePanelHtml({ error: 'Choose a book.' }), /role="alert" data-sf-error>Choose a book\./);
  assert.match(ps.scripturePanelHtml({ draft: { typed: '<b>' } }), /value="&lt;b&gt;"/, 'typed text is escaped');
  assert.equal(ps.scripturePreview({ typed: 'Sample Book 4:2 (CEB)', version: 'WEB' }), 'Sample Book 4:2 (CEB)', 'a typed reference wins over the fields');
});

test('Praise & Worship saves a prayer and a reference as items the server accepts, on every kind of segment', () => {
  const segs = model.praiseSegments(model.PRAISE_TEMPLATE);
  const state = { ...model.praiseFromItems([], segs), contentHubItems: [] };
  const pray = segs.find((s) => s.kind === 'rite');
  const song = segs.find((s) => s.kind === 'song');
  const reading = segs.find((s) => s.kind === 'reading');
  state.segments = model.withEntry(state.segments, pray.id, ps.prayerEntry(ps.PRAYER_CATALOG.find((p) => p.id === 'hail-mary')));
  state.segments = model.withEntry(state.segments, song.id, ps.prayerEntry(ps.PRAYER_CATALOG.find((p) => p.id === 'angelus')));
  state.segments = model.withEntry(state.segments, reading.id, ps.scriptureEntry('Sample Book 2:1-3 (WEB)'));
  state.segments = model.withEntry(state.segments, pray.id, ps.scriptureEntry('Sample Book 5:5 (CEB)'));
  const items = model.praiseToItems(state, segs);
  const of = (id) => items.filter((i) => i.slotId === id);
  assert.deepEqual(of(pray.id).map((i) => [i.kind, i.text, i.contentType]), [['rite', 'Hail Mary', 'prayer'], ['reading', 'Sample Book 5:5 (CEB)', 'scripture']]);
  assert.deepEqual([of(song.id)[0].kind, of(song.id)[0].contentType], ['rite', 'prayer']);
  assert.deepEqual([of(reading.id)[0].kind, of(reading.id)[0].contentType], ['reading', 'scripture']);
  assert.doesNotThrow(() => checkItems(items, new Set()));
  const back = model.praiseFromItems(items, segs);
  assert.deepEqual(model.describeEntries(back.segments[pray.id], [], []).map((e) => e.badge), ['prayer', 'scripture']);
  assert.deepEqual(model.praiseToItems({ ...back, contentHubItems: [] }, segs).map((i) => [i.key, i.text, i.contentType]), items.map((i) => [i.key, i.text, i.contentType]));
});

test('laptop items that fill no slot (an unslotted Bible passage or prayer) are listed as "Also in this plan", with badges, and kept on save', () => {
  const items = [
    { key: 'hbible0001', group: 'word', order: 1, kind: 'reading', text: 'Sample Book 3:1-6 (WEB)', contentType: 'scripture' },
    { key: 'hprayer001', group: 'word', order: 2, kind: 'rite', text: 'Sample Prayer Title', contentType: 'prayer' },
  ];
  const filled = model.massFromItems(items, PS_ROWS);
  assert.equal(filled.extra.length, 2, 'they fill no slot');
  const entries = filled.extra.flatMap((item) => model.describeEntries(item, [], []));
  const html = ps.extraItemsHtml(entries, 'EN');
  assert.match(html, /Also in this plan/);
  assert.match(html, /lp-kind-badge is-scripture">Scripture<\/span><span class="lp-lang-tag">EN<\/span><span class="lp-pill-title">Sample Book 3:1-6 \(WEB\)/);
  assert.match(html, /lp-kind-badge is-prayer">Prayer<\/span>[\s\S]*Sample Prayer Title/);
  assert.equal(ps.extraItemsHtml([]), '', 'nothing is drawn when there are none');
  // Saving the plan sends them back as they were.
  const saved = model.massToItems({ ...filled, contentHubItems: [] }, PS_ROWS);
  assert.deepEqual(saved.map((i) => [i.key, i.text, i.contentType]), items.map((i) => [i.key, i.text, i.contentType]));
});

// ---- The Praise & Worship Library + LINEUP ----

const pwWork = await load('web', 'js', 'praise-workspace.js');
const lineup = await load('web', 'js', 'praise-lineup.js');
const PW_SONG = { id: '40000000-0000-4000-8000-000000000001', title: 'Sample Song Title', category: 'Joyful / Fast Praise', language: 'English', key: 'G' };
const escRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('the Praise & Worship page is the two-column Library + LINEUP, and every id its script looks up is on the page', () => {
  const html = readWeb('plan/praise.html');
  const js = readWeb('js/praise.js');
  for (const id of [...js.matchAll(/getElementById\('([a-z-]+)'\)/g)].map((m) => m[1])) assert.match(html, new RegExp(`id="${id}"`), `${id} is on the page`);
  assert.match(html, /class="lp-workspace pw-workspace"/);
  assert.match(html, /<h2 class="pw-lib-title">Library<\/h2>/);
  assert.match(html, /id="browse-library"/, 'a jump to the Library for phones and tablets');
  for (const id of ['duplicate', 'discard', 'save', 'plan-title', 'date-badge']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /aria-keyshortcuts="Control\+S Meta\+S"/);
  // The grid is two columns from 1024px wide (about 380px for the Library) and one column below it.
  const css = readWeb('css/planner.css');
  assert.match(css, /@media \(min-width: 1024px\) \{\s*\.pw-workspace \{\s*grid-template-columns: minmax\(320px, 380px\) minmax\(0, 1fr\);/);
});

test('the Library: Songs, Prayers (with its count) and Scripture tabs, the gold target pill, and INSERT INTO SEGMENT / ADD SELECTED', () => {
  const tabs = pwWork.pwTabsHtml('prayers', { prayers: 26 });
  assert.deepEqual([...tabs.matchAll(/data-lib-tab="(\w+)"/g)].map((m) => m[1]), ['songs', 'prayers', 'scripture']);
  assert.match(tabs, /pw-tab is-on" data-lib-tab="prayers">Prayers<span class="pw-tab-count">26<\/span>/);
  assert.equal(pwWork.pwTabOf('nonsense'), 'songs');
  assert.match(pwWork.pwTargetPillHtml({ n: 1, name: 'Sample Segment Title' }), /Adds to segment 01 · <strong>Sample Segment Title<\/strong>/);
  assert.match(pwWork.pwTargetPillHtml({ n: 2, name: '<b>x</b>' }), /&lt;b&gt;x&lt;\/b&gt;/, 'escaped');
  assert.match(pwWork.pwTargetPillHtml(null), /Pick a segment/);
  const bar = pwWork.pwActionBarHtml({ hasPick: true, hasTarget: true });
  assert.match(bar, /data-pw-insert>Insert into segment/);
  assert.match(bar, /data-pw-add-selected>Add selected/);
  assert.match(pwWork.pwActionBarHtml({ hasPick: false, hasTarget: true }), /data-pw-insert disabled>[\s\S]*data-pw-add-selected disabled>/, 'nothing highlighted: both wait');
  assert.match(pwWork.pwActionBarHtml({ hasPick: true, hasTarget: false }), /data-pw-insert disabled>[\s\S]*data-pw-add-selected>/, 'no target: only ADD SELECTED, which makes its own segment');
  assert.match(pwWork.pwActionBarHtml({ hasPick: true, hasTarget: true, canEdit: false }), /data-pw-insert disabled>[\s\S]*data-pw-add-selected disabled>/, 'a viewer cannot add');
  assert.match(pwWork.pwSearchHtml('', 'songs'), /placeholder="Search title, category, composer"/);
});

test('the Library cards: songs and prayers have ADD (no LIVE), a held card says Added, and the picked card is highlighted', () => {
  const songs = pwWork.pwSongCardsHtml([PW_SONG], { picked: `song:${PW_SONG.id}`, held: new Set(), songs: [PW_SONG] });
  assert.match(songs, /pw-card is-picked" data-pw-pick="song:40000000-0000-4000-8000-000000000001"/);
  assert.match(songs, /data-pw-add-song="40000000-[\w-]+" aria-pressed="false"[^>]*>Add<\/button>/);
  assert.match(songs, /Sample Song Title/);
  assert.doesNotMatch(songs, /LIVE|Live/);
  assert.match(pwWork.pwSongCardsHtml([PW_SONG], { held: new Set([PW_SONG.id]), songs: [PW_SONG] }), /pw-card is-added[\s\S]*aria-pressed="true"[^>]*>Added</);
  assert.match(pwWork.pwSongCardsHtml([], { songs: [] }), /No songs yet/);
  assert.match(pwWork.pwSongCardsHtml([], { songs: [PW_SONG] }), /No songs match/);
  const prayers = pwWork.pwPrayerCardsHtml({});
  assert.equal([...prayers.matchAll(/data-pw-add-prayer="/g)].length, ps.PRAYER_CATALOG.length, 'every prayer of the catalog is listed');
  assert.match(prayers, /Liturgical Prayer/);
  assert.match(prayers, /Community Prayer/);
  const first = ps.PRAYER_CATALOG[0];
  assert.match(pwWork.pwPrayerCardsHtml({ held: new Set([first.title.toLowerCase()]) }), new RegExp(`data-pw-add-prayer="${first.id}" aria-pressed="true"`));
  assert.match(pwWork.pwPrayerCardsHtml({ query: 'zzzz-no-such-prayer' }), /No prayers match/);
  assert.ok([...pwWork.pwPrayerCardsHtml({ query: first.title.slice(0, 5) }).matchAll(/data-pw-add-prayer="/g)].length >= 1, 'the search narrows by title');
});

test("the Scripture tab builds a citation (book across both testaments, chapter, verses, version) with INSERT INTO SEGMENT and ADD AS NEW SEGMENT; only the laptop's Bibles are offered", () => {
  const html = ps.scripturePanelHtml({ draft: { book: 'Sample Book', chapter: '3', verses: '1-6', version: 'WEB', title: 'Sample Segment Title' }, newSegment: true });
  assert.match(html, /<optgroup label="Old Testament">/);
  assert.match(html, /<optgroup label="New Testament">/);
  assert.match(html, /data-sf="chapter"/);
  assert.match(html, /data-sf="verses"/);
  assert.match(html, /data-sf="title"[^>]*value="Sample Segment Title"/, 'the optional display title');
  assert.match(html, /data-add-scripture[^>]*>Insert into segment</);
  assert.match(html, /data-add-scripture-new[^>]*>Add as new segment</);
  assert.deepEqual([...html.matchAll(/data-sf-version="(\w+)"/g)].map((m) => m[1]), ['WEB', 'TGL', 'CEB'], 'a version the laptop has no Bible for would only reach it as words');
  // The Holy Mass library's single button is unchanged.
  const mass = ps.scripturePanelHtml({ draft: {} });
  assert.match(mass, />Add Scripture</);
  assert.doesNotMatch(mass, /data-add-scripture-new/);
});

function pwSections(segs, state, songs = [PW_SONG]) {
  return lineup.templateFor(segs).sections.map((section) => {
    const rows = segs.filter((s) => s.group === section.group).map((s) => model.praiseRow(s, state, songs));
    return { group: section.group, title: section.title, rows, minutes: rows.reduce((n, r) => n + r.minutes, 0) };
  });
}

test('the LINEUP: sections with their minutes, numbered rows, the status of each, the target highlighted, Edit and Delete', () => {
  const { segs } = lineup.lineupFromPlan([]);
  const prayer = ps.PRAYER_CATALOG[0];
  const state = { segments: model.withEntry(model.withEntry({}, 'marian_song', { songId: PW_SONG.id, contentType: 'song' }), 'prayer_authority', ps.prayerEntry(prayer)), notes: {}, extra: [], present: new Set() };
  const sections = pwSections(segs, state);
  assert.deepEqual(sections.map((s) => [s.title, s.minutes]), [['Opening', 15], ['Praise & Worship', 39], ['Word & Offering', 20]]);
  const html = pwWork.pwLineupHtml(sections, (row, first, last) => pwWork.pwRowHtml(row, { active: row.id === 'marian_song', first, last }));
  assert.deepEqual([...html.matchAll(/class="pw-section-title">([^<]+)</g)].map((m) => m[1]), ['Opening', 'Praise &amp; Worship', 'Word &amp; Offering']);
  assert.deepEqual([...html.matchAll(/data-section-minutes="\w+">(\d+) min/g)].map((m) => m[1]), ['15', '39', '20']);
  assert.deepEqual([...html.matchAll(/class="pw-num">(\d\d)</g)].map((m) => m[1]).slice(0, 3), ['01', '02', '03']);
  assert.match(html, /pw-row is-active" data-seg="marian_song"/);
  // Statuses: a prayer waiting, a held prayer and song, a title slide the laptop fills.
  const status = (id) => html.match(new RegExp(`data-seg="${id}"[\\s\\S]*?pw-status is-(\\w+)">([^<]+)<`)).slice(1);
  assert.deepEqual(status('consecration_mary'), ['needs', 'Needs prayer']);
  assert.deepEqual(status('joyful_song'), ['needs', 'Needs song']);
  assert.deepEqual(status('prayer_authority'), ['ready', 'Ready']);
  assert.deepEqual(status('marian_song'), ['ready', 'Ready']);
  assert.deepEqual(status('bible_enthronement'), ['auto', 'Auto']);
  assert.match(html, new RegExp(`${escRe(prayer.title)}</span>`), 'what a ready row holds is its subtitle');
  assert.match(html, /\[Select prayer\]/);
  assert.match(html, /\[Select song\]/);
  assert.match(html, /Title slide/);
  assert.match(html, /data-drag-seg="marian_song"/, 'drag handle');
  assert.match(html, /data-seg-move="prayer_authority" data-delta="-1"[^>]*disabled>/, 'the first segment cannot go up');
  assert.match(html, /data-edit-seg="marian_song"/);
  assert.match(html, /data-delete-seg="marian_song"/);
  assert.match(html, /class="pw-min" data-minutes="marian_song">5 min</);
  // A viewer, and a plan from the earlier layout, cannot restructure.
  assert.match(pwWork.pwRowHtml(sections[0].rows[0], { canEdit: false }), /data-delete-seg[^>]*disabled>/);
  assert.match(pwWork.pwRowHtml(sections[0].rows[1], { structure: false }), /data-delete-seg[^>]*disabled>/);
  assert.doesNotMatch(pwWork.pwRowHtml(sections[0].rows[1], { structure: false }), /data-edit-seg="[^"]+" aria-expanded="false" aria-label="[^"]+" title="Edit" disabled/, 'Edit still works');
  assert.match(pwWork.lineupHeadHtml({ count: 12 }), /pw-count" aria-label="12 segments">12<[\s\S]*\+ Add segment/);
});

test("a segment's name and what it holds are escaped in the LINEUP", () => {
  const built = lineup.buildSegment({ name: '<img src=x onerror=alert(1)>', type: 'prayer' }, []);
  const row = model.praiseRow(built.seg, { segments: { [built.seg.id]: { text: '"><script>x</script>', contentType: 'prayer' } }, notes: {} }, []);
  const html = pwWork.pwRowHtml(row, {});
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('the segment statuses and subtitles', () => {
  const row = (kind, over = {}) => ({ kind, entries: [], note: '', value: '', optional: false, ...over });
  assert.deepEqual(lineup.segmentStatus(row('rite')), { tone: 'needs', label: 'Needs prayer' });
  assert.deepEqual(lineup.segmentStatus(row('song')), { tone: 'needs', label: 'Needs song' });
  assert.deepEqual(lineup.segmentStatus(row('reading')), { tone: 'needs', label: 'Needs reading' });
  assert.deepEqual(lineup.segmentStatus(row('reading', { optional: true })), { tone: 'auto', label: 'Auto' });
  assert.deepEqual(lineup.segmentStatus(row('song', { entries: [{ title: 'Sample Song Title' }] })), { tone: 'ready', label: 'Ready' });
  assert.deepEqual(lineup.segmentStatus(row('rite', { note: 'Sample Musician Cue' })), { tone: 'needs', label: 'Needs prayer' }, 'a cue alone is not an assignment');
  assert.equal(lineup.segmentSubtitle(row('song', { entries: [{ title: 'Sample Song Title' }, { title: 'Sample Prayer Title' }] })), 'Sample Song Title + Sample Prayer Title');
});

test('the lineup: add, rename, move, drag and delete a segment; an earlier layout is left alone', () => {
  let { segs } = lineup.lineupFromPlan([]);
  assert.equal(segs.length, 12);
  assert.deepEqual(lineup.groupOrder(segs), ['opening', 'praise', 'word']);
  // Add: neutral key, the section asked for, at the end of it; a blank or long title and a bad length are refused in words.
  assert.match(lineup.buildSegment({ name: '  ', type: 'song' }, segs).error, /title/);
  assert.match(lineup.buildSegment({ name: 'x'.repeat(81) }, segs).error, /80/);
  assert.match(lineup.buildSegment({ name: 'Sample Segment Title', minutes: 0 }, segs).error, /1 to 60/);
  const built = lineup.buildSegment({ name: ' Sample   Segment Title ', type: 'scripture', group: 'opening', minutes: 4 }, segs);
  assert.equal(built.seg.id, 'seg_1');
  assert.equal(built.seg.name, 'Sample Segment Title');
  assert.equal(built.seg.kind, 'reading');
  assert.equal(built.seg.optional, true, 'a title slide behind it, so never "needs"');
  segs = lineup.withSegmentAdded(segs, built.seg);
  assert.equal(segs.length, 13);
  assert.equal(segs.findIndex((s) => s.id === 'seg_1'), 4, 'the end of Opening');
  assert.deepEqual(segs.map((s) => s.n), segs.map((_, i) => i + 1), 'numbered 1 upward');
  assert.equal(lineup.buildSegment({ name: 'Sample Segment Title' }, segs, ['seg_2']).seg.id, 'seg_3', 'a key an item already has is not reused');
  // Rename: only a segment of its own.
  assert.equal(lineup.withSegmentRenamed(segs, 'seg_1', 'Sample Renamed Segment').find((s) => s.id === 'seg_1').name, 'Sample Renamed Segment');
  assert.equal(lineup.withSegmentRenamed(segs, 'worship', 'Anything').find((s) => s.id === 'worship').name, 'Worship', 'the laptop names its own');
  // Move across a section edge, and swap inside one.
  const down = lineup.withSegmentMoved(segs, 'seg_1', 1);
  assert.equal(down.find((s) => s.id === 'seg_1').group, 'praise');
  assert.equal(down.findIndex((s) => s.id === 'seg_1'), 4);
  const swapped = lineup.withSegmentMoved(segs, 'marian_song', -1);
  assert.deepEqual(swapped.slice(0, 3).map((s) => s.id), ['prayer_authority', 'marian_song', 'consecration_mary']);
  assert.equal(lineup.withSegmentMoved(segs, 'prayer_authority', -1), segs, 'the first stays');
  // Drag: before another segment, in its section.
  const dropped = lineup.withSegmentDropped(segs, 'finale', 'joyful_song', false);
  assert.equal(dropped.find((s) => s.id === 'finale').group, 'praise');
  assert.equal(dropped.findIndex((s) => s.id === 'finale'), dropped.findIndex((s) => s.id === 'joyful_song') - 1);
  assert.equal(lineup.withSegmentDropped(segs, 'finale', 'finale'), segs);
  // Delete, and put back.
  const fewer = lineup.withoutSegment(segs, 'finale');
  assert.equal(fewer.length, 12);
  assert.equal(lineup.withSegmentRestored(fewer, 'finale').length, 13);
  assert.equal(lineup.withSegmentRestored(segs, 'finale'), segs, 'already there');
  // An earlier layout is left alone.
  const earlier = [{ key: '2', group: 'opening', order: 1, kind: 'song', minutes: 5 }];
  assert.equal(lineup.lineupFromPlan(earlier).template, model.PRAISE_TEMPLATE);
  assert.equal(lineup.lineupFromPlan(earlier).segs.length, 12);
});

test("a plan opens as it was saved: segments in their saved order and section, a laptop segment taken out is offered back, and the laptop's own cards show as segments", () => {
  const items = [
    { key: 'worship', group: 'praise', order: 1, kind: 'song', minutes: 15 },
    { key: 'seg_1', slotId: 'seg_1', group: 'opening', order: 2, kind: 'rite', text: 'Sample Prayer Title', contentType: 'prayer', title: 'Sample Segment Title', minutes: 4 },
    { key: 'custom_abc123', group: 'word', order: 3, kind: 'reading', minutes: 2 },
    { key: 'seg_2.2', slotId: 'seg_2', group: 'praise', order: 4, kind: 'song', songId: '40000000-0000-4000-8000-000000000001' },
    { key: 'seg_2', slotId: 'seg_2', group: 'praise', order: 5, kind: 'song', minutes: 6 },
  ];
  const opened = lineup.lineupFromPlan(items, () => 'Sample Song Title');
  // Sections in the laptop's order, each segment in the order its first item had.
  assert.deepEqual(opened.segs.map((s) => [s.id, s.group]), [['seg_1', 'opening'], ['worship', 'praise'], ['seg_2', 'praise'], ['custom_abc123', 'word']]);
  assert.deepEqual(opened.segs.map((s) => s.name), ['Sample Segment Title', 'Worship', 'Sample Song Title', 'Scripture']);
  assert.equal(opened.removed.length, 12 - 1, 'the other laptop segments were taken out');
  assert.ok(opened.removed.some((s) => s.id === 'finale'));
  assert.deepEqual(opened.template.sections.map((s) => s.group), ['opening', 'praise', 'word']);
  const back = model.praiseFromItems(items, opened.segs);
  assert.deepEqual(back.extra, [], 'nothing is hidden under "Also in this plan"');
  assert.equal(model.slotEntries(back.segments.seg_1)[0].title, undefined, "the segment's name is not the prayer's");
  assert.equal(model.slotEntries(back.segments.seg_1)[0].text, 'Sample Prayer Title');
  // Another section's name from a laptop that has one of its own.
  const other = lineup.lineupFromPlan([{ key: 'custom_xyz', group: 'sample_part', order: 1, kind: 'rite', title: 'Sample Segment Title' }]);
  assert.deepEqual(other.template.sections.map((s) => s.title), ['Opening', 'Praise & Worship', 'Word & Offering', 'Sample part']);
});

test('prayer and Scripture items are visible in both web editors, with their badges and controls, never filtered out', () => {
  const prayer = ps.PRAYER_CATALOG[0];
  const text = ps.buildScripture({ book: 'Sample Book', chapter: 3, verses: '1-6', version: 'WEB' }).text;
  // Praise & Worship: both are the segment's entries, with badges, and the edit panel carries the minutes, the cue and the entry list.
  const { segs } = lineup.lineupFromPlan([]);
  let segments = model.withEntry({}, 'worship', ps.prayerEntry(prayer));
  segments = model.withEntry(segments, 'worship', ps.scriptureEntry(text));
  const row = model.praiseRow(segs.find((s) => s.id === 'worship'), { segments, notes: {} }, []);
  assert.deepEqual(row.entries.map((e) => e.badge), ['prayer', 'scripture']);
  const panel = pwWork.pwEditPanelHtml(row, { entriesHtml: '<ul>entries</ul>' });
  assert.match(panel, /<ul>entries<\/ul>/);
  assert.match(panel, /data-role="panel-minutes"/);
  assert.match(panel, /data-role="panel-note"/);
  assert.match(panel, /The laptop names this segment/, 'a laptop segment cannot be renamed here');
  assert.match(pwWork.pwEditPanelHtml({ ...row, custom: true }, {}), /data-role="panel-name" maxlength="80" value="Worship">/);
  assert.match(pwWork.pwRowHtml(row, {}), new RegExp(`${escRe(prayer.title)} \\+ ${escRe(text)}`));
  // Holy Mass: the slot's pills carry the same badges, reorder, and remove.
  const pills = workspace.entryPillsHtml(row.entries, 's18', true, {});
  assert.match(pills, /lp-kind-badge is-prayer">Prayer</);
  assert.match(pills, /lp-kind-badge is-scripture">Scripture</);
  assert.match(pills, /data-move-entry="0" data-delta="1"/);
  assert.match(pills, /data-move-entry="1" data-delta="-1"/);
  assert.match(pills, /data-remove-entry="1" data-for="s18"/);
  assert.deepEqual(workspace.LIBRARY_TABS.map((t) => t.id), ['songs', 'lectionary', 'prayers', 'scripture', 'cues', 'templates']);
});

test('the add-segment form lists the sections and any laptop segment taken out; long titles wrap instead of widening a phone', () => {
  const removed = lineup.lineupFromPlan([{ key: 'worship', group: 'praise', order: 1, kind: 'song' }]).removed;
  const html = pwWork.addSegmentFormHtml({ groups: ['opening', 'praise', 'word'], removed, error: 'Give the segment a title.' });
  assert.match(html, /data-asf="name"/);
  assert.deepEqual([...html.matchAll(/<option value="(prayer|song|scripture)"/g)].map((m) => m[1]), ['prayer', 'song', 'scripture']);
  assert.match(html, /<option value="praise" selected>Praise &amp; Worship<\/option>/);
  assert.match(html, /data-restore-segment="finale"/);
  assert.match(html, /role="alert" data-asf-error>Give the segment a title\./);
  const css = readWeb('css/planner.css');
  assert.match(css, /\.pw-row-select \{[^}]*min-width: 0;/);
  assert.match(css, /\.pw-card-text strong \{[^}]*overflow-wrap: anywhere;/);
});

test("adding a song from the Songs page, and the printed setlist, keep a lineup the planner changed instead of putting it back in the template's order", async () => {
  const { PRAISE_PLAN: EARLIER } = await load('web', 'js', 'sample-data.js');
  const templates = { mass: MASS_PLAN, praise: EARLIER };
  const NEW_SONG = '40000000-0000-4000-8000-0000000000a1';
  const HELD_SONG = '40000000-0000-4000-8000-0000000000a2';
  // A segment of the planner's own first, a laptop segment moved to another section, and the rest of the laptop's twelve taken out.
  const items = [
    { key: 'seg_1', slotId: 'seg_1', group: 'opening', order: 1, kind: 'song', minutes: 6, title: 'Sample Song Segment' },
    { key: 'prayer_authority', slotId: 'prayer_authority', group: 'opening', order: 2, kind: 'rite', minutes: 3 },
    { key: 'worship', slotId: 'worship', group: 'word', order: 3, kind: 'song', songId: HELD_SONG, minutes: 15 },
  ];
  const plan = { kind: 'pw', items, contentHubItems: [] };
  const steps = model.songSteps(plan, templates, NEW_SONG);
  assert.deepEqual(steps.map((s) => s.id), ['seg_1', 'worship'], 'the planner\'s own song segment is offered, the segments taken out are not');
  const next = model.itemsWithSong(plan, templates, 'seg_1', NEW_SONG);
  assert.deepEqual(next.map((i) => [i.key, i.group, i.order]), [['seg_1', 'opening', 1], ['prayer_authority', 'opening', 2], ['worship', 'word', 3]], 'same keys, sections and order');
  assert.deepEqual([next[0].songId, next[0].title, next[0].minutes], [NEW_SONG, 'Sample Song Segment', 6], 'the segment keeps its name and minutes');
  assert.equal(next.length, 3, 'no laptop segment is put back and nothing falls under "Also in this plan"');
  // A second song in the moved laptop segment stays in its section.
  const more = model.itemsWithSong(plan, templates, 'worship', NEW_SONG);
  assert.deepEqual(more.filter((i) => i.slotId === 'worship').map((i) => [i.songId, i.group]), [[HELD_SONG, 'word'], [NEW_SONG, 'word']]);
  // The printed setlist names the segment of the planner's own.
  const segs = model.praiseSegmentsFor(next, EARLIER);
  assert.deepEqual(segs.map((s) => s.id), ['seg_1', 'prayer_authority', 'worship']);
  const entries = model.setlistEntries(model.praiseFromItems(next, segs), segs, [{ id: NEW_SONG, title: 'Sample Song Title', key: 'G' }]);
  assert.deepEqual([entries[0].label, entries[0].title, entries[1].label], ['Sample Song Segment', 'Sample Song Title', 'Worship']);
  // A plan from the earlier layout is still read in that layout.
  const earlier = [{ key: '2', group: 'opening', order: 1, kind: 'song', minutes: 5 }];
  assert.equal(model.praiseSegmentsFor(earlier, EARLIER).length, model.praiseSegments(EARLIER).length);
  assert.equal(model.praiseSegmentsFor([], EARLIER).length, 12, 'a new plan is the laptop\'s twelve');
});

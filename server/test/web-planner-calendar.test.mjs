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
    for (const id of ['plan-title', 'date-badge', 'fill-badge', 'duplicate', 'delete', 'delete-dialog', 'save']) assert.match(html, new RegExp(`id="${id}"`), `${editor} has #${id}`);
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

// The web Planner's two calendars, laid out as the church laptop's Planner lays them out (src/planner/PlannerCalendarView.tsx): the
// Liturgical Calendar holds Holy Mass plans only, the Praise & Worship Calendar Praise & Worship plans only. A month is shown Sunday to
// Saturday under a banner naming its devotion and the seasons it falls in. Each day shows its number, its rank (Solemnity, Feast), its
// liturgical colour, its name from the Ordo, the parish's memo for the day, and a pill for each plan of the calendar's kind.
//
// The liturgical rules are the laptop's own: liturgical-calendar.js, liturgical-day.js and liturgical-season.js are byte-for-byte copies of
// the files in shared/, and ordo-names.js holds the Ordo's day names. Pure, so the tests run it without a browser. Every value written into
// markup goes through esc().
import { calendarDayOf, monthGrid, requiredSlotsFor, seasonsOfMonth, shortDayName } from './liturgical-calendar.js';
import { ordoDayOf } from './liturgical-day.js';
import { ORDO_NAMES } from './ordo-names.js';
import { MASS_SLOTS } from './mass-slots.js';
import { cellScheduleBadges, schedulesOn } from './holy-mass-schedule.js';
import { asSchedulePlan, badgeText, scheduleText } from './schedule-ui.js';

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The Planner's three tabs, in the order the laptop shows them. */
export const PLANNER_TABS = [
  { key: 'mass', label: 'Liturgical Calendar', subtitle: 'Holy Mass plans on the liturgical calendar.' },
  { key: 'pw', label: 'Praise & Worship Calendar', subtitle: 'Praise & Worship plans on the calendar.' },
  { key: 'editor', label: 'Plan Editor', subtitle: 'Open a plan from a calendar to edit it.' },
];

/** A calendar's key from the address or storage: 'pw' is the Praise & Worship Calendar, anything else the Liturgical Calendar. */
export const calendarKindOf = (value) => (value === 'pw' ? 'pw' : 'mass');

/** The Planner's layout as stored in this browser: the calendar, unless the list or the grid was chosen. */
export const plannerViewOf = (value) => (value === 'list' || value === 'grid' ? value : 'calendar');

/** The calendar a plan belongs on: Praise & Worship plans on theirs, every other plan (an untyped one too) on the Liturgical Calendar. */
export const calendarOfPlan = (plan) => (plan?.kind === 'pw' ? 'pw' : 'mass');

export const CALENDAR_HINT = {
  mass: 'Holy Mass plans only. Pick a day to open its Holy Mass plan, or to start one.',
  pw: 'Praise & Worship plans only. Pick a day to open its plan, or to start one.',
};

/** The season names and the colour of each season's pill, as the laptop's banner has them. */
export const SEASONS = {
  advent: { label: 'Advent', color: 'violet' },
  christmas: { label: 'Christmas', color: 'white' },
  'ordinary-time': { label: 'Ordinary Time', color: 'green' },
  lent: { label: 'Lent', color: 'violet' },
  'holy-week': { label: 'Holy Week', color: 'red' },
  easter: { label: 'Easter', color: 'white' },
  pentecost: { label: 'Pentecost', color: 'red' },
};

/** The traditional devotion of each month, January first (the laptop's month_dedication_0 to _11). */
export const MONTH_DEDICATIONS = [
  'Month of the Most Holy Name of Jesus',
  'Month of the Holy Family',
  'Month of Saint Joseph',
  'Month of the Holy Eucharist',
  'Month of the Blessed Virgin Mary',
  'Month of the Sacred Heart of Jesus',
  'Month of the Most Precious Blood',
  'Month of the Immaculate Heart of Mary',
  'Month of Our Lady of Sorrows',
  'Month of the Holy Rosary',
  'Month of the Holy Souls in Purgatory',
  'Month of the Immaculate Conception',
];

/** The ranks the calendar marks on a day. A Sunday or weekday is not marked. */
export const RANK_LABEL = { solemnity: 'Solemnity', feast: 'Feast' };

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const ORDO = { days: Object.fromEntries(Object.entries(ORDO_NAMES).map(([code, name]) => [code, { name }])) };
const SLOT_ID_OF_NUMBER = new Map(MASS_SLOTS.map((slot) => [slot.number, slot.id]));

/** The liturgical day of "YYYY-MM-DD": its Ordo code, colour, rank, season, its full name and its name as a cell shows it. */
export function liturgicalDay(iso) {
  const day = calendarDayOf(iso);
  const name = ordoDayOf(ORDO, iso).name;
  return { ...day, name, title: day.rank === 'weekday' ? shortDayName(name) : name };
}

/** "Sunday, 6 December 2026". */
export function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${WEEKDAYS_LONG[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${d} ${MONTHS[m - 1]} ${y}`;
}

/**
 * How far a Holy Mass plan is: `done` of the `total` slots its day needs (every slot that is not optional, and on a weekday that is not a
 * solemnity, not the parts said only on Sundays), and `ready` once all are filled. `filledSlots` are the slot numbers the plan has an item in.
 */
export function massProgress(plan, iso) {
  const required = requiredSlotsFor(iso);
  const filled = new Set((plan?.filledSlots ?? []).map((n) => SLOT_ID_OF_NUMBER.get(Number(n))).filter(Boolean));
  const done = required.filter((id) => filled.has(id)).length;
  return { done, total: required.length, ready: required.length > 0 && done === required.length };
}

/** One day's plans on a calendar: its Holy Masses in the order they are celebrated, or its Praise & Worship plans by name. */
export function plansOnCalendarDay(kind, plans, iso) {
  const list = (plans ?? []).map(asSchedulePlan);
  if (kind === 'pw') return list.filter((p) => p.kind === 'pw' && p.liturgicalDate === iso).sort((a, b) => a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id)));
  return schedulesOn(list.filter((p) => p.kind !== 'pw'), iso);
}

/**
 * What a click on a day does on a calendar: an empty day opens New Plan for it ('create'; 'none' for a viewer), a day with one plan opens it
 * in the Plan Editor ('open'), and a day with several lists them to choose from ('pick': Available Holy Mass Schedules on the Liturgical
 * Calendar). `plans` are the day's plans of the calendar's kind, and `plan` the one to open.
 */
export function dayClick(kind, plans, iso, canCreate) {
  const onDay = plansOnCalendarDay(kind, plans, iso);
  if (onDay.length === 0) return { action: canCreate ? 'create' : 'none', plans: onDay };
  if (onDay.length === 1) return { action: 'open', plan: onDay[0], plans: onDay };
  return { action: 'pick', plans: onDay };
}

/** A Holy Mass plan's pill: its time and language ("9:30 AM · EN", or Holy Mass with none) and its progress ("8/23"), or ready. */
export function massBadge(plan, iso) {
  const progress = massProgress(plan, iso);
  return {
    id: plan.id,
    kind: 'mass',
    label: badgeText(plan),
    count: `${progress.done}/${progress.total}`,
    ready: progress.ready,
    title: [scheduleText(plan), plan.name].filter(Boolean).join(' · '),
  };
}

/** A Praise & Worship plan's pill: its title and how many songs and items it holds. */
export const pwBadge = (plan) => ({ id: plan.id, kind: 'pw', label: plan.name, count: String(plan.itemCount ?? 0), ready: false, title: plan.name });

/**
 * A month of one calendar: the banner (month, year, devotion, seasons) and the weeks, each day with what its cell shows. `month` is "YYYY-MM",
 * `notes` the parish's day memos by date, `today` "YYYY-MM-DD". A day on the Liturgical Calendar shows up to two Holy Masses and "+N more";
 * the Praise & Worship Calendar shows up to three plans.
 */
export function calendarMonth({ kind = 'mass', month, plans = [], notes = {}, today = '' }) {
  const [year, m] = month.split('-').map(Number);
  const weeks = monthGrid(year, m - 1).map((week) =>
    week.map((iso) => {
      const day = liturgicalDay(iso);
      const onDay = plansOnCalendarDay(kind, plans, iso);
      let shown;
      let more;
      if (kind === 'pw') {
        shown = onDay.slice(0, 3).map(pwBadge);
        more = Math.max(0, onDay.length - 3);
      } else {
        const cell = cellScheduleBadges(onDay);
        shown = cell.shown.map((p) => massBadge(p, iso));
        more = cell.more;
      }
      const memo = typeof notes?.[iso] === 'string' ? notes[iso].trim() : '';
      return {
        iso,
        day: Number(iso.slice(8, 10)),
        inMonth: Number(iso.slice(5, 7)) === m,
        isToday: iso === today,
        weekday: WEEKDAYS_LONG[weeks0Day(iso)],
        rank: day.rank,
        rankLabel: RANK_LABEL[day.rank] ?? '',
        color: day.color,
        name: day.name,
        title: day.title,
        memo,
        count: onDay.length,
        badges: shown,
        more,
      };
    }),
  );
  return {
    kind,
    month,
    year,
    monthName: MONTHS[m - 1],
    dedication: MONTH_DEDICATIONS[m - 1],
    hint: CALENDAR_HINT[kind],
    seasons: seasonsOfMonth(year, m - 1).map((key) => ({ key, ...SEASONS[key] })),
    isTodayMonth: typeof today === 'string' && today.slice(0, 7) === month,
    weekdays: WEEKDAYS,
    weeks,
  };
}

function weeks0Day(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const svg = (body, size = 14) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON_CHURCH = svg('<path d="M12 2v4M10 4h4"/><path d="M6 21V11l6-5 6 5v10"/><path d="M10 21v-5h4v5"/>', 12);
const ICON_GUITAR = svg('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>', 12);
const ICON_CHECK = svg('<path d="M20 6 9 17l-5-5"/>', 12);
const ICON_MEMO = svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>', 13);
const ICON_NOTE = svg('<path d="M4 4h16v12H8l-4 4z"/>', 11);

function badgeHtml(badge) {
  const icon = badge.ready ? ICON_CHECK : badge.kind === 'pw' ? ICON_GUITAR : ICON_CHURCH;
  const what = badge.kind === 'pw' ? 'Open the Praise & Worship plan' : 'Open the Holy Mass';
  const count = badge.ready ? '' : `<span class="pc-badge-count">${esc(badge.count)}</span>`;
  return `<button type="button" class="pc-badge is-${badge.kind}${badge.ready ? ' is-ready' : ''}" data-open-plan="${esc(badge.id)}" title="${esc(badge.title)}" aria-label="${esc(`${what}: ${badge.title}`)}">${icon}<span class="pc-badge-label">${esc(badge.label)}</span>${count}</button>`;
}

function cellHtml(cell, kind, canEdit) {
  const classes = ['pc-day', cell.inMonth ? '' : 'is-outside', cell.isToday ? 'is-today' : '', cell.rank !== 'weekday' ? 'is-festive' : '', cell.count ? 'has-plans' : '']
    .filter(Boolean).join(' ');
  const plansSaid = cell.count ? `, ${cell.count} ${kind === 'pw' ? 'Praise & Worship' : 'Holy Mass'} ${cell.count === 1 ? 'plan' : 'plans'}` : '';
  const action = cell.count === 0 ? (canEdit ? ', create a plan' : '') : cell.count === 1 ? ', open its plan' : ', choose a plan';
  const label = `${cell.weekday} ${cell.day} ${cell.iso.slice(0, 7)}: ${cell.name}${cell.rankLabel ? ` (${cell.rankLabel})` : ''}${cell.memo ? `. Memo: ${cell.memo}` : ''}${plansSaid}${action}`;
  const hit = cell.count || canEdit
    ? `<button type="button" class="pc-day-hit" data-day="${cell.iso}" aria-label="${esc(label)}"></button>`
    : `<span class="pc-day-hit" aria-hidden="true"></span>`;
  const memoButton = canEdit
    ? `<button type="button" class="pc-memo-btn" data-memo-day="${cell.iso}" aria-label="${esc(`${cell.memo ? 'Edit' : 'Add'} the memo for ${cell.weekday} ${cell.day}`)}" title="${cell.memo ? 'Edit memo' : 'Add memo'}">${ICON_MEMO}</button>`
    : '';
  const more = cell.more
    ? `<button type="button" class="pc-badge is-more" data-day="${cell.iso}" aria-label="${esc(`Show all ${cell.count} plans on ${cell.weekday} ${cell.day}`)}">+${cell.more} more</button>`
    : '';
  const add = canEdit && cell.count
    ? `<button type="button" class="pc-add" data-add-day="${cell.iso}" aria-label="${esc(kind === 'pw' ? `Add a Praise & Worship plan on ${cell.weekday} ${cell.day}` : `Add another Holy Mass schedule on ${cell.weekday} ${cell.day}`)}" title="${kind === 'pw' ? 'Add a Praise &amp; Worship plan' : 'Add Another Holy Mass Schedule'}">+</button>`
    : '';
  return `
        <div class="${classes}" role="gridcell" data-color="${cell.color}" data-cell="${cell.iso}">
          ${hit}
          <div class="pc-day-top">
            <span class="pc-day-num"${cell.isToday ? ' aria-current="date"' : ''}>${cell.day}</span>
            ${cell.rankLabel ? `<span class="pc-rank">${esc(cell.rankLabel)}</span>` : ''}
            ${cell.memo ? `<span class="pc-memo-dot" title="Has a memo">${ICON_NOTE}</span>` : ''}
            <span class="pc-day-tools">${memoButton}${add}</span>
          </div>
          <p class="pc-day-title" title="${esc(cell.name)}">${esc(cell.title)}</p>
          ${cell.memo ? `<p class="pc-memo">${esc(cell.memo)}</p>` : ''}
          <div class="pc-badges">${cell.badges.map(badgeHtml).join('')}${more}</div>
        </div>`;
}

/** The calendar's markup: the banner with month navigation, Today and the season pills, then the month. */
export function calendarHtml(model, { canEdit = false } = {}) {
  const seasons = model.seasons.map((s) => `<span class="pc-season" data-color="${s.color}"><span class="pc-season-dot" aria-hidden="true"></span>${esc(s.label)}</span>`).join('');
  const rows = model.weeks.map((week) => `
      <div class="pc-week" role="row">${week.map((cell) => cellHtml(cell, model.kind, canEdit)).join('')}
      </div>`).join('');
  return `
    <section class="pc-calendar" data-kind="${model.kind}" aria-labelledby="pc-title">
      <div class="pc-banner">
        <div class="pc-banner-row">
          <div class="pc-nav">
            <button type="button" class="pc-round" data-cal-nav="-1" aria-label="Previous month" title="Previous month">${svg('<path d="m15 18-6-6 6-6"/>', 20)}</button>
            <h2 id="pc-title" class="pc-title" aria-live="polite">${esc(model.monthName)} <span class="pc-year">${model.year}</span></h2>
            <button type="button" class="pc-round" data-cal-nav="1" aria-label="Next month" title="Next month">${svg('<path d="m9 18 6-6-6-6"/>', 20)}</button>
          </div>
          <button type="button" class="pc-today" data-cal-nav="0"${model.isTodayMonth ? ' disabled' : ''}>${svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>', 15)}Today</button>
          <div class="pc-seasons" aria-label="Liturgical seasons this month">${seasons}</div>
        </div>
        <p class="pc-dedication">${esc(model.dedication)}</p>
        <p class="pc-hint">${esc(model.hint)}</p>
      </div>
      <div class="pc-scroll">
        <div class="pc-grid" role="grid" aria-labelledby="pc-title">
          <div class="pc-week pc-weekdays" role="row">${model.weekdays.map((d, i) => `<div role="columnheader" class="pc-weekday${i === 0 ? ' is-sunday' : ''}" aria-label="${WEEKDAYS_LONG[i]}">${d}</div>`).join('')}</div>${rows}
        </div>
      </div>
    </section>`;
}

/** One row of the day chooser: a Holy Mass with its time, language and slots filled, or a Praise & Worship plan with its count. */
export function chooserRowHtml(plan, iso, kind, editorHref) {
  if (kind === 'pw') {
    const count = plan.itemCount ?? 0;
    return `
      <li>
        <a class="bc-schedule" href="${esc(editorHref)}" data-open-plan="${esc(plan.id)}">
          <span class="bc-schedule-main">
            <span class="bc-lang">Praise &amp; Worship</span>
            <span class="bc-schedule-name">${esc(plan.name)}</span>
          </span>
          <span class="bc-schedule-count">${count} ${count === 1 ? 'item' : 'items'}</span>
        </a>
      </li>`;
  }
  const time = plan.massTime || '';
  const progress = massProgress(plan, iso);
  return `
      <li>
        <a class="bc-schedule" href="${esc(editorHref)}" data-open-plan="${esc(plan.id)}" aria-label="${esc(`Open the ${scheduleText(plan) || 'unscheduled'} Holy Mass: ${plan.name}`)}">
          <span class="bc-schedule-main">
            <span style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px">
              <span class="bc-schedule-time${time ? '' : ' is-blank'}">${esc(time || 'No time set')}</span>
              ${plan.massLanguage ? `<span class="bc-lang">${esc(plan.massLanguage)}</span>` : ''}
            </span>
            <span class="bc-schedule-name">${esc(plan.name)}</span>
          </span>
          <span class="bc-schedule-count">${progress.ready ? 'Ready' : `${progress.done}/${progress.total} slots`}</span>
        </a>
      </li>`;
}

// Create a plan: the church laptop's CREATE A PLAN card (src/planner/PlannerCalendarView.tsx, CreatePlanDialog), on the web. One centred
// column with the day's liturgical colour as a ribbon down its left edge: the full date, the day's Ordo name in italics, the plan name, and
// for a Holy Mass its time and language (the laptop's ScheduleFields, from schedule-ui.js). One action card at the foot makes the plan.
// A time another Holy Mass on the date already has is not sent: the card says so, with Open Existing beside it.
//
// From a calendar day the card opens on that day in that calendar's kind, as on the laptop. Opened without a day (+ New Plan, plan/new.html)
// it adds a picker row on top: Holy Mass / Praise & Worship, a date box and Today / This Saturday / Next Sunday, and the heading follows them.
//
// One card, two places: the Planner's New Plan modal (index.html) and the plan/new.html page that older links still open. Both call
// mountNewPlanForm(). The markup is built from constants only; everything the user types or the data holds reaches the page through
// textContent, an input's value, or the escaped markup of schedule-ui.js.
import { conflictIn, mountScheduleFields, onOpenExisting, showConflict, textsLanguageFor } from './schedule-ui.js';
import { checkNewPlan, dateShortcut, newPlanRequest, suggestPlanName } from './plan-model.js';
import { liturgicalDay } from './planner-calendar.js';
import { createPlan } from './plan-api.js';
import { dayReadingItems } from './day-readings.js';
import { compactSectionHtml, mountCompactAppearance, sanitizePlanAppearance } from './plan-appearance-ui.js';

/** The action card at the foot of the card, per kind, in the laptop's words. */
export const ACTIONS = {
  mass: { title: 'Create Holy Mass Plan', text: "The four parts of the Holy Mass, with the day's readings from the Lectionary." },
  pw: { title: 'Create Praise & Worship Plan', text: 'Opening, Praise & Worship, and Word & Offering sets.' },
};
export const BUSY_TITLE = 'Creating…';

/** The picker row's date shortcuts, in the order they are shown. */
export const DATE_SHORTCUTS = [
  { key: 'today', label: 'Today' },
  { key: 'saturday', label: 'This Saturday' },
  { key: 'sunday', label: 'Next Sunday' },
];

const icon = (body, size = 18, cls = '') =>
  `<svg${cls ? ` class="${cls}"` : ''} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON_CLOSE = icon('<path d="M18 6 6 18M6 6l12 12"/>');
const ICON_CHURCH = icon('<path d="M10 9h4"/><path d="M12 7v5"/><path d="M14 22v-4a2 2 0 0 0-4 0v4"/><path d="M18 22V5.6a1 1 0 0 0-.55-.9l-4.56-2.27a2 2 0 0 0-1.78 0L6.55 4.72a1 1 0 0 0-.55.9V22"/><path d="m18 7 3.45 1.72a1 1 0 0 1 .55.9V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9.38a1 1 0 0 1 .55-.9L6 7"/>', 20, 'np-action-glyph is-mass');
const ICON_MUSIC = icon('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>', 20, 'np-action-glyph is-pw');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A whole "YYYY-MM-DD" as a UTC date, or null ("2026-02-30" is not a day). */
function dateOf(iso) {
  if (!DATE.test(iso ?? '')) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}

/** "Saturday, November 7, 2026", as the laptop's heading says it, or '' when the date is not a whole date. */
export function fullDate(iso) {
  const date = dateOf(iso);
  if (!date) return '';
  return `${WEEKDAYS[date.getUTCDay()]}, ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

/** The liturgical name of a date, or '' when the date is not a whole date. */
export function dayNameOf(iso) {
  return dateOf(iso) ? liturgicalDay(iso).name : '';
}

/** The vestment colour of a date for the ribbon (green, violet, white, red, rose), or 'none' with no whole date. */
export function ribbonColorOf(iso) {
  return dateOf(iso) ? liturgicalDay(iso).color : 'none';
}

/**
 * What the card shows for its state, without a browser: the heading and subtitle, the ribbon colour, the action card, the Holy Mass already
 * at the typed time (a Holy Mass only) and whether the plan can be made. `plans` are the church's plans, as the list gives them.
 */
export function newPlanCard({ kind = 'mass', date = '', name = '', massTime = '', plans = [], busy = false } = {}) {
  const chosen = kind === 'pw' ? 'pw' : 'mass';
  const whole = dateOf(date) !== null;
  const conflict = chosen === 'mass' && whole ? conflictIn(plans, date, massTime) : null;
  return {
    kind: chosen,
    heading: whole ? fullDate(date) : 'Choose a date',
    subtitle: dayNameOf(date),
    color: ribbonColorOf(date),
    action: { title: busy ? BUSY_TITLE : ACTIONS[chosen].title, text: ACTIONS[chosen].text },
    conflict,
    canCreate: !busy && whole && String(name).trim() !== '' && conflict === null,
  };
}

/**
 * Makes the plan the card describes. `input` is { name, date, kind, language, massTime, massLanguage, appearance }; `create(request)` posts it (the
 * server's answer has `plan`). Returns { plan }, { problem } (a message for the card) or { conflict } (the Holy Mass already at that time,
 * from `known` or from the server). Nothing is sent for a problem or a known conflict.
 */
export async function submitNewPlan(input, { known = [], create = createPlan, uuid = () => crypto.randomUUID() } = {}) {
  const problem = checkNewPlan(input);
  if (problem) return { problem };
  const taken = input.kind === 'mass' ? conflictIn(known, input.date, input.massTime) : null;
  if (taken) return { conflict: taken };
  try {
    const request = newPlanRequest(input, uuid());
    // A new Holy Mass starts with the day's readings in their slots, as the laptop's Planner fills them. Names only: the laptop shows the readings itself.
    const body = await create(input.kind === 'mass' ? { ...request, items: dayReadingItems(input.date) } : request);
    return { plan: body.plan };
  } catch (err) {
    // Made on another device since the list was read: the server names the plan already there.
    if (err?.conflict) return { conflict: { ...err.conflict, liturgicalDate: err.conflict.date, kind: 'mass' } };
    return { problem: err?.message || 'The plan could not be made. Try again.' };
  }
}

/** The card. No value from the user or the data is in it; mountNewPlanForm fills it. */
export function newPlanFormHtml() {
  const chips = DATE_SHORTCUTS.map((s) => `<button type="button" class="bc-chip" data-date-shortcut="${s.key}" aria-pressed="false">${s.label}</button>`).join('');
  return `
      <form id="new-plan-form" class="np-card" data-color="none" data-kind="mass" novalidate autocomplete="off" aria-labelledby="np-heading">
        <span class="np-ribbon" aria-hidden="true"></span>
        <div class="np-head">
          <div class="np-head-text">
            <p class="np-eyebrow">Create a plan</p>
            <h2 id="np-heading" class="np-heading"></h2>
            <p id="np-subtitle" class="np-subtitle"></p>
          </div>
          <button type="button" id="new-plan-close" class="np-close" aria-label="Close" title="Close (Esc)">${ICON_CLOSE}</button>
        </div>

        <div id="np-picker" class="np-picker" hidden>
          <div class="bc-pills" role="group" aria-label="Plan type">
            <button type="button" class="bc-pill" data-plan-kind="mass" aria-pressed="true">Holy Mass</button>
            <button type="button" class="bc-pill" data-plan-kind="pw" aria-pressed="false">Praise &amp; Worship</button>
          </div>
          <div class="bc-field">
            <label class="np-label" for="plan-date">Date</label>
            <input id="plan-date" class="bc-input" type="date">
            <div class="bc-chips" role="group" aria-label="Quick dates">${chips}</div>
          </div>
        </div>

        <div class="bc-field">
          <label class="np-label" for="plan-name">Plan name</label>
          <input id="plan-name" class="bc-input np-name" type="text" maxlength="120" required>
        </div>

        <div id="mass-fields" class="np-mass-fields">
          <div id="schedule-fields" class="np-schedule"></div>
          <div id="schedule-conflict" hidden></div>
        </div>

        ${compactSectionHtml()}

        <p id="new-plan-status" class="np-error" role="alert"></p>

        <button id="new-plan-submit" type="submit" class="np-action">
          <span class="np-action-icon">${ICON_CHURCH}${ICON_MUSIC}</span>
          <span class="np-action-text">
            <span id="np-action-title" class="np-action-title">${ACTIONS.mass.title}</span>
            <span id="np-action-sub" class="np-action-sub">${ACTIONS.mass.text}</span>
          </span>
        </button>
      </form>`;
}

/**
 * Draws the card in `root` and runs it. `kind` and `date` are its first values: with a date (a calendar day, + Add Time) the card is for that
 * day and kind; without one it shows the picker row and starts on next Sunday. `plans` are the church's plans for the taken-time warning,
 * when already loaded; `setPlans()` gives them later. `onCreated(plan)` is called with the new plan, `onOpenExisting(id)` when Open Existing
 * is pressed, and `onClose()` from the × button. Returns { setPlans, reset, focus, busy, kind }.
 */
export function mountNewPlanForm(root, { kind = 'mass', date = '', plans = [], onCreated, onOpenExisting: openExisting, onClose } = {}) {
  // The card is drawn from constants (newPlanFormHtml takes no user value).
  root.innerHTML = newPlanFormHtml();
  const byId = (id) => root.querySelector(`#${id}`);
  const form = byId('new-plan-form');
  const status = byId('new-plan-status');
  const submit = byId('new-plan-submit');
  const nameInput = byId('plan-name');
  const dateInput = byId('plan-date');
  const picker = byId('np-picker');
  const massFields = byId('mass-fields');
  const conflictBox = byId('schedule-conflict');
  const shortcuts = [...root.querySelectorAll('[data-date-shortcut]')];
  const kindPills = [...root.querySelectorAll('[data-plan-kind]')];

  let chosenKind = 'mass';
  // Set once the user has typed a name of their own. A suggestion never replaces it.
  let nameIsCustom = false;
  let busy = false;
  // The church's plans, for the taken-time warning. Until they load (or if they cannot), the server still refuses a taken time.
  let known = plans ?? [];
  let schedule = { massTime: '', massLanguage: '' };
  // The plan's own slide look (Plan Appearance), when the planner opens that section and sets one.
  let appearance = sanitizePlanAppearance(null);
  const look = mountCompactAppearance(byId('np-appearance'), {
    onChange: (next) => {
      appearance = next;
      status.textContent = '';
    },
  });
  const fields = mountScheduleFields(byId('schedule-fields'), {
    id: 'new-schedule',
    onChange: (next) => {
      schedule = next;
      status.textContent = '';
      render();
    },
  });

  const values = () => ({
    name: nameInput.value,
    date: dateInput.value,
    kind: chosenKind,
    dayName: dayNameOf(dateInput.value),
    // English, Tagalog and Cebuano draft the readings and responses in that language, as on the laptop; another language drafts in English.
    language: textsLanguageFor(schedule.massLanguage),
    massTime: schedule.massTime,
    massLanguage: schedule.massLanguage,
    appearance,
  });

  function suggestName() {
    const suggestion = suggestPlanName(values());
    nameInput.placeholder = suggestion;
    if (!nameIsCustom) nameInput.value = suggestion;
  }

  function render() {
    const now = values();
    const card = newPlanCard({ ...now, plans: known, busy });
    form.dataset.color = card.color;
    form.dataset.kind = card.kind;
    byId('np-heading').textContent = card.heading;
    byId('np-subtitle').textContent = card.subtitle;
    byId('np-action-title').textContent = card.action.title;
    byId('np-action-sub').textContent = card.action.text;
    massFields.hidden = card.kind !== 'mass';
    for (const chip of shortcuts) chip.setAttribute('aria-pressed', String(dateShortcut(chip.dataset.dateShortcut) === now.date));
    for (const pill of kindPills) pill.setAttribute('aria-pressed', String(pill.dataset.planKind === card.kind));
    showConflict(conflictBox, card.conflict);
    submit.disabled = !card.canCreate;
    submit.setAttribute('aria-busy', String(busy));
    form.setAttribute('aria-busy', String(busy));
    for (const el of form.querySelectorAll('input, button')) if (el !== submit) el.disabled = busy;
  }

  form.addEventListener('input', ({ target }) => {
    // The schedule fields report through onChange.
    if (target.closest('#schedule-fields')) return;
    status.textContent = '';
    if (target === nameInput) nameIsCustom = nameInput.value.trim() !== '' && nameInput.value !== suggestPlanName(values());
    if (target === dateInput) suggestName();
    render();
  });

  for (const chip of shortcuts) {
    chip.addEventListener('click', () => {
      dateInput.value = dateShortcut(chip.dataset.dateShortcut);
      dateInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  for (const pill of kindPills) {
    pill.addEventListener('click', () => {
      chosenKind = pill.dataset.planKind === 'pw' ? 'pw' : 'mass';
      status.textContent = '';
      suggestName();
      render();
    });
  }

  // Open Existing: the Holy Mass already at that time opens in its editor.
  onOpenExisting(conflictBox, (id) => openExisting?.(id));
  byId('new-plan-close').addEventListener('click', () => {
    if (!busy) onClose?.();
  });

  // The action card is the form's one submit button, so Enter in the name or time box makes the plan too, once it can be made.
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const input = values();
    busy = true;
    status.textContent = '';
    render();
    const result = await submitNewPlan(input, { known });
    if (result.plan) {
      onCreated?.(result.plan);
      return;
    }
    busy = false;
    if (result.conflict) known = [...known.filter((p) => p.id !== result.conflict.id), result.conflict];
    if (result.problem) status.textContent = result.problem;
    render();
    if (result.conflict) conflictBox.querySelector('[data-open-existing]')?.focus();
  });

  /** Starts the card again: for the date and kind given (a calendar day, + Add Time), or with the picker on next Sunday when no date is. */
  function reset(next = {}) {
    const day = dateOf(next.date) ? next.date : '';
    busy = false;
    nameIsCustom = false;
    status.textContent = '';
    chosenKind = next.kind === 'pw' ? 'pw' : 'mass';
    picker.hidden = day !== '';
    dateInput.value = day || dateShortcut('sunday');
    schedule = { massTime: '', massLanguage: '' };
    fields.set(schedule);
    look.reset();
    appearance = look.get();
    byId('np-appearance').open = false;
    suggestName();
    render();
  }

  reset({ kind, date });
  return {
    setPlans(list) {
      known = list ?? [];
      render();
    },
    reset,
    focus() {
      nameInput.focus();
      nameInput.select();
    },
    get busy() {
      return busy;
    },
    get kind() {
      return chosenKind;
    },
  };
}

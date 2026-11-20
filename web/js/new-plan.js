// New plan: template, date, name and, for a Holy Mass plan, its schedule (time and language) as the church laptop asks for it, with a preview
// that follows the form. A time another Holy Mass on the date already has is not sent: the form says so, with Open Existing beside it, which
// opens that plan. The browser makes the plan's UUID, the server creates the plan, and the editor for its type opens. Viewers are told that
// only a planner or admin can create a plan. `?date=` and `?kind=` (from the calendar and the editor's + Add Time) fill the form.
// Everything the user types reaches the page through textContent, an Option's text, or the escaped markup of schedule-ui.js.
import { mountSidebar } from './shell.js';
import { guard } from './auth.js';
import { createPlan, listPlans } from './plan-api.js';
import { MASS_SECTIONS, MASS_SLOTS } from './mass-slots.js';
import { conflictIn, mountScheduleFields, onOpenExisting, openExistingHref, scheduleText, showConflict, textsLanguageFor } from './schedule-ui.js';
import { PRAISE_TEMPLATE, canCreatePlans, checkNewPlan, dateShortcut, editorPathFor, newPlanRequest, shortDate, suggestPlanName } from './plan-model.js';

mountSidebar();

/** What the preview says about each template. The parts and their counts come from the lists the editors are built from. */
const TEMPLATES = {
  mass: {
    label: 'Holy Mass Plan',
    unit: 'slots',
    parts: MASS_SECTIONS.map((section) => ({ title: section.title, count: MASS_SLOTS.filter((slot) => section.groups.includes(slot.group)).length })),
  },
  pw: {
    label: 'Praise & Worship Night',
    unit: 'segments',
    // A new plan is laid out as the church laptop's lineup: Opening, Praise & Worship, Word & Offering.
    parts: PRAISE_TEMPLATE.sections.map((section) => ({ title: section.title, count: section.rows.length })),
  },
};

const byId = (id) => document.getElementById(id);
const layout = byId('new-plan-layout');
const form = byId('new-plan-form');
const status = byId('new-plan-status');
const submit = byId('new-plan-submit');
const denied = byId('new-plan-denied');
const nameInput = byId('plan-name');
const dateInput = byId('plan-date');
const massFields = byId('mass-fields');
const conflictBox = byId('schedule-conflict');
const shortcuts = [...document.querySelectorAll('[data-date-shortcut]')];
const params = new URLSearchParams(location.search);

// Set once the user has typed a name of their own. A suggestion never replaces it.
let nameIsCustom = false;
// The church's plans, for the taken-time warning. Until they load (or if they cannot), the server still refuses a taken time.
let plans = [];
let schedule = { massTime: '', massLanguage: '' };
mountScheduleFields(byId('schedule-fields'), {
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
  kind: form.elements.kind.value,
  // English, Tagalog and Cebuano draft the readings and responses in that language, as on the laptop; another language drafts in English.
  language: textsLanguageFor(schedule.massLanguage),
  massTime: schedule.massTime,
  massLanguage: schedule.massLanguage,
});

/** The Holy Mass already at the typed time on the chosen date, or null. */
const conflict = () => {
  const { kind, date, massTime } = values();
  return kind === 'mass' ? conflictIn(plans, date, massTime) : null;
};

function suggestName() {
  const suggestion = suggestPlanName(values());
  nameInput.placeholder = suggestion;
  if (!nameIsCustom) nameInput.value = suggestion;
}

function renderPreview() {
  const { name, date, kind, massTime, massLanguage } = values();
  const template = TEMPLATES[kind];
  const title = name.trim();
  const isMass = kind === 'mass';
  byId('preview-title').textContent = title || 'Untitled plan';
  byId('preview-title').classList.toggle('is-empty', !title);
  byId('preview-kind').textContent = template.label;
  byId('preview-date').textContent = date ? shortDate(date) : 'No date chosen';
  byId('preview-language-row').hidden = !isMass;
  byId('preview-time-row').hidden = !isMass;
  byId('preview-language').textContent = scheduleText({ massLanguage }) || 'Not set';
  byId('preview-time').textContent = scheduleText({ massTime }) || 'Decide later';
  byId('preview-count').textContent = `${template.parts.reduce((sum, part) => sum + part.count, 0)} ${template.unit}`;
  byId('preview-parts').replaceChildren(...template.parts.map((part) => {
    const row = document.createElement('li');
    const partTitle = document.createElement('span');
    const count = document.createElement('span');
    partTitle.textContent = part.title;
    count.textContent = String(part.count);
    row.append(partTitle, count);
    return row;
  }));
}

function render() {
  const { date, kind } = values();
  massFields.hidden = kind !== 'mass';
  for (const chip of shortcuts) chip.setAttribute('aria-pressed', String(dateShortcut(chip.dataset.dateShortcut) === date));
  const taken = conflict();
  showConflict(conflictBox, taken);
  submit.disabled = taken !== null;
  renderPreview();
}

form.addEventListener('input', ({ target }) => {
  // The schedule fields report through onChange.
  if (target.closest('#schedule-fields')) return;
  status.textContent = '';
  if (target === nameInput) nameIsCustom = nameInput.value.trim() !== '' && nameInput.value !== suggestPlanName(values());
  if (target === dateInput || target.name === 'kind') suggestName();
  render();
});

for (const chip of shortcuts) {
  chip.addEventListener('click', () => {
    dateInput.value = dateShortcut(chip.dataset.dateShortcut);
    dateInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// Open Existing: the Holy Mass already at that time opens in its editor, and this form is left.
onOpenExisting(conflictBox, (id) => location.assign(openExistingHref(id, document.documentElement.dataset.base ?? '')));

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = values();
  const problem = checkNewPlan(input);
  if (problem) {
    status.textContent = problem;
    return;
  }
  if (conflict()) {
    render();
    conflictBox.querySelector('[data-open-existing]')?.focus();
    return;
  }
  const label = submit.textContent;
  submit.disabled = true;
  submit.textContent = 'Creating…';
  status.textContent = '';
  try {
    const body = await createPlan(newPlanRequest(input, crypto.randomUUID()));
    // The page sits under plan/, so the editor's path is taken from the site root.
    location.replace(`${document.documentElement.dataset.base ?? ''}${editorPathFor(body.plan)}`);
  } catch (err) {
    submit.disabled = false;
    submit.textContent = label;
    if (err.conflict) {
      // Made on another device since the list was read: the server names the plan already there.
      plans = [...plans.filter((p) => p.id !== err.conflict.id), { ...err.conflict, liturgical_date: err.conflict.date, kind: 'mass' }];
      render();
      conflictBox.querySelector('[data-open-existing]')?.focus();
    } else {
      status.textContent = err.message;
    }
  }
});

/** The form's first values: the date and the plan type from the address when given (calendar, + Add Time), else next Sunday. */
function startValues() {
  const date = params.get('date');
  dateInput.value = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? date : dateShortcut('sunday');
  const kind = params.get('kind');
  if (kind === 'mass' || kind === 'pw') {
    const choice = form.querySelector(`input[name="kind"][value="${kind}"]`);
    if (choice) choice.checked = true;
  }
}

const user = await guard();
if (user) {
  if (!canCreatePlans(user.role)) {
    denied.hidden = false;
  } else {
    startValues();
    suggestName();
    render();
    // The form stays hidden until the user is known and its first values are in.
    layout.hidden = false;
    // A time typed before the list arrives is checked again once it has.
    listPlans()
      .then((body) => {
        plans = body.plans ?? [];
        render();
      })
      .catch(() => undefined);
  }
}

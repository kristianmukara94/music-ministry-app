// New plan: template, date, name and, for a Holy Mass plan, language and Mass time, with a preview that follows the form. The browser makes the
// plan's UUID, the server creates the plan, and the editor for its type opens. Viewers are told that only a planner or admin can create a plan.
// Everything the user types reaches the page through textContent or an Option's text, never as markup.
import { mountSidebar } from './shell.js';
import { guard } from './auth.js';
import { createPlan } from './plan-api.js';
import { languageName } from './mass-language.js';
import { massTimesFor } from './mass-schedule.js';
import { MASS_SECTIONS, MASS_SLOTS } from './mass-slots.js';
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
const timeSelect = byId('plan-mass-time');
const massFields = byId('mass-fields');
const shortcuts = [...document.querySelectorAll('[data-date-shortcut]')];

// Set once the user has typed a name of their own. A suggestion never replaces it.
let nameIsCustom = false;

const values = () => ({
  name: nameInput.value,
  date: dateInput.value,
  kind: form.elements.kind.value,
  language: form.elements.language.value,
  massTime: timeSelect.value,
});

/** The Mass times of the chosen date. A chosen time stays chosen if the new date has it too. */
function offerMassTimes() {
  const chosen = timeSelect.value;
  const offered = massTimesFor(dateInput.value);
  timeSelect.replaceChildren(new Option('Decide later', ''), ...offered.map((time) => new Option(time.label, time.time)));
  timeSelect.value = offered.some((time) => time.time === chosen) ? chosen : '';
}

function suggestName() {
  const suggestion = suggestPlanName(values());
  nameInput.placeholder = suggestion;
  if (!nameIsCustom) nameInput.value = suggestion;
}

function renderPreview() {
  const { name, date, kind, language } = values();
  const template = TEMPLATES[kind];
  const title = name.trim();
  const isMass = kind === 'mass';
  byId('preview-title').textContent = title || 'Untitled plan';
  byId('preview-title').classList.toggle('is-empty', !title);
  byId('preview-kind').textContent = template.label;
  byId('preview-date').textContent = date ? shortDate(date) : 'No date chosen';
  byId('preview-language-row').hidden = !isMass;
  byId('preview-time-row').hidden = !isMass;
  byId('preview-language').textContent = languageName(language);
  byId('preview-time').textContent = timeSelect.value ? timeSelect.selectedOptions[0].text : 'Decide later';
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
  renderPreview();
}

form.addEventListener('input', ({ target }) => {
  status.textContent = '';
  if (target === nameInput) nameIsCustom = nameInput.value.trim() !== '' && nameInput.value !== suggestPlanName(values());
  if (target === dateInput) offerMassTimes();
  if (target === dateInput || target.name === 'kind') suggestName();
  render();
});

for (const chip of shortcuts) {
  chip.addEventListener('click', () => {
    dateInput.value = dateShortcut(chip.dataset.dateShortcut);
    dateInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = values();
  const problem = checkNewPlan(input);
  if (problem) {
    status.textContent = problem;
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
    status.textContent = err.message;
    submit.disabled = false;
    submit.textContent = label;
  }
});

const user = await guard();
if (user) {
  if (!canCreatePlans(user.role)) {
    denied.hidden = false;
  } else {
    dateInput.value = dateShortcut('sunday');
    offerMassTimes();
    suggestName();
    render();
    // The form stays hidden until the user is known and its first values are in.
    layout.hidden = false;
  }
}

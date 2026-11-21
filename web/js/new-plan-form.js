// New Plan: template, date, name and, for a Holy Mass plan, its schedule (time and language) as the church laptop asks for it, with a preview
// that follows the form and the liturgical day of the chosen date. A time another Holy Mass on the date already has is not sent: the form says
// so, with Open Existing beside it. The browser makes the plan's UUID and the server creates the plan.
//
// One form, two places: the Planner's New Plan modal (index.html, opened from + New Plan or an empty calendar day) and the plan/new.html page
// that older links still open. Both draw newPlanFormHtml() and call mountNewPlanForm(). The markup is built from constants only; everything
// the user types reaches the page through textContent, an input's value, or the escaped markup of schedule-ui.js.
import { MASS_SECTIONS, MASS_SLOTS } from './mass-slots.js';
import { conflictIn, mountScheduleFields, onOpenExisting, scheduleText, showConflict, textsLanguageFor } from './schedule-ui.js';
import { PRAISE_TEMPLATE, checkNewPlan, dateShortcut, newPlanRequest, shortDate, suggestPlanName } from './plan-model.js';
import { liturgicalDay } from './planner-calendar.js';
import { createPlan } from './plan-api.js';

/** What the preview says about each template. The parts and their counts come from the lists the editors are built from. */
export const TEMPLATES = {
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

const total = (kind) => TEMPLATES[kind].parts.reduce((sum, part) => sum + part.count, 0);
const CHECK = '<svg class="template-card-check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

/** The form and its preview. `cancel` adds a Cancel button (the modal). No value from the user or the data is in it. */
export function newPlanFormHtml({ cancel = false } = {}) {
  return `
      <form id="new-plan-form" class="new-plan-form" novalidate autocomplete="off">
        <p id="plan-day-line" class="new-plan-day" aria-live="polite"></p>

        <fieldset class="new-plan-group">
          <legend class="new-plan-label">Template</legend>
          <div class="template-cards">
            <label class="template-card">
              <input type="radio" name="kind" value="mass" checked>
              <span class="template-card-body">
                ${CHECK}
                <span class="template-card-title">Holy Mass Plan</span>
                <span class="template-card-count">${total('mass')} slots</span>
                <span class="template-card-text">Introductory Rites, Liturgy of the Word, Eucharist and Recessional.</span>
              </span>
            </label>
            <label class="template-card">
              <input type="radio" name="kind" value="pw">
              <span class="template-card-body">
                ${CHECK}
                <span class="template-card-title">Praise &amp; Worship Night</span>
                <span class="template-card-count">${total('pw')} segments</span>
                <span class="template-card-text">Opening, Praise &amp; Worship, and Word &amp; Offering sets.</span>
              </span>
            </label>
          </div>
        </fieldset>

        <div class="new-plan-group">
          <label class="new-plan-label" for="plan-date">Date</label>
          <input id="plan-date" class="new-plan-input" type="date">
          <div class="date-chips">
            <button type="button" class="date-chip" data-date-shortcut="sunday" aria-pressed="false">Next Sunday</button>
            <button type="button" class="date-chip" data-date-shortcut="saturday" aria-pressed="false">This Saturday</button>
            <button type="button" class="date-chip" data-date-shortcut="today" aria-pressed="false">Today</button>
          </div>
        </div>

        <div class="new-plan-group">
          <label class="new-plan-label" for="plan-name">Plan name</label>
          <input id="plan-name" class="new-plan-input" type="text" maxlength="120">
        </div>

        <div id="mass-fields" class="new-plan-mass-fields">
          <section class="bc-panel" aria-labelledby="schedule-title">
            <p id="schedule-title" class="bc-eyebrow">Holy Mass schedule</p>
            <div id="schedule-fields" style="display: flex; flex-direction: column; gap: 16px"></div>
          </section>
          <div id="schedule-conflict" hidden></div>
        </div>

        <p id="new-plan-status" class="form-error" role="alert"></p>
        <div class="new-plan-buttons">
          <button id="new-plan-submit" type="submit" class="btn-primary" style="height: 44px; padding: 0 22px; font-size: 14px; font-weight: 700">Create plan</button>
          ${cancel ? '<button id="new-plan-cancel" type="button" class="btn-quiet" style="height: 44px; padding: 0 18px; font-size: 14px; font-weight: 600">Cancel</button>' : ''}
        </div>
        <p class="new-plan-note">Songs and readings are chosen in the Plan Editor. Lyrics and slides are prepared in the desktop app.</p>
      </form>

      <aside class="preview-card-box" aria-label="Plan preview">
        <span class="eyebrow">Live preview</span>
        <h2 id="preview-title" class="preview-title"></h2>
        <span id="preview-kind" class="preview-kind"></span>
        <dl class="preview-details">
          <div><dt>Date</dt><dd id="preview-date"></dd></div>
          <div><dt>Liturgical day</dt><dd id="preview-day"></dd></div>
          <div id="preview-language-row"><dt>Language</dt><dd id="preview-language"></dd></div>
          <div id="preview-time-row"><dt>Holy Mass time</dt><dd id="preview-time"></dd></div>
          <div><dt>Order</dt><dd id="preview-count"></dd></div>
        </dl>
        <ul id="preview-parts" class="preview-parts"></ul>
      </aside>`;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The liturgical name of a date, or '' when the date is not a whole date. */
export function dayNameOf(iso) {
  if (!DATE.test(iso ?? '')) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // "2026-02-30" is not a day.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return '';
  return liturgicalDay(iso).name;
}

/**
 * Draws the form in `root` and runs it. `kind` and `date` are its first values (a date from a calendar click; else next Sunday). `plans` are
 * the church's plans for the taken-time warning, when already loaded; `setPlans()` gives them later. `onCreated(plan)` is called with the new
 * plan, `onOpenExisting(id)` when Open Existing is pressed, and `onCancel()` from Cancel. Returns { setPlans, reset, focus }.
 */
export function mountNewPlanForm(root, { kind = 'mass', date = '', plans = [], cancel = false, onCreated, onOpenExisting: openExisting, onCancel } = {}) {
  // The form is drawn from constants (newPlanFormHtml takes no user value).
  root.innerHTML = newPlanFormHtml({ cancel });
  const byId = (id) => root.querySelector(`#${id}`);
  const form = byId('new-plan-form');
  const status = byId('new-plan-status');
  const submit = byId('new-plan-submit');
  const nameInput = byId('plan-name');
  const dateInput = byId('plan-date');
  const massFields = byId('mass-fields');
  const conflictBox = byId('schedule-conflict');
  const shortcuts = [...root.querySelectorAll('[data-date-shortcut]')];

  // Set once the user has typed a name of their own. A suggestion never replaces it.
  let nameIsCustom = false;
  // The church's plans, for the taken-time warning. Until they load (or if they cannot), the server still refuses a taken time.
  let known = plans ?? [];
  let schedule = { massTime: '', massLanguage: '' };
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
    kind: form.elements.kind.value,
    dayName: dayNameOf(dateInput.value),
    // English, Tagalog and Cebuano draft the readings and responses in that language, as on the laptop; another language drafts in English.
    language: textsLanguageFor(schedule.massLanguage),
    massTime: schedule.massTime,
    massLanguage: schedule.massLanguage,
  });

  /** The Holy Mass already at the typed time on the chosen date, or null. */
  const conflict = () => {
    const now = values();
    return now.kind === 'mass' ? conflictIn(known, now.date, now.massTime) : null;
  };

  function suggestName() {
    const suggestion = suggestPlanName(values());
    nameInput.placeholder = suggestion;
    if (!nameIsCustom) nameInput.value = suggestion;
  }

  function renderPreview() {
    const { name, date, kind: chosen, dayName, massTime, massLanguage } = values();
    const template = TEMPLATES[chosen];
    const title = name.trim();
    const isMass = chosen === 'mass';
    byId('preview-title').textContent = title || 'Untitled plan';
    byId('preview-title').classList.toggle('is-empty', !title);
    byId('preview-kind').textContent = template.label;
    byId('preview-date').textContent = date ? shortDate(date) : 'No date chosen';
    byId('preview-day').textContent = dayName || 'Choose a date';
    byId('preview-language-row').hidden = !isMass;
    byId('preview-time-row').hidden = !isMass;
    byId('preview-language').textContent = scheduleText({ massLanguage }) || 'Not set';
    byId('preview-time').textContent = scheduleText({ massTime }) || 'Decide later';
    byId('preview-count').textContent = `${total(chosen)} ${template.unit}`;
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
    const { date, kind: chosen, dayName } = values();
    massFields.hidden = chosen !== 'mass';
    byId('plan-day-line').textContent = date ? `${shortDate(date)}${dayName ? ` · ${dayName}` : ''}` : '';
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

  // Open Existing: the Holy Mass already at that time opens in its editor.
  onOpenExisting(conflictBox, (id) => openExisting?.(id));
  byId('new-plan-cancel')?.addEventListener('click', () => onCancel?.());

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
      onCreated?.(body.plan);
    } catch (err) {
      submit.disabled = false;
      submit.textContent = label;
      if (err.conflict) {
        // Made on another device since the list was read: the server names the plan already there.
        known = [...known.filter((p) => p.id !== err.conflict.id), { ...err.conflict, liturgical_date: err.conflict.date, kind: 'mass' }];
        render();
        conflictBox.querySelector('[data-open-existing]')?.focus();
      } else {
        status.textContent = err.message;
      }
    }
  });

  /** Starts the form again: the date and the plan type given (a calendar day, + Add Time), else next Sunday as a Holy Mass. */
  function reset(next = {}) {
    form.reset();
    nameIsCustom = false;
    status.textContent = '';
    submit.disabled = false;
    submit.textContent = 'Create plan';
    dateInput.value = DATE.test(next.date ?? '') ? next.date : dateShortcut('sunday');
    const choice = form.querySelector(`input[name="kind"][value="${next.kind === 'pw' ? 'pw' : 'mass'}"]`);
    if (choice) choice.checked = true;
    schedule = { massTime: '', massLanguage: '' };
    fields.set(schedule);
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
  };
}

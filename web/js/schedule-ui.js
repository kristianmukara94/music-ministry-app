// The Holy Mass schedule on the web planner, as the church laptop has it (src/planner/MassSchedule.tsx): a typed time with one-tap presets,
// English / Cebuano / Tagalog / Other / Custom pills, the warning when the time is already taken on that date with Open Existing beside it, the
// calendar's schedule badges, and the editor's switcher pills. The rules (reading times, ordering, clashes) are the laptop's own, from
// holy-mass-schedule.js, a byte-for-byte copy of shared/mass-schedule.js. Everything typed reaches the page escaped, never as markup.
// Pure markup builders plus one small DOM mount, so the builders run in tests without a browser.
import {
  MAX_MASS_LANGUAGE,
  MAX_MASS_TIME,
  SCHEDULE_LANGUAGES,
  TIME_PRESETS,
  findTimeConflict,
  isScheduleLanguage,
  normalizeMassLanguage,
  normalizeMassTime,
  planLanguageForSchedule,
  scheduleLabel,
  scheduleLanguageCode,
  timeConflictText,
} from './holy-mass-schedule.js';

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const TIME_PLACEHOLDER = 'e.g. 6:00 AM, 8:00 AM, 9:30 AM';
export const TEXTS_HINT = 'English, Tagalog and Cebuano also set the language of the readings and responses.';
export const OPEN_EXISTING = 'Open Existing';
export const TAKEN_HINT = 'Open it, or pick another time.';
export const OTHER_LANGUAGE = 'Other / Custom';

const labelIcon = (body) =>
  `<svg class="bc-label-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON_CLOCK = labelIcon('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>');
const ICON_LANGUAGES = labelIcon('<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>');

/** A website plan as the schedule rules read it: the list gives `liturgical_date`, a loaded plan `date`. */
export const asSchedulePlan = (plan) => ({ ...plan, liturgicalDate: plan.liturgicalDate ?? plan.liturgical_date ?? plan.date });

/** The Holy Mass plans of a list (anything not Praise & Worship), each readable by the schedule rules. */
export const massPlansOf = (plans) => (plans ?? []).filter((p) => p.kind !== 'pw').map(asSchedulePlan);

/** The Holy Mass already at `massTime` on `date` among `plans`, or null. `exceptId` is the plan being edited. */
export const conflictIn = (plans, date, massTime, exceptId = null) => findTimeConflict(massPlansOf(plans), { date, massTime }, exceptId);

/** A schedule as one line: "6:00 AM · English", or "6:00 AM · EN" with `short`. '' when neither is set. */
export const scheduleText = (plan, short = false) => scheduleLabel(plan, { short });

/** The plan language (EN, TL, CEB) a schedule language drafts its texts in, or `fallback` for the parish's own language. */
export const textsLanguageFor = (massLanguage, fallback = 'EN') => planLanguageForSchedule(massLanguage) ?? fallback;

/** The fields' markup: the time box with its presets, and the language pills with Other's own box. `id` prefixes the element ids. */
export function scheduleFieldsHtml({ massTime = '', massLanguage = '', otherOpen = false, disabled = false, id = 'schedule' } = {}) {
  const off = disabled ? ' disabled' : '';
  const time = normalizeMassTime(massTime);
  const language = normalizeMassLanguage(massLanguage);
  const isOther = otherOpen || (language !== '' && !isScheduleLanguage(language));
  const presets = TIME_PRESETS.map((preset) =>
    `<button type="button" class="bc-chip" data-time-preset="${esc(preset)}" aria-pressed="${time === preset}"${off}>${esc(preset)}</button>`).join('');
  const pills = [
    ...SCHEDULE_LANGUAGES.map((name) => {
      const on = !isOther && language === name;
      return `<button type="button" class="bc-pill" data-schedule-lang="${name}" aria-pressed="${on}"${off}>${name}</button>`;
    }),
    `<button type="button" class="bc-pill" data-schedule-lang="other" aria-pressed="${isOther}"${off}>${OTHER_LANGUAGE}</button>`,
  ].join('');
  return `
    <div class="bc-field">
      <label class="bc-label" for="${id}-time">${ICON_CLOCK}Holy Mass time</label>
      <input id="${id}-time" class="bc-input" data-role="mass-time" type="text" maxlength="${MAX_MASS_TIME}" autocomplete="off" placeholder="${TIME_PLACEHOLDER}" value="${esc(massTime)}"${off}>
      <div class="bc-chips" role="group" aria-label="Quick times">${presets}<span class="bc-hint">Type any time, or tap one of these.</span></div>
    </div>
    <div class="bc-field">
      <span class="bc-label" id="${id}-lang-label">${ICON_LANGUAGES}Language</span>
      <div class="bc-pills" role="group" aria-labelledby="${id}-lang-label">${pills}</div>
      ${isOther ? `<input id="${id}-lang-other" class="bc-input" data-role="lang-other" type="text" maxlength="${MAX_MASS_LANGUAGE}" aria-label="Custom language" placeholder="Type the language" value="${esc(language)}"${off}>` : ''}
      <span class="bc-hint">${TEXTS_HINT}</span>
    </div>`;
}

/** The warning when a time is taken: the plain line, the plan's name, and Open Existing beside it. '' for no conflict. */
export function conflictBannerHtml(conflict) {
  if (!conflict) return '';
  return `
    <div class="bc-alert" role="alert" data-time-conflict>
      <svg class="bc-alert-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>
      <p class="bc-alert-text"><strong>${esc(timeConflictText(conflict))}</strong><span>${conflict.name ? `${esc(conflict.name)} · ` : ''}${TAKEN_HINT}</span></p>
      <button type="button" class="bc-btn-gold" data-open-existing="${esc(conflict.id)}">${OPEN_EXISTING} <span aria-hidden="true">→</span></button>
    </div>`;
}

/** Where Open Existing goes: the Holy Mass plan already at that time, in its editor. `root` is the path to the site root ('' or '../'). */
export const openExistingHref = (id, root = '') => `${root}plan/mass.html?id=${encodeURIComponent(id)}`;

/** Calls `open(id)` with the plan's id when Open Existing inside `el` is pressed. The pages send the browser to openExistingHref. */
export function onOpenExisting(el, open) {
  el.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-open-existing]');
    if (button) open(button.dataset.openExisting);
  });
}

/** Shows the warning for `conflict` in `el`, or hides `el` when there is none. Its text is escaped (conflictBannerHtml). */
export function showConflict(el, conflict) {
  el.innerHTML = conflictBannerHtml(conflict);
  el.hidden = !conflict;
}

/** A calendar cell's badges for its Holy Masses: "6:00 AM · EN" each, "Holy Mass" for one with no schedule. */
export const badgeText = (plan) => scheduleText(plan, true) || 'Holy Mass';

/** A language's short code for a badge (EN, CEB, TL, or the first letters of the parish's own). */
export const languageCode = scheduleLanguageCode;

/**
 * Mounts the fields in `root` and keeps them in step: `onChange({ massTime, massLanguage })` after every change. The time box is not redrawn
 * while it is typed in, so the caret stays put. Returns `{ value, set(next), setDisabled(flag) }`.
 */
export function mountScheduleFields(root, { value = {}, disabled = false, id = 'schedule', onChange = () => {} } = {}) {
  const state = {
    massTime: value.massTime ?? '',
    massLanguage: value.massLanguage ?? '',
    otherOpen: false,
    disabled,
  };
  const current = () => ({ massTime: state.massTime, massLanguage: state.massLanguage });
  const render = (focus = null) => {
    root.innerHTML = scheduleFieldsHtml({ ...state, id });
    if (focus) root.querySelector(focus)?.focus();
  };
  const markPresets = () => {
    const time = normalizeMassTime(state.massTime);
    for (const chip of root.querySelectorAll('[data-time-preset]')) chip.setAttribute('aria-pressed', String(chip.dataset.timePreset === time));
  };
  root.addEventListener('input', (event) => {
    const role = event.target.dataset.role;
    if (role === 'mass-time') {
      state.massTime = event.target.value;
      markPresets();
    } else if (role === 'lang-other') {
      state.massLanguage = event.target.value;
    } else return;
    onChange(current());
  });
  root.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || button.disabled || !root.contains(button)) return;
    if (button.dataset.timePreset) {
      state.massTime = button.dataset.timePreset;
      render(`[data-time-preset="${button.dataset.timePreset}"]`);
    } else if (button.dataset.scheduleLang === 'other') {
      const isOther = state.otherOpen || (state.massLanguage !== '' && !isScheduleLanguage(normalizeMassLanguage(state.massLanguage)));
      state.otherOpen = !isOther;
      // Other starts empty; closing it clears what was typed there.
      if (isOther || isScheduleLanguage(normalizeMassLanguage(state.massLanguage))) state.massLanguage = '';
      render(state.otherOpen ? `#${id}-lang-other` : '[data-schedule-lang="other"]');
    } else if (button.dataset.scheduleLang) {
      const name = button.dataset.scheduleLang;
      state.otherOpen = false;
      state.massLanguage = button.getAttribute('aria-pressed') === 'true' ? '' : name;
      render(`[data-schedule-lang="${name}"]`);
    } else return;
    onChange(current());
  });
  render();
  return {
    get value() {
      return current();
    },
    set(next) {
      state.massTime = next.massTime ?? '';
      state.massLanguage = next.massLanguage ?? '';
      state.otherOpen = false;
      render();
    },
    setDisabled(flag) {
      state.disabled = flag;
      render();
    },
  };
}

/** The editor header's switcher: a pill per Holy Mass on the day ("6:00 AM · English"), the open one marked, then + Add Time. */
export function switcherHtml(dayPlans, activeId, { pathOf, addHref = null } = {}) {
  if (!dayPlans.length) return '';
  const pills = dayPlans.map((plan) => {
    const on = String(plan.id) === String(activeId);
    const label = scheduleText(plan) || 'No time set';
    return on
      ? `<span class="bc-switch is-on" aria-current="page" title="${esc(plan.name)}">${esc(label)}</span>`
      : `<a class="bc-switch" href="${esc(pathOf(plan))}" title="${esc(plan.name)}">${esc(label)}</a>`;
  });
  const add = addHref ? `<a class="bc-switch is-add" href="${esc(addHref)}"><span aria-hidden="true">+</span> Add Time</a>` : '';
  return `<span class="bc-switch-label">Holy Masses on this day</span>${pills.join('')}${add}`;
}

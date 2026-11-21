// The Planner's header, as the church laptop's SERVICE PLANNING → Planner has it: the gold eyebrow, the serif "Planner" heading and a line
// saying what is shown, then the pill switcher (Liturgical Calendar, Praise & Worship Calendar, Plan Editor) and + New Plan. The calendars
// and the New plan page draw it with their tab on; the two editors draw it with Plan Editor on. Plan Editor reopens the plan last opened in
// this browser, and is locked until a plan has been opened, as on the laptop.
//
// Pure markup builders plus small storage helpers, so the tests run them without a browser. Every value written into markup goes through esc().
import { PLANNER_TABS, calendarOfPlan } from './planner-calendar.js';

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const LAST_PLAN_KEY = 'apccmma.planner.lastPlan';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Planner page for a calendar: "index.html?cal=mass" or "?cal=pw". `root` is the path to the site root ('' or '../'). */
export const calendarHref = (kind, root = '', month = '') => `${root}index.html?cal=${kind === 'pw' ? 'pw' : 'mass'}${/^\d{4}-\d{2}$/.test(month) ? `&month=${month}` : ''}`;

/** The editor page for a plan, from the site root: plan/praise.html for Praise & Worship, plan/mass.html for any other plan. */
export const editorHrefFor = (plan, root = '') => `${root}plan/${plan.kind === 'pw' ? 'praise' : 'mass'}.html?id=${encodeURIComponent(plan.id)}`;

/** The New Plan flow for a day and a kind, on the Planner (a modal over the calendar). */
export const newPlanFlowHref = ({ kind = 'mass', date = '' } = {}, root = '') =>
  `${root}index.html?cal=${kind === 'pw' ? 'pw' : 'mass'}&new=${kind === 'pw' ? 'pw' : 'mass'}${/^\d{4}-\d{2}-\d{2}$/.test(date) ? `&date=${date}` : ''}`;

/** A plan as remembered for the Plan Editor tab: its id, kind, name and date. Anything else is dropped; a malformed one is null. */
export function asRememberedPlan(value) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !UUID.test(value.id)) return null;
  return {
    id: value.id,
    kind: value.kind === 'pw' ? 'pw' : 'mass',
    name: typeof value.name === 'string' ? value.name.slice(0, 120) : '',
    date: typeof value.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date) ? value.date : '',
  };
}

/** The plan the Plan Editor tab reopens, or null. A blocked or empty store is null. */
export function lastPlan(storage = globalThis.localStorage) {
  try {
    return asRememberedPlan(JSON.parse(storage?.getItem(LAST_PLAN_KEY) ?? 'null'));
  } catch {
    return null;
  }
}

/** Remembers the plan just opened, for the Plan Editor tab. Not kept when the store is blocked. */
export function rememberPlan(plan, storage = globalThis.localStorage) {
  const kept = asRememberedPlan(plan);
  try {
    if (kept) storage?.setItem(LAST_PLAN_KEY, JSON.stringify(kept));
  } catch {
    // Not kept.
  }
  return kept;
}

/** Forgets the remembered plan when it is the one given (it was deleted), so the Plan Editor tab does not open a plan that is gone. */
export function forgetPlan(id, storage = globalThis.localStorage) {
  try {
    if (lastPlan(storage)?.id === id) storage?.removeItem(LAST_PLAN_KEY);
  } catch {
    // Nothing to forget.
  }
}

/**
 * The header. `tab` is 'mass', 'pw' or 'editor'. `subtitle` replaces the tab's own line (the Plan Editor shows the plan's title and date).
 * `editorPlan` is the plan the Plan Editor tab opens (null locks it). `canCreate` shows + New Plan; `newPlan` is its href, or null for a
 * button the page handles itself (the calendars open the New Plan modal). `title` replaces the "Planner" heading (the Holy Mass editor says
 * "Liturgical Plan", as the laptop does), and `actions` is the page's own markup for the right-hand actions (Duplicate, Save plan), drawn
 * after + New Plan. It is the page's markup, not user text: values in it must already be escaped.
 */
export function plannerHeaderHtml({ tab = 'mass', subtitle = '', root = '', editorPlan = null, canCreate = false, newPlan = null, title = 'Planner', actions = '' } = {}) {
  const line = subtitle || PLANNER_TABS.find((t) => t.key === tab)?.subtitle || '';
  const pills = PLANNER_TABS.map((t) => {
    const on = t.key === tab;
    const label = esc(t.label);
    if (on) return `<span class="ph-tab is-on" aria-current="page" data-planner-tab="${t.key}">${label}</span>`;
    if (t.key === 'editor') {
      return editorPlan
        ? `<a class="ph-tab" href="${esc(editorHrefFor(editorPlan, root))}" data-planner-tab="editor" title="${esc(`Open ${editorPlan.name || 'the last plan'}`)}">${label}</a>`
        : `<span class="ph-tab is-locked" aria-disabled="true" data-planner-tab="editor" title="Open a plan from a calendar first">${label}</span>`;
    }
    const month = editorPlan?.date && tab === 'editor' && calendarOfPlan(editorPlan) === t.key ? editorPlan.date.slice(0, 7) : '';
    return `<a class="ph-tab" href="${esc(calendarHref(t.key, root, month))}" data-planner-tab="${t.key}">${label}</a>`;
  }).join('');
  const plus = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  const action = !canCreate
    ? ''
    : newPlan
      ? `<a class="btn-primary ph-new" href="${esc(newPlan)}">${plus}New Plan</a>`
      : `<button type="button" class="btn-primary ph-new" data-new-plan>${plus}New Plan</button>`;
  return `
    <header class="ph">
      <div class="ph-text">
        <span class="ph-eyebrow">Service Planning</span>
        <h1 class="ph-title">${esc(title)}</h1>
        <p class="ph-subtitle" data-planner-subtitle>${esc(line)}</p>
      </div>
      <div class="ph-actions">
        <nav class="ph-tabs" aria-label="Planner views">${pills}</nav>
        ${action}${actions ? `<div class="ph-page-actions">${actions}</div>` : ''}
      </div>
    </header>`;
}

/** Draws the header into `slot` (an element marked data-planner-header). Returns a setter for the subtitle line. */
export function mountPlannerHeader(slot, options) {
  if (!slot) return { setSubtitle() {} };
  slot.innerHTML = plannerHeaderHtml(options);
  return {
    setSubtitle(text) {
      const line = slot.querySelector('[data-planner-subtitle]');
      if (line) line.textContent = text;
    },
  };
}

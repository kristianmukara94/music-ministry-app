// The Planner (index.html), as the church laptop's SERVICE PLANNING → Planner: the header with Liturgical Calendar, Praise & Worship Calendar
// and Plan Editor, and + New Plan. Each calendar shows a month of its own plans (planner-calendar.js): Holy Mass plans on the Liturgical
// Calendar with their time, language and slots filled ("9:30 AM · EN 8/23"), Praise & Worship plans on theirs. A click on an empty day opens
// the New Plan modal for it, on a day with one plan opens that plan in the Plan Editor, and on a day with several lists them (Available Holy
// Mass Schedules, with + Add Another Holy Mass Schedule). Each day can carry a memo. The list and grid views show the same calendar's plans
// with search, sort and each plan's ··· menu (Edit, Duplicate, Export PDF Setlist, Delete).
//
// The address keeps the calendar and month (?cal=pw&month=2026-12), and ?new=mass|pw&date= opens the New Plan modal (+ New Plan from the Plan
// Editor). Nothing is made up: the plans and memos come from the server.
import { esc, mountSidebar } from './shell.js';
import { guard, parishLine } from './auth.js';
import { getPlan, listDayNotes, listPlans, saveDayNote } from './plan-api.js';
import { MASS_PLAN, PRAISE_PLAN } from './sample-data.js';
import { languageName, slotName } from './mass-language.js';
import { openExistingHref, scheduleText } from './schedule-ui.js';
import { monthOf, shiftMonth } from './plan-calendar.js';
import { calendarHtml, calendarKindOf, calendarMonth, chooserRowHtml, dayClick, liturgicalDay, longDate, massProgress, plannerViewOf, plansOnCalendarDay } from './planner-calendar.js';
import { editorHrefFor, lastPlan, mountPlannerHeader } from './planner-header.js';
import { mountNewPlanForm } from './new-plan-form.js';
import { deletePlanById, deleteWarning, duplicatePlanById } from './plan-actions.js';
import {
  DEFAULT_SORT,
  canCreatePlans,
  localDate,
  massFromItems,
  massRows,
  planTiming,
  praiseFromItems,
  praiseSegments,
  praiseTemplateFor,
  setlistEntries,
  shortDate,
  sortPlans,
  visiblePlans,
} from './plan-model.js';

mountSidebar();

const EMPTY = 'No plans on this calendar yet. Pick a day on the calendar to start one, or create plans on the church laptop.';
const VIEW_KEY = 'apccmma.planner.view';
const PAGE_TITLE = document.title;
const params = new URLSearchParams(location.search);

function readView() {
  try {
    return plannerViewOf(localStorage.getItem(VIEW_KEY));
  } catch {
    return 'calendar';
  }
}

function writeView(view) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Not kept.
  }
}

const state = {
  cal: calendarKindOf(params.get('cal')),
  month: monthOf(params.get('month')) ?? monthOf(localDate()),
  view: readView(),
  query: '',
  sort: DEFAULT_SORT,
  plans: null,
  notes: {},
  notesAvailable: true,
  message: '',
  error: '',
  canEdit: false,
  busy: false,
};

const list = document.getElementById('plan-rows');
const search = document.getElementById('plan-search');
const statusLine = document.getElementById('plan-list-status');
const menu = document.getElementById('plan-menu');
const deleteDialog = document.getElementById('delete-dialog');
const deleteConfirm = document.getElementById('delete-confirm');
const deleteCancel = document.getElementById('delete-cancel');
const deleteError = document.getElementById('delete-error');
const setlistPrint = document.getElementById('setlist-print');
const headerSlot = document.querySelector('[data-planner-header]');

const stroke = (size, body) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON_MASS = stroke(20, '<path d="M12 3v18M7 8h10"/>');
const ICON_PW = stroke(20, '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>');
const ICON_DOTS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
const ICON_EDIT = stroke(16, '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>');
const ICON_VIEW = stroke(16, '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>');
const ICON_COPY = stroke(16, '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>');
const ICON_PRINT = stroke(16, '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>');
const ICON_TRASH = stroke(16, '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>');

/** When a plan was last saved, in the reader's own format. */
const updatedText = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

const planOf = (id) => state.plans?.find((p) => p.id === id);
const editorHref = (plan) => editorHrefFor(plan);
const openPlan = (plan) => location.assign(editorHref(plan));

/** Says what just happened in the line above the list. A screen reader speaks it too. */
function say(text, isError = false) {
  statusLine.textContent = text;
  statusLine.classList.toggle('is-error', isError);
}

/** Keeps the calendar and month in the address, so a reload or a shared link opens the same view. */
function writeAddress() {
  const next = new URLSearchParams();
  next.set('cal', state.cal);
  if (state.month !== monthOf(localDate())) next.set('month', state.month);
  history.replaceState(null, '', `${location.pathname}?${next}`);
}

function renderHeader() {
  mountPlannerHeader(headerSlot, { tab: state.cal, editorPlan: lastPlan(), canCreate: state.canEdit });
}

function renderViewToggle() {
  document.querySelectorAll('[data-view]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.view === state.view)));
  document.getElementById('list-controls').hidden = state.view === 'calendar';
}

/** The message in place of the cards: a loading line, a server error, the empty message, or no match. */
function notice(text, tone = 'var(--muted)') {
  return `<div style="padding: 36px 18px; text-align: center; font-size: 14px; line-height: 1.5; color: ${tone}">${esc(text)}</div>`;
}

function showNotice(text, tone) {
  list.classList.remove('is-grid', 'is-calendar');
  list.innerHTML = notice(text, tone);
}

function card(plan, today) {
  const isPw = plan.kind === 'pw';
  const timing = planTiming(plan.liturgical_date, today);
  const progress = isPw ? null : massProgress(plan, plan.liturgical_date);
  return `
          <article class="plan-card">
            <span class="plan-card-icon">${isPw ? ICON_PW : ICON_MASS}</span>
            <div class="plan-card-main">
              <a class="plan-card-link" href="${esc(editorHref(plan))}">${esc(plan.name)}</a>
              <span class="plan-badges">
                <span class="plan-badge is-kind">${isPw ? 'Praise &amp; Worship' : 'Holy Mass plan'}</span>
                ${!isPw && scheduleText(plan) ? `<span class="plan-badge is-kind">${esc(scheduleText(plan))}</span>` : ''}
                ${progress ? `<span class="plan-badge is-kind">${progress.ready ? 'Ready' : `${progress.done}/${progress.total} slots`}</span>` : `<span class="plan-badge is-kind">${plan.itemCount ?? 0} items</span>`}
                <span class="plan-badge is-${timing}">${timing === 'upcoming' ? 'Upcoming' : 'Past'}</span>
                ${plan.synced_at != null ? '<span class="badge-pill badge-synced">Synced</span>' : ''}
              </span>
              <span class="plan-card-updated">Updated ${esc(updatedText(plan.updated_at))}</span>
            </div>
            <span class="plan-card-date">${esc(shortDate(plan.liturgical_date))}</span>
            <button type="button" class="plan-menu-button" data-menu="${esc(plan.id)}" aria-haspopup="menu" aria-expanded="false" aria-label="Actions for ${esc(plan.name)}">${ICON_DOTS}</button>
          </article>`;
}

/** The plans of the calendar on show. */
const calendarPlans = () => visiblePlans(state.plans ?? [], { tab: state.cal });

function renderRows() {
  closeMenu();
  if (state.error) return showNotice(state.error, 'var(--danger)');
  if (!state.plans) return showNotice('Loading plans…');
  list.classList.toggle('is-calendar', state.view === 'calendar');
  if (state.view === 'calendar') {
    // The calendar shows even with no plans, so a planner can pick a day to create the first one.
    list.classList.remove('is-grid');
    const model = calendarMonth({ kind: state.cal, month: state.month, plans: calendarPlans(), notes: state.notes, today: localDate() });
    list.innerHTML = calendarHtml(model, { canEdit: state.canEdit });
    return;
  }
  const rows = sortPlans(visiblePlans(state.plans, { tab: state.cal, query: state.query }), state.sort);
  if (calendarPlans().length === 0) return showNotice(state.message || EMPTY);
  if (rows.length === 0) return showNotice('No plans match. Clear the search to see them all.');
  const today = localDate();
  list.classList.toggle('is-grid', state.view === 'grid');
  list.innerHTML = rows.map((plan) => card(plan, today)).join('');
}

function render() {
  renderHeader();
  renderViewToggle();
  renderRows();
}

/** Shows the other calendar, keeping the month. */
function showCalendar(kind) {
  if (kind === state.cal) return;
  state.cal = kind;
  writeAddress();
  render();
  headerSlot.querySelector(`[data-planner-tab="${kind}"]`)?.focus();
}

// ---- The ··· menu. One menu, moved to the card that opened it, so the list can redraw without losing it and no card can clip it. ----

let menuButton = null;

const menuItems = () => [...menu.querySelectorAll('button:not(:disabled)')];

function menuItem(action, icon, label, { disabled = false, danger = false } = {}) {
  return `<button type="button" role="menuitem" data-action="${action}"${disabled ? ' disabled' : ''}${danger ? ' class="is-danger"' : ''}>${icon}<span>${label}</span></button>`;
}

function closeMenu({ refocus = false } = {}) {
  if (!menuButton) return;
  const button = menuButton;
  menuButton = null;
  menu.hidden = true;
  button.setAttribute('aria-expanded', 'false');
  if (refocus) button.focus();
}

function openMenu(button) {
  closeMenu();
  menuButton = button;
  const busy = state.busy;
  menu.dataset.plan = button.dataset.menu;
  menu.innerHTML = [
    menuItem('edit', state.canEdit ? ICON_EDIT : ICON_VIEW, state.canEdit ? 'Edit Plan' : 'View Plan'),
    state.canEdit ? menuItem('duplicate', ICON_COPY, 'Duplicate Plan', { disabled: busy }) : '',
    menuItem('export', ICON_PRINT, 'Export PDF Setlist', { disabled: busy }),
    state.canEdit ? `<hr>${menuItem('delete', ICON_TRASH, 'Delete Plan', { disabled: busy, danger: true })}` : '',
  ].join('');
  menu.hidden = false;
  button.setAttribute('aria-expanded', 'true');

  // Below the button, right edges lined up. It goes above instead when the window has no room under the button.
  const edge = 8;
  const rect = button.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const below = rect.bottom + 6;
  menu.style.left = `${Math.max(edge, Math.min(rect.right - width, window.innerWidth - width - edge))}px`;
  menu.style.top = `${below + height > window.innerHeight - edge ? Math.max(edge, rect.top - height - 6) : below}px`;
  menuItems()[0]?.focus();
}

/** Puts keyboard focus back on a plan's ··· button, or on the list when the plan has gone. */
function focusPlan(id) {
  const button = id ? list.querySelector(`[data-menu="${CSS.escape(id)}"]`) : null;
  (button ?? list).focus();
}

// ---- What the menu does. ----

/** One piece of work at a time. Its failure is said in plain words in the line above the list. */
async function runAction(label, work) {
  if (state.busy) return;
  state.busy = true;
  list.setAttribute('aria-busy', 'true');
  say(label);
  try {
    await work();
  } catch (err) {
    say(err.message, true);
  } finally {
    state.busy = false;
    list.removeAttribute('aria-busy');
  }
}

function duplicatePlan(plan) {
  return runAction(`Copying ${plan.name}…`, async () => {
    const { created, source, updatedAt, message, failed } = await duplicatePlanById(plan.id);
    const schedule = created.kind === 'pw' ? {} : { massTime: '', massLanguage: source.massLanguage ?? '', filledSlots: plan.filledSlots ?? [] };
    state.plans = [...state.plans, { id: created.id, name: created.name, liturgical_date: created.date, updated_at: updatedAt, kind: created.kind, ...schedule, itemCount: created.items.length }];
    render();
    say(message, failed);
    focusPlan(created.id);
  });
}

/** What the setlist holds: the filled places of the plan, named as its editor names them. */
function setlistOf(plan, songs) {
  if (plan.kind === 'pw') {
    // The laptop's lineup, or the earlier editor's layout for a plan it laid out: the same choice the editor makes.
    const segments = praiseSegments(praiseTemplateFor(plan.items, PRAISE_PLAN));
    return setlistEntries(praiseFromItems(plan.items, segments), segments, songs);
  }
  const rows = massRows(MASS_PLAN);
  return setlistEntries(massFromItems(plan.items, rows), rows, songs, (row) => slotName(row, plan.language));
}

function setlistMarkup(plan, entries) {
  const when = [shortDate(plan.date), plan.kind !== 'pw' ? scheduleText(plan) : '', plan.kind !== 'pw' && !plan.massLanguage && plan.language ? languageName(plan.language) : ''].filter(Boolean).join(' · ');
  const hasKeys = entries.some((entry) => entry.key);
  return `
    <p class="setlist-eyebrow">${esc(parishLine())}</p>
    <h1>${esc(plan.name)}</h1>
    <p class="setlist-when">${esc(when)}</p>
    <table>
      <thead><tr><th scope="col">#</th><th scope="col">Part</th><th scope="col">Song or text</th>${hasKeys ? '<th scope="col">Key</th>' : ''}</tr></thead>
      <tbody>${entries.map((entry, index) => `<tr><td>${index + 1}</td><td>${esc(entry.label)}</td><td>${esc(entry.title)}</td>${hasKeys ? `<td>${esc(entry.key)}</td>` : ''}</tr>`).join('')}</tbody>
    </table>`;
}

function exportSetlist(listed) {
  return runAction(`Preparing the setlist for ${listed.name}…`, async () => {
    const { plan, songs } = await getPlan(listed.id);
    const entries = setlistOf(plan, songs);
    if (entries.length === 0) throw new Error(`${plan.name} has no songs or text yet, so there is no setlist to export.`);
    setlistPrint.innerHTML = setlistMarkup(plan, entries);
    document.body.classList.add('is-printing-setlist');
    // The browser offers this as the name of the saved PDF.
    document.title = `Setlist - ${plan.name}`;
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('is-printing-setlist');
      document.title = PAGE_TITLE;
    }, { once: true });
    say('Choose Save as PDF in the print window.');
    window.print();
    focusPlan(listed.id);
  });
}

let deleting = null;

function askDelete(plan) {
  deleting = plan;
  document.getElementById('delete-text').textContent = deleteWarning(plan.name);
  deleteError.textContent = '';
  deleteDialog.showModal();
}

deleteCancel.addEventListener('click', () => deleteDialog.close());

// Escape closes the dialog, unless the delete has already been sent.
deleteDialog.addEventListener('cancel', (event) => {
  if (state.busy) event.preventDefault();
});

deleteDialog.addEventListener('close', () => {
  focusPlan(deleting?.id);
  deleting = null;
});

deleteConfirm.addEventListener('click', async () => {
  if (state.busy || !deleting) return;
  const plan = deleting;
  state.busy = true;
  deleteConfirm.disabled = true;
  deleteCancel.disabled = true;
  deleteConfirm.textContent = 'Deleting…';
  deleteError.textContent = '';
  try {
    await deletePlanById(plan.id);
    state.plans = state.plans.filter((p) => p.id !== plan.id);
    render();
    say(`Deleted ${plan.name}.`);
    deleteDialog.close();
  } catch (err) {
    deleteError.textContent = err.message;
  } finally {
    state.busy = false;
    deleteConfirm.disabled = false;
    deleteCancel.disabled = false;
    deleteConfirm.textContent = 'Delete plan';
  }
});

// ---- New Plan: the CREATE A PLAN card over the calendar, the same card plan/new.html shows. ----

const newPlanDialog = document.getElementById('new-plan-dialog');
let newPlanForm = null;
let newPlanReturn = null;

/** A plan just made: on the calendar at once (the pill shows on Back too), then open in the Plan Editor. */
function planCreated(plan) {
  const schedule = plan.kind === 'pw' ? {} : { massTime: plan.massTime ?? '', massLanguage: plan.massLanguage ?? '' };
  const listed = { id: plan.id, name: plan.name, liturgical_date: plan.date, updated_at: plan.updatedAt ?? new Date().toISOString(), kind: plan.kind, ...schedule, filledSlots: [], itemCount: plan.items?.length ?? 0 };
  state.plans = [...(state.plans ?? []).filter((p) => p.id !== plan.id), listed];
  renderRows();
  newPlanReturn = null;
  newPlanDialog.close();
  openPlan(plan);
}

/**
 * Opens Create a plan. From a calendar day (and + Add Another Holy Mass Schedule) it is for that day, in the calendar's kind; from + New Plan
 * (no day) it shows the date and kind picker. Planners and admins only.
 */
function openNewPlan({ kind = state.cal, date = '' } = {}) {
  if (!state.canEdit) return;
  newPlanReturn = document.activeElement;
  if (dayDialog.open) dayDialog.close();
  if (!newPlanForm) {
    newPlanForm = mountNewPlanForm(document.getElementById('new-plan-layout'), {
      kind,
      date,
      plans: state.plans ?? [],
      onCreated: planCreated,
      onOpenExisting: (id) => location.assign(openExistingHref(id)),
      onClose: () => newPlanDialog.close(),
    });
  } else {
    newPlanForm.setPlans(state.plans ?? []);
    newPlanForm.reset({ kind, date });
  }
  newPlanDialog.showModal();
  newPlanForm.focus();
}

// Esc closes the card, as on the laptop, except while the plan is being made.
newPlanDialog.addEventListener('cancel', (event) => {
  if (newPlanForm?.busy) event.preventDefault();
});
// A click on the dimmed page around the card closes it too.
newPlanDialog.addEventListener('click', (event) => {
  if (event.target === newPlanDialog && !newPlanForm?.busy) newPlanDialog.close();
});
newPlanDialog.addEventListener('close', () => {
  newPlanReturn?.focus?.();
  newPlanReturn = null;
});

// ---- A day: Available Holy Mass Schedules (or the day's Praise & Worship plans), and its memo. ----

const dayDialog = document.getElementById('day-dialog');
let dayOpenFor = null;

/** A click on a calendar day: New Plan for an empty day, the plan itself for a day with one, the chooser for a day with several. */
function pickDay(iso) {
  const click = dayClick(state.cal, calendarPlans(), iso, state.canEdit);
  if (click.action === 'create') openNewPlan({ kind: state.cal, date: iso });
  else if (click.action === 'open') openPlan(click.plan);
  else if (click.action === 'pick') openDay(iso, click.plans);
}

function openDay(iso, onDay) {
  dayOpenFor = iso;
  const isPw = state.cal === 'pw';
  const day = liturgicalDay(iso);
  document.getElementById('day-dialog-eyebrow').textContent = isPw ? 'Praise & Worship plans' : 'Available Holy Mass Schedules';
  document.getElementById('day-dialog-title').textContent = longDate(iso);
  document.getElementById('day-dialog-hint').textContent = `${day.name}. ${isPw ? 'Pick a plan to open it.' : 'Pick a Holy Mass to open it, or add another time on this day.'}`;
  document.getElementById('day-dialog-list').innerHTML = onDay.map((plan) => chooserRowHtml(plan, iso, state.cal, editorHref(plan))).join('');
  document.getElementById('day-dialog-actions').innerHTML = state.canEdit
    ? `<button type="button" class="bc-btn-gold" data-dialog-add="${iso}"><span aria-hidden="true">+</span> ${isPw ? 'Add a Praise &amp; Worship Plan' : onDay.length ? 'Add Another Holy Mass Schedule' : 'Add a Holy Mass Schedule'}</button>`
    : '';
  dayDialog.showModal();
  dayDialog.querySelector('.bc-schedule, .bc-btn-gold')?.focus();
}

document.getElementById('day-dialog-close').addEventListener('click', () => dayDialog.close());
dayDialog.addEventListener('click', (event) => {
  // A press on the backdrop closes it.
  if (event.target === dayDialog) dayDialog.close();
  const add = event.target.closest?.('[data-dialog-add]');
  if (add) openNewPlan({ kind: state.cal, date: add.dataset.dialogAdd });
});
dayDialog.addEventListener('close', () => {
  if (!newPlanDialog.open) list.querySelector(`[data-day="${dayOpenFor}"]`)?.focus();
  dayOpenFor = null;
});

const memoDialog = document.getElementById('memo-dialog');
const memoInput = document.getElementById('memo-input');
const memoError = document.getElementById('memo-error');
const memoSave = document.getElementById('memo-save');
const memoRemove = document.getElementById('memo-remove');
let memoFor = null;

function openMemo(iso) {
  if (!state.canEdit) return;
  memoFor = iso;
  document.getElementById('memo-dialog-title').textContent = longDate(iso);
  document.getElementById('memo-dialog-day').textContent = liturgicalDay(iso).name;
  memoInput.value = state.notes[iso] ?? '';
  memoRemove.hidden = !state.notes[iso];
  memoError.textContent = state.notesAvailable ? '' : 'Day memos cannot be saved yet. Ask your admin to update the planner database.';
  memoInput.disabled = !state.notesAvailable;
  memoSave.disabled = !state.notesAvailable;
  memoDialog.showModal();
  memoInput.focus();
}

async function storeMemo(note) {
  if (!memoFor || memoSave.disabled) return;
  const iso = memoFor;
  memoSave.disabled = true;
  memoRemove.disabled = true;
  memoError.textContent = '';
  try {
    const saved = await saveDayNote(iso, note);
    const next = { ...state.notes };
    if (saved.note) next[iso] = saved.note;
    else delete next[iso];
    state.notes = next;
    memoDialog.close();
    renderRows();
    say(saved.note ? `Memo saved for ${shortDate(iso)}.` : `Memo removed from ${shortDate(iso)}.`);
  } catch (err) {
    memoError.textContent = err.message;
  } finally {
    memoSave.disabled = !state.notesAvailable;
    memoRemove.disabled = false;
  }
}

document.getElementById('memo-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void storeMemo(memoInput.value);
});
memoRemove.addEventListener('click', () => void storeMemo(''));
document.getElementById('memo-dialog-close').addEventListener('click', () => memoDialog.close());
memoDialog.addEventListener('close', () => {
  list.querySelector(`[data-memo-day="${memoFor}"]`)?.focus();
  memoFor = null;
});

const ACTIONS = {
  edit: openPlan,
  duplicate: duplicatePlan,
  export: exportSetlist,
  delete: askDelete,
};

menu.addEventListener('click', (event) => {
  const item = event.target.closest('[data-action]');
  if (!item || item.disabled) return;
  const plan = planOf(menu.dataset.plan);
  closeMenu({ refocus: true });
  if (plan) void ACTIONS[item.dataset.action](plan);
});

menu.addEventListener('keydown', (event) => {
  const items = menuItems();
  const at = items.indexOf(document.activeElement);
  const target = { ArrowDown: items[(at + 1) % items.length], ArrowUp: items[(at - 1 + items.length) % items.length], Home: items[0], End: items[items.length - 1] }[event.key];
  if (target) {
    event.preventDefault();
    target.focus();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeMenu({ refocus: true });
  } else if (event.key === 'Tab') {
    // Focus goes back to the ··· button first, so Tab carries on from the card instead of from the end of the page.
    closeMenu({ refocus: true });
  }
});

list.addEventListener('click', (event) => {
  const nav = event.target.closest('[data-cal-nav]');
  if (nav) {
    const step = Number(nav.dataset.calNav);
    state.month = step === 0 ? monthOf(localDate()) : shiftMonth(state.month, step);
    writeAddress();
    renderRows();
    (list.querySelector(`[data-cal-nav="${nav.dataset.calNav}"]:not(:disabled)`) ?? list.querySelector('[data-cal-nav="1"]'))?.focus();
    return;
  }
  const badge = event.target.closest('[data-open-plan]');
  if (badge) {
    const plan = planOf(badge.dataset.openPlan);
    if (plan) openPlan(plan);
    return;
  }
  const add = event.target.closest('[data-add-day]');
  if (add) {
    openNewPlan({ kind: state.cal, date: add.dataset.addDay });
    return;
  }
  const memo = event.target.closest('[data-memo-day]');
  if (memo) {
    openMemo(memo.dataset.memoDay);
    return;
  }
  const day = event.target.closest('[data-day]');
  if (day) {
    // "+N more" always lists the whole day.
    if (day.classList.contains('is-more')) openDay(day.dataset.day, plansOnCalendarDay(state.cal, calendarPlans(), day.dataset.day));
    else pickDay(day.dataset.day);
    return;
  }
  const button = event.target.closest('[data-menu]');
  if (!button) return;
  if (menuButton === button) closeMenu({ refocus: true });
  else openMenu(button);
});

list.addEventListener('keydown', (event) => {
  const button = event.target.closest('[data-menu]');
  if (!button || event.key !== 'ArrowDown') return;
  event.preventDefault();
  openMenu(button);
});

document.addEventListener('click', (event) => {
  if (menuButton && !event.target.closest('#plan-menu, [data-menu]')) closeMenu();
});
// The menu is placed against the window, so it would be left behind when the page moves.
window.addEventListener('scroll', () => closeMenu(), { capture: true, passive: true });
window.addEventListener('resize', () => closeMenu());

// ---- The header and the controls above the list. ----

headerSlot.addEventListener('click', (event) => {
  // The two calendars switch in place; Plan Editor is a link to the editor page.
  const tab = event.target.closest('a[data-planner-tab="mass"], a[data-planner-tab="pw"]');
  if (tab && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) {
    event.preventDefault();
    showCalendar(tab.dataset.plannerTab);
    return;
  }
  if (event.target.closest('[data-new-plan]')) openNewPlan({ kind: state.cal });
});

search.addEventListener('input', (event) => {
  state.query = event.target.value;
  renderRows();
});

document.getElementById('plan-sort').addEventListener('change', (event) => {
  state.sort = event.target.value;
  renderRows();
});

document.querySelector('.view-toggle').addEventListener('click', (event) => {
  const button = event.target.closest('[data-view]');
  if (!button) return;
  state.view = plannerViewOf(button.dataset.view);
  writeView(state.view);
  renderViewToggle();
  renderRows();
});

const user = await guard();
if (user) {
  state.canEdit = canCreatePlans(user.role);

  // "/" goes to the search box in the list, unless the person is already typing somewhere or a dialog is open. The key is added only now,
  // so it cannot move focus behind the change-password screen.
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || state.view === 'calendar') return;
    if (event.target.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
    event.preventDefault();
    closeMenu();
    search.focus();
  });

  render();
  // The memos are extra: a server that cannot store them yet, or a failed read, leaves the calendar without them.
  const notes = listDayNotes().catch(() => ({ notes: {}, available: false }));
  try {
    const body = await listPlans();
    state.plans = body.plans;
    state.message = '';
  } catch (err) {
    state.error = err.message;
  }
  const memoBody = await notes;
  state.notes = memoBody.notes ?? {};
  state.notesAvailable = memoBody.available !== false;
  render();

  // + New Plan from the Plan Editor, and older links: ?new=mass|pw opens the New Plan modal, on ?date= when given.
  const asked = params.get('new');
  if (asked && state.canEdit && !state.error) {
    const date = params.get('date');
    openNewPlan({ kind: calendarKindOf(asked), date: /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? date : '' });
    writeAddress();
  }
}

// Plans: the plan type tabs, the search box, the sort and layout controls, and the list of the church's plans. The plans come from the
// server. Nothing is made up: when the church has no plans the list says so, and a plan shows Synced only while a laptop holds its latest
// version. Each card opens its editor with the plan's id in the address, and its ··· menu holds the plan's other actions.
import { esc, mountSidebar } from './shell.js';
import { guard, parishLine } from './auth.js';
import { createPlan, deletePlan, getPlan, listPlans, savePlan } from './plan-api.js';
import { MASS_PLAN, PRAISE_PLAN } from './sample-data.js';
import { languageName, slotName } from './mass-language.js';
import { timeLabel } from './mass-schedule.js';
import {
  DEFAULT_SORT,
  canCreatePlans,
  duplicateRequest,
  editorPathFor,
  localDate,
  massFromItems,
  massRows,
  planTiming,
  praiseFromItems,
  praiseSegments,
  praiseTemplateFor,
  savePayload,
  setlistEntries,
  shortDate,
  sortPlans,
  tabCounts,
  viewModeOf,
  visiblePlans,
} from './plan-model.js';

mountSidebar();

const EMPTY = 'No plans yet. Plans are created on the church laptop and appear here after sync.';
const VIEW_KEY = 'apccmma_plans_view_mode';
const PAGE_TITLE = document.title;

/** The layout chosen in this browser. A blocked store just starts with the list. */
function readView() {
  try {
    return viewModeOf(localStorage.getItem(VIEW_KEY));
  } catch {
    return 'list';
  }
}

function writeView(view) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Not kept.
  }
}

const state = { tab: 'all', query: '', sort: DEFAULT_SORT, view: readView(), plans: null, message: '', error: '', canEdit: false, busy: false };

const list = document.getElementById('plan-rows');
const search = document.getElementById('plan-search');
const statusLine = document.getElementById('plan-list-status');
const menu = document.getElementById('plan-menu');
const deleteDialog = document.getElementById('delete-dialog');
const deleteConfirm = document.getElementById('delete-confirm');
const deleteCancel = document.getElementById('delete-cancel');
const deleteError = document.getElementById('delete-error');
const setlistPrint = document.getElementById('setlist-print');

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'mass', label: 'Holy Mass' },
  { key: 'pw', label: 'Praise &amp; Worship' },
];
const TAB_ON = 'height:40px;padding:0 16px;border-radius:8px;border:1px solid var(--primary);background:var(--primary);color:var(--on-primary);font-size:14px;font-weight:700;cursor:pointer';
const TAB_OFF = 'height:40px;padding:0 16px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:14px;font-weight:600;cursor:pointer';

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

/** Says what just happened in the line above the list. A screen reader speaks it too. */
function say(text, isError = false) {
  statusLine.textContent = text;
  statusLine.classList.toggle('is-error', isError);
}

function renderTabs() {
  const counts = state.plans ? tabCounts(state.plans) : null;
  document.getElementById('tabs').innerHTML = TABS.map((t) => `
            <button type="button" role="tab" data-tab="${t.key}" aria-selected="${t.key === state.tab}" style="${t.key === state.tab ? TAB_ON : TAB_OFF}">${t.label}${counts ? ` <span style="font-family: 'JetBrains Mono', monospace; font-size: 12px; margin-left: 6px">${counts[t.key]}</span>` : ''}</button>`).join('');
}

function renderViewToggle() {
  document.querySelectorAll('[data-view]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.view === state.view)));
}

/** The message in place of the cards: a loading line, a server error, the empty message, or no match. */
function notice(text, tone = 'var(--muted)') {
  return `<div style="padding: 36px 18px; text-align: center; font-size: 14px; line-height: 1.5; color: ${tone}">${esc(text)}</div>`;
}

function showNotice(text, tone) {
  list.classList.remove('is-grid');
  list.innerHTML = notice(text, tone);
}

function card(plan, today) {
  const isPw = plan.kind === 'pw';
  const timing = planTiming(plan.liturgical_date, today);
  return `
          <article class="plan-card">
            <span class="plan-card-icon">${isPw ? ICON_PW : ICON_MASS}</span>
            <div class="plan-card-main">
              <a class="plan-card-link" href="${esc(editorPathFor(plan))}">${esc(plan.name)}</a>
              <span class="plan-badges">
                <span class="plan-badge is-kind">${isPw ? 'Praise &amp; Worship' : 'Holy Mass plan'}</span>
                <span class="plan-badge is-${timing}">${timing === 'upcoming' ? 'Upcoming' : 'Past'}</span>
                ${plan.synced_at != null ? '<span class="badge-pill badge-synced">Synced</span>' : ''}
              </span>
              <span class="plan-card-updated">Updated ${esc(updatedText(plan.updated_at))}</span>
            </div>
            <span class="plan-card-date">${esc(shortDate(plan.liturgical_date))}</span>
            <button type="button" class="plan-menu-button" data-menu="${esc(plan.id)}" aria-haspopup="menu" aria-expanded="false" aria-label="Actions for ${esc(plan.name)}">${ICON_DOTS}</button>
          </article>`;
}

function renderRows() {
  closeMenu();
  if (state.error) return showNotice(state.error, 'var(--danger)');
  if (!state.plans) return showNotice('Loading plans…');
  if (state.plans.length === 0) return showNotice(state.message || EMPTY);
  const rows = sortPlans(visiblePlans(state.plans, { tab: state.tab, query: state.query }), state.sort);
  if (rows.length === 0) return showNotice('No plans match. Try another tab or clear the search.');
  const today = localDate();
  list.classList.toggle('is-grid', state.view === 'grid');
  list.innerHTML = rows.map((plan) => card(plan, today)).join('');
}

function render() {
  renderTabs();
  renderViewToggle();
  renderRows();
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
    const { plan: source } = await getPlan(plan.id);
    const { plan: created } = await createPlan(duplicateRequest(source, crypto.randomUUID()));
    let updatedAt = created.updatedAt;
    let message = `Copied to ${created.name}.`;
    let failed = false;
    // A new plan starts without a language or a Mass time, so a Holy Mass plan's are saved onto the copy straight after.
    if (created.kind !== 'pw' && (source.language || source.massTime)) {
      try {
        updatedAt = (await savePlan(savePayload(created, created.items, { language: source.language, massTime: source.massTime }))).savedAt;
      } catch {
        message = `Copied to ${created.name}, but its language and Holy Mass time were not copied. Open the copy to set them.`;
        failed = true;
      }
    }
    state.plans = [...state.plans, { id: created.id, name: created.name, liturgical_date: created.date, updated_at: updatedAt, kind: created.kind }];
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
  const when = [shortDate(plan.date), plan.massTime ? timeLabel(plan.massTime) : '', plan.kind !== 'pw' && plan.language ? languageName(plan.language) : ''].filter(Boolean).join(' · ');
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
  document.getElementById('delete-text').textContent = `“${plan.name}” will be removed for everyone, and from the church laptops at their next sync. This cannot be undone here.`;
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
    await deletePlan(plan.id);
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

const ACTIONS = {
  edit: (plan) => location.assign(editorPathFor(plan)),
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

// ---- The controls above the list. ----

document.getElementById('tabs').addEventListener('click', (event) => {
  const button = event.target.closest('[data-tab]');
  if (!button) return;
  state.tab = button.dataset.tab;
  render();
  // The tabs are redrawn, so keep keyboard focus on the one that was pressed.
  document.querySelector(`[data-tab="${state.tab}"]`)?.focus();
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
  state.view = viewModeOf(button.dataset.view);
  writeView(state.view);
  renderViewToggle();
  renderRows();
});

const user = await guard();
if (user) {
  state.canEdit = canCreatePlans(user.role);
  // The New plan button is for planners and admins only.
  document.getElementById('new-plan-actions').style.display = state.canEdit ? 'flex' : 'none';

  // "/" goes to the search box, unless the person is already typing somewhere or a dialog is open. The key is added only now, so it
  // cannot move focus behind the change-password screen.
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest?.('input, textarea, select, [contenteditable]') || deleteDialog.open) return;
    event.preventDefault();
    closeMenu();
    search.focus();
  });

  render();
  try {
    const body = await listPlans();
    state.plans = body.plans;
    state.message = body.message ?? '';
  } catch (err) {
    state.error = err.message;
  }
  render();
}

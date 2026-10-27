// Plans: the plan type tabs, the search box and the list of the church's plans. The plans come from the server. Nothing is made up:
// when the church has no plans the list says so. Each row opens its editor with the plan's id in the address.
import { esc, mountSidebar } from './shell.js';
import { guard } from './auth.js';
import { listPlans } from './plan-api.js';
import { dateLabel, editorPathFor, tabCounts, visiblePlans } from './plan-model.js';

mountSidebar();

const EMPTY = 'No plans yet. Plans are created on the church laptop and appear here after sync.';
const state = { tab: 'all', query: '', plans: null, message: '', error: '' };

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'mass', label: 'Mass' },
  { key: 'pw', label: 'Praise &amp; Worship' },
];
const TAB_ON = 'height:40px;padding:0 16px;border-radius:10px;border:1px solid #ecc98a;background:#2a0c18;color:#ecc98a;font-size:14px;font-weight:700;cursor:pointer';
const TAB_OFF = 'height:40px;padding:0 16px;border-radius:10px;border:1px solid #3a1523;background:transparent;color:#dbb3bf;font-size:14px;font-weight:600;cursor:pointer';

const ICON_MASS = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M7 8h10"/></svg>';
const ICON_PW = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>';

/** The date as it reads in a list: "Sunday 1 November 2026". */
const shortDate = (iso) => dateLabel(iso).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** When a plan was last saved, in the reader's own format. */
const updatedText = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function renderTabs() {
  const counts = state.plans ? tabCounts(state.plans) : null;
  document.getElementById('tabs').innerHTML = TABS.map((t) => `
            <button type="button" role="tab" data-tab="${t.key}" aria-selected="${t.key === state.tab}" style="${t.key === state.tab ? TAB_ON : TAB_OFF}">${t.label}${counts ? ` <span style="font-family: 'JetBrains Mono', monospace; font-size: 12px; margin-left: 6px">${counts[t.key]}</span>` : ''}</button>`).join('');
}

/** The message in place of the rows: a loading line, a server error, the empty message, or no match. */
function notice(text, tone = '#b48d99') {
  return `<div style="padding: 36px 18px; text-align: center; font-size: 14px; line-height: 1.5; color: ${tone}">${esc(text)}</div>`;
}

function renderRows() {
  const list = document.getElementById('plan-rows');
  if (state.error) return void (list.innerHTML = notice(state.error, '#ff9a9a'));
  if (!state.plans) return void (list.innerHTML = notice('Loading plans…'));
  if (state.plans.length === 0) return void (list.innerHTML = notice(state.message || EMPTY));
  const rows = visiblePlans(state.plans, { tab: state.tab, query: state.query });
  if (rows.length === 0) return void (list.innerHTML = notice('No plans match. Try another tab or clear the search.'));
  list.innerHTML = rows.map((p) => {
    const isPw = p.kind === 'pw';
    return `
          <a href="${esc(editorPathFor(p))}" style="display: flex; flex-wrap: wrap; align-items: center; gap: 16px 24px; padding: 18px 22px; border-bottom: 1px solid #2b1019; text-decoration: none; color: inherit">
            <span style="flex: 1 1 280px; min-width: 0; display: flex; align-items: center; gap: 14px">
              <span style="flex: none; width: 44px; height: 44px; border-radius: 12px; background: #2a0c18; border: 1px solid #55202f; display: grid; place-items: center; color: #ecc98a">${isPw ? ICON_PW : ICON_MASS}</span>
              <span style="display: flex; flex-direction: column; gap: 3px; min-width: 0">
                <span style="font-size: 16px; font-weight: 700">${esc(p.name)}</span>
                <span style="font-size: 13px; color: #b48d99">${isPw ? 'Praise &amp; Worship' : 'Mass plan'} · Updated ${esc(updatedText(p.updated_at))}</span>
              </span>
            </span>
            <span style="flex: 0 0 240px; font-size: 14px; color: #dbb3bf">${esc(shortDate(p.liturgical_date))}</span>
          </a>`;
  }).join('');
}

function render() {
  renderTabs();
  renderRows();
}

document.getElementById('tabs').addEventListener('click', (event) => {
  const button = event.target.closest('[data-tab]');
  if (!button) return;
  state.tab = button.dataset.tab;
  render();
  // The tabs are redrawn, so keep keyboard focus on the one that was pressed.
  document.querySelector(`[data-tab="${state.tab}"]`)?.focus();
});

document.getElementById('plan-search').addEventListener('input', (event) => {
  state.query = event.target.value;
  renderRows();
});

const user = await guard();
if (user) {
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

// Plans: the summary cards, the plan type tabs, the search box and the plan list.
import { PLANS, PLAN_STATUS, SUMMARY } from './sample-data.js';
import { esc, mountSidebar } from './shell.js';

mountSidebar();

const state = { tab: 'all', query: '' };

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'mass', label: 'Mass' },
  { key: 'pw', label: 'Praise &amp; Worship' },
];
const TAB_ON = 'height:40px;padding:0 16px;border-radius:10px;border:1px solid #ecc98a;background:#2a0c18;color:#ecc98a;font-size:14px;font-weight:700;cursor:pointer';
const TAB_OFF = 'height:40px;padding:0 16px;border-radius:10px;border:1px solid #3a1523;background:transparent;color:#dbb3bf;font-size:14px;font-weight:600;cursor:pointer';

const ICON_MASS = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M7 8h10"/></svg>';
const ICON_PW = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>';

function renderSummary() {
  document.getElementById('summary').innerHTML = SUMMARY.map((card) => `
      <div style="padding: 20px; border: 1px solid ${card.highlight ? '#55202f' : '#3a1523'}; border-radius: 14px; background: ${card.highlight ? '#2a0c18' : '#1b0a13'}; display: flex; flex-direction: column; gap: 6px">
        <span style="font-size: 12px; font-weight: 700; letter-spacing: 0.12em; color: ${card.highlight ? '#ecc98a' : '#b48d99'}">${esc(card.label)}</span>
        <span style="font-size: 26px; font-weight: 700">${esc(card.value)}</span>
        <span style="font-size: 13px; color: #dbb3bf; line-height: 1.4">${esc(card.detail)}</span>
      </div>`).join('');
}

function renderTabs() {
  const count = (key) => (key === 'all' ? PLANS.length : PLANS.filter((p) => p.kind === key).length);
  document.getElementById('tabs').innerHTML = TABS.map((t) => `
            <button type="button" role="tab" data-tab="${t.key}" aria-selected="${t.key === state.tab}" style="${t.key === state.tab ? TAB_ON : TAB_OFF}">${t.label} <span style="font-family: 'JetBrains Mono', monospace; font-size: 12px; margin-left: 6px">${count(t.key)}</span></button>`).join('');
}

function renderRows() {
  const q = state.query.trim().toLowerCase();
  const rows = PLANS.filter((p) => (state.tab === 'all' || p.kind === state.tab) && (!q || p.name.toLowerCase().includes(q)));
  const list = document.getElementById('plan-rows');
  if (rows.length === 0) {
    list.innerHTML = '<div style="padding: 36px 18px; text-align: center; font-size: 14px; color: #b48d99">No plans match. Try another tab or clear the search.</div>';
    return;
  }
  list.innerHTML = rows.map((p) => {
    const s = PLAN_STATUS[p.status];
    const href = p.kind === 'mass' ? 'plan/mass.html' : 'plan/praise.html';
    return `
          <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 16px 24px; padding: 18px 22px; border-bottom: 1px solid #2b1019">
            <a href="${href}" style="flex: 1 1 280px; min-width: 0; display: flex; align-items: center; gap: 14px">
              <span style="flex: none; width: 44px; height: 44px; border-radius: 12px; background: #2a0c18; border: 1px solid #55202f; display: grid; place-items: center; color: #ecc98a">${p.kind === 'mass' ? ICON_MASS : ICON_PW}</span>
              <span style="display: flex; flex-direction: column; gap: 3px; min-width: 0">
                <span style="font-size: 16px; font-weight: 700">${esc(p.name)}</span>
                <span style="font-size: 13px; color: #b48d99">${p.kind === 'mass' ? 'Mass plan' : 'Praise &amp; Worship'} · ${esc(p.by)}</span>
              </span>
            </a>
            <span style="flex: 0 0 150px; font-size: 14px; color: #dbb3bf">${esc(p.date)}</span>
            <span style="flex: 0 0 190px; display: flex; flex-direction: column; gap: 8px">
              <span style="height: 6px; border-radius: 99px; background: #2b1019; overflow: hidden"><span style="display:block;height:100%;border-radius:99px;background:#ecc98a;width:${Number(p.pct)}%"></span></span>
              <span style="font-size: 13px; color: #dbb3bf">${esc(p.progress)}</span>
            </span>
            <span style="flex: 0 0 170px; display: flex">
              <span style="display:inline-flex;align-items:center;gap:8px;height:30px;padding:0 12px;border-radius:99px;font-size:13px;font-weight:600;color:${s.fg};background:${s.bg}">
                <span style="width:7px;height:7px;border-radius:50%;background:${s.fg}"></span>
                ${esc(s.label)}
              </span>
            </span>
          </div>`;
  }).join('');
}

document.getElementById('tabs').addEventListener('click', (event) => {
  const button = event.target.closest('[data-tab]');
  if (!button) return;
  state.tab = button.dataset.tab;
  renderTabs();
  renderRows();
  // The tabs are redrawn, so keep keyboard focus on the one that was pressed.
  document.querySelector(`[data-tab="${state.tab}"]`)?.focus();
});

document.getElementById('plan-search').addEventListener('input', (event) => {
  state.query = event.target.value;
  renderRows();
});

renderSummary();
renderTabs();
renderRows();

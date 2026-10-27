// The parts every signed-in page shares: the sidebar, and escaping for text written into markup.
import { SYNC } from './sample-data.js';

/** Text made safe to put inside markup. Every value from the data goes through this. */
export const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The path from this page to the site root: '' for pages at the root, '../' for pages under plan/. */
export const base = () => document.documentElement.dataset.base ?? '';

const ICON = {
  plans: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>',
  songs: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  devices: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/></svg>',
};

const LINKS = [
  { key: 'plans', href: 'index.html', label: 'Plans' },
  { key: 'songs', href: 'songs.html', label: 'Songs' },
  { key: 'devices', href: 'devices.html', label: 'Devices &amp; sync' },
];

const LINK_STYLE = 'display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px; font-size: 14px;';
const ON = 'background: #2a0c18; color: #ecc98a; font-weight: 600';
const OFF = 'color: #dbb3bf; font-weight: 500';

/** Replaces the `[data-sidebar]` placeholder with the sidebar. Its value names the current section. */
export function mountSidebar() {
  const slot = document.querySelector('[data-sidebar]');
  if (!slot) return;
  const current = slot.dataset.sidebar;
  const root = base();
  const links = LINKS.map((link) => {
    const on = link.key === current;
    return `<a href="${root}${link.href}"${on ? ' aria-current="page"' : ''} style="${LINK_STYLE} ${on ? ON : OFF}">
        ${ICON[link.key]}
        ${link.label}
      </a>`;
  }).join('');

  slot.outerHTML = `
  <aside class="side" style="flex: 1 1 248px; padding: 24px 16px; border-right: 1px solid #3a1523; background: #150610; display: flex; flex-direction: column; gap: 28px">
    <div style="display: flex; align-items: center; gap: 12px">
      <div style="width: 40px; height: 40px; border-radius: 12px; background: #ecc98a; display: grid; place-items: center">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1c070d" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>
      </div>
      <div style="display: flex; flex-direction: column; line-height: 1.15">
        <span style="font-weight: 800; font-size: 15px; letter-spacing: 0.04em">APCCMMA</span>
        <span style="font-size: 12px; color: #b48d99">Web Planner</span>
      </div>
    </div>
    <nav class="nav" aria-label="Main" style="display: flex; flex-direction: column; gap: 4px">${links}</nav>
    <div style="margin-top: auto; display: flex; flex-direction: column; gap: 12px">
      <div style="display: flex; align-items: center; gap: 10px; padding: 12px; border: 1px solid #3a1523; border-radius: 12px; background: #1b0a13">
        <span style="width: 8px; height: 8px; border-radius: 50%; background: #8fd9ae"></span>
        <div style="display: flex; flex-direction: column; line-height: 1.3">
          <span style="font-size: 13px; font-weight: 600">${esc(SYNC.title)}</span>
          <span style="font-size: 12px; color: #b48d99">${esc(SYNC.when)}</span>
        </div>
      </div>
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 4px 0">
        <span style="font-size: 13px; color: #dbb3bf">${esc(SYNC.account)}</span>
        <a href="${root}login.html" style="font-size: 13px; color: #ecc98a; font-weight: 600">Sign out</a>
      </div>
    </div>
  </aside>`;
}

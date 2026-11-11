// The parts every signed-in page shares: the sidebar, and escaping for text written into markup.
import { signOut } from './auth.js';

// Sign out from any page's sidebar. The button is drawn by mountSidebar, so the handler is on the document.
document.addEventListener('click', (event) => {
  if (event.target.closest('[data-sign-out]')) void signOut();
  const themeButton = event.target.closest('[data-theme-choice]');
  if (themeButton) window.apccmmaTheme?.set(themeButton.dataset.themeChoice);
});

// The switch marks the saved choice, including one made in another tab or a System theme that just changed.
document.addEventListener('apccmma:themechange', () => markThemeChoice());

/** Sets aria-pressed on the Light / Dark / System buttons from the saved choice. */
function markThemeChoice() {
  const pref = window.apccmmaTheme?.preference() ?? 'system';
  for (const button of document.querySelectorAll('[data-theme-choice]')) {
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === pref));
  }
}

const THEME_ICON = {
  light: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/></svg>',
  system: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/></svg>',
};

const THEME_CHOICES = [
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
  { key: 'system', label: 'System' },
];

/** Text made safe to put inside markup. Every value from the data goes through this. */
export const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The path from this page to the site root: '' for pages at the root, '../' for pages under plan/. */
export const base = () => document.documentElement.dataset.base ?? '';

const ICON = {
  plans: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>',
  songs: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  users: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.5c1.5.8 2.5 2.6 2.8 5.5"/></svg>',
  devices: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/></svg>',
};

const LINKS = [
  { key: 'plans', href: 'index.html', label: 'Plans' },
  { key: 'songs', href: 'songs.html', label: 'Songs' },
  { key: 'devices', href: 'devices.html', label: 'Devices &amp; sync' },
  // Only admins see this link: guard() shows it once the server confirms the role.
  { key: 'users', href: 'users.html', label: 'Users', adminOnly: true },
];

const LINK_STYLE = 'display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px; font-size: 14px;';
const ON = 'background: var(--primary); color: var(--on-primary); font-weight: 600';
const OFF = 'color: var(--text); font-weight: 500';

/** Replaces the `[data-sidebar]` placeholder with the sidebar. Its value names the current section. */
export function mountSidebar() {
  const slot = document.querySelector('[data-sidebar]');
  if (!slot) return;
  const current = slot.dataset.sidebar;
  const root = base();
  const links = LINKS.map((link) => {
    const on = link.key === current;
    return `<a href="${root}${link.href}"${on ? ' aria-current="page"' : ''}${link.adminOnly ? ' data-admin-only hidden' : ''} style="${LINK_STYLE} ${on ? ON : OFF}">
        ${ICON[link.key]}
        ${link.label}
      </a>`;
  }).join('');
  const themeButtons = THEME_CHOICES.map(
    (choice) => `<button type="button" data-theme-choice="${choice.key}" aria-pressed="false">${THEME_ICON[choice.key]}${choice.label}</button>`,
  ).join('');

  slot.outerHTML = `
  <aside class="side" style="flex: 1 1 248px; padding: 24px 16px; border-right: 1px solid var(--border); background: var(--sidebar-bg); display: flex; flex-direction: column; gap: 28px">
    <div style="display: flex; align-items: center; gap: 12px">
      <img src="${root}img/logo.png" alt="" width="40" height="40" class="brand-mark small">
      <div style="display: flex; flex-direction: column; gap: 2px; line-height: 1.25; min-width: 0">
        <span style="font-weight: 700; font-size: 15px">APCCMMA Web Planner</span>
        <span data-parish-line style="font-size: 12px; color: var(--muted); overflow-wrap: anywhere">Music Ministry</span>
      </div>
    </div>
    <nav class="nav" aria-label="Main" style="display: flex; flex-direction: column; gap: 4px">${links}</nav>
    <div style="margin-top: auto; display: flex; flex-direction: column; gap: 12px">
      <div style="display: flex; align-items: center; gap: 10px; padding: 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface)">
        <span style="width: 8px; height: 8px; border-radius: 50%; background: var(--pill-text)"></span>
        <div style="display: flex; flex-direction: column; line-height: 1.3">
          <span data-account-name style="font-size: 13px; font-weight: 600; overflow-wrap: anywhere"></span>
          <span data-account-role style="font-size: 12px; color: var(--muted)"></span>
        </div>
      </div>
      <div class="theme-toggle" role="group" aria-label="Colour theme">${themeButtons}</div>
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 4px 0">
        <span style="font-size: 13px; color: var(--text)">Signed in</span>
        <button type="button" data-sign-out style="border: 0; background: transparent; padding: 0; cursor: pointer; font-size: 13px; color: var(--focus); font-weight: 600">Sign out</button>
      </div>
    </div>
  </aside>`;
  markThemeChoice();
}

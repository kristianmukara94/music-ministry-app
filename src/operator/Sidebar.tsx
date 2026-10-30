import { useRef, useState, type ReactNode } from 'react';
import {
  Activity, ArrowDownUp, BookOpen, BookOpenText, ClipboardList, Flower2, Film, FolderOpen, HandHeart, Languages, LayoutGrid, Maximize, Megaphone,
  Menu, Music, NotebookPen, Presentation, Radio, Search, Settings, type LucideIcon,
} from 'lucide-react';
import { useLive } from '../live/store';
import { LANGS, useT, type StringKey } from '../i18n/strings';
import { exportSettings, importSettings, setUi, useUi, type ViewKey } from '../state/ui';
import { toggleFullscreen } from './actions';
import { DatabaseStatus } from '../system/DatabaseStatus';
import { LOGO_SRC } from '../brand/logo';
import { FOOTER_TEXT } from '../legal/license';
import { LibraryTransferDialog } from './LibraryTransfer';

export const NAV: { key: ViewKey; icon: LucideIcon; label: StringKey }[] = [
  { key: 'dashboard', icon: LayoutGrid, label: 'nav.dashboard' },
  { key: 'announcements', icon: Megaphone, label: 'nav.announcements' },
  { key: 'lectionary', icon: BookOpen, label: 'nav.lectionary' },
  { key: 'bible', icon: BookOpenText, label: 'nav.bible' },
  { key: 'rosary', icon: Flower2, label: 'nav.rosary' },
  { key: 'media', icon: Film, label: 'nav.media' },
  { key: 'notes', icon: NotebookPen, label: 'nav.notes' },
  { key: 'lyrics', icon: Music, label: 'nav.lyrics' },
  { key: 'whiteboard', icon: Presentation, label: 'nav.whiteboard' },
  { key: 'planner', icon: ClipboardList, label: 'nav.planner' },
  { key: 'goLive', icon: Radio, label: 'nav.goLive' },
  { key: 'praiseWorship', icon: HandHeart, label: 'nav.praiseWorship' },
  { key: 'settings', icon: Settings, label: 'nav.settings' },
];

/**
 * Sidebar sections, in the order the operator works through them. Each module appears once. The Dashboard is the brand
 * at the top, and Settings is the gear in the icon row above it.
 */
const NAV_GROUPS: { key: StringKey; items: ViewKey[] }[] = [
  { key: 'nav.group.liturgy', items: ['lectionary', 'bible', 'rosary', 'notes'] },
  { key: 'nav.group.worship', items: ['goLive', 'praiseWorship', 'lyrics', 'media', 'announcements'] },
  { key: 'nav.group.management', items: ['planner', 'whiteboard'] },
];

/** Views that are listed in the navigation but not built yet. They are disabled until they are ready. */
const NOT_YET_BUILT: ViewKey[] = [];

/** Category labels: small, spaced, with a hairline running out to the right. Shared by the navigation and the footer headings. */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 mb-1 flex items-center gap-2 px-3">
      <span className="shrink-0 text-xs font-bold tracking-widest text-accent uppercase">{children}</span>
      <span className="h-px flex-1 bg-fg/10" aria-hidden />
    </div>
  );
}

/** One output as a read-only row: a dot, its name, and LIVE or OFF in the status colour. It is not a control, so a stray click mid-service changes nothing. */
function OutputRow({ label, on, stateLabel, collapsed }: { label: string; on: boolean; stateLabel: string; collapsed: boolean }) {
  return (
    <li title={`${label}: ${stateLabel}`} className="flex items-center gap-2 rounded-lg px-3 py-1 text-[15px] font-medium text-fg/85">
      <span
        className={`size-2.5 shrink-0 rounded-full ${on ? 'animate-pulse bg-ok shadow-[0_0_8px_var(--color-ok)]' : 'bg-fg/40'}`}
        aria-hidden
      />
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {!collapsed && <span className={`text-sm font-semibold tracking-wide ${on ? 'text-ok' : 'text-danger'}`}>{stateLabel}</span>}
    </li>
  );
}

/** A footer shortcut row. Generous height so it is easy to hit with a mouse or a touch screen. */
function QuickRow({ icon: Icon, label, collapsed, onClick, children }: {
  icon: LucideIcon; label: string; collapsed: boolean; onClick?: () => void; children?: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} title={label}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-1 text-left text-[15px] font-medium text-fg/85 transition-colors hover:bg-fg/[0.06] hover:text-fg">
      <Icon size={18} strokeWidth={1.7} className="shrink-0 text-fg/70" aria-hidden />
      {!collapsed && <span className="flex-1">{label}</span>}
      {!collapsed && children}
    </button>
  );
}

const KBD = 'rounded-md border border-fg/15 bg-fg/[0.04] px-2 py-0.5 font-mono text-[11px] text-fg/75';

export function Sidebar() {
  const t = useT();
  const { view, collapsed, lang } = useUi();
  const outputs = useLive((s) => s.state.outputs);
  const lowerThirdLive = useLive((s) => s.state.lowerThird.live);
  const [ioOpen, setIoOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const outputRows = [
    { label: t('side.projector'), on: outputs.projector },
    { label: t('side.lowerThird'), on: lowerThirdLive !== null },
    { label: t('side.preview'), on: outputs.preview },
  ];

  const iconButton = 'grid size-9 place-items-center rounded-lg text-fg/70 transition hover:bg-fg/10 hover:text-fg';

  return (
    // No outer scrolling: the header and footer are fixed, and only the navigation column scrolls on short screens.
    // The warm glow in the top corner is the only warm tone on the sidebar; the rest is slate.
    <aside
      style={{ background: 'radial-gradient(120% 34% at 0% 0%, color-mix(in oklab, var(--color-accent) 28%, transparent), color-mix(in oklab, var(--color-accent) 7%, transparent) 55%, transparent 80%), var(--color-canvas)' }}
      className={`flex h-full min-h-0 shrink-0 flex-col justify-between overflow-hidden border-r border-fg/[0.08] px-2 pt-2 pb-2 transition-[width] select-none ${collapsed ? 'w-[76px]' : 'w-[288px]'}`}
    >
      {/* Icon row: the menu button collapses the sidebar, the folder opens the library, the gear opens Settings. */}
      <div className={`flex shrink-0 gap-1 ${collapsed ? 'flex-col items-center' : 'items-center px-1'}`}>
        <button type="button" onClick={() => setUi({ collapsed: !collapsed })} className={iconButton} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <Menu size={20} strokeWidth={1.7} />
        </button>
        <button type="button" onClick={() => setLibraryOpen(true)} className={iconButton} aria-label="Library" title="Library">
          <FolderOpen size={20} strokeWidth={1.7} />
        </button>
        <button type="button" onClick={() => setUi({ view: 'settings' })} className={`${iconButton} ${view === 'settings' ? 'bg-fg/10 text-accent' : ''}`}
          aria-label={t('nav.settings')} title={t('nav.settings')} aria-current={view === 'settings' ? 'page' : undefined}>
          <Settings size={20} strokeWidth={1.7} />
        </button>
      </div>

      {/* Brand: the crest and the app name, in gold. Clicking it returns to the dashboard. */}
      <button type="button" onClick={() => setUi({ view: 'dashboard' })} title={t('nav.dashboard')} aria-current={view === 'dashboard' ? 'page' : undefined}
        className={`mt-2 mb-1 flex shrink-0 items-center rounded-xl px-1 py-1 text-left transition hover:bg-fg/[0.04] ${collapsed ? 'justify-center' : 'gap-2.5'}`}>
        <img src={LOGO_SRC} alt="Our Lady of the Assumption Parish" draggable={false} className="h-14 w-14 shrink-0 object-contain" />
        {!collapsed && (
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[34px] leading-none font-extrabold tracking-tight text-accent [text-shadow:0_0_18px_color-mix(in_oklab,var(--color-accent)_30%,transparent)]">APCCMMA</span>
            <span className="mt-1 text-[8.5px] leading-tight font-semibold tracking-wide text-fg/75 uppercase">Assumption Parish Church • Music Ministry</span>
          </span>
        )}
      </button>

      {/* The navigation is the only part that scrolls, so it fits any screen height without clipping. */}
      <nav aria-label="Modules" className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
        {NAV_GROUPS.map((group) => (
          <div key={group.key} className="flex flex-col">
            {collapsed ? (
              <div className="mx-2 my-2 h-px bg-fg/10" aria-hidden />
            ) : (
              <SectionLabel>{t(group.key)}</SectionLabel>
            )}
            {group.items.map((key) => {
              const { icon: Icon, label } = NAV.find((n) => n.key === key)!;
              const active = view === key;
              // Modules not yet built stay visible but cannot be opened, so an operator mid-service cannot land on a placeholder.
              const soon = NOT_YET_BUILT.includes(key);
              // Go Live carries a pulse while the congregation can see something.
              const onAir = key === 'goLive' && (outputs.projector || outputs.preview);
              return (
                <button key={key} type="button" onClick={() => setUi({ view: key })} title={soon ? `${t(label)} · ${t('nav.comingSoon')}` : t(label)}
                  disabled={soon} aria-current={active ? 'page' : undefined}
                  className={`flex w-full items-center gap-3 rounded-lg border-l-[3px] py-1.5 text-[16px] transition-colors duration-150 ${
                    collapsed ? 'justify-center px-0' : 'px-3'
                  } my-px ${
                    soon
                      ? 'cursor-not-allowed border-transparent font-medium text-fg/40 opacity-50'
                      : active
                        ? 'border-accent bg-gradient-to-r from-accent/20 to-accent/5 font-semibold text-accent'
                        : 'border-transparent font-medium text-fg/85 hover:bg-fg/[0.06] hover:text-fg'
                  }`}>
                  <Icon size={20} strokeWidth={1.6} aria-hidden className="shrink-0" />
                  {!collapsed && <span className="flex-1 truncate text-left">{t(label)}</span>}
                  {!collapsed && onAir && <Activity size={18} aria-hidden className="shrink-0 animate-pulse text-ok" />}
                  {/* Coming-soon items are muted: plain small text, no pill, so they never compete with working tools. */}
                  {!collapsed && soon && <span className="text-[10px] font-medium tracking-wide text-fg/40 uppercase">{t('nav.comingSoon')}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer: quick actions, the database badge, and the outputs. Fixed at the bottom, never scrolled away. */}
      <div className="flex shrink-0 flex-col border-t border-fg/[0.08] pt-1">
        {!collapsed && <SectionLabel>{t('side.quickActions')}</SectionLabel>}
        <div className="flex flex-col gap-0.5">
          <QuickRow icon={Search} label={t('side.search')} collapsed={collapsed} onClick={() => setUi({ paletteOpen: true })}>
            <kbd className={KBD}>Ctrl+K</kbd>
          </QuickRow>

          <div className="flex items-center gap-3 rounded-lg px-3 py-1 text-[15px] font-medium text-fg/85">
            <Languages size={18} strokeWidth={1.7} className="shrink-0 text-fg/70" aria-hidden />
            {!collapsed && <span className="flex-1">{t('side.language')}</span>}
            {!collapsed && (
              <div role="radiogroup" aria-label={t('side.language')} className="flex gap-1">
                {LANGS.map((l) => (
                  <button key={l.code} type="button" role="radio" aria-checked={lang === l.code} onClick={() => setUi({ lang: l.code })}
                    className={`rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold transition ${
                      lang === l.code ? 'border-accent bg-accent/15 text-accent' : 'border-fg/15 bg-fg/[0.04] text-fg/75 hover:text-fg'
                    }`}>
                    {l.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <QuickRow icon={ArrowDownUp} label={t('side.exportImport')} collapsed={collapsed} onClick={() => setIoOpen((o) => !o)} />
          {ioOpen && !collapsed && (
            <div className="mb-1 ml-10 flex gap-2">
              <button type="button" onClick={exportSettings} className="rounded-full border border-fg/15 px-3 py-1 text-xs text-fg/85 transition hover:border-accent/50 hover:bg-fg/[0.06]">{t('side.export')}</button>
              <button type="button" onClick={() => fileInput.current?.click()} className="rounded-full border border-fg/15 px-3 py-1 text-xs text-fg/85 transition hover:border-accent/50 hover:bg-fg/[0.06]">{t('side.import')}</button>
              <input ref={fileInput} type="file" accept="application/json" hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importSettings(f).catch((err) => alert(err.message)); e.target.value = ''; }} />
              <button type="button" onClick={() => setLibraryOpen(true)} className="rounded-full border border-fg/15 px-3 py-1 text-xs text-fg/85 transition hover:border-accent/50 hover:bg-fg/[0.06]">Library</button>
            </div>
          )}

          <QuickRow icon={Maximize} label={t('side.fullscreen')} collapsed={collapsed} onClick={toggleFullscreen}>
            <kbd className={KBD}>Ctrl+Shift+F</kbd>
          </QuickRow>
        </div>

        <div className="mt-2 flex justify-center">
          <DatabaseStatus collapsed={collapsed} />
        </div>

        <div className="mt-1">
          {!collapsed && <SectionLabel>{t('side.outputs')}</SectionLabel>}
          <ul className="flex flex-col gap-0.5 py-1">
            {outputRows.map((row) => (
              <OutputRow key={row.label} label={row.label} on={row.on} stateLabel={row.on ? 'LIVE' : 'OFF'} collapsed={collapsed} />
            ))}
          </ul>
        </div>

        {/* Licensing footer. Subtle on purpose: it identifies the licensed build without competing with the operator's tools. */}
        <p
          title={FOOTER_TEXT}
          className="mt-1 truncate border-t border-fg/[0.08] px-3 pt-2 pb-1 text-center text-[10px] tracking-wide text-fg/45"
        >
          {collapsed ? '©' : FOOTER_TEXT}
        </p>
      </div>
      {libraryOpen && <LibraryTransferDialog onClose={() => setLibraryOpen(false)} />}
    </aside>
  );
}

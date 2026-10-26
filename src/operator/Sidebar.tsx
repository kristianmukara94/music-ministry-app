import { useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownUp, BookOpen, BookOpenText, ClipboardList, Flower2, Film, HandHeart, Languages, LayoutGrid, Maximize, Megaphone,
  Music, NotebookPen, PanelLeftClose, PanelLeftOpen, Presentation, Radio, Search, Settings, type LucideIcon,
} from 'lucide-react';
import { useLive } from '../live/store';
import { LANGS, useT, type StringKey } from '../i18n/strings';
import { exportSettings, importSettings, setUi, useUi, type ViewKey } from '../state/ui';
import { toggleFullscreen } from './actions';
import { DatabaseStatus } from '../system/DatabaseStatus';
import { LOGO_SRC } from '../brand/logo';
import { useNow } from './useNow';
import { FOOTER_TEXT } from '../legal/license';

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

/** Sidebar sections, in the order the operator works through them. Each module appears once. */
const NAV_GROUPS: { key: StringKey; items: ViewKey[] }[] = [
  { key: 'nav.group.liturgy', items: ['lectionary', 'bible', 'rosary', 'notes'] },
  { key: 'nav.group.worship', items: ['goLive', 'praiseWorship', 'lyrics', 'media', 'announcements'] },
  { key: 'nav.group.management', items: ['planner', 'dashboard', 'settings', 'whiteboard'] },
];

/** Views that are listed in the navigation but not built yet. They are disabled until they are ready. */
const NOT_YET_BUILT: ViewKey[] = [];

/** Category labels: small, spaced, gold. Shared by the navigation and the footer headings. */
const SECTION_LABEL = 'mt-2.5 mb-1 px-3 text-xs font-extrabold tracking-widest text-amber-400/80 uppercase';

/** One output as a row: a dot, its name, and a LIVE or OFF badge that is easy to read at a glance. */
function OutputRow({ label, on, stateLabel, collapsed }: { label: string; on: boolean; stateLabel: string; collapsed: boolean }) {
  return (
    <li title={`${label}: ${stateLabel}`} className="flex items-center gap-1.5 rounded-lg px-3 py-1 text-sm font-semibold text-stone-200">
      <span
        className={`size-2.5 shrink-0 rounded-full ${on ? 'animate-pulse bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]' : 'bg-stone-600'}`}
        aria-hidden
      />
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {!collapsed && (
        <span
          className={`rounded-md border px-2 py-1 text-xs font-extrabold tracking-wider ${
            on
              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.25)]'
              : 'border-stone-700 bg-stone-800/60 text-stone-400'
          }`}
        >
          {stateLabel}
        </span>
      )}
    </li>
  );
}

/** A footer shortcut row. Generous height so it is easy to hit with a mouse or a touch screen. */
function QuickRow({ icon: Icon, label, collapsed, onClick, children }: {
  icon: LucideIcon; label: string; collapsed: boolean; onClick?: () => void; children?: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} title={label}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-1 text-left text-sm font-medium text-stone-200 transition-colors hover:bg-stone-800/60 hover:text-stone-100">
      <Icon size={18} className="shrink-0 text-amber-400/80" aria-hidden />
      {!collapsed && <span className="flex-1">{label}</span>}
      {!collapsed && children}
    </button>
  );
}

export function Sidebar() {
  const t = useT();
  const { view, collapsed, lang } = useUi();
  const outputs = useLive((s) => s.state.outputs);
  const lowerThirdLive = useLive((s) => s.state.lowerThird.live);
  const now = useNow();
  const [ioOpen, setIoOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const outputRows = [
    { label: t('side.projector'), on: outputs.projector },
    { label: t('side.lowerThird'), on: lowerThirdLive !== null },
    { label: t('side.preview'), on: outputs.preview },
  ];

  return (
    // No outer scrolling: the header and footer are fixed, and only the navigation column scrolls on short screens.
    <aside className={`flex h-full min-h-0 shrink-0 flex-col justify-between overflow-hidden border-r border-fg/[0.06] bg-canvas/70 px-2 pt-3 pb-2 backdrop-blur-xl transition-[width] select-none ${collapsed ? 'w-[76px]' : 'w-[288px]'}`}>
      {/* Brand card: the crest in a gold-ringed badge, then the parish name and ministry. */}
      <div className={`mb-2 flex shrink-0 items-center rounded-xl border border-stone-800/80 bg-stone-900/60 p-2 ${collapsed ? 'justify-center' : 'gap-3'}`}>
        <div className="shrink-0 rounded-xl border border-amber-500/30 bg-amber-500/10 p-1.5 shadow-md shadow-amber-950/40">
          <img src={LOGO_SRC} alt="Our Lady of the Assumption Parish" draggable={false} className="h-11 w-11 object-contain" />
        </div>
        {!collapsed && (
          <div className="flex min-w-0 flex-1 flex-col">
            <h1 className="truncate text-base font-bold tracking-wide text-stone-100">ASSUMPTION PARISH</h1>
            <span className="truncate text-xs font-bold tracking-widest text-amber-400/90">MUSIC MINISTRY</span>
          </div>
        )}
        {!collapsed && (
          <button type="button" onClick={() => setUi({ collapsed: true })} className="shrink-0 rounded-md p-1 text-stone-400 transition hover:bg-stone-800 hover:text-amber-300" aria-label="Collapse sidebar">
            <PanelLeftClose size={18} />
          </button>
        )}
      </div>
      {collapsed && (
        <button type="button" onClick={() => setUi({ collapsed: false })} className="mb-3 grid place-items-center rounded-md p-1 text-stone-400 transition hover:bg-stone-800 hover:text-amber-300" aria-label="Expand sidebar">
          <PanelLeftOpen size={18} />
        </button>
      )}

      {/* The navigation is the only part that scrolls, so it fits any screen height without clipping. */}
      <nav aria-label="Modules" className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
        {NAV_GROUPS.map((group) => (
          <div key={group.key} className="flex flex-col">
            {collapsed ? (
              <div className="mx-2 my-2 h-px bg-fg/10" aria-hidden />
            ) : (
              <div className={SECTION_LABEL}>{t(group.key)}</div>
            )}
            {group.items.map((key) => {
              const { icon: Icon, label } = NAV.find((n) => n.key === key)!;
              const active = view === key;
              // Modules not yet built stay visible but cannot be opened, so an operator mid-service cannot land on a placeholder.
              const soon = NOT_YET_BUILT.includes(key);
              return (
                <button key={key} type="button" onClick={() => setUi({ view: key })} title={soon ? `${t(label)} · ${t('nav.comingSoon')}` : t(label)}
                  disabled={soon} aria-current={active ? 'page' : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-lg border-l-4 py-1.5 text-[15px] transition-colors duration-150 ${
                    collapsed ? 'justify-center px-0' : 'px-3.5'
                  } my-0.5 ${
                    soon
                      ? 'cursor-not-allowed border-transparent font-medium text-stone-500 opacity-50'
                      : active
                        ? 'border-amber-400 bg-gradient-to-r from-amber-500/20 to-amber-500/5 font-bold text-amber-200'
                        : 'border-transparent font-semibold text-stone-300 hover:bg-stone-800/60 hover:text-stone-100'
                  }`}>
                  <Icon size={20} strokeWidth={2} aria-hidden className={`shrink-0 ${active ? 'text-amber-300 drop-shadow-[0_0_6px_rgba(251,191,36,0.6)]' : ''}`} />
                  {!collapsed && <span className={`flex-1 truncate text-left ${active ? 'drop-shadow-[0_0_6px_rgba(251,191,36,0.45)]' : ''}`}>{t(label)}</span>}
                  {/* Coming-soon items are muted: plain small text, no pill, so they never compete with working tools. */}
                  {!collapsed && soon && <span className="text-[10px] font-medium tracking-wide text-stone-500 uppercase">{t('nav.comingSoon')}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer: quick actions, the database badge, and the outputs. Fixed at the bottom, never scrolled away. */}
      <div className="flex shrink-0 flex-col border-t border-stone-800/80 pt-1">
        {!collapsed && <div className={SECTION_LABEL}>{t('side.quickActions')}</div>}
        <div className="flex flex-col gap-0.5">
          <QuickRow icon={Search} label={t('side.search')} collapsed={collapsed} onClick={() => setUi({ paletteOpen: true })}>
            <kbd className="rounded bg-stone-800 px-2 py-0.5 font-mono text-[11px] text-stone-300">Ctrl K</kbd>
          </QuickRow>

          <div className="flex items-center gap-3 rounded-lg px-3 py-1 text-sm font-medium text-stone-200">
            <Languages size={18} className="shrink-0 text-amber-400/80" aria-hidden />
            {!collapsed && <span className="flex-1">{t('side.language')}</span>}
            {!collapsed && (
              <div role="radiogroup" aria-label={t('side.language')} className="flex rounded-full border border-stone-700 bg-stone-900/70 p-0.5">
                {LANGS.map((l) => (
                  <button key={l.code} type="button" role="radio" aria-checked={lang === l.code} onClick={() => setUi({ lang: l.code })}
                    className={`rounded-full px-2.5 py-1 font-mono text-xs font-bold transition ${
                      lang === l.code ? 'bg-amber-400/20 text-amber-200' : 'text-stone-400 hover:text-stone-100'
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
              <button type="button" onClick={exportSettings} className="rounded-full border border-stone-700 px-3 py-1 text-xs text-stone-200 transition hover:border-amber-400/40 hover:bg-stone-800/60">{t('side.export')}</button>
              <button type="button" onClick={() => fileInput.current?.click()} className="rounded-full border border-stone-700 px-3 py-1 text-xs text-stone-200 transition hover:border-amber-400/40 hover:bg-stone-800/60">{t('side.import')}</button>
              <input ref={fileInput} type="file" accept="application/json" hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importSettings(f).catch((err) => alert(err.message)); e.target.value = ''; }} />
            </div>
          )}

          <QuickRow icon={Maximize} label={t('side.fullscreen')} collapsed={collapsed} onClick={toggleFullscreen}>
            <kbd className="rounded bg-stone-800 px-2 py-0.5 font-mono text-[11px] text-stone-300">Ctrl Shift F</kbd>
          </QuickRow>
        </div>

        <div className="mt-2 flex justify-center">
          <DatabaseStatus collapsed={collapsed} />
        </div>

        <div className="mt-2 border-t border-stone-800/80 pt-1">
          {!collapsed ? (
            <div className="flex items-center justify-between px-3 pt-3">
              <span className="text-xs font-extrabold tracking-widest text-amber-400/80 uppercase">{t('side.outputs')}</span>
              <span className="font-mono text-xs font-semibold text-stone-400 tabular-nums">
                {now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
              </span>
            </div>
          ) : null}
          <ul className="flex flex-col gap-0.5 py-1">
            {outputRows.map((row) => (
              <OutputRow key={row.label} label={row.label} on={row.on} stateLabel={row.on ? 'LIVE' : 'OFF'} collapsed={collapsed} />
            ))}
          </ul>
        </div>

        {/* Licensing footer. Subtle on purpose: it identifies the licensed build without competing with the operator's tools. */}
        <p
          title={FOOTER_TEXT}
          className="mt-1 truncate border-t border-stone-800/80 px-3 pt-2 pb-1 text-center text-[10px] tracking-wide text-stone-500"
        >
          {collapsed ? '©' : FOOTER_TEXT}
        </p>
      </div>
    </aside>
  );
}

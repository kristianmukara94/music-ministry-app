import { useRef, useState, type ReactNode } from 'react';
import {
  Activity, ArrowDownUp, BookOpen, BookOpenText, CalendarDays, Flower2, Film, FolderOpen, Languages, LayoutGrid, Maximize,
  Menu, Music, NotebookPen, Presentation, Radio, Search, Settings, type LucideIcon,
} from 'lucide-react';
import { dispatch, useLive } from '../live/store';
import { LICENSE_LOCKED_TIP, useLicense, useProjectionLocked } from '../live/license';
import { activeNavKey, lineupCount, navHotkeyCombo, outputPills, type OutputPill, type OutputPillKey } from '../../shared/sidebar-nav.js';
import { LANGS, useT, type StringKey } from '../i18n/strings';
import { exportSettings, importSettings, setUi, useUi, type ViewKey } from '../state/ui';
import { toggleFullscreen } from './actions';
import { DatabaseStatus } from '../system/DatabaseStatus';
import { useChurchName, useMinistryName } from '../context/ChurchProfileContext';
import { ChurchEmblem } from '../church/ChurchEmblem';
import { FOOTER_TEXT } from '../legal/license';
import { LibraryTransferDialog } from './LibraryTransfer';

/** `short`: the name shown instead of `label` on compact viewports (below the xl breakpoint). */
export const NAV: { key: ViewKey; icon: LucideIcon; label: StringKey; short?: StringKey }[] = [
  { key: 'dashboard', icon: LayoutGrid, label: 'nav.dashboard' },
  // One workspace for announcements and the Whiteboard. The 'whiteboard' view still opens it, on the Whiteboard's slides.
  { key: 'announcements', icon: Presentation, label: 'nav.announcementsWhiteboard' },
  { key: 'lectionary', icon: BookOpen, label: 'nav.lectionary' },
  { key: 'bible', icon: BookOpenText, label: 'nav.bible' },
  { key: 'rosary', icon: Flower2, label: 'nav.rosary' },
  { key: 'media', icon: Film, label: 'nav.media' },
  { key: 'notes', icon: NotebookPen, label: 'nav.notes', short: 'nav.notesShort' },
  { key: 'lyrics', icon: Music, label: 'nav.lyrics' },
  // One Planner for the Holy Mass and Praise & Worship. A Praise & Worship plan opens in it, under the 'praiseWorship' view (see PlannerView).
  { key: 'planner', icon: CalendarDays, label: 'nav.planner' },
  { key: 'goLive', icon: Radio, label: 'nav.goLive' },
  { key: 'settings', icon: Settings, label: 'nav.settings' },
];

/**
 * Sidebar sections, in the order the operator works through them. Each module appears once. The Service Console (home) leads, without a
 * section label; Settings is the gear in the icon row above it.
 */
const NAV_GROUPS: { key: StringKey | null; items: ViewKey[] }[] = [
  { key: null, items: ['dashboard'] },
  { key: 'nav.group.liturgy', items: ['lectionary', 'bible', 'rosary', 'notes'] },
  { key: 'nav.group.worship', items: ['goLive', 'lyrics', 'media', 'announcements'] },
  { key: 'nav.group.management', items: ['planner'] },
];

/** Views that are listed in the navigation but not built yet. They are disabled until they are ready. */
const NOT_YET_BUILT: ViewKey[] = [];

/** Category labels: small, spaced, with a hairline running out to the right. Shared by the navigation and the footer headings. */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 mb-1 flex items-center gap-2 px-3 short:mt-1.5 short:mb-0.5">
      <span className="shrink-0 text-xs font-bold tracking-widest text-accent uppercase">{children}</span>
      <span className="h-px flex-1 bg-fg/10" aria-hidden />
    </div>
  );
}

/**
 * One output as a quick toggle: a dot and its name, green and pulsing while live, amber while paused. The three share one line, so the
 * footer spends one row. A click does what the top bar and the Service Console cards do (see outputPills).
 */
function OutputChip({ label, pill, stateLabel, tip, collapsed, onClick }: {
  label: string; pill: OutputPill; stateLabel: string; tip: string; collapsed: boolean; onClick: () => void;
}) {
  const tone = pill.paused
    ? { pill: 'border-warn/50 bg-warn/10 text-warn hover:bg-warn/20', dot: 'bg-warn shadow-[0_0_8px_var(--color-warn)]' }
    : pill.on
      ? { pill: 'border-ok/50 bg-ok/10 text-ok hover:bg-ok/20', dot: 'animate-pulse bg-ok shadow-[0_0_8px_var(--color-ok)]' }
      : { pill: 'border-fg/15 text-muted hover:border-fg/30 hover:bg-fg/[0.06] hover:text-fg', dot: 'bg-fg/40' };
  const name = `${label}: ${stateLabel}`;
  return (
    <li className="flex min-w-0">
      <button type="button" onClick={onClick} disabled={pill.disabled} aria-pressed={pill.on} aria-label={name}
        title={`${name}. ${tip}`} data-testid={`output-pill-${pill.key}`}
        className={`flex min-w-0 items-center gap-1 rounded-full border text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
          collapsed ? 'size-5 justify-center' : 'px-1.5 py-0.5'
        } ${tone.pill}`}>
        <span className={`size-2 shrink-0 rounded-full ${tone.dot}`} aria-hidden />
        {!collapsed && <span className="truncate">{label}</span>}
      </button>
    </li>
  );
}

/** A footer shortcut row. Generous height so it is easy to hit with a mouse or a touch screen. */
function QuickRow({ icon: Icon, label, collapsed, onClick, children }: {
  icon: LucideIcon; label: string; collapsed: boolean; onClick?: () => void; children?: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} title={label}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-1 text-left text-[15px] font-medium text-fg/85 transition-colors hover:bg-fg/[0.06] hover:text-fg short:py-0.5 short:text-sm">
      <Icon size={18} strokeWidth={1.7} className="shrink-0 text-fg/70" aria-hidden />
      {!collapsed && <span className="flex-1">{label}</span>}
      {!collapsed && children}
    </button>
  );
}

const KBD = 'rounded-md border border-fg/15 bg-fg/[0.04] px-2 py-0.5 font-mono text-[11px] text-fg/75';
/** The same keycap inside a navigation row: no vertical padding, so a row with a hint is no taller than one without. */
const NAV_KBD = 'shrink-0 rounded-md border px-1.5 font-mono text-[11px] leading-[17px] font-medium';

/** EN, TL, CEB as a radio group. Shared by the Language row and the compact quick-action bar. */
function LangSwitch() {
  const t = useT();
  const lang = useUi((s) => s.lang);
  return (
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
  );
}

/** A square icon button for the compact quick-action bar. The tooltip and accessible name carry the label and its shortcut. */
function QuickIcon({ icon: Icon, label, onClick, pressed }: { icon: LucideIcon; label: string; onClick: () => void; pressed?: boolean }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} aria-pressed={pressed}
      className="grid size-8 shrink-0 place-items-center rounded-lg text-fg/70 transition-colors hover:bg-fg/[0.06] hover:text-fg">
      <Icon size={18} strokeWidth={1.7} aria-hidden />
    </button>
  );
}

export function Sidebar() {
  const t = useT();
  const churchName = useChurchName();
  const ministryName = useMinistryName();
  const { view, collapsed, shortcuts } = useUi();
  const outputs = useLive((s) => s.state.outputs);
  // Only the pause flag: the projector's state changes on every slide step, and the sidebar need not redraw with it.
  const projectorPaused = useLive((s) => s.state.projector.paused);
  const lowerThird = useLive((s) => s.state.lowerThird);
  const queued = useLive((s) => lineupCount(s.state));
  const license = useLicense((s) => s.status);
  const locked = useProjectionLocked();
  const [ioOpen, setIoOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const pills = outputPills({ outputs, projector: { paused: projectorPaused }, lowerThird }, locked);
  const pillLabel: Record<OutputPillKey, string> = { projector: t('side.projector'), lowerThird: t('side.lowerThird'), preview: t('side.preview') };
  const pillTip = (pill: OutputPill) => {
    if (pill.disabled) return LICENSE_LOCKED_TIP;
    if (pill.key === 'preview') return t(pill.on ? 'side.tipMirrorOpen' : 'side.tipMirrorClosed');
    if (!pill.ready) return t('top.tipOpenLowerThird');
    return t(pill.on ? 'side.clickOff' : 'side.clickOn');
  };
  const runPill = ({ intent }: OutputPill) =>
    intent.type === 'dispatch' ? dispatch(intent.action) : setUi({ view: 'media', pendingFocus: { kind: 'lowerThird' } });

  const activeKey = activeNavKey(view);
  const iconButton = 'grid size-9 place-items-center rounded-lg transition focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:outline-none';
  const iconIdle = 'text-fg/70 hover:bg-fg/10 hover:text-fg';

  return (
    // No outer scrolling: the header and footer are fixed, and only the navigation column scrolls on short screens.
    // A flat canvas, with no ambient glow, so the crest and the wordmark render crisply.
    <aside
      className={`flex h-full min-h-0 shrink-0 flex-col justify-between overflow-hidden border-r border-fg/[0.08] bg-canvas px-2 pt-2 pb-2 transition-[width] select-none ${collapsed ? 'w-[76px]' : 'w-[288px]'}`}
    >
      {/* Icon row: the menu button collapses the sidebar, the folder opens the library, the gear opens Settings. */}
      <div className={`flex shrink-0 gap-1 ${collapsed ? 'flex-col items-center' : 'items-center px-1'}`}>
        <button type="button" onClick={() => setUi({ collapsed: !collapsed })} className={`${iconButton} ${iconIdle}`} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <Menu size={20} strokeWidth={1.7} />
        </button>
        <button type="button" onClick={() => setLibraryOpen(true)} className={`${iconButton} ${iconIdle}`} aria-label="Library" title="Library">
          <FolderOpen size={20} strokeWidth={1.7} />
        </button>
        <button type="button" onClick={() => setUi({ view: 'settings' })} className={`${iconButton} ${view === 'settings' ? 'bg-accent text-on-accent' : iconIdle}`}
          aria-label={t('nav.settings')} title={t('nav.settings')} aria-current={view === 'settings' ? 'page' : undefined}>
          <Settings size={20} strokeWidth={1.7} />
        </button>
      </div>

      {/* Brand: the crest and the app name, in gold. Clicking it returns to the dashboard. */}
      {/* It is a shortcut home, not the current-page marker: that is the Service Console item below. */}
      <button type="button" onClick={() => setUi({ view: 'dashboard' })} title={t('nav.dashboard')}
        className={`mt-2 mb-1 flex shrink-0 items-center rounded-xl px-1 py-1 text-left transition hover:bg-fg/[0.04] focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:outline-none focus-visible:ring-inset short:mt-1 short:mb-0 short:py-0.5 ${collapsed ? 'justify-center' : 'gap-2.5'}`}>
        <ChurchEmblem alt={churchName || 'APCCMMA'} className="h-14 w-14 short:h-11 short:w-11" />
        {!collapsed && (
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[34px] leading-none font-extrabold short:text-[30px] tracking-tight text-accent">APCCMMA</span>
            {/* The parish name from the profile, above the ministry line. Long names wrap to two lines rather than being cut off. */}
            {churchName && (
              <span title={churchName} className="mt-1 line-clamp-2 text-[10px] leading-tight font-bold tracking-wide text-fg/90 uppercase">
                {churchName}
              </span>
            )}
            <span title={ministryName} className="mt-0.5 truncate text-[8.5px] leading-tight font-semibold tracking-wide text-muted uppercase">
              {ministryName}
            </span>
          </span>
        )}
      </button>

      {/* The navigation is the only part that scrolls, so it fits any screen height without clipping. */}
      <nav aria-label="Modules" className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
        {NAV_GROUPS.map((group) => (
          <div key={group.key ?? 'home'} className="flex flex-col">
            {group.key === null ? null : collapsed ? (
              <div className="mx-2 my-2 h-px bg-fg/10" aria-hidden />
            ) : (
              <SectionLabel>{t(group.key)}</SectionLabel>
            )}
            {group.items.map((key) => {
              const { icon: Icon, label, short } = NAV.find((n) => n.key === key)!;
              // One current item at most: activeNavKey folds the Whiteboard into Announcements and Praise & Worship into the Planner.
              const active = activeKey === key;
              const combo = navHotkeyCombo(key);
              // An operator's own older shortcut on the same key wins, so the hint is not offered for it.
              const hint = combo && !shortcuts.some((s) => s.key === combo) ? combo : null;
              const count = key === 'goLive' ? queued : 0;
              const countLabel = `${count} ${t('side.lineupItems')}`;
              // Modules not yet built stay visible but cannot be opened, so an operator mid-service cannot land on a placeholder.
              const soon = NOT_YET_BUILT.includes(key);
              const name = soon ? `${t(label)} · ${t('nav.comingSoon')}` : t(label);
              // Go Live carries a pulse while the congregation can see something.
              const onAir = key === 'goLive' && (outputs.projector || outputs.preview);
              return (
                <button key={key} type="button" onClick={() => setUi({ view: key })}
                  title={[name, hint && `(${hint})`, count > 0 && `· ${countLabel}`].filter(Boolean).join(' ')}
                  disabled={soon} aria-current={active ? 'page' : undefined} aria-keyshortcuts={hint ?? undefined}
                  className={`relative flex w-full items-center gap-2.5 rounded-lg border-l-[3px] py-1.5 text-[15px] leading-tight transition-colors duration-150 short:py-1 focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none ${
                    active ? 'focus-visible:ring-fg' : 'focus-visible:ring-accent/70'
                  } ${
                    collapsed ? 'justify-center px-0' : 'px-3'
                  } my-px ${
                    soon
                      ? 'cursor-not-allowed border-transparent font-medium text-faint opacity-50'
                      : active
                        ? 'border-accent bg-accent font-semibold text-on-accent shadow-sm'
                        : 'border-transparent font-medium text-fg/85 hover:bg-fg/[0.06] hover:text-fg'
                  }`}>
                  <Icon size={20} strokeWidth={1.6} aria-hidden className="shrink-0" />
                  {/* A long label (Announcements & Whiteboard) wraps onto a second compact line rather than ending in an ellipsis mid-word. */}
                  {!collapsed && !short && <span data-testid="nav-label" className="line-clamp-2 flex-1 text-left [overflow-wrap:anywhere]">{t(label)}</span>}
                  {!collapsed && short && <span data-testid="nav-label" className="line-clamp-2 flex-1 text-left [overflow-wrap:anywhere]"><span className="hidden xl:inline">{t(label)}</span><span className="xl:hidden">{t(short)}</span></span>}
                  {!collapsed && onAir && <Activity size={18} aria-hidden className={`shrink-0 animate-pulse ${active ? 'text-on-accent' : 'text-ok'}`} />}
                  {/* The loaded lineup's item count. On the collapsed sidebar it sits on the icon's corner. */}
                  {count > 0 && (
                    <span aria-label={countLabel} data-testid="lineup-count"
                      className={`shrink-0 rounded-full text-center font-mono text-[11px] leading-[17px] font-bold tabular-nums ${
                        collapsed ? 'absolute top-0 right-1 min-w-[17px] px-1' : 'min-w-[22px] px-1.5'
                      } ${active ? 'bg-on-accent text-accent' : collapsed ? 'bg-surface-2 text-fg' : 'bg-fg/15 text-fg'}`}>
                      {count}
                    </span>
                  )}
                  {!collapsed && hint && (
                    <kbd aria-hidden className={`${NAV_KBD} ${active ? 'border-on-accent/40 text-on-accent' : 'border-fg/15 bg-fg/[0.04] text-fg/75'}`}>{hint}</kbd>
                  )}
                  {/* Coming-soon items are muted: plain small text, no pill, so they never compete with working tools. */}
                  {!collapsed && soon && <span className="text-[10px] font-medium tracking-wide text-faint uppercase">{t('nav.comingSoon')}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer: quick actions, the database badge, and the outputs. Fixed at the bottom, never scrolled away. */}
      <div className="flex shrink-0 flex-col border-t border-fg/[0.08] pt-1">
        {!collapsed && <SectionLabel>{t('side.quickActions')}</SectionLabel>}
        {/* On a short window (768px tall) the four quick actions fold into one toolbar row, so every navigation link above stays visible. */}
        {!collapsed && (
          <div className="hidden items-center gap-0.5 px-2 short:flex" data-testid="quick-actions-compact">
            <QuickIcon icon={Search} label={`${t('side.search')} (Ctrl+K)`} onClick={() => setUi({ paletteOpen: true })} />
            <QuickIcon icon={ArrowDownUp} label={t('side.exportImport')} pressed={ioOpen} onClick={() => setIoOpen((o) => !o)} />
            <QuickIcon icon={Maximize} label={`${t('side.fullscreen')} (Ctrl+Shift+F)`} onClick={toggleFullscreen} />
            <span className="ml-auto flex items-center gap-1.5">
              <Languages size={16} strokeWidth={1.7} className="shrink-0 text-fg/70" aria-hidden />
              <LangSwitch />
            </span>
          </div>
        )}
        <div className={`flex flex-col gap-0.5 ${collapsed ? '' : 'short:hidden'}`}>
          <QuickRow icon={Search} label={t('side.search')} collapsed={collapsed} onClick={() => setUi({ paletteOpen: true })}>
            <kbd className={KBD}>Ctrl+K</kbd>
          </QuickRow>

          <div className="flex items-center gap-3 rounded-lg px-3 py-1 text-[15px] font-medium text-fg/85 short:py-0.5 short:text-sm">
            <Languages size={18} strokeWidth={1.7} className="shrink-0 text-fg/70" aria-hidden />
            {!collapsed && <span className="flex-1">{t('side.language')}</span>}
            {!collapsed && <LangSwitch />}
          </div>

          <QuickRow icon={ArrowDownUp} label={t('side.exportImport')} collapsed={collapsed} onClick={() => setIoOpen((o) => !o)} />
          <QuickRow icon={Maximize} label={t('side.fullscreen')} collapsed={collapsed} onClick={toggleFullscreen}>
            <kbd className={KBD}>Ctrl+Shift+F</kbd>
          </QuickRow>
        </div>
        {ioOpen && !collapsed && (
          <div className="mb-1 ml-10 flex gap-2 short:mt-0.5 short:ml-3">
            <button type="button" onClick={exportSettings} className="rounded-full border border-fg/15 px-3 py-1 text-xs text-fg/85 transition hover:border-accent/50 hover:bg-fg/[0.06]">{t('side.export')}</button>
            <button type="button" onClick={() => fileInput.current?.click()} className="rounded-full border border-fg/15 px-3 py-1 text-xs text-fg/85 transition hover:border-accent/50 hover:bg-fg/[0.06]">{t('side.import')}</button>
            <input ref={fileInput} type="file" accept="application/json" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) importSettings(f).catch((err) => alert(err.message)); e.target.value = ''; }} />
            <button type="button" onClick={() => setLibraryOpen(true)} className="rounded-full border border-fg/15 px-3 py-1 text-xs text-fg/85 transition hover:border-accent/50 hover:bg-fg/[0.06]">Library</button>
          </div>
        )}

        <div className="mt-2 flex justify-center short:mt-0">
          <DatabaseStatus collapsed={collapsed} />
        </div>

        <ul
          aria-label={t('side.outputs')}
          className={`mt-1.5 flex gap-x-3 gap-y-1 short:mt-1 ${collapsed ? 'justify-center gap-x-0!' : 'flex-wrap items-center justify-center'}`}
        >
          {pills.map((pill) => (
            <OutputChip key={pill.key} pill={pill} label={pillLabel[pill.key]} collapsed={collapsed} tip={pillTip(pill)}
              stateLabel={t(pill.paused ? 'status.paused' : pill.on ? 'status.live' : 'status.off')} onClick={() => runPill(pill)} />
          ))}
        </ul>

        {!collapsed && license?.statusText && (
          <p title={license.statusText} className={`truncate px-3 pt-2 text-center text-[11px] short:pt-1 ${license.canProject ? 'text-muted' : 'text-danger'}`}>
            {license.statusText}
          </p>
        )}

        {/* Licensing footer. Subtle on purpose: it identifies the licensed build without competing with the operator's tools. */}
        <p
          title={FOOTER_TEXT}
          className="mt-1 truncate border-t border-fg/[0.08] px-3 pt-2 pb-1 text-center text-[10px] tracking-wide text-faint short:pt-1 short:pb-0"
        >
          {collapsed ? '©' : FOOTER_TEXT}
        </p>
      </div>
      {libraryOpen && <LibraryTransferDialog onClose={() => setLibraryOpen(false)} />}
    </aside>
  );
}

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Calendar, Smartphone } from 'lucide-react';
import { REMOTE_TAB_ID, RemoteDrawer } from '../remote/RemoteDrawer';
import { dispatch, useLive } from '../live/store';
import { useT } from '../i18n/strings';
import { setUi, useUi } from '../state/ui';
import { comboOf } from '../../shared/shortcuts.js';
import { toggleFullscreen } from './actions';
import { runShortcut } from './shortcuts';
import { SongLyrics } from '../lyrics/SongLyrics';
import { LectionaryDeck } from '../lectionary/LectionaryDeck';
import { BibleDeck } from '../bible/BibleDeck';
import { RosaryDeck } from '../rosary/RosaryDeck';
import { MediaLibrary } from '../media/MediaLibrary';
import { NotesPrayersView } from '../notes/NotesPrayersView';
import { UnifiedDeckView } from '../whiteboard/UnifiedDeckView';
import { PlannerView } from '../planner/PlannerView';
import { GoLiveConsole } from '../golive/GoLiveConsole';
import { Settings } from '../settings/Settings';
import { EulaGate } from '../components/EulaModal';
import { bridge } from '../live/bridge';
import { useTheme } from '../theme/store';
import { stepQueue } from '../planner/routing';
import { watchProjectorPromptChoice } from '../live/prompt-choice';
import { watchRemoteCommands } from '../live/remoteBridge';
import { watchRemoteSteps, watchSlideScale } from '../praise-worship/live';
import { stepLive } from '../praise-worship/live';
import { massShowing, stepMass } from '../golive/massLive';
import { CommandPalette } from './CommandPalette';
import { SanctuaryAlertModal, useSanctuaryAlertHotkey } from './SanctuaryAlertModal';
import { ProjectorPrompt } from './ProjectorPrompt';
import { SplitStanzaDialog } from '../praise-worship/SplitStanzaDialog';
import { BoothLighting } from './BoothLighting';
import { Dashboard } from './Dashboard';
import { PreviewPanel } from './PreviewPanel';
import { NAV, Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { startLiveSongWatch } from '../live/liveSongs';
import { LiveNoticeBanner } from '../live/LiveNoticeBanner';
import { LicenseBanner } from '../live/LicenseBanner';
import { startLicenseWatch } from '../live/license';
import { watchPlanSlotTitle } from '../planner/plan-api';

function useGlobalHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      if (ui.capturingHotkey) return;
      const key = e.key.toLowerCase();

      if ((e.ctrlKey || e.metaKey) && key === 'k') {
        e.preventDefault();
        setUi({ paletteOpen: !ui.paletteOpen });
        return;
      }
      if (e.ctrlKey && e.shiftKey && key === 'f') {
        e.preventDefault();
        toggleFullscreen();
        return;
      }

      const typing = (e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]');
      if (typing || ui.paletteOpen) return;
      // Ctrl+Down and Ctrl+Up move through the order of service. The item is staged, not taken live.
      if (e.ctrlKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        void stepQueue(e.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      // The Rosary Guide handles its own Space, arrow and Enter keys, so the global step does not run too.
      if (ui.view === 'rosary' && [' ', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) return;

      // A saved shortcut runs its action. A shortcut still waiting for a key has an empty combo and never matches.
      const combo = comboOf(e);
      const shortcut = combo ? ui.shortcuts.find((s) => s.key === combo) : undefined;
      if (shortcut) {
        e.preventDefault();
        runShortcut(shortcut);
        return;
      }
      // Presentation clickers send PageUp/PageDown. While Praise & Worship or the Holy Mass is on air they step its lineup instead, the same way
      // as the console's Next and Back. On a live console, Down, Up and Space step it too; a focused button keeps Space for itself.
      const live = useLive.getState().state;
      const lineup = live.pw?.onAir ? 'pw' : massShowing(live) ? 'mass' : null;
      const consoleKeys = lineup !== null && (ui.view === 'goLive' || ui.view === 'praiseWorship') && !(e.key === ' ' && (e.target as HTMLElement).closest('button'));
      const delta =
        e.key === 'PageDown' || e.key === 'ArrowRight' || (consoleKeys && (e.key === 'ArrowDown' || e.key === ' '))
          ? 1
          : e.key === 'PageUp' || e.key === 'ArrowLeft' || (consoleKeys && e.key === 'ArrowUp')
            ? -1
            : 0;
      // With a dialog open (Add slides, Reset order), the keys are the dialog's: nothing on screen moves behind it.
      if (!delta || document.querySelector('[aria-modal="true"]')) return;
      // Keys a control already handled (tab lists, arrangement chips) do not step the lineup.
      if (lineup) {
        if (e.defaultPrevented) return;
        e.preventDefault();
        void (lineup === 'pw' ? stepLive(delta) : stepMass(delta));
      } else dispatch({ type: 'projector/step', delta });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function ModulePlaceholder() {
  const t = useT();
  const view = useUi((s) => s.view);
  const nav = NAV.find((n) => n.key === view)!;
  return (
    <div className="p-5">
      <div className="rounded-xl border border-line bg-panel p-8">
        <nav.icon size={28} strokeWidth={1.6} aria-hidden />
        <h1 className="mt-4 text-4xl font-extrabold tracking-tight">{t(nav.label)}</h1>
        <p className="mt-2 max-w-xl text-muted">{t('module.soon')}</p>
      </div>
    </div>
  );
}

function EdgeTabs() {
  const t = useT();
  const remoteOpen = useUi((s) => s.remoteOpen);
  // Each tab slides a little toward the centre on hover, so the edge reads as a set of buttons.
  const tab = 'group relative flex h-[150px] w-12 flex-col items-center justify-center gap-2.5 rounded-l-xl border border-r-0 border-fg/15 bg-panel-2 transition-transform duration-200 hover:-translate-x-1.5 hover:bg-fg/10';
  const label = 'text-[13px] font-black tracking-[0.2em] uppercase condensed [writing-mode:vertical-rl]';
  const icon = 'text-accent transition-transform duration-200 group-hover:scale-110';
  return (
    // Below the top bar, wherever it ends. The bar is one row when the window is wide and two when it is not.
    <div className="fixed top-[calc(var(--topbar-h)+86px)] right-0 z-20 flex flex-col gap-3">
      {/* Toggles: a second click closes the drawer. The drawer's outside-click check skips this tab, so the two do not fight. */}
      <button
        id={REMOTE_TAB_ID}
        type="button"
        className={tab}
        onClick={() => setUi({ remoteOpen: !useUi.getState().remoteOpen })}
        aria-label={t('remote.tab')}
        aria-expanded={remoteOpen}
      >
        <Smartphone size={16} strokeWidth={2.25} aria-hidden className={icon} />
        <span className={label}>{t('remote.tab')}</span>
      </button>
      <button type="button" className={tab} onClick={() => setUi({ view: 'planner' })}>
        <Calendar size={16} strokeWidth={2.25} aria-hidden className={icon} />
        <span className={label}>{t('queue.planner')}</span>
      </button>
    </div>
  );
}

export function OperatorApp() {
  // Keeps the projector-prompt choice in step with the projector and the loaded queue or session.
  useEffect(() => watchProjectorPromptChoice(), []);
  useEffect(() => watchSlideScale(), []);
  // The loaded Holy Mass plan's own choice for slot titles on the projector.
  useEffect(() => watchPlanSlotTitle(), []);
  useEffect(() => watchRemoteSteps(), []);
  useEffect(() => watchRemoteCommands(), []);
  // A song or prayer on the projector follows its edits, and the operator is told when it was deleted.
  useEffect(() => startLiveSongWatch(), []);
  useEffect(() => startLicenseWatch(), []);
  const view = useUi((s) => s.view);
  const previewOpen = useUi((s) => s.previewOpen);
  const lang = useUi((s) => s.lang);
  useGlobalHotkeys();
  useSanctuaryAlertHotkey();
  // The saved default language applies at launch. The sidebar switch then overrides it for this session.
  useEffect(() => {
    bridge.config
      .get()
      .then((s) => {
        setUi({ lang: s.config.default_language });
        // The saved theme applies before the first paint of the operator window.
        useTheme.getState().hydrate(s.config.theme);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang === 'tl' ? 'fil' : lang;
  }, [lang]);

  // The top bar's real height. It is one row in a wide window and two in a narrower one, and the overlays below it (the queue drawer and
  // the edge tabs) start where it ends, so they read it from --topbar-h rather than assuming a row.
  const barRef = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(48);
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const read = () => setBarHeight(Math.round(bar.getBoundingClientRect().height));
    read();
    const observer = new ResizeObserver(read);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-clip bg-canvas text-fg" style={{ '--topbar-h': `${barHeight}px` } as CSSProperties}>
      {/* The top bar spans the full width. The queue drawer, planner tab and command palette are overlays above it. */}
      <div ref={barRef} className="relative z-20 w-full shrink-0">
        <TopBar />
      </div>
      <LiveNoticeBanner />
      <LicenseBanner />

      <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-clip">
        <Sidebar />
        {/* pt-6 keeps headings and the first cards clear of the top bar. pr-14 leaves room for the edge tabs. */}
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden pt-6 pr-14">
          {view === 'dashboard' && <Dashboard />}
          {/* Announcements and the Whiteboard are one workspace. A link that still asks for the Whiteboard opens it on the Whiteboard's slides. */}
          {(view === 'announcements' || view === 'whiteboard') && <UnifiedDeckView />}
          {view === 'lyrics' && <SongLyrics />}
          {view === 'lectionary' && <LectionaryDeck />}
          {view === 'bible' && <BibleDeck />}
          {view === 'rosary' && <RosaryDeck />}
          {view === 'media' && <MediaLibrary />}
          {/* One Planner for both views, so moving between a Mass plan and a Praise & Worship plan keeps it mounted. */}
          {(view === 'planner' || view === 'praiseWorship') && <PlannerView />}
          {view === 'goLive' && <GoLiveConsole />}
          {view === 'settings' && <Settings />}
          {view === 'notes' && <NotesPrayersView />}
          {!['dashboard', 'announcements', 'lyrics', 'lectionary', 'bible', 'rosary', 'media', 'notes', 'whiteboard', 'planner', 'praiseWorship', 'goLive', 'settings'].includes(view) && <ModulePlaceholder />}
        </main>
      </div>

      <EdgeTabs />
      <RemoteDrawer />
      {/* The floating preview sits above whatever module is open. The top bar's Preview button toggles it. */}
      {previewOpen && <PreviewPanel />}
      <CommandPalette />
      {/* Ctrl+Shift+A from any window. Above the palette; the EULA gate still covers it. */}
      <SanctuaryAlertModal />
      <ProjectorPrompt />
      <SplitStanzaDialog />
      {/* Above everything else. Shown until the operator accepts the license, then it renders nothing. */}
      <EulaGate />
      {/* The booth lighting preset (Red-Shift, High Contrast) over the whole operator window. It never takes a click. */}
      <BoothLighting />
    </div>
  );
}

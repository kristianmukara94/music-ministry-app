import { useEffect, useRef } from 'react';
import { Calendar, ListOrdered, X } from 'lucide-react';
import { dispatch, useLive } from '../live/store';
import { useT } from '../i18n/strings';
import { setUi, useUi } from '../state/ui';
import { comboOf } from '../../shared/shortcuts.js';
import { toggleFullscreen } from './actions';
import { runShortcut } from './shortcuts';
import { AnnouncementsDeck } from '../announcements/AnnouncementsDeck';
import { SongLyrics } from '../lyrics/SongLyrics';
import { LectionaryDeck } from '../lectionary/LectionaryDeck';
import { BibleDeck } from '../bible/BibleDeck';
import { RosaryDeck } from '../rosary/RosaryDeck';
import { MediaLibrary } from '../media/MediaLibrary';
import { NotesPrayersView } from '../notes/NotesPrayersView';
import { WhiteboardDeck } from '../whiteboard/WhiteboardDeck';
import { MEDIA_DRAG } from '../media/types';
import { addToQueue } from '../planner/plan-api';
import { MassPlanner } from '../planner/MassPlanner';
import { PraiseWorship } from '../praise-worship/PraiseWorship';
import { GoLiveHub } from '../golive/GoLiveHub';
import { Settings } from '../settings/Settings';
import { EulaGate } from '../components/EulaModal';
import { bridge } from '../live/bridge';
import { useTheme } from '../theme/store';
import { ServiceQueue } from '../planner/ServiceQueue';
import { stepQueue } from '../planner/routing';
import { watchProjectorPromptChoice } from '../live/prompt-choice';
import { watchSlideScale } from '../praise-worship/live';
import { stepLive } from '../praise-worship/live';
import { CommandPalette } from './CommandPalette';
import { ProjectorPrompt } from './ProjectorPrompt';
import { Dashboard } from './Dashboard';
import { PreviewPanel } from './PreviewPanel';
import { NAV, Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { startLiveSongWatch } from '../live/liveSongs';
import { LiveNoticeBanner } from '../live/LiveNoticeBanner';

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
      // Presentation clickers send PageUp/PageDown. While Praise & Worship is on air they step its lineup instead.
      const delta = e.key === 'PageDown' || e.key === 'ArrowRight' ? 1 : e.key === 'PageUp' || e.key === 'ArrowLeft' ? -1 : 0;
      // Keys a control already handled (tab lists, arrangement chips) do not step the lineup.
      if (delta && useLive.getState().state.pw?.onAir) {
        if (!e.defaultPrevented) void stepLive(delta);
      } else if (delta) dispatch({ type: 'projector/step', delta });
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
  const queueCount = useLive((s) => s.state.queue.length);
  // Each tab slides a little toward the centre on hover, so the edge reads as a set of buttons.
  const tab = 'group relative flex h-[150px] w-12 flex-col items-center justify-center gap-2.5 rounded-l-xl border border-r-0 border-fg/15 bg-panel-2 transition-transform duration-200 hover:-translate-x-1.5 hover:bg-fg/10';
  const label = 'text-[13px] font-black tracking-[0.2em] uppercase condensed [writing-mode:vertical-rl]';
  const icon = 'text-accent transition-transform duration-200 group-hover:scale-110';
  return (
    <div className="fixed top-[134px] right-0 z-20 flex flex-col gap-3">
      <button id="queue-nav-button" type="button" className={tab} onClick={() => setUi({ queueOpen: true })} aria-label={`${t('queue.tab')}: ${queueCount} ${t('card.items')}`}>
        <ListOrdered size={16} strokeWidth={2.25} aria-hidden className={icon} />
        <span className={label}>{t('queue.tab')}</span>
        {queueCount > 0 && (
          <span
            aria-hidden
            className="absolute -top-2 -left-2 grid min-w-6 place-items-center rounded-full bg-accent px-1.5 py-0.5 font-mono text-[11px] font-extrabold text-on-accent shadow-[0_0_12px_color-mix(in_oklab,var(--color-accent)_55%,transparent)]"
          >
            {queueCount}
          </span>
        )}
      </button>
      <button type="button" className={tab} onClick={() => setUi({ view: 'planner' })}>
        <Calendar size={16} strokeWidth={2.25} aria-hidden className={icon} />
        <span className={label}>{t('queue.planner')}</span>
      </button>
    </div>
  );
}

function QueueDrawer() {
  const t = useT();
  const open = useUi((s) => s.queueOpen);
  const queue = useLive((s) => s.state.queue);
  const drawerRef = useRef<HTMLElement>(null);
  // Q is tracked so a Q+click on a Bible verse queues it without closing the drawer.
  const qHeld = useRef(false);

  // A mousedown outside the drawer closes it. The queue tab is excluded, so its own click does not toggle twice.
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (drawerRef.current?.contains(target)) return;
      if (document.getElementById('queue-nav-button')?.contains(target)) return;
      if (qHeld.current) return;
      setUi({ queueOpen: false });
    };
    const down = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'q' && !(e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) qHeld.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'q') qHeld.current = false;
    };
    const clear = () => {
      qHeld.current = false;
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
    };
  }, [open]);

  if (!open) return null;
  const close = () => setUi({ queueOpen: false });
  // The drawer sits below the top bar, so the window controls and the Projector status stay clickable.
  // The backdrop only dims the page. Clicks pass through it, and the outside-click listener closes the drawer.
  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 top-12 z-30 bg-black/50" aria-hidden />
      <aside
        ref={drawerRef}
        // Clicks inside the drawer never reach the outside-click listener.
        onMouseDown={(e) => e.stopPropagation()}
        className="fixed top-12 right-0 z-40 flex h-[calc(100vh-3rem)] w-[380px] flex-col border-l border-line bg-panel shadow-2xl"
        aria-label={t('card.queue')}
        // A media card dropped here joins the queue, in the introductory rites. The queue then stages it.
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(MEDIA_DRAG)) e.preventDefault();
        }}
        onDrop={(e) => {
          const raw = e.dataTransfer.getData(MEDIA_DRAG);
          if (!raw) return;
          e.preventDefault();
          const { id, label } = JSON.parse(raw) as { id: number; label: string };
          addToQueue([{ block: 'introductory', module: 'media', sourceId: String(id), label }]).catch((err) =>
            window.alert(err instanceof Error ? err.message : String(err)),
          );
        }}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-bold tracking-tight text-fg">Mass Queue</h2>
            <span className="rounded-full bg-accent/20 px-2 py-0.5 font-mono text-xs font-bold text-accent tabular-nums">{queue.length}</span>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close queue"
            className="grid size-8 place-items-center rounded-md border border-line text-fg/60 transition hover:border-fg/30 hover:text-fg"
          >
            <X size={16} aria-hidden />
          </button>
        </header>
        <ServiceQueue items={queue} />
      </aside>
    </>
  );
}

export function OperatorApp() {
  // Keeps the projector-prompt choice in step with the projector and the loaded queue or session.
  useEffect(() => watchProjectorPromptChoice(), []);
  useEffect(() => watchSlideScale(), []);
  // A song or prayer on the projector follows its edits, and the operator is told when it was deleted.
  useEffect(() => startLiveSongWatch(), []);
  const view = useUi((s) => s.view);
  const previewOpen = useUi((s) => s.previewOpen);
  const lang = useUi((s) => s.lang);
  useGlobalHotkeys();
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

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-canvas text-fg">
      {/* The top bar spans the full width. The queue drawer, planner tab and command palette are overlays above it. */}
      <div className="relative z-20 w-full shrink-0">
        <TopBar />
      </div>
      <LiveNoticeBanner />

      <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
        <Sidebar />
        {/* pt-6 keeps headings and the first cards clear of the top bar. pr-14 leaves room for the edge tabs. */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden pt-6 pr-14">
          {view === 'dashboard' && <Dashboard />}
          {view === 'announcements' && <AnnouncementsDeck />}
          {view === 'lyrics' && <SongLyrics />}
          {view === 'lectionary' && <LectionaryDeck />}
          {view === 'bible' && <BibleDeck />}
          {view === 'rosary' && <RosaryDeck />}
          {view === 'media' && <MediaLibrary />}
          {view === 'planner' && <MassPlanner />}
          {view === 'praiseWorship' && <PraiseWorship />}
          {view === 'goLive' && <GoLiveHub />}
          {view === 'settings' && <Settings />}
          {view === 'notes' && <NotesPrayersView />}
          {view === 'whiteboard' && <WhiteboardDeck />}
          {!['dashboard', 'announcements', 'lyrics', 'lectionary', 'bible', 'rosary', 'media', 'notes', 'whiteboard', 'planner', 'praiseWorship', 'goLive', 'settings'].includes(view) && <ModulePlaceholder />}
        </main>
      </div>

      <EdgeTabs />
      <QueueDrawer />
      {/* The floating preview sits above whatever module is open. The top bar's Preview button toggles it. */}
      {previewOpen && <PreviewPanel />}
      <CommandPalette />
      <ProjectorPrompt />
      {/* Above everything else. Shown until the operator accepts the license, then it renders nothing. */}
      <EulaGate />
    </div>
  );
}

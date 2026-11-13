import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Check, ChevronRight, FileUp, Folder, Image as ImageIcon, Inbox, Layers, ListPlus, Megaphone, Monitor, Pause, Play, Plus, Presentation, Type, X } from 'lucide-react';
import type { Frame } from '../../shared/live.js';
import { SLIDE_DRAG_TYPE, parseGridColumns, selectionKey, type GridColumns } from '../../shared/slide-selection.js';
import { ANN_SLIDE_DRAG_TYPE, DECK_PRESETS, activePreset, applyPreset, dragItemKeys, type DeckPresetId } from '../../shared/deck-presets.js';
import {
  buildDeckItems,
  canReorder,
  clickKeySelection,
  destinationFor,
  existingView,
  isSystemFolder,
  itemKey,
  itemsInView,
  moveKey,
  parseDeckView,
  parseItemKey,
  searchItems,
  splitKeys,
  stepIndex,
  type DeckDestination,
  type DeckItem,
  type DeckView,
} from '../../shared/deck-items.js';
import { deckSlice, decksOf, type PictureDeck } from '../../shared/flow-insert.js';
import { bridge } from '../live/bridge';
import { dispatch, useLive } from '../live/store';
import { setUi, useUi } from '../state/ui';
import { useAnnT } from '../announcements/strings';
import { announcementFrame } from '../announcements/frames';
import { SlidePreview, TextSlideModal } from '../announcements/TextSlideModal';
import type { AnnouncementFolder, AnnouncementSlide, ImportResult } from '../announcements/types';
import { getSlideImageUrl, onSlideImageError } from '../output/slideImage';
import { templateStart } from './templates';
import { TargetSlotSelectorModal } from './TargetSlotSelectorModal';
import { notifyWhiteboardChanged } from './changes';
import { errorText } from './errors';
import { FolderSidebar, type TreeFolder } from './FolderSidebar';
import { ImportProgressBar } from './ImportProgressBar';
import { ClearUnfiledDialog } from './ClearUnfiledDialog';
import { DeleteSelectedDialog } from './DeleteSelectedDialog';
import { MoveMenu } from './MoveMenu';
import { SelectionToolbar } from './SelectionToolbar';
import { SlideCanvas } from './SlideCanvas';
import { SlideCard } from './SlideCard';
import { usePowerPointImport } from './usePowerPointImport';
import { frameForWhiteboardSlide } from './projectSlide';
import { SlideEditorModal } from './SlideEditorModal';
import { TemplateModal, type TemplateId } from './TemplateModal';
import { DeckControlBar, loadPlayback, savePlayback, type Playback } from './DeckControlBar';
import { SpeakerNotesDrawer } from './SpeakerNotesDrawer';
import type { WhiteboardFolder, WhiteboardSlide, WhiteboardSlideInput } from './types';

const annApi = bridge.announcements;
const wbApi = bridge.whiteboard;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Where the grid's density is kept between sessions (the Whiteboard's key, so the choice carries over). */
const COLUMNS_KEY = 'whiteboard_grid_columns';
/** Whether the speaker notes drawer is open. */
const NOTES_KEY = 'apccmma.deck.notesOpen';
// Spelled out in full so Tailwind finds the classes.
const GRID_CLASS: Record<GridColumns, string> = { 3: 'grid-cols-3 gap-4', 4: 'grid-cols-4 gap-4', 6: 'grid-cols-6 gap-3' };
/** The drag type of an announcement card being moved to a new place in its folder. It carries the item key. */
const DECK_ITEM_DRAG_TYPE = 'application/x-apcc-deck-item';

const readStored = <T,>(key: string, parse: (raw: string | null) => T): T => {
  try {
    return parse(localStorage.getItem(key));
  } catch {
    return parse(null);
  }
};
const writeStored = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable; the choice still holds for this session.
  }
};

const HEADER_BTN =
  'flex h-10 items-center gap-2 rounded-lg border border-fg/20 bg-panel-2 px-3 text-xs font-bold tracking-wider text-fg/90 uppercase transition-colors hover:border-accent/40 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40';
const HEADER_PRIMARY =
  'flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-xs font-bold tracking-wider text-on-accent uppercase shadow-md shadow-black/40 transition-all hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40';
const PLAY_BTN =
  'flex h-10 items-center gap-2 rounded-lg bg-fg px-5 text-xs font-extrabold tracking-wider text-canvas uppercase shadow-md shadow-black/40 ring-2 ring-accent transition-all hover:brightness-110 focus-visible:ring-4 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40';

/** Whether a frame shows this announcement slide. */
const showsAnnouncement = (frame: Frame, s: AnnouncementSlide) =>
  s.slideType === 'image' ? frame.kind === 'image' && frame.src === s.src : frame.kind === 'text' && frame.title === s.name && frame.text === s.text;

/** Whether a frame shows this Whiteboard slide. */
const showsWhiteboard = (frame: Frame, s: WhiteboardSlide) =>
  s.image ? frame.kind === 'image' && frame.src === s.image : frame.kind === 'whiteboard' && frame.slide.title === s.title && frame.slide.content === s.content;

/** A drag of several cards shows a pill with how many go, instead of the one card's picture. */
function setCountDragImage(e: DragEvent, label: string) {
  const ghost = document.createElement('div');
  ghost.textContent = label;
  ghost.style.cssText =
    'position:fixed;top:-1000px;left:-1000px;padding:6px 14px;border-radius:9999px;background:var(--color-accent);color:var(--color-on-accent);font:800 12px system-ui,sans-serif;letter-spacing:.05em;text-transform:uppercase;box-shadow:0 4px 14px rgb(0 0 0/.5)';
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 16, 16);
  // The browser copies the picture when the drag starts, so the element can go at once.
  window.setTimeout(() => ghost.remove(), 0);
}

/** The slide behind an item, with its library. */
type Entry = { source: 'ann'; slide: AnnouncementSlide } | { source: 'wb'; slide: WhiteboardSlide };

/** A slide drawn to fill its 16:9 box, for the grid and the notes drawer. */
function Preview({ entry }: { entry: Entry }) {
  if (entry.source === 'wb') {
    const s = entry.slide;
    return s.image ? <img src={s.image} alt="" loading="lazy" draggable={false} className="h-full w-full bg-black object-contain" /> : <SlideCanvas slide={s} className="h-full w-full" />;
  }
  const s = entry.slide;
  return s.slideType === 'image' && s.src ? (
    // object-contain keeps the whole page visible, with bars where its proportions differ from the screen.
    <img src={getSlideImageUrl(s.src)} onError={onSlideImageError} alt="" loading="lazy" draggable={false} className="h-full w-full bg-black object-contain" />
  ) : (
    <SlidePreview text={s.text ?? ''} headline={s.headline} bgSrc={s.bgSrc} style={s.style} className="h-full w-full" />
  );
}

/**
 * Announcements & Whiteboard: one workspace for every slide the parish projects. Announcement slides (pictures, PDFs, text slides) and
 * Whiteboard slides (designed slides, sermon notes, PowerPoint decks) keep their own libraries and folders, and are browsed, searched,
 * picked, played and projected together here.
 */
export function UnifiedDeckView() {
  const tr = useAnnT();
  const lang = useUi((s) => s.lang);
  const uiView = useUi((s) => s.view);
  const projector = useLive((s) => s.state.projector);

  // ── The two libraries ──
  const [annFolders, setAnnFolders] = useState<AnnouncementFolder[]>([]);
  const [annSlides, setAnnSlides] = useState<AnnouncementSlide[]>([]);
  const [wbFolders, setWbFolders] = useState<WhiteboardFolder[]>([]);
  const [wbSlides, setWbSlides] = useState<WhiteboardSlide[]>([]);
  const [loaded, setLoaded] = useState(false);

  // ── What is shown ──
  // Opened from a Whiteboard link (the Go Live card), the deck starts on the Whiteboard's slides.
  const [view, setView] = useState<DeckView>(() => (useUi.getState().view === 'whiteboard' ? 'wb' : 'all'));
  const [chosenDest, setChosenDest] = useState<DeckDestination | null>(null);
  const [query, setQuery] = useState('');
  const [columns, setColumns] = useState<GridColumns>(() => readStored(COLUMNS_KEY, parseGridColumns));
  const [notesOpen, setNotesOpen] = useState(() => readStored(NOTES_KEY, (raw) => raw !== 'false'));

  // ── Staging, playback, picking ──
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [playback, setPlayback] = useState<Playback>(loadPlayback);
  const [playing, setPlaying] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const anchorRef = useRef<string | null>(null);

  // ── Messages and dialogs ──
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [annBusy, setAnnBusy] = useState(false);
  const [textFolder, setTextFolder] = useState<number | null>(null);
  const [editor, setEditor] = useState<{ key: number; mode: 'create' | 'edit'; folderId: number | null; initial: WhiteboardSlideInput } | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [targetDecks, setTargetDecks] = useState<PictureDeck[] | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [deleteKeys, setDeleteKeys] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [moveFor, setMoveFor] = useState<string | null>(null);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  // ── Drag and drop ──
  const [dragKeys, setDragKeys] = useState<string[] | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [fileDragOver, setFileDragOver] = useState(false);

  const cardRefs = useRef(new Map<string, HTMLLIElement>());
  // A Service Queue request to stage one announcement slide, waiting for the libraries to load.
  const pendingSlide = useRef<number | null>(null);

  // The sidebar keeps one entry for this workspace. A link that still asks for the Whiteboard lands here, on its slides.
  useEffect(() => {
    if (uiView !== 'whiteboard') return;
    setView('wb');
    setUi({ view: 'announcements' });
  }, [uiView]);

  // A confirmation fades after a few seconds, so it never lingers over later work.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // ── Loading ──
  const reloadAnn = useCallback(async () => {
    const [{ folders }, slides] = await Promise.all([annApi.folders(), annApi.slides(null)]);
    setAnnFolders(folders);
    setAnnSlides(slides);
  }, []);
  const reloadWb = useCallback(async () => {
    const [slides, folders] = await Promise.all([wbApi.list(), wbApi.folders()]);
    setWbSlides(slides);
    setWbFolders(folders);
    notifyWhiteboardChanged();
  }, []);
  /** Reloads one library or both. A failure is shown, never thrown. */
  const reload = useCallback(
    (which: 'ann' | 'wb' | 'both' = 'both') =>
      Promise.all([which !== 'wb' ? reloadAnn() : null, which !== 'ann' ? reloadWb() : null]).catch((err) => setError(errorText(err))),
    [reloadAnn, reloadWb],
  );

  useEffect(() => {
    const pending = useUi.getState().pendingFocus;
    if (pending?.kind === 'slide') {
      pendingSlide.current = pending.id;
      setUi({ pendingFocus: null });
    }
    void reload().then(() => setLoaded(true));
  }, [reload]);

  // ── The combined list ──
  const items = useMemo(() => buildDeckItems(annSlides, wbSlides), [annSlides, wbSlides]);
  const entries = useMemo(() => {
    const map = new Map<string, Entry>();
    for (const s of annSlides) map.set(itemKey('ann', s.id), { source: 'ann', slide: s });
    for (const s of wbSlides) map.set(itemKey('wb', s.id), { source: 'wb', slide: s });
    return map;
  }, [annSlides, wbSlides]);
  const annFolderIds = useMemo(() => annFolders.map((f) => f.id), [annFolders]);
  const wbFolderIds = useMemo(() => wbFolders.map((f) => f.id), [wbFolders]);

  // A folder that is gone (deleted here or elsewhere) cannot stay open.
  useEffect(() => {
    if (!loaded) return;
    const next = existingView(view, annFolderIds, wbFolderIds);
    if (next !== view) setView(next);
  }, [loaded, view, annFolderIds, wbFolderIds]);

  // Picks of slides that no longer exist are dropped.
  useEffect(() => {
    setChecked((current) => {
      const kept = [...current].filter((k) => entries.has(k));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [entries]);

  const inView = useMemo(() => itemsInView(items, view), [items, view]);
  const visible = useMemo(() => searchItems(inView, query), [inView, query]);
  const visibleKeys = useMemo(() => visible.map((i) => i.key), [visible]);

  const counts = useMemo(() => {
    const ann = new Map<number, number>();
    const wb = new Map<number | null, number>();
    let annTotal = 0;
    for (const item of items) {
      if (item.source === 'ann') {
        annTotal += 1;
        ann.set(item.folderId as number, (ann.get(item.folderId as number) ?? 0) + 1);
      } else wb.set(item.folderId, (wb.get(item.folderId) ?? 0) + 1);
    }
    return { ann, wb, annTotal, wbTotal: items.length - annTotal };
  }, [items]);

  // The folder that holds the pictures behind Whiteboard PowerPoint cards is the app's own: listed only while it holds other slides, and locked.
  const annTree: TreeFolder[] = useMemo(
    () =>
      annFolders
        .map((f) => ({ id: f.id, name: f.name, count: counts.ann.get(f.id) ?? 0, locked: isSystemFolder(f.name) }))
        .filter((f) => !f.locked || f.count > 0),
    [annFolders, counts],
  );
  const wbTree: TreeFolder[] = useMemo(() => wbFolders.map((f) => ({ id: f.id, name: f.name, count: counts.wb.get(f.id) ?? 0 })), [wbFolders, counts]);
  const unfiledCount = counts.wb.get(null) ?? 0;

  const annFolderName = (id: number) => annFolders.find((f) => f.id === id)?.name ?? 'a folder';
  const wbFolderName = (id: number | null) => (id == null ? 'Unfiled' : (wbFolders.find((f) => f.id === id)?.name ?? 'a folder'));
  /** A PowerPoint deck's name: its folder's, or none for Unfiled (the deck then takes its default name). */
  const wbFolderTitle = (id: number | null) => (id == null ? null : (wbFolders.find((f) => f.id === id)?.name ?? null));

  const parsedView = parseDeckView(view);
  const section = parsedView.store === 'all' ? null : parsedView.store;
  const viewTitle =
    view === 'all'
      ? 'All Slides & Decks'
      : view === 'ann'
        ? 'All announcements'
        : view === 'wb'
          ? 'All Whiteboard slides'
          : view === 'wb:unfiled'
            ? 'Unfiled'
            : parsedView.store === 'ann'
              ? annFolderName(parsedView.folder as number)
              : wbFolderName(parsedView.folder as number);
  const sectionTitle = section === 'ann' ? 'Announcements' : section === 'wb' ? 'Whiteboard & Notes' : null;

  // ── Where new slides and imports go ──
  const dest = destinationFor(view, chosenDest, annFolderIds.filter((id) => annTree.some((f) => f.id === id)), wbFolderIds);
  const destName = dest.store === 'ann' ? annFolderName(dest.folderId) : wbFolderName(dest.folderId);
  const destLabel = `${dest.store === 'ann' ? 'Announcements' : 'Whiteboard'} › ${destName}`;
  /** The view spans folders, so the operator picks where new slides go. */
  const choosesDest = parsedView.folder === undefined;

  // ── Frames: staging, playback and the projector ──
  const frameOf = (key: string): Frame | null => {
    const entry = entries.get(key);
    if (!entry) return null;
    return entry.source === 'ann' ? announcementFrame(entry.slide, annSlides) : frameForWhiteboardSlide(entry.slide, wbSlides);
  };
  const shows = (frame: Frame, key: string) => {
    const entry = entries.get(key);
    if (!entry) return false;
    return entry.source === 'ann' ? showsAnnouncement(frame, entry.slide) : showsWhiteboard(frame, entry.slide);
  };

  const currentIndex = activeKey == null ? -1 : visibleKeys.indexOf(activeKey);

  /** Stages the item, and takes it live when `take` is set. */
  const showKey = (key: string, take: boolean) => {
    const frame = frameOf(key);
    if (!frame) return;
    setActiveKey(key);
    dispatch({ type: 'projector/stage', frame });
    if (take) dispatch({ type: 'projector/take' });
  };
  const showIndex = (index: number, take: boolean) => {
    const key = visibleKeys[index];
    if (key) showKey(key, take);
  };
  /** Moves one slide on. Past the last slide it wraps to the first when looping, otherwise the timer stops. */
  const stepForward = (take: boolean) => {
    const next = stepIndex(currentIndex, visibleKeys.length, 1, playback.loop);
    if (next < 0) setPlaying(false);
    else showIndex(next, take);
  };
  /** Starts the timer: takes the staged slide live, or the first slide shown when none is staged. */
  const startPlaying = () => {
    if (visibleKeys.length === 0) return;
    showIndex(currentIndex >= 0 ? currentIndex : 0, true);
    setPlaying(true);
  };
  /** Starts or stops the timer. */
  const togglePlay = () => {
    if (playing) setPlaying(false);
    else startPlaying();
  };
  /** Takes the deck off the projector and stops the timer. The libraries are not changed. */
  const clearProjector = () => {
    setPlaying(false);
    setActiveKey(null);
    dispatch({ type: 'projector/clear' });
  };

  // The timer. Each slide gets its full interval, so the countdown restarts whenever the slide, the interval, loop or the list changes.
  const stepRef = useRef(stepForward);
  stepRef.current = stepForward;
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => stepRef.current(true), playback.interval * 1000);
    return () => window.clearInterval(timer);
  }, [playing, playback.interval, playback.loop, activeKey, visibleKeys]);

  // The slide counter goes to the projector while this deck is open. Leaving the deck clears it.
  useEffect(() => {
    dispatch({ type: 'counter/set', counter: { show: playback.showCount, index: currentIndex + 1, total: visibleKeys.length } });
  }, [playback.showCount, currentIndex, visibleKeys.length]);
  useEffect(() => () => dispatch({ type: 'counter/set', counter: null }), []);
  useEffect(() => savePlayback(playback), [playback]);

  // The Service Queue's request, once the libraries are in: open the slide's folder and stage it. A PowerPoint picture is its Whiteboard card.
  useEffect(() => {
    if (!loaded || pendingSlide.current == null) return;
    const id = pendingSlide.current;
    pendingSlide.current = null;
    const card = wbSlides.find((s) => s.slideId === id);
    const slide = annSlides.find((s) => s.id === id);
    if (card) {
      setView(card.folderId == null ? 'wb:unfiled' : `wb:${card.folderId}`);
      showKey(itemKey('wb', card.id), false);
    } else if (slide) {
      setView(`ann:${slide.folderId}`);
      showKey(itemKey('ann', slide.id), false);
    } else setError('That slide is no longer in the library.');
  }, [loaded]);

  // Keep the staged card in view as the keys step through the deck. "nearest" moves only as far as needed.
  useEffect(() => {
    if (activeKey) cardRefs.current.get(activeKey)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [activeKey]);

  // ── Picking ──
  const check = (key: string, shift: boolean) => {
    setChecked((current) => clickKeySelection(current, visibleKeys, anchorRef.current, key, shift));
    anchorRef.current = key;
  };
  const selectAllShown = () => setChecked((current) => new Set([...current, ...visibleKeys]));
  const clearSelection = () => {
    setBulkMoveOpen(false);
    setChecked(new Set());
    anchorRef.current = null;
  };
  const pickedWb = useMemo(() => splitKeys(checked).wb, [checked]);
  const pickedAnnCount = checked.size - pickedWb.length;
  /** The Whiteboard folder every picked Whiteboard slide is in, or undefined when they are spread over several. */
  const pickedFolder = useMemo(() => {
    const homes = new Set(wbSlides.filter((s) => pickedWb.includes(s.id)).map((s) => s.folderId));
    return homes.size === 1 ? [...homes][0] : undefined;
  }, [wbSlides, pickedWb]);

  const askDeleteChecked = () => {
    if (checked.size > 0) setDeleteKeys(items.filter((i) => checked.has(i.key)).map((i) => i.key));
  };

  const anyDialog = () =>
    Boolean(
      document.querySelector('[aria-modal="true"]') ||
        editor ||
        textFolder != null ||
        templatesOpen ||
        targetDecks ||
        clearOpen ||
        deleteKeys ||
        moveFor != null ||
        bulkMoveOpen ||
        renamingKey != null,
    );

  // The grid's selection keys: Ctrl+A picks every slide shown, Escape clears the pick, Delete or Backspace asks to delete it.
  // Read through a ref so the listener is added once and always sees the current state. Capture, so the grid answers before the app's
  // global shortcuts on the same keys.
  const selectionKeys = useRef<(e: KeyboardEvent) => void>(() => {});
  selectionKeys.current = (e) => {
    const ui = useUi.getState();
    if (ui.capturingHotkey || ui.paletteOpen || ui.remoteOpen) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest?.('input:not([type="checkbox"]), textarea, select, [contenteditable="true"]')) return;
    if (anyDialog()) return;
    const action = selectionKey(e, checked.size);
    if (!action || (action === 'selectAll' && visible.length === 0)) return;
    e.preventDefault();
    e.stopPropagation();
    if (action === 'selectAll') selectAllShown();
    else if (action === 'clear') clearSelection();
    else askDeleteChecked();
  };

  // The stepping keys, for the operator and a presentation clicker: Right, Down, Space and Page Down stage the next slide, Left, Up and
  // Page Up the previous one, and Enter takes the staged slide live. None of these is a global hotkey.
  const stepKeys = useRef<(e: KeyboardEvent) => void>(() => {});
  stepKeys.current = (e) => {
    if (e.defaultPrevented) return;
    if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]') || useUi.getState().paletteOpen) return;
    if (anyDialog() || visibleKeys.length === 0) return;
    if (e.key === 'Enter') {
      if (currentIndex < 0) return;
      e.preventDefault();
      showIndex(currentIndex, true);
      return;
    }
    const forward = [' ', 'ArrowRight', 'ArrowDown', 'PageDown'].includes(e.key);
    const back = ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key);
    if (!forward && !back) return;
    e.preventDefault();
    const from = currentIndex < 0 ? (forward ? -1 : visibleKeys.length) : currentIndex;
    showIndex(Math.min(Math.max(from + (forward ? 1 : -1), 0), visibleKeys.length - 1), false);
  };

  useEffect(() => {
    const onSelection = (e: KeyboardEvent) => selectionKeys.current(e);
    const onStep = (e: KeyboardEvent) => stepKeys.current(e);
    window.addEventListener('keydown', onSelection, { capture: true });
    window.addEventListener('keydown', onStep);
    return () => {
      window.removeEventListener('keydown', onSelection, { capture: true });
      window.removeEventListener('keydown', onStep);
    };
  }, []);

  // ── Library actions ──
  /** Runs an announcements task with the busy flag and error handling. Resolves true on success. */
  const runAnn = async (task: () => Promise<void>): Promise<boolean> => {
    setAnnBusy(true);
    setError(null);
    try {
      await task();
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    } finally {
      setAnnBusy(false);
    }
  };

  /** Reloads after an announcements import, and lists every file that was skipped with its reason. */
  const reportImport = async (result: ImportResult, folderId: number) => {
    if (result.imported > 0) {
      await reload('ann');
      setNotice(`Imported ${plural(result.imported, 'slide', 'slides')} into "${annFolderName(folderId)}".`);
    }
    if (result.failed.length > 0) setError(result.failed.map((f) => `${f.name}: ${f.reason}`).join('\n'));
  };

  // The PowerPoint import into the Whiteboard reports as it goes, so the header shows a bar.
  const powerPoint = usePowerPointImport({
    folderId: dest.store === 'wb' ? dest.folderId : null,
    destination: destName,
    onDone: async (message) => {
      if (message) setNotice(message);
      // The pictures live in Announcements and the cards in the Whiteboard.
      await reload('both');
    },
    onFail: setError,
  });
  const importing = powerPoint.busy || annBusy;

  const importSlides = () => {
    setError(null);
    setNotice(null);
    if (dest.store === 'wb') {
      void powerPoint.start();
      return;
    }
    const folderId = dest.folderId;
    void runAnn(async () => {
      const result = await annApi.importSlides(folderId, lang);
      if (result) await reportImport(result, folderId);
    });
  };
  const importLabel = powerPoint.busy ? `Importing… ${powerPoint.progress?.percentage ?? 0}%` : annBusy ? 'Importing…' : 'Import PowerPoint';
  const importTitle =
    dest.store === 'wb'
      ? `Import a PowerPoint (.pptx or .ppt) into ${destLabel}. Each slide keeps its design and can be edited.`
      : `Import PowerPoint, PDF, Word, text or image files into ${destLabel}`;

  // Files dragged in from the file system import into an announcement folder. Card drags carry no files, so they are not caught here.
  const isFileDrag = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  const dropFiles = (e: DragEvent<HTMLElement>) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    setFileDragOver(false);
    if (dest.store !== 'ann') {
      setError('Dropped files go into an Announcements folder. Open one, or choose one under "New slides go to". Use Import PowerPoint for the Whiteboard.');
      return;
    }
    const paths = Array.from(e.dataTransfer.files).map((file) => bridge.files.pathFor(file));
    if (paths.length === 0) return;
    const folderId = dest.folderId;
    void runAnn(async () => reportImport(await annApi.importPaths(folderId, paths), folderId));
  };

  const openNew = () => {
    setError(null);
    if (dest.store === 'ann') setTextFolder(dest.folderId);
    else setEditor({ key: Date.now(), mode: 'create', folderId: dest.folderId, initial: templateStart('sermon') });
  };
  const openEdit = (slide: WhiteboardSlide) =>
    setEditor({ key: Date.now(), mode: 'edit', folderId: slide.folderId, initial: { id: slide.id, title: slide.title, content: slide.content, design: slide.design } });

  /** A template either starts a new Whiteboard slide or replaces the draft of the one being made. */
  const pickTemplate = (id: TemplateId) => {
    setTemplatesOpen(false);
    setEditor((current) =>
      current
        ? { ...current, key: Date.now(), initial: { ...templateStart(id), id: current.initial.id, design: current.initial.design } }
        : { key: Date.now(), mode: 'create', folderId: dest.store === 'wb' ? dest.folderId : null, initial: templateStart(id) },
    );
  };

  const saveSlide = async (input: WhiteboardSlideInput) => {
    // A new slide goes where the editor was opened for. An existing one keeps the folder it is in.
    await wbApi.save(input.id == null ? { ...input, folderId: editor?.folderId ?? null } : input);
    setEditor(null);
    setError(null);
    await reload('wb');
  };

  const duplicate = async (slide: WhiteboardSlide) => {
    try {
      await wbApi.save({ title: `${slide.title} (copy)`, content: slide.content, design: slide.design, folderId: slide.folderId });
      setNotice(`Duplicated "${slide.title}".`);
      await reload('wb');
    } catch (err) {
      setError(errorText(err));
    }
  };

  const startRename = (key: string, title: string) => {
    setMoveFor(null);
    setRenameError(null);
    setRenameDraft(title);
    setRenamingKey(key);
  };
  const cancelRename = () => {
    setRenamingKey(null);
    setRenameError(null);
  };
  const saveRename = async (slide: WhiteboardSlide) => {
    try {
      await wbApi.rename(slide.id, renameDraft);
      setRenamingKey(null);
      setRenameError(null);
      setNotice(`Renamed to "${renameDraft.trim().replace(/\s+/g, ' ')}".`);
      await reload('wb');
    } catch (err) {
      setRenameError(errorText(err));
    }
  };

  /** Deletes the slides the confirmation was opened for, from each library. Slides that are already gone are not counted. */
  const confirmDelete = async () => {
    const keys = deleteKeys;
    if (!keys || keys.length === 0) return;
    const { ann, wb } = splitKeys(keys);
    setDeleting(true);
    setError(null);
    try {
      let removed = 0;
      for (const id of ann) if (await annApi.deleteSlide(id)) removed += 1;
      if (wb.length === 1) removed += (await wbApi.remove(wb[0])) ? 1 : 0;
      else if (wb.length > 1) removed += await wbApi.removeMany(wb);
      setChecked((current) => new Set([...current].filter((k) => !keys.includes(k))));
      if (activeKey && keys.includes(activeKey)) setActiveKey(null);
      setNotice(`Deleted ${plural(removed, 'slide', 'slides')}.`);
      setDeleteKeys(null);
    } catch (err) {
      setDeleteKeys(null);
      setError(errorText(err));
    } finally {
      setDeleting(false);
      await reload(wb.length > 0 ? 'both' : 'ann');
    }
  };

  const clearUnfiled = async () => {
    setClearing(true);
    setError(null);
    try {
      const removed = await wbApi.clearUnfiled();
      setClearOpen(false);
      setNotice(`Deleted ${plural(removed, 'unfiled slide', 'unfiled slides')}.`);
    } catch (err) {
      setClearOpen(false);
      setError(errorText(err));
    } finally {
      setClearing(false);
      await reload('both');
    }
  };

  /** Moves Whiteboard slides to a Whiteboard folder (or Unfiled) in one step. Announcement slides stay in their folders. */
  const moveTo = async (ids: number[], target: number | null, skippedAnn = 0) => {
    const moving = wbSlides.filter((s) => ids.includes(s.id) && s.folderId !== target);
    setMoveFor(null);
    setBulkMoveOpen(false);
    const stay = skippedAnn > 0 ? ` ${plural(skippedAnn, 'announcement slide stays', 'announcement slides stay')} in its folder.` : '';
    if (moving.length === 0) {
      if (stay) setNotice(stay.trim());
      return;
    }
    setError(null);
    try {
      const moved = await wbApi.moveSelectedToFolder({ slideIds: moving.map((s) => s.id), targetFolderId: target });
      const movedKeys = new Set(ids.map((id) => itemKey('wb', id)));
      setChecked((current) => new Set([...current].filter((k) => !movedKeys.has(k))));
      setNotice(`Moved ${moved === 1 && moving.length === 1 ? `"${moving[0].title}"` : plural(moved, 'slide', 'slides')} to "${wbFolderName(target)}".${stay}`);
      await reload('wb');
    } catch (err) {
      setError(errorText(err));
    }
  };

  /** Files announcement slides into an announcement folder in one transaction. Whiteboard slides in the same drag stay in their folders. */
  const moveAnnTo = async (ids: number[], target: number, skippedWb = 0) => {
    const moving = annSlides.filter((s) => ids.includes(s.id) && s.folderId !== target);
    const stay = skippedWb > 0 ? ` ${plural(skippedWb, 'Whiteboard slide stays in its folder', 'Whiteboard slides stay in their folders')}.` : '';
    if (moving.length === 0) {
      if (stay) setNotice(stay.trim());
      return;
    }
    setError(null);
    try {
      const moved = await annApi.moveSlides(
        moving.map((s) => s.id),
        target,
      );
      const movedKeys = new Set(ids.map((id) => itemKey('ann', id)));
      setChecked((current) => new Set([...current].filter((k) => !movedKeys.has(k))));
      const what = moved === 1 && moving.length === 1 ? `"${moving[0].name}"` : plural(moved, 'slide', 'slides');
      setNotice(`Moved ${what} to "${annFolderName(target)}".${stay}`);
      await reload('ann');
    } catch (err) {
      setError(errorText(err));
    }
  };

  const createFolder = async (store: 'ann' | 'wb', name: string) => {
    if (store === 'ann') {
      const folder = await annApi.createFolder(name);
      await reload('ann');
      setView(`ann:${folder.id}`);
      setNotice(`Folder "${folder.name}" created in Announcements.`);
    } else {
      const folder = await wbApi.createFolder(name);
      await reload('wb');
      setView(`wb:${folder.id}`);
      setNotice(`Folder "${folder.name}" created. Slides you create or import now go into it.`);
    }
  };

  const renameFolder = async (store: 'ann' | 'wb', id: number, name: string) => {
    if (store === 'ann') await annApi.renameFolder(id, name);
    else await wbApi.renameFolder(id, name);
    await reload(store);
  };

  const deleteFolder = async (store: 'ann' | 'wb', folder: TreeFolder) => {
    const warning =
      store === 'ann'
        ? tr('confirmDeleteFolder', { name: folder.name })
        : `Delete the folder "${folder.name}"?${folder.count === 0 ? '' : ` Its ${plural(folder.count, 'slide', 'slides')} ${folder.count === 1 ? 'is' : 'are'} kept and move to Unfiled.`}`;
    if (!window.confirm(warning)) return;
    setError(null);
    try {
      if (store === 'ann') await annApi.deleteFolder(folder.id);
      else await wbApi.deleteFolder(folder.id);
      if (view === `${store}:${folder.id}`) setView(store);
      setNotice(`Folder "${folder.name}" deleted.`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      await reload(store);
    }
  };

  // ── Go Live ──
  const addToGoLive = (slide: WhiteboardSlide) => {
    if (slide.slideId == null) return;
    setError(null);
    setTargetDecks([deckSlice({ slideId: slide.slideId, folderId: slide.folderId, title: slide.title }, wbSlides, wbFolderTitle)]);
  };
  const visibleWb = useMemo(() => visible.filter((i) => i.source === 'wb').map((i) => entries.get(i.key)!.slide as WhiteboardSlide), [visible, entries]);
  const hasPictures = visibleWb.some((s) => s.slideId != null);
  const addAllToGoLive = () => {
    const decks = decksOf(visibleWb, wbFolderTitle);
    if (decks.length === 0) return;
    setError(null);
    setTargetDecks(decks);
  };

  // ── Reordering ──
  const reorderable = canReorder(view, query);
  const reorderKey = dragKeys?.length === 1 && reorderable ? dragKeys[0] : null;
  const dragging = useMemo(() => new Set(dragKeys ?? []), [dragKeys]);

  const endDrag = () => {
    setDragKeys(null);
    setDropKey(null);
  };

  /** Drag and drop reorders instantly, then saves the order. A failed save puts the old order back. */
  const dropOn = (targetKey: string) => {
    const from = reorderKey;
    endDrag();
    if (from == null || from === targetKey) return;
    const a = parseItemKey(from);
    const b = parseItemKey(targetKey);
    if (!a || !b || a.source !== b.source) return;
    if (a.source === 'wb') {
      const previous = wbSlides;
      const order = moveKey(
        wbSlides.map((s) => itemKey('wb', s.id)),
        from,
        targetKey,
      );
      const byKey = new Map(wbSlides.map((s) => [itemKey('wb', s.id), s]));
      const next = order.map((k) => byKey.get(k)!);
      setWbSlides(next);
      wbApi.reorder(next.map((s) => s.id)).catch((err) => {
        setWbSlides(previous);
        setError(errorText(err));
      });
      return;
    }
    const folderId = parsedView.folder as number;
    const previous = annSlides;
    const inFolder = annSlides.filter((s) => s.folderId === folderId);
    const order = moveKey(
      inFolder.map((s) => itemKey('ann', s.id)),
      from,
      targetKey,
    );
    const byKey = new Map(inFolder.map((s) => [itemKey('ann', s.id), s]));
    const reordered = order.map((k, i) => ({ ...byKey.get(k)!, order: i + 1 }));
    // The folder's slides sit together in the list, so they are replaced in place.
    let at = 0;
    const next = annSlides.map((s) => (s.folderId === folderId ? reordered[at++] : s));
    setAnnSlides(next);
    annApi.reorder(folderId, reordered.map((s) => s.id)).catch((err) => {
      setAnnSlides(previous);
      setError(errorText(err));
    });
  };

  /**
   * A card starts a drag. A picked card carries every picked slide, so they can be filed together: the Whiteboard ones under their drag
   * type and the announcement ones under theirs, so each folder takes only its own library's slides. A lone announcement card can also
   * be dropped on another card in its folder to reorder.
   */
  const onDragStart = (e: DragEvent, item: DeckItem) => {
    setMoveFor(null);
    setBulkMoveOpen(false);
    e.dataTransfer.effectAllowed = 'move';
    const keys = dragItemKeys(
      item.key,
      checked,
      items.map((i) => i.key),
    );
    const { ann, wb } = splitKeys(keys);
    if (wb.length > 0) e.dataTransfer.setData(SLIDE_DRAG_TYPE, JSON.stringify(wb));
    if (ann.length > 0) e.dataTransfer.setData(ANN_SLIDE_DRAG_TYPE, JSON.stringify(ann));
    if (keys.length === 1 && item.source === 'ann') e.dataTransfer.setData(DECK_ITEM_DRAG_TYPE, item.key);
    e.dataTransfer.setData('text/plain', keys.length === 1 ? item.title : plural(keys.length, 'slide', 'slides'));
    if (keys.length > 1) setCountDragImage(e, plural(keys.length, 'slide', 'slides'));
    setDragKeys(keys);
  };
  const dragSources = useMemo(() => {
    const sources = new Set((dragKeys ?? []).map((k) => parseItemKey(k)?.source).filter((s): s is 'ann' | 'wb' => s != null));
    return [...sources];
  }, [dragKeys]);

  /** Slides dropped on a folder: those of the folder's library move, and the others are counted as staying where they are. */
  const fileDropped = (store: 'ann' | 'wb', target: number | null, ids: number[]) => {
    const others = (dragKeys ?? []).filter((k) => parseItemKey(k)?.source !== store).length;
    endDrag();
    if (ids.length === 0) return;
    if (store === 'wb') void moveTo(ids, target, others);
    else if (target != null) void moveAnnTo(ids, target, others);
  };

  const pickColumns = (next: GridColumns) => {
    setColumns(next);
    writeStored(COLUMNS_KEY, String(next));
  };
  const showNotes = (open: boolean) => {
    setNotesOpen(open);
    writeStored(NOTES_KEY, String(open));
  };
  const toggleNotes = () => showNotes(!notesOpen);

  // ── Presentation presets ──
  const preset = activePreset(playback, playing);
  /** One click sets the deck up for an announcement loop (and starts it) or for a sermon stepped by hand (with the notes open). */
  const pickPreset = (id: DeckPresetId) => {
    const def = DECK_PRESETS[id];
    setPlayback((current) => applyPreset(id, current));
    if (def.notesOpen != null) showNotes(def.notesOpen);
    if (!def.autoplay) setPlaying(false);
    else if (!playing) startPlaying();
  };

  // ── Speaker notes ──
  /** Saves the notes typed for a slide, then shows them without reloading the libraries (which would disturb the grid). */
  const saveNotes = async (key: string, text: string) => {
    const parsed = parseItemKey(key);
    if (!parsed) return;
    if (parsed.source === 'ann') {
      await annApi.setNotes(parsed.id, text);
      const notes = text.replace(/\r\n?/g, '\n').trimEnd() || null;
      setAnnSlides((list) => list.map((s) => (s.id === parsed.id ? { ...s, notes } : s)));
    } else {
      const slide = await wbApi.setNotes(parsed.id, text);
      setWbSlides((list) => list.map((s) => (s.id === slide.id ? slide : s)));
    }
  };

  const changeView = (next: DeckView) => {
    setView(next);
    setQuery('');
    setMoveFor(null);
    // A pick never carries into another folder, where its slides would be out of sight but still deleted with the rest.
    clearSelection();
  };

  // ── Rendering ──
  const activeEntry = activeKey ? entries.get(activeKey) : undefined;
  const liveFrame = projector.live;
  const stagedFrame = projector.staged;
  const empty = loaded && items.length === 0;

  const destinationOptions: { value: string; label: string; group: string }[] = [
    ...annTree.filter((f) => !f.locked).map((f) => ({ value: `ann:${f.id}`, label: f.name, group: 'Announcements' })),
    ...wbFolders.map((f) => ({ value: `wb:${f.id}`, label: f.name, group: 'Whiteboard & Notes' })),
    { value: 'wb:unfiled', label: 'Unfiled', group: 'Whiteboard & Notes' },
  ].filter((o) => section == null || o.value.startsWith(section));
  const destValue = dest.store === 'ann' ? `ann:${dest.folderId}` : dest.folderId == null ? 'wb:unfiled' : `wb:${dest.folderId}`;
  const pickDest = (value: string) => {
    const { store, folder } = parseDeckView(value);
    if (store === 'ann' && typeof folder === 'number') setChosenDest({ store: 'ann', folderId: folder });
    else if (store === 'wb' && folder !== undefined) setChosenDest({ store: 'wb', folderId: folder });
  };

  const newSlideTitle = dest.store === 'ann' ? `New text slide in ${destLabel}` : `New Whiteboard slide in ${destLabel}`;

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      {choosesDest && destinationOptions.length > 0 && (
        <label className="flex items-center gap-2 text-xs text-muted">
          New slides go to
          <select
            value={destValue}
            onChange={(e) => pickDest(e.target.value)}
            className="h-10 max-w-[220px] rounded-lg border border-fg/15 bg-panel-2 px-2 text-sm text-fg"
          >
            {['Announcements', 'Whiteboard & Notes'].map((group) => {
              const options = destinationOptions.filter((o) => o.group === group);
              return options.length === 0 ? null : (
                <optgroup key={group} label={group}>
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </label>
      )}
      <button type="button" onClick={openNew} className={HEADER_PRIMARY} title={newSlideTitle}>
        <Plus size={14} aria-hidden /> New slide
      </button>
      <button
        type="button"
        onClick={() => setTemplatesOpen(true)}
        disabled={dest.store === 'ann'}
        className={HEADER_BTN}
        title={dest.store === 'ann' ? 'Templates make Whiteboard slides. Open a Whiteboard folder, or choose one under "New slides go to".' : `Start a Whiteboard slide in ${destLabel} from a template`}
      >
        <Layers size={14} aria-hidden /> Templates
      </button>
      <button type="button" onClick={importSlides} disabled={importing} className={HEADER_BTN} title={importTitle}>
        <FileUp size={14} aria-hidden /> {importLabel}
      </button>
      {hasPictures && (
        <button type="button" onClick={addAllToGoLive} className={HEADER_BTN} title="Puts the PowerPoint slides shown into a Holy Mass slot or a Praise &amp; Worship card">
          <ListPlus size={14} aria-hidden /> Add PowerPoint to Go Live
        </button>
      )}
      <button type="button" onClick={togglePlay} disabled={visibleKeys.length === 0 && !playing} className={PLAY_BTN} title="Takes the staged slide (or the first shown) live and steps through the deck on the autoplay timer">
        {playing ? <Pause size={14} aria-hidden /> : <Play size={14} fill="currentColor" aria-hidden />}
        {playing ? 'Pause deck' : 'Play deck to projector'}
      </button>
    </div>
  );

  const viewIcon: ReactNode =
    view === 'wb:unfiled' ? <Inbox size={14} aria-hidden /> : view === 'all' ? <Layers size={14} aria-hidden /> : parsedView.folder === undefined ? (section === 'ann' ? <Megaphone size={14} aria-hidden /> : <Presentation size={14} aria-hidden />) : <Folder size={14} aria-hidden />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header: the title, where the operator is, and the actions. */}
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-5 px-6 pt-5 pb-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold tracking-wider text-accent uppercase">Slide deck</div>
          <h1 className="mt-1 text-3xl leading-tight font-extrabold tracking-tight text-fg xl:text-4xl">Announcements &amp; Whiteboard</h1>
          <nav aria-label="Breadcrumb" className="mt-3 flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-muted">
            <button type="button" onClick={() => changeView('all')} className="hover:text-fg">
              All Slides &amp; Decks
            </button>
            {sectionTitle && (
              <>
                <ChevronRight size={13} aria-hidden />
                <button type="button" onClick={() => changeView(section as string)} className="hover:text-fg">
                  {sectionTitle}
                </button>
              </>
            )}
            {view !== 'all' && view !== section && (
              <>
                <ChevronRight size={13} aria-hidden />
                <span className="flex items-center gap-1.5 font-semibold text-fg">
                  {viewIcon}
                  <span className="truncate">{viewTitle}</span>
                </span>
              </>
            )}
            <span className="ml-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 font-mono text-xs font-semibold text-accent tabular-nums" aria-label={`${inView.length} slides here`}>
              {inView.length}
            </span>
          </nav>
          <p className="mt-1.5 text-xs text-faint">
            New slides and imports go to <strong className="font-semibold text-fg/75">{destLabel}</strong>
          </p>
        </div>
        {headerActions}
      </header>

      {powerPoint.busy && (
        <div className="border-t border-line bg-accent/10 px-6 py-3">
          <ImportProgressBar progress={powerPoint.progress} />
        </div>
      )}

      <DeckControlBar
        tr={tr}
        playing={playing}
        playback={playback}
        onPlayback={setPlayback}
        current={currentIndex + 1}
        total={visibleKeys.length}
        onFirst={() => showIndex(0, playing)}
        onNext={() => stepForward(playing)}
        onTogglePlay={togglePlay}
        onClear={clearProjector}
        query={query}
        onQuery={setQuery}
        searchPlaceholder={view === 'all' ? 'Search slides…' : `Search in ${viewTitle}…`}
        columns={columns}
        onColumns={pickColumns}
        preset={preset}
        onPreset={pickPreset}
      />

      {error && (
        <div role="alert" className="flex items-start justify-between gap-3 border-b border-danger/40 bg-danger/10 px-6 py-2 text-sm whitespace-pre-line text-danger">
          {error}
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss" className="grid size-6 shrink-0 place-items-center rounded text-danger/70 hover:text-danger">
            <X size={14} aria-hidden />
          </button>
        </div>
      )}
      {/* Confirmations float as a toast over the grid, so they never push the deck down; errors stay in the bar above until dismissed. */}
      {notice && !error && (
        <div
          role="status"
          className="pointer-events-auto fixed bottom-6 left-1/2 z-50 flex max-w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-lg border border-accent/40 bg-surface px-4 py-2.5 text-sm text-fg shadow-xl shadow-black/50"
        >
          <Check size={15} className="shrink-0 text-accent" aria-hidden />
          <span className="min-w-0 [overflow-wrap:anywhere]">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="grid size-6 shrink-0 place-items-center rounded text-muted hover:text-fg">
            <X size={14} aria-hidden />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <FolderSidebar
          annFolders={annTree}
          wbFolders={wbTree}
          total={items.length}
          annTotal={counts.annTotal}
          wbTotal={counts.wbTotal}
          unfiledCount={unfiledCount}
          view={view}
          section={section ?? dest.store}
          dragging={dragSources}
          onView={changeView}
          onCreate={createFolder}
          onRename={renameFolder}
          onDelete={(store, folder) => void deleteFolder(store, folder)}
          onDropOn={fileDropped}
          onClearUnfiled={() => setClearOpen(true)}
        />

        <section
          aria-label={viewTitle}
          className={`relative min-h-0 min-w-0 flex-1 overflow-y-auto p-6 ${fileDragOver ? 'ring-2 ring-accent ring-inset' : ''}`}
          onDragOver={(e) => {
            if (!isFileDrag(e)) return;
            e.preventDefault();
            setFileDragOver(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFileDragOver(false);
          }}
          onDrop={dropFiles}
        >
          {fileDragOver && (
            <div className="pointer-events-none sticky top-0 z-30 mx-auto mb-3 w-fit rounded-md bg-accent px-4 py-2 text-sm font-extrabold uppercase condensed text-on-accent">
              {dest.store === 'ann' ? `${tr('dropHint')} → ${destName}` : 'Choose an Announcements folder to drop files into'}
            </div>
          )}

          {empty ? (
            <div className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-xl border border-dashed border-fg/20 bg-panel-2/40 p-10 text-center">
              <div className="grid size-16 place-items-center rounded-xl border border-accent/30 bg-panel text-accent">
                <Monitor size={26} aria-hidden />
              </div>
              <h2 className="mt-5 text-2xl font-bold tracking-tight text-fg">No slides yet</h2>
              <p className="mt-2 max-w-md text-sm text-muted">
                Write a text slide or a sermon note, or import a PowerPoint, PDF or images. Announcements and Whiteboard slides live side by side here, each in its
                own folders.
              </p>
              <p className="mt-1 text-xs text-faint">{tr('dropHint')}</p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <button type="button" onClick={openNew} className={HEADER_PRIMARY}>
                  <Plus size={14} aria-hidden /> New slide
                </button>
                <button type="button" onClick={importSlides} disabled={importing} className={HEADER_BTN}>
                  <FileUp size={14} aria-hidden /> {importLabel}
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* The bulk bar: shown only while something is picked, so it never takes room otherwise. */}
              {checked.size > 0 && (
                <SelectionToolbar
                  count={checked.size}
                  hidden={checked.size - visible.filter((i) => checked.has(i.key)).length}
                  allShown={visible.length > 0 && visible.every((i) => checked.has(i.key))}
                  onSelectAll={selectAllShown}
                  onClear={clearSelection}
                  onDelete={askDeleteChecked}
                  // Only Whiteboard slides can change folder; with none picked there is nowhere to move them.
                  folders={pickedWb.length > 0 ? wbFolders : []}
                  currentFolder={pickedFolder}
                  moveOpen={bulkMoveOpen}
                  onMoveOpen={(open) => {
                    setMoveFor(null);
                    setBulkMoveOpen(open);
                  }}
                  onMove={(target) => void moveTo(pickedWb, target, pickedAnnCount)}
                />
              )}

              {reorderable && inView.length > 1 && <p className="mb-3 text-xs text-faint">{tr('dragHint')}</p>}

              {loaded && inView.length === 0 && (
                <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed border-fg/20 bg-panel-2/40 p-10 text-center">
                  <div className="grid size-14 place-items-center rounded-xl border border-accent/30 bg-panel text-accent">
                    {view === 'wb:unfiled' ? <Inbox size={24} aria-hidden /> : <Folder size={24} aria-hidden />}
                  </div>
                  <h3 className="mt-4 text-xl font-bold tracking-tight text-fg">{view === 'wb:unfiled' ? 'Nothing is unfiled' : 'Nothing here yet'}</h3>
                  <p className="mt-2 max-w-md text-sm text-muted">
                    {view === 'wb:unfiled'
                      ? 'Every Whiteboard slide is in a folder. Drag a slide onto Unfiled to take it out of its folder.'
                      : `Make a new slide or import into ${destLabel}.`}
                  </p>
                  {view !== 'wb:unfiled' && (
                    <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                      <button type="button" onClick={openNew} className={HEADER_PRIMARY}>
                        <Plus size={14} aria-hidden /> New slide
                      </button>
                      <button type="button" onClick={importSlides} disabled={importing} className={HEADER_BTN}>
                        <FileUp size={14} aria-hidden /> {importLabel}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {inView.length > 0 && visible.length === 0 && (
                <p role="status" className="rounded-lg border border-dashed border-fg/20 p-8 text-center text-sm text-muted">
                  No slides match "{query.trim()}".
                </p>
              )}

              <ul className={`grid ${GRID_CLASS[columns]}`}>
                {visible.map((item, i) => {
                  const entry = entries.get(item.key)!;
                  const wb = entry.source === 'wb' ? entry.slide : null;
                  const folderLabel =
                    view === 'all' || view === 'ann' || view === 'wb'
                      ? entry.source === 'ann'
                        ? annFolderName(entry.slide.folderId)
                        : entry.slide.folderId != null
                          ? wbFolderName(entry.slide.folderId)
                          : view === 'all'
                            ? 'Whiteboard'
                            : null
                      : null;
                  const isLive = shows(liveFrame, item.key);
                  return (
                    <li
                      key={item.key}
                      ref={(el) => {
                        if (el) cardRefs.current.set(item.key, el);
                        else cardRefs.current.delete(item.key);
                      }}
                      onDragOver={(e) => {
                        if (reorderKey == null) return;
                        e.preventDefault();
                        setDropKey(item.key);
                      }}
                      onDragLeave={() => setDropKey((k) => (k === item.key ? null : k))}
                      onDrop={(e) => {
                        if (reorderKey == null) return;
                        e.preventDefault();
                        dropOn(item.key);
                      }}
                      className={`group relative rounded-lg transition ${dropKey === item.key && reorderKey !== item.key ? 'ring-2 ring-accent ring-offset-2 ring-offset-canvas' : ''}`}
                    >
                      <SlideCard
                        title={item.title}
                        preview={<Preview entry={entry} />}
                        index={i + 1}
                        checked={checked.has(item.key)}
                        focused={activeKey === item.key}
                        live={isLive}
                        staged={!isLive && shows(stagedFrame, item.key)}
                        folderLabel={folderLabel}
                        reorderable={reorderable}
                        kindIcon={
                          entry.source === 'ann' ? (
                            entry.slide.slideType === 'text' ? (
                              <Type size={12} className="shrink-0 text-faint" aria-label="Text slide" />
                            ) : (
                              <Megaphone size={12} className="shrink-0 text-faint" aria-label="Announcement" />
                            )
                          ) : wb?.image ? (
                            <ImageIcon size={12} className="shrink-0 text-faint" aria-label="PowerPoint slide" />
                          ) : (
                            <Presentation size={12} className="shrink-0 text-faint" aria-label="Whiteboard slide" />
                          )
                        }
                        moveOpen={moveFor === item.key}
                        dense={columns === 6}
                        dragging={dragging.has(item.key)}
                        onCheck={(shift) => check(item.key, shift)}
                        onFocus={() => showKey(item.key, false)}
                        onDragStart={(e) => onDragStart(e, item)}
                        onDragEnd={endDrag}
                        actions={{
                          project: () => showKey(item.key, true),
                          addToGoLive: wb?.slideId != null ? () => addToGoLive(wb) : undefined,
                          move:
                            wb && wbFolders.length > 0
                              ? () => {
                                  setBulkMoveOpen(false);
                                  setMoveFor((cur) => (cur === item.key ? null : item.key));
                                }
                              : undefined,
                          rename: wb ? () => startRename(item.key, wb.title) : undefined,
                          edit: wb && !wb.image ? () => openEdit(wb) : undefined,
                          duplicate: wb && !wb.image ? () => void duplicate(wb) : undefined,
                          remove: () => setDeleteKeys([item.key]),
                        }}
                      />
                      {/* Rename: the title line becomes a field. Enter saves, Escape cancels; a refused title stays open with the reason. */}
                      {wb && renamingKey === item.key && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void saveRename(wb);
                          }}
                          onKeyDown={(e) => e.key === 'Escape' && cancelRename()}
                          className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-1 rounded-b-lg border-t border-accent bg-surface p-2 shadow-lg shadow-black/50"
                        >
                          <div className="flex items-center gap-1.5">
                            <input
                              autoFocus
                              value={renameDraft}
                              onChange={(e) => {
                                setRenameDraft(e.target.value);
                                setRenameError(null);
                              }}
                              onFocus={(e) => e.currentTarget.select()}
                              maxLength={200}
                              aria-label={`New title for ${wb.title || 'untitled slide'}`}
                              aria-invalid={renameError ? true : undefined}
                              className="h-8 min-w-0 flex-1 rounded-md border border-fg/20 bg-panel-2 px-2 text-sm font-semibold text-fg outline-none focus:border-accent"
                            />
                            <button type="submit" aria-label="Save title" title="Save" className="grid size-8 shrink-0 place-items-center rounded-md text-ok transition hover:bg-ok/15">
                              <Check size={15} aria-hidden />
                            </button>
                            <button type="button" onClick={cancelRename} aria-label="Cancel" title="Cancel" className="grid size-8 shrink-0 place-items-center rounded-md text-muted transition hover:bg-fg/10">
                              <X size={15} aria-hidden />
                            </button>
                          </div>
                          {renameError && (
                            <p role="alert" className="px-1 text-xs text-danger">
                              {renameError}
                            </p>
                          )}
                        </form>
                      )}
                      {wb && moveFor === item.key && (
                        <MoveMenu folders={wbFolders} current={wb.folderId} onPick={(target) => void moveTo([wb.id], target)} onClose={() => setMoveFor(null)} />
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>

        <SpeakerNotesDrawer
          tr={tr}
          open={notesOpen}
          onToggle={toggleNotes}
          slideKey={activeEntry ? activeKey : null}
          onSave={saveNotes}
          title={activeEntry ? (activeEntry.source === 'ann' ? activeEntry.slide.name : activeEntry.slide.title) : null}
          preview={activeEntry ? <Preview entry={activeEntry} /> : null}
          notes={activeEntry?.slide.notes ?? null}
        />
      </div>

      {textFolder != null && (
        <TextSlideModal
          folderId={textFolder}
          onClose={() => setTextFolder(null)}
          onSaved={() => {
            const folder = textFolder;
            setTextFolder(null);
            setNotice(`Text slides saved to "${annFolderName(folder)}".`);
            void reload('ann');
          }}
        />
      )}
      {editor && (
        <SlideEditorModal
          key={editor.key}
          mode={editor.mode}
          initial={editor.initial}
          onSave={saveSlide}
          onClose={() => setEditor(null)}
          onUseTemplate={() => setTemplatesOpen(true)}
        />
      )}
      {deleteKeys && (
        <DeleteSelectedDialog
          titles={deleteKeys.map((k) => items.find((i) => i.key === k)?.title ?? '')}
          busy={deleting}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleteKeys(null)}
        />
      )}
      {clearOpen && <ClearUnfiledDialog count={unfiledCount} busy={clearing} onConfirm={() => void clearUnfiled()} onCancel={() => setClearOpen(false)} />}
      {templatesOpen && <TemplateModal onPick={pickTemplate} onClose={() => setTemplatesOpen(false)} />}
      {targetDecks && (
        <TargetSlotSelectorModal
          decks={targetDecks}
          onClose={() => setTargetDecks(null)}
          onDone={(message) => {
            setTargetDecks(null);
            setNotice(message);
          }}
        />
      )}
    </div>
  );
}

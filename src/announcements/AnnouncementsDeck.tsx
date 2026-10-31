import { useEffect, useRef, useState, type DragEvent, type FormEvent, type MutableRefObject } from 'react';
import { ChevronsLeft, ChevronsRight, Folder, FolderPlus, GripVertical, Info, Megaphone, Pause, Pencil, Play, Trash2, Type, Upload } from 'lucide-react';
import type { Frame } from '../../shared/live.js';
import { bridge } from '../live/bridge';
import { dispatch, useLive } from '../live/store';
import { setUi, useUi } from '../state/ui';
import { useAnnT, type AnnT } from './strings';
import { SpeakerNotes } from './SpeakerNotes';
import { getSlideImageUrl, onSlideImageError } from '../output/slideImage';
import { SlidePreview, TextSlideModal } from './TextSlideModal';
import type { AnnouncementFolder, AnnouncementSlide, ImportResult } from './types';

const api = bridge.announcements;

/** The playback choices. They are remembered on this machine, so the deck opens the way the operator left it. */
interface Playback {
  interval: number;
  loop: boolean;
  showCount: boolean;
}

const PLAYBACK_KEY = 'apccmma.announcements.playback';

/** Autoplay interval in seconds, kept between 1 and 30. */
const clampInterval = (value: unknown) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(30, Math.max(1, n)) : 10;
};

function loadPlayback(): Playback {
  try {
    const raw = JSON.parse(localStorage.getItem(PLAYBACK_KEY) ?? 'null');
    return { interval: clampInterval(raw?.interval), loop: raw?.loop === true, showCount: raw?.showCount === true };
  } catch {
    return { interval: 10, loop: false, showCount: false };
  }
}

function savePlayback(playback: Playback) {
  try {
    localStorage.setItem(PLAYBACK_KEY, JSON.stringify(playback));
  } catch {
    /* storage unavailable: the choices last for this session */
  }
}

/** `null` is the virtual "All Slides" folder. */
type FolderId = number | null;

const toFrame = (s: AnnouncementSlide): Frame =>
  s.slideType === 'image' && s.src
    ? { kind: 'image', title: s.name, src: s.src, notes: s.notes ?? undefined }
    : { kind: 'text', title: s.name, headline: s.headline ?? undefined, text: s.text ?? '', bg: s.bgSrc, notes: s.notes ?? undefined, style: s.style };

/** Whether the projector is already showing this slide. */
const isShowing = (frame: Frame, s: AnnouncementSlide) =>
  s.slideType === 'image'
    ? frame.kind === 'image' && frame.src === s.src
    : frame.kind === 'text' && frame.title === s.name && frame.text === s.text;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Returns a copy of the list with `fromId` placed where `toId` was, renumbered from 1. */
function moveSlide(list: AnnouncementSlide[], fromId: number, toId: number) {
  const from = list.findIndex((s) => s.id === fromId);
  const to = list.findIndex((s) => s.id === toId);
  if (from < 0 || to < 0) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next.map((s, i) => ({ ...s, order: i + 1 }));
}

export function AnnouncementsDeck() {
  const tr = useAnnT();
  const lang = useUi((s) => s.lang);
  const [folders, setFolders] = useState<AnnouncementFolder[]>([]);
  const [total, setTotal] = useState(0);
  const [slides, setSlides] = useState<AnnouncementSlide[]>([]);
  const [folderId, setFolderId] = useState<FolderId>(null);
  const [importTarget, setImportTarget] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [textOpen, setTextOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropId, setDropId] = useState<number | null>(null);
  const [playback, setPlayback] = useState<Playback>(loadPlayback);
  const [playing, setPlaying] = useState(false);
  const projector = useLive((s) => s.state.projector);
  // Set when a queue request switches folders, so the folder change keeps that slide highlighted.
  const pendingSlide = useRef<number | null>(null);
  // One entry per slide card, so the active card can be scrolled into view while the arrow keys step through the deck.
  const cardRefs = useRef<(HTMLLIElement | null)[]>([]);

  const loadFolders = async () => {
    const res = await api.folders();
    setFolders(res.folders);
    setTotal(res.total);
    setImportTarget((current) => current ?? res.folders[0]?.id ?? null);
  };
  const loadSlides = async () => setSlides(await api.slides(folderId));
  const reload = async () => {
    await loadFolders();
    await loadSlides();
  };

  useEffect(() => {
    loadFolders().catch((err) => setError(errorText(err)));
  }, []);

  useEffect(() => {
    setActiveId(pendingSlide.current);
    pendingSlide.current = null;
    loadSlides().catch((err) => setError(errorText(err)));
  }, [folderId]);

  // A Service Queue request to stage one slide: switch to its folder, then stage it.
  useEffect(() => {
    const pending = useUi.getState().pendingFocus;
    if (pending?.kind !== 'slide') return;
    setUi({ pendingFocus: null });
    api
      .slides(null)
      .then((list) => {
        const slide = list.find((s) => s.id === pending.id);
        if (!slide) {
          setError('That slide is no longer in the library.');
          return;
        }
        pendingSlide.current = slide.id;
        setFolderId(slide.folderId);
        dispatch({ type: 'projector/stage', frame: toFrame(slide) });
      })
      .catch((err) => setError(errorText(err)));
  }, []);

  /** Runs an IPC task with busy and error handling. Resolves true on success. */
  const run = async (task: () => Promise<void>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await task();
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Import and text-slide creation go to the open folder, or to the chosen folder under "All Slides".
  const target = folderId ?? importTarget;

  /** Reloads after an import that added slides, and lists every file that was skipped with its reason. */
  const reportImport = async (result: ImportResult) => {
    if (result.imported > 0) await reload();
    if (result.failed.length > 0) setError(result.failed.map((f) => `${f.name}: ${f.reason}`).join('\n'));
  };

  const importSlides = () => {
    if (target == null) return;
    void run(async () => {
      const result = await api.importSlides(target, lang);
      if (result) await reportImport(result);
    });
  };

  // Drag and drop from the file system. Internal slide reordering carries no files, so it is not caught here.
  const [fileDragOver, setFileDragOver] = useState(false);
  const isFileDrag = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  const dropFiles = (e: DragEvent<HTMLElement>) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    setFileDragOver(false);
    if (target == null) return;
    const paths = Array.from(e.dataTransfer.files).map((file) => bridge.files.pathFor(file));
    if (paths.length === 0) return;
    void run(async () => {
      await reportImport(await api.importPaths(target, paths));
    });
  };

  const createFolder = (name: string) =>
    run(async () => {
      const folder = await api.createFolder(name);
      await loadFolders();
      setFolderId(folder.id);
    });

  const renameFolder = (id: number, name: string) =>
    run(async () => {
      await api.renameFolder(id, name);
      await loadFolders();
    });

  const deleteFolder = (folder: AnnouncementFolder) => {
    if (!window.confirm(tr('confirmDeleteFolder', { name: folder.name }))) return;
    void run(async () => {
      await api.deleteFolder(folder.id);
      if (folderId === folder.id) setFolderId(null);
      else await loadSlides();
      await loadFolders();
    });
  };

  const removeSlide = (slide: AnnouncementSlide) => {
    if (!window.confirm(tr('confirmDeleteSlide'))) return;
    void run(async () => {
      await api.deleteSlide(slide.id);
      await reload();
    });
  };

  /** A single click loads the slide into the staged slot without touching the projector. */
  const stage = (slide: AnnouncementSlide) => {
    setActiveId(slide.id);
    dispatch({ type: 'projector/stage', frame: toFrame(slide) });
  };

  // ── Playback: step by hand or on a timer. While the timer runs, each slide it reaches goes live. ──
  const currentIndex = slides.findIndex((s) => s.id === activeId);

  /** Stages the slide at `index`, and takes it live when `take` is set. */
  const showIndex = (index: number, take: boolean) => {
    const slide = slides[index];
    if (!slide) return;
    setActiveId(slide.id);
    dispatch({ type: 'projector/stage', frame: toFrame(slide) });
    if (take) dispatch({ type: 'projector/take' });
  };

  /** Moves one slide on. Past the last slide it wraps to the first when looping, otherwise the timer stops. */
  const stepForward = (take: boolean) => {
    if (slides.length === 0) return;
    if (currentIndex + 1 < slides.length) showIndex(currentIndex + 1, take);
    else if (playback.loop) showIndex(0, take);
    else setPlaying(false);
  };

  /** Takes the staged slide live (Enter). Play moves the staged slide to live; the PROJECTOR switch in the top bar decides whether it is shown. */
  const takeActive = () => {
    if (currentIndex >= 0) showIndex(currentIndex, true);
  };

  /** Starts or stops the timer. Starting takes the current slide live, or the first slide when none is chosen. */
  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (slides.length === 0) return;
    showIndex(currentIndex >= 0 ? currentIndex : 0, true);
    setPlaying(true);
  };

  /** Takes every announcement off the projector and stops the timer. The library is not changed. */
  const clearAll = () => {
    setPlaying(false);
    setActiveId(null);
    dispatch({ type: 'projector/clear' });
  };

  // The timer. Each slide gets its full interval, so the countdown restarts whenever the slide, the interval or loop changes.
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => stepForward(true), playback.interval * 1000);
    return () => window.clearInterval(timer);
  }, [playing, playback.interval, playback.loop, activeId, slides]);

  // The counter goes to the projector while this deck is open. Leaving the deck clears it.
  useEffect(() => {
    dispatch({ type: 'counter/set', counter: { show: playback.showCount, index: currentIndex + 1, total: slides.length } });
  }, [playback.showCount, currentIndex, slides.length]);
  useEffect(() => () => dispatch({ type: 'counter/set', counter: null }), []);

  useEffect(() => savePlayback(playback), [playback]);

  // Keyboard, for the operator and a presentation clicker: Right, Down, Space and Page Down stage the next slide,
  // Left, Up and Page Up the previous one, and Enter takes the staged slide live. None of these is a global hotkey.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]') || useUi.getState().paletteOpen) return;
      if (slides.length === 0) return;
      if (e.key === 'Enter') {
        if (activeId == null) return;
        e.preventDefault();
        takeActive();
        return;
      }
      const forward = [' ', 'ArrowRight', 'ArrowDown', 'PageDown'].includes(e.key);
      const back = ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key);
      if (!forward && !back) return;
      e.preventDefault();
      const current = slides.findIndex((s) => s.id === activeId);
      const from = current < 0 ? (forward ? -1 : slides.length) : current;
      const next = Math.min(Math.max(from + (forward ? 1 : -1), 0), slides.length - 1);
      stage(slides[next]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [slides, activeId]);

  // Keep the active card in view as the arrow keys move through the slides. "nearest" moves only as far as needed.
  useEffect(() => {
    const index = slides.findIndex((s) => s.id === activeId);
    cardRefs.current[index]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [activeId]);

  // Drag and drop: the list reorders instantly, then the new order is saved. A failed save reverts.
  const dropOn = (targetSlide: AnnouncementSlide) => {
    const from = dragId;
    setDragId(null);
    setDropId(null);
    if (from == null || folderId == null || from === targetSlide.id) return;
    const previous = slides;
    const next = moveSlide(slides, from, targetSlide.id);
    setSlides(next);
    void run(async () => {
      await api.reorder(folderId, next.map((s) => s.id));
    }).then((ok) => {
      if (!ok) {
        setSlides(previous);
        void loadSlides();
      }
    });
  };

  const liveFrame = projector.live;
  const stagedFrame = projector.staged;
  const currentFolder = folders.find((f) => f.id === folderId);
  const folderLabel = folderId === null ? tr('allSlides') : currentFolder?.name ?? '';
  const count = folderId === null ? total : currentFolder?.count ?? 0;

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex flex-wrap items-start justify-between gap-6 px-6 pt-5 pb-3">
        <div>
          <div className="text-sm font-semibold tracking-wider text-accent uppercase">{tr('eyebrow')}</div>
          <h1 className="mt-1 text-3xl leading-tight font-extrabold tracking-tight text-fg xl:text-4xl">{tr('title')}</h1>
          <p className="mt-2 text-[15px] text-muted">{tr('subtitle')}</p>
          <div className="mt-3 flex items-center gap-2 text-sm text-muted">
            <span className="font-semibold text-fg">{folderLabel}</span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">{tr('slideCount', { n: count })}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {folderId === null && folders.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-muted">
              {tr('importTo')}
              <select
                value={importTarget ?? ''}
                onChange={(e) => setImportTarget(Number(e.target.value))}
                className="h-10 rounded-md border border-fg/15 bg-panel-2 px-2 text-sm text-fg"
              >
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={importSlides}
            disabled={busy || target == null}
            className="flex h-11 items-center gap-2 rounded-md border border-fg/15 px-4 text-xs font-extrabold tracking-wider uppercase hover:bg-fg/10 disabled:opacity-40"
          >
            <Upload size={16} aria-hidden /> {tr('importSlides')}
          </button>
          <button
            type="button"
            onClick={() => setTextOpen(true)}
            disabled={busy || target == null}
            className="flex h-11 items-center gap-2 rounded-md border border-fg/15 px-4 text-xs font-extrabold tracking-wider uppercase hover:bg-fg/10 disabled:opacity-40"
          >
            <Type size={16} aria-hidden /> {tr('createText')}
          </button>
        </div>
      </header>

      <PlaybackBar
        tr={tr}
        playing={playing}
        playback={playback}
        onChange={setPlayback}
        current={currentIndex + 1}
        total={slides.length}
        disabled={slides.length === 0}
        onFirst={() => showIndex(0, playing)}
        onNext={() => stepForward(playing)}
        onTogglePlay={togglePlay}
        onClear={clearAll}
      />

      {error && (
        <div role="alert" className="border-b border-crimson/40 bg-crimson/10 px-6 py-2 text-sm whitespace-pre-line text-danger">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <FolderList
          tr={tr}
          folders={folders}
          total={total}
          selected={folderId}
          onSelect={setFolderId}
          onCreate={createFolder}
          onRename={renameFolder}
          onDelete={deleteFolder}
        />

        <section
          tabIndex={0}
          aria-label={folderLabel}
          className={`relative min-w-0 flex-1 overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${fileDragOver ? 'ring-2 ring-accent ring-inset' : ''}`}
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
            <div className="pointer-events-none absolute inset-x-0 top-6 z-10 mx-auto w-fit rounded-md bg-accent px-4 py-2 text-sm font-extrabold uppercase condensed text-on-accent">
              {tr('dropHint')}
            </div>
          )}
          {slides.length === 0 ? (
            <EmptyState tr={tr} onImport={importSlides} disabled={busy || target == null} />
          ) : (
            <>
              {folderId !== null && <p className="px-6 pt-5 text-xs text-faint">{tr('dragHint')}</p>}
              <SlideGrid
                tr={tr}
                slides={slides}
                reorderable={folderId !== null}
                cardRefs={cardRefs}
                activeId={activeId}
                liveFrame={liveFrame}
                stagedFrame={stagedFrame}
                dragId={dragId}
                dropId={dropId}
                onStage={stage}
                onRemove={removeSlide}
                onDragStart={setDragId}
                onDragEnter={setDropId}
                onDrop={dropOn}
                onDragEnd={() => {
                  setDragId(null);
                  setDropId(null);
                }}
              />
            </>
          )}
        </section>

        <SpeakerNotes tr={tr} staged={stagedFrame} />
      </div>

      {textOpen && target != null && (
        <TextSlideModal
          folderId={target}
          onClose={() => setTextOpen(false)}
          onSaved={() => {
            setTextOpen(false);
            void run(reload);
          }}
        />
      )}
    </div>
  );
}

function FolderList({
  tr,
  folders,
  total,
  selected,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  tr: AnnT;
  folders: AnnouncementFolder[];
  total: number;
  selected: FolderId;
  onSelect: (id: FolderId) => void;
  onCreate: (name: string) => Promise<boolean>;
  onRename: (id: number, name: string) => Promise<boolean>;
  onDelete: (folder: AnnouncementFolder) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  const submitNew = async (e: FormEvent) => {
    e.preventDefault();
    if (await onCreate(name)) {
      setName('');
      setAdding(false);
    }
  };

  const submitRename = async (e: FormEvent, id: number) => {
    e.preventDefault();
    if (await onRename(id, draft)) setEditingId(null);
  };

  const rowClass = (isActive: boolean) =>
    `flex min-w-0 flex-1 items-center gap-3 rounded-md border-l-2 px-3 py-2.5 text-left text-sm font-semibold transition ${
      isActive ? 'border-accent bg-panel-2 text-fg' : 'border-transparent text-muted hover:bg-fg/10 hover:text-fg'
    }`;

  const inputClass = 'h-10 w-full rounded-md border border-fg/15 bg-panel-2 px-3 text-sm outline-none focus:border-accent';

  return (
    <aside className="flex w-[260px] shrink-0 flex-col gap-3 border-r border-line p-4">
      {adding ? (
        <form onSubmit={submitNew} className="flex flex-col gap-2">
          <input
            autoFocus
            value={name}
            maxLength={60}
            placeholder={tr('folderName')}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setAdding(false)}
            className={inputClass}
          />
          <div className="flex gap-2">
            <button type="submit" disabled={!name.trim()} className="h-9 flex-1 rounded-md bg-accent text-xs font-extrabold uppercase text-on-accent disabled:opacity-40">
              {tr('create')}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="h-9 rounded-md px-3 text-xs font-bold uppercase text-muted hover:text-fg">
              {tr('cancel')}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex h-10 items-center justify-center gap-2 rounded-md border border-fg/15 text-xs font-extrabold tracking-wider uppercase hover:bg-fg/10"
        >
          <FolderPlus size={15} aria-hidden /> {tr('newFolder')}
        </button>
      )}

      <nav aria-label={tr('allSlides')} className="flex flex-col gap-1">
        <div className="flex items-center">
          <button type="button" onClick={() => onSelect(null)} className={rowClass(selected === null)} aria-current={selected === null}>
            <Folder size={15} aria-hidden />
            <span className="flex-1">{tr('allSlides')}</span>
            <span className="font-mono text-xs tabular-nums">{total}</span>
          </button>
        </div>

        {folders.map((f) =>
          editingId === f.id ? (
            <form key={f.id} onSubmit={(e) => submitRename(e, f.id)} className="flex gap-2 py-1">
              <input
                autoFocus
                value={draft}
                maxLength={60}
                aria-label={tr('rename')}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setEditingId(null)}
                className={inputClass}
              />
            </form>
          ) : (
            <div key={f.id} className="group flex items-center">
              <button type="button" onClick={() => onSelect(f.id)} className={rowClass(selected === f.id)} aria-current={selected === f.id}>
                <Folder size={15} aria-hidden />
                <span className="flex-1 truncate">{f.name}</span>
                <span className="font-mono text-xs tabular-nums">{f.count}</span>
              </button>
              <div className="flex items-center opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => { setDraft(f.name); setEditingId(f.id); }}
                  aria-label={tr('rename')}
                  title={tr('rename')}
                  className="grid size-7 place-items-center rounded text-muted hover:bg-fg/10 hover:text-fg"
                >
                  <Pencil size={13} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(f)}
                  aria-label={tr('deleteFolder')}
                  title={tr('deleteFolder')}
                  className="grid size-7 place-items-center rounded text-muted hover:bg-crimson/20 hover:text-danger"
                >
                  <Trash2 size={13} aria-hidden />
                </button>
              </div>
            </div>
          ),
        )}
      </nav>
    </aside>
  );
}

function EmptyState({ tr, onImport, disabled }: { tr: AnnT; onImport: () => void; disabled: boolean }) {
  return (
    <div className="flex h-full min-h-[480px] flex-col items-center justify-center p-10 text-center">
      <div className="grid size-16 place-items-center rounded-xl border border-fg/15 bg-panel">
        <Megaphone size={26} strokeWidth={1.6} aria-hidden />
      </div>
      <h2 className="mt-5 text-3xl font-bold tracking-tight">{tr('emptyTitle')}</h2>
      <p className="mt-2 max-w-md text-sm text-muted">{tr('emptyBody')}</p>
      <p className="mt-1 text-xs text-faint">{tr('dropHint')}</p>

      <div className="mt-6 flex flex-col items-center gap-4 lg:flex-row">
        <button
          type="button"
          onClick={onImport}
          disabled={disabled}
          className="flex h-11 items-center gap-2 rounded-md bg-accent px-5 text-xs font-extrabold tracking-wider uppercase text-on-accent hover:brightness-105 disabled:opacity-40"
        >
          <Upload size={16} aria-hidden /> {tr('importSlides')}
        </button>
        <aside className="flex max-w-md gap-3 rounded-lg border border-fg/15 bg-panel p-4 text-left">
          <Info size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
          <div className="text-sm">
            <p className="font-bold">{tr('infoTitle')}</p>
            <p className="mt-1 text-muted">{tr('infoBody')}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SlideGrid({
  tr,
  slides,
  reorderable,
  cardRefs,
  activeId,
  liveFrame,
  stagedFrame,
  dragId,
  dropId,
  onStage,
  onRemove,
  onDragStart,
  onDragEnter,
  onDrop,
  onDragEnd,
}: {
  tr: AnnT;
  slides: AnnouncementSlide[];
  reorderable: boolean;
  cardRefs: MutableRefObject<(HTMLLIElement | null)[]>;
  activeId: number | null;
  liveFrame: Frame;
  stagedFrame: Frame;
  dragId: number | null;
  dropId: number | null;
  onStage: (slide: AnnouncementSlide) => void;
  onRemove: (slide: AnnouncementSlide) => void;
  onDragStart: (id: number) => void;
  onDragEnter: (id: number) => void;
  onDrop: (slide: AnnouncementSlide) => void;
  onDragEnd: () => void;
}) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4 p-6">
      {slides.map((slide, i) => {
        const isActive = activeId === slide.id;
        return (
          <li
            key={slide.id}
            ref={(el) => {
              cardRefs.current[i] = el;
            }}
            draggable={reorderable}
            onDragStart={() => onDragStart(slide.id)}
            onDragOver={(e) => {
              if (dragId == null) return;
              e.preventDefault();
              onDragEnter(slide.id);
            }}
            onDrop={(e) => {
              e.preventDefault();
              onDrop(slide);
            }}
            onDragEnd={onDragEnd}
            className={`group relative rounded-lg transition ${dropId === slide.id ? 'ring-2 ring-accent' : ''} ${
              dragId === slide.id ? 'opacity-40' : ''
            }`}
          >
            <button
              type="button"
              onClick={() => onStage(slide)}
              aria-pressed={isActive}
              className={`w-full overflow-hidden rounded-lg border bg-panel text-left transition ${
                isActive ? 'border-accent ring-1 ring-accent' : 'border-line hover:border-fg/15'
              }`}
            >
              <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-md border border-line bg-black/80">
                {slide.slideType === 'image' && slide.src ? (
                  // object-contain keeps the whole page visible, with bars where its proportions differ from the screen.
                  <img src={getSlideImageUrl(slide.src)} onError={onSlideImageError} alt={slide.name} loading="lazy" draggable={false} className="h-full w-full object-contain" />
                ) : (
                  <SlidePreview text={slide.text ?? ''} headline={slide.headline} bgSrc={slide.bgSrc} style={slide.style} className="h-full w-full" />
                )}
                <span className="absolute top-2 left-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] font-bold">{i + 1}</span>
                <div className="absolute bottom-2 left-2 flex gap-1">
                  {isShowing(liveFrame, slide) && <Badge tone="live">{tr('live')}</Badge>}
                  {!isShowing(liveFrame, slide) && isShowing(stagedFrame, slide) && <Badge tone="staged">{tr('staged')}</Badge>}
                </div>
              </div>
              <div className="flex items-center gap-2 px-3 py-2">
                {reorderable && <GripVertical size={14} className="shrink-0 cursor-grab text-faint" aria-hidden />}
                <span className="flex-1 truncate text-sm font-semibold">{slide.name}</span>
                {slide.slideType === 'text' && <Type size={12} className="shrink-0 text-faint" aria-hidden />}
              </div>
            </button>
            <button
              type="button"
              onClick={() => onRemove(slide)}
              aria-label={tr('deleteSlide')}
              title={tr('deleteSlide')}
              className="absolute top-2 right-2 grid size-7 place-items-center rounded bg-black/80 text-white opacity-0 transition hover:bg-crimson focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
            >
              <Trash2 size={14} aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Badge({ tone, children }: { tone: 'live' | 'staged'; children: string }) {
  const style = tone === 'live' ? 'bg-accent text-on-accent' : 'bg-amber text-on-accent';
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-extrabold uppercase ${style}`}>{children}</span>;
}

/** A gold switch. Lit amber when on, dark stone when off. */
function LimeSwitch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex items-center gap-2 text-xs font-bold tracking-wider text-fg/80 uppercase">
      <span className={`relative h-5 w-9 rounded-full border transition ${on ? 'border-accent bg-accent' : 'border-fg/20 bg-panel-2'}`}>
        <span className={`absolute top-0.5 size-3.5 rounded-full transition-all ${on ? 'left-[18px] bg-panel' : 'left-0.5 bg-fg/60'}`} aria-hidden />
      </span>
      {label}
    </button>
  );
}

/**
 * The playback bar: step buttons, autoplay, the loop and count switches, the slide counter, and the clear and play
 * actions. Navigation sits on the left and the projector actions on the right. The keyboard hint sits underneath.
 */
function PlaybackBar({ tr, playing, playback, onChange, current, total, disabled, onFirst, onNext, onTogglePlay, onClear }: {
  tr: AnnT;
  playing: boolean;
  playback: Playback;
  onChange: (playback: Playback) => void;
  current: number;
  total: number;
  disabled: boolean;
  onFirst: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
  onClear: () => void;
}) {
  const tile = 'grid size-9 place-items-center rounded-lg border border-accent/30 bg-panel-2 text-fg/90 transition-colors hover:border-accent hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40';
  const timerLabel = playing ? tr('pauseAutoplay') : tr('startAutoplay');
  const numberField = 'w-14 rounded-md border border-accent/40 bg-panel-2 px-2 py-1 text-right font-mono text-xs font-bold text-fg focus:border-accent focus:outline-none';

  return (
    <div role="toolbar" aria-label={tr('playback')} className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line px-6 py-3">
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={onFirst} disabled={disabled} aria-label={tr('firstSlide')} title={tr('firstSlide')} className={tile}>
          <ChevronsLeft size={16} aria-hidden />
        </button>
        <button type="button" onClick={onTogglePlay} disabled={disabled && !playing} aria-label={timerLabel} title={timerLabel} className={tile}>
          {playing ? <Pause size={15} aria-hidden /> : <Play size={14} aria-hidden />}
        </button>
        <button type="button" onClick={onNext} disabled={disabled} aria-label={tr('nextSlide')} title={tr('nextSlide')} className={tile}>
          <ChevronsRight size={16} aria-hidden />
        </button>
      </div>

      <div className="flex items-center gap-2.5">
        <span className="text-xs font-bold tracking-wider text-muted uppercase">{tr('autoplay')}</span>
        <input
          type="range"
          min={1}
          max={30}
          step={1}
          value={playback.interval}
          onChange={(e) => onChange({ ...playback, interval: clampInterval(e.target.value) })}
          aria-label={tr('autoplayInterval')}
          className="h-1.5 w-28 cursor-pointer rounded-lg bg-fg/10 accent-accent"
        />
        <span className="flex items-center gap-1.5">
          <input
            type="number"
            min={1}
            max={30}
            value={playback.interval}
            onChange={(e) => {
              if (e.target.value !== '') onChange({ ...playback, interval: clampInterval(e.target.value) });
            }}
            // Typing here must not trigger the deck's keys (arrows, space, Enter).
            onKeyDown={(e) => e.stopPropagation()}
            aria-label={tr('autoplayInterval')}
            className={numberField}
          />
          <span className="text-xs font-bold text-muted">{tr('secondsUnit')}</span>
        </span>
      </div>

      <LimeSwitch label={tr('loopDeck')} on={playback.loop} onChange={(loop) => onChange({ ...playback, loop })} />
      <LimeSwitch label={tr('showCount')} on={playback.showCount} onChange={(showCount) => onChange({ ...playback, showCount })} />

      <output aria-live="polite" className="rounded-full border border-accent/30 bg-panel-2/90 px-3 py-1 font-mono text-xs font-semibold tabular-nums text-accent">
        {current > 0 ? tr('pageOf', { n: current, total }) : tr('noSlideSelected')}
      </output>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onClear}
          className="flex h-10 items-center gap-2 rounded-lg border border-danger/50 bg-panel-2/80 px-3.5 text-xs font-bold tracking-wider text-danger uppercase transition-colors hover:border-danger hover:bg-danger/10 focus-visible:ring-2 focus-visible:ring-danger focus-visible:outline-none"
        >
          <Trash2 size={14} aria-hidden /> {tr('clearProjector')}
        </button>
        <button
          type="button"
          onClick={onTogglePlay}
          disabled={disabled && !playing}
          className="flex h-10 items-center gap-2 rounded-lg bg-accent px-5 text-xs font-extrabold tracking-wider text-on-accent uppercase shadow-md shadow-black/40 transition-all hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
        >
          {playing ? <Pause size={14} aria-hidden /> : <Play size={14} fill="currentColor" aria-hidden />}
          {playing ? tr('pauseDeck') : tr('playDeck')}
        </button>
      </div>

      <p className="-mt-1 w-full text-xs text-faint">{tr('keyHint')}</p>
    </div>
  );
}

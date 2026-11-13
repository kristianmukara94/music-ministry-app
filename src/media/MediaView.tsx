import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import {
  Clock,
  Film,
  FolderClosed,
  FolderPlus,
  Image as ImageIcon,
  LayoutGrid,
  Layers,
  List,
  MoreHorizontal,
  Music,
  Play,
  Search,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import type { MediaFrame } from '../../shared/live.js';
import { bridge } from '../live/bridge';
import { dispatch, useLive } from '../live/store';
import { setUi, useUi } from '../state/ui';
import { addToQueue } from '../planner/plan-api';
import { BackgroundEverywhereToggle } from '../operator/BackgroundEverywhereToggle';
import { useMediaT } from './strings';
import { LowerThirdButton, LowerThirdDrawer } from './LowerThirdDrawer';
import { MediaContextMenu, type MediaMenuActions, type MediaMenuState } from './MediaContextMenu';
import { MEDIA_DRAG, type MediaAsset, type MediaFolder } from './types';

const api = bridge.media;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

// ---------------------------------------------------------------------------------------------------------------------------------------
// Look: the inspector's per-showing settings. They ride on the staged/live frame only; the library record never changes.
// ---------------------------------------------------------------------------------------------------------------------------------------

type Playback = NonNullable<MediaFrame['playback']>;
type Rate = 0.5 | 1 | 1.5;
interface Look {
  /** Dark tint behind the text, 0 to 80 (percent). */
  tint: number;
  rate: Rate;
  playback: Playback;
}
const DEFAULT_LOOK: Look = { tint: 0, rate: 1, playback: 'loop' };
const RATES: Rate[] = [0.5, 1, 1.5];
const PLAYBACKS: { id: Playback; label: string; hint: string }[] = [
  { id: 'loop', label: 'Loop', hint: 'Plays over and over.' },
  { id: 'once', label: 'Play once', hint: 'Plays to the end, then the background clears from the screen.' },
  { id: 'hold', label: 'Hold last frame', hint: 'Plays to the end and stays on its last frame.' },
];

const lookOf = (frame: MediaFrame | null): Look =>
  frame
    ? {
        tint: Math.round(Math.min(0.8, Math.max(0, frame.tint ?? 0)) * 100),
        rate: frame.rate === 0.5 || frame.rate === 1.5 ? frame.rate : 1,
        playback: frame.playback ?? 'loop',
      }
    : DEFAULT_LOOK;

/** A new cue for each staging of a "play once" clip. Always moves forward, even for two stagings in the same millisecond. */
let lastCue = 0;
const nextCue = () => (lastCue = Math.max(Date.now(), lastCue + 1));

/** A library item as a background frame, with the inspector's look. Audio is never a background, so it has no frame. */
const toFrame = (m: MediaAsset, look: Look = DEFAULT_LOOK): MediaFrame | null => {
  if (m.mediaType === 'audio') return null;
  const frame: MediaFrame = { kind: 'media', mediaType: m.mediaType, src: m.src, title: m.filename };
  // Only what differs from the default is carried, so a plain background looks exactly as it always did.
  if (look.tint > 0) frame.tint = look.tint / 100;
  if (m.mediaType === 'video' && look.rate !== 1) frame.rate = look.rate;
  if (m.mediaType === 'video' && look.playback !== 'loop') frame.playback = look.playback;
  // Each staging of a "play once" clip is its own showing, so taking it again after it ended plays it again.
  if (frame.playback === 'once') frame.cue = nextCue();
  return frame;
};
const sameLook = (a: Look, b: Look) => a.tint === b.tint && a.rate === b.rate && a.playback === b.playback;

// ---------------------------------------------------------------------------------------------------------------------------------------
// Technical details (resolution, duration), read from the files in this window. Cached for the session, keyed by address.
// ---------------------------------------------------------------------------------------------------------------------------------------

interface Meta {
  width?: number;
  height?: number;
  duration?: number;
}
const metaCache = new Map<string, Meta>();
const PROBE_TIMEOUT_MS = 8000;

function probe(m: MediaAsset): Promise<Meta> {
  if (m.mediaType === 'image') {
    // onload, not decode(): decode() on a detached image never settles for apcc-media:// files in Electron 33.
    return new Promise((resolve) => {
      const img = new Image();
      const timer = window.setTimeout(() => done({}), PROBE_TIMEOUT_MS);
      const done = (meta: Meta) => {
        window.clearTimeout(timer);
        img.onload = img.onerror = null;
        resolve(meta);
      };
      img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => done({});
      img.src = m.src;
    });
  }
  return new Promise((resolve) => {
    const el = document.createElement(m.mediaType === 'video' ? 'video' : 'audio');
    el.preload = 'metadata';
    el.muted = true;
    const done = (meta: Meta) => {
      window.clearTimeout(timer);
      el.removeAttribute('src');
      el.load();
      resolve(meta);
    };
    const timer = window.setTimeout(() => done({}), PROBE_TIMEOUT_MS);
    el.onloadedmetadata = () => {
      const v = el as HTMLVideoElement;
      done({
        duration: Number.isFinite(el.duration) ? el.duration : undefined,
        ...(m.mediaType === 'video' && v.videoWidth ? { width: v.videoWidth, height: v.videoHeight } : {}),
      });
    };
    el.onerror = () => done({});
    el.src = m.src;
  });
}

/** Reads each item's details one at a time in the background, so a large library never floods the decoder. */
function useMediaMeta(items: MediaAsset[]): Map<string, Meta> {
  const [, bump] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const todo = items.filter((m) => !metaCache.has(m.src));
    void (async () => {
      for (const m of todo) {
        if (cancelled) return;
        if (metaCache.has(m.src)) continue;
        metaCache.set(m.src, await probe(m));
        if (!cancelled) bump((n) => n + 1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [items]);
  return metaCache;
}

const resolutionLabel = (meta: Meta | undefined): string | null => {
  if (!meta?.width || !meta.height) return null;
  const short = Math.min(meta.width, meta.height);
  const long = Math.max(meta.width, meta.height);
  if (long >= 3840 || short >= 2160) return '4K';
  if (short >= 1440) return '1440p';
  if (short >= 1080) return '1080p';
  if (short >= 720) return '720p';
  return `${short}p`;
};
const formatDuration = (s: number | undefined): string | null => {
  if (s === undefined || !Number.isFinite(s)) return null;
  const total = Math.round(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};
const extOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot >= name.length - 5 ? name.slice(dot + 1).toUpperCase() : null;
};

// ---------------------------------------------------------------------------------------------------------------------------------------
// Filters, sorting and remembered view choices.
// ---------------------------------------------------------------------------------------------------------------------------------------

type QuickFilter = 'all' | 'video' | 'image' | 'audio' | 'countdown';
type Selection = { kind: 'quick'; id: QuickFilter } | { kind: 'folder'; id: number };
type SortKey = 'date' | 'name' | 'duration' | 'resolution';
type ViewMode = 'grid' | 'list';

/** Countdowns have no type of their own: they are the items whose name says so. */
const COUNTDOWN = /count[\s_-]?down|timer|clock/i;

const QUICK: { id: QuickFilter; label: string; icon: typeof Film; test: (m: MediaAsset) => boolean }[] = [
  { id: 'all', label: 'All Media', icon: Layers, test: () => true },
  { id: 'video', label: 'Motion Backgrounds', icon: Film, test: (m) => m.mediaType === 'video' },
  { id: 'image', label: 'Still Images', icon: ImageIcon, test: (m) => m.mediaType === 'image' },
  { id: 'audio', label: 'Audio Tracks', icon: Music, test: (m) => m.mediaType === 'audio' },
  { id: 'countdown', label: 'Countdowns & Timers', icon: Clock, test: (m) => COUNTDOWN.test(m.filename) },
];

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'date', label: 'Date Added' },
  { id: 'name', label: 'Name' },
  { id: 'duration', label: 'Duration' },
  { id: 'resolution', label: 'Resolution' },
];

const PREFS_KEY = 'apccmma.media.view';
interface Prefs {
  sort: SortKey;
  mode: ViewMode;
  selection: Selection;
}
const readPrefs = (): Prefs => {
  const fallback: Prefs = { sort: 'date', mode: 'grid', selection: { kind: 'quick', id: 'all' } };
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    if (!raw) return fallback;
    return {
      sort: SORTS.some((s) => s.id === raw.sort) ? (raw.sort as SortKey) : fallback.sort,
      mode: raw.mode === 'list' ? 'list' : 'grid',
      selection:
        raw.selection?.kind === 'folder' && typeof raw.selection.id === 'number'
          ? raw.selection
          : raw.selection?.kind === 'quick' && QUICK.some((q) => q.id === raw.selection?.id)
            ? raw.selection
            : fallback.selection,
    };
  } catch {
    return fallback;
  }
};
const writePrefs = (prefs: Prefs) => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* the choice is simply not remembered */
  }
};

const BTN =
  'flex h-8 items-center gap-1.5 rounded-md border border-fg/15 bg-panel-2 px-3 text-[11px] font-bold tracking-wide uppercase text-fg/85 transition hover:bg-fg/10 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40';
const SECTION = 'px-3 pt-4 pb-1.5 text-[10px] font-bold tracking-[0.14em] text-faint uppercase';

const hasMediaDrag = (e: DragEvent) => e.dataTransfer.types.includes(MEDIA_DRAG);
const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');
const readMediaDrag = (e: DragEvent): number | null => {
  try {
    const id = Number((JSON.parse(e.dataTransfer.getData(MEDIA_DRAG)) as { id: unknown }).id);
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------------------------------------------------------------------
// The view.
// ---------------------------------------------------------------------------------------------------------------------------------------

/**
 * The Media Library: a broadcast-style workspace. A status bar shows what is staged and live; folders and quick filters on the left; the
 * asset grid in the middle; the inspector with its stage preview and look on the right. Click selects, double-click stages, Shift+click
 * takes live, right-click opens the item's menu. Staging only ever writes the projector's live state, never the library record.
 */
export function MediaView() {
  const t = useMediaT();
  const background = useLive((s) => s.state.projector.background);
  const slideBackground = useLive((s) => s.state.welcome.slideBackground);

  const [items, setItems] = useState<MediaAsset[]>([]);
  const [folders, setFolders] = useState<MediaFolder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [look, setLook] = useState<Look>(DEFAULT_LOOK);
  const [menu, setMenu] = useState<MediaMenuState | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileDrag, setFileDrag] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const meta = useMediaMeta(items);

  const updatePrefs = (patch: Partial<Prefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      writePrefs(next);
      return next;
    });

  /** Shows a note for a few seconds, without holding up the screen. */
  const showNotice = useCallback((text: string) => {
    setError(null);
    setNotice(text);
    window.setTimeout(() => setNotice((current) => (current === text ? null : current)), 6000);
  }, []);
  const fail = useCallback((err: unknown) => {
    setNotice(null);
    setError(errorText(err));
  }, []);

  const reload = useCallback(
    () =>
      Promise.all([api.list(), api.folders()])
        .then(([list, dirs]) => {
          setItems(list);
          setFolders(dirs);
          setLoaded(true);
          return list;
        })
        .catch((err) => {
          fail(err);
          return [] as MediaAsset[];
        }),
    [fail],
  );

  // Background events: a converted MP4 appears in the list, and a failed conversion is reported.
  useEffect(
    () =>
      api.onEvent((event) => {
        if (event.kind === 'changed') void reload();
        else if (event.kind === 'remux-failed') fail(`Could not convert ${event.name ?? 'a file'} to MP4. The original is still in the library.`);
      }),
    [reload, fail],
  );

  // First load, then any request from elsewhere: a Service Queue item to stage, or the Lower Third drawer.
  const pendingFocus = useUi((s) => s.pendingFocus);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (pendingFocus?.kind === 'lowerThird') {
      setUi({ pendingFocus: null });
      setDrawerOpen(true);
      return;
    }
    if (pendingFocus?.kind !== 'media' || !loaded) return;
    setUi({ pendingFocus: null });
    const asset = items.find((m) => m.id === pendingFocus.id);
    if (!asset) return;
    setSelectedId(asset.id);
    const frame = toFrame(asset);
    if (frame) dispatch({ type: 'background/stage', media: frame });
  }, [pendingFocus, loaded, items]);

  // Ctrl+F finds in the library while this view is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f' && searchRef.current) {
        e.preventDefault();
        searchRef.current.focus();
        searchRef.current.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // If the remembered folder was deleted, fall back to All Media.
  useEffect(() => {
    if (loaded && prefs.selection.kind === 'folder' && !folders.some((f) => f.id === (prefs.selection as { id: number }).id)) {
      updatePrefs({ selection: { kind: 'quick', id: 'all' } });
    }
  }, [loaded, folders, prefs.selection]);

  const selected = items.find((m) => m.id === selectedId) ?? null;
  const findBySrc = (src: string | undefined) => (src ? (items.find((m) => m.src === src) ?? null) : null);

  /**
   * The look an item gets when it is selected: its own when it is staged or live, so the inspector shows what the screen has; otherwise the
   * dimmer carries over (it is about the room's legibility) and speed and end behaviour reset. The selected item keeps the inspector's look.
   */
  const lookFor = (m: MediaAsset): Look => {
    if (m.id === selectedId) return look;
    const onScreen = background.live?.src === m.src ? background.live : background.staged?.src === m.src ? background.staged : null;
    return onScreen ? lookOf(onScreen) : { ...look, rate: 1, playback: 'loop' };
  };

  /** Selects an item and returns the look it now has, so an action in the same click uses exactly what the inspector will show. */
  const select = (m: MediaAsset): Look => {
    const next = lookFor(m);
    setSelectedId(m.id);
    setLook(next);
    return next;
  };

  // ---- Background actions: all of them write only the projector's live state. --------------------------------------------------------

  const stage = (m: MediaAsset, withLook: Look = look) => {
    const frame = toFrame(m, withLook);
    if (frame) dispatch({ type: 'background/stage', media: frame });
  };
  const takeLive = (m: MediaAsset, withLook: Look = look) => {
    const frame = toFrame(m, withLook);
    if (!frame) return;
    dispatch({ type: 'background/stage', media: frame });
    dispatch({ type: 'background/take' });
  };
  const takeStaged = () => dispatch({ type: 'background/take' });
  const clearBackground = () => dispatch({ type: 'background/clear' });

  // ---- Library actions. -------------------------------------------------------------------------------------------------------------

  const runImport = async (files: File[] | null) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const folderId = prefs.selection.kind === 'folder' ? prefs.selection.id : null;
    try {
      const result = files ? await api.importFiles(files, folderId) : await api.importMedia(folderId);
      await reload();
      if (result.failed.length > 0) fail(t('notImported', { names: result.failed.join(', ') }));
      else if (result.notice) showNotice(result.notice);
      else if (result.imported > 0) showNotice(t('imported', { n: result.imported }));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m: MediaAsset) => {
    if (!window.confirm(t('confirmDelete', { name: m.filename }))) return;
    try {
      // A deleted file cannot keep playing; the main process clears it from the background before deleting.
      await api.deleteMedia(m.id);
      if (selectedId === m.id) setSelectedId(null);
      await reload();
    } catch (err) {
      fail(err);
    }
  };

  const rename = async (m: MediaAsset) => {
    const name = window.prompt('New name for this file', m.filename);
    if (name === null || name.trim() === '' || name.trim() === m.filename) return;
    try {
      await api.rename(m.id, name);
      await reload();
    } catch (err) {
      fail(err);
    }
  };

  const moveToFolder = async (id: number, folderId: number | null) => {
    try {
      await api.moveToFolder(id, folderId);
      await reload();
      const item = items.find((m) => m.id === id);
      const folder = folders.find((f) => f.id === folderId);
      if (item) showNotice(folder ? `"${item.filename}" moved to ${folder.name}.` : `"${item.filename}" removed from its folder.`);
    } catch (err) {
      fail(err);
    }
  };

  const createFolder = async (name: string) => {
    try {
      const id = await api.createFolder(name);
      await reload();
      updatePrefs({ selection: { kind: 'folder', id } });
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  };

  const deleteFolder = async (folder: MediaFolder) => {
    if (!window.confirm(`Delete the folder "${folder.name}"? Its media stays in the library.`)) return;
    try {
      await api.deleteFolder(folder.id);
      await reload();
    } catch (err) {
      fail(err);
    }
  };

  const menuActions: MediaMenuActions = {
    onStage: (m) => stage(m, select(m)),
    onTakeLive: (m) => takeLive(m, select(m)),
    onDefaultMass: (m) =>
      bridge.projector
        .save({ idle: 'media', idleMedia: m.src })
        .then(() => showNotice(`"${m.filename}" is now the Holy Mass default: it shows whenever nothing is live.`))
        .catch(fail),
    onDefaultPraise: (m) => {
      const type = m.mediaType === 'video' ? 'VIDEO' : 'IMAGE';
      bridge.welcome
        .save({ slideBackground: { ...slideBackground, backgroundType: type, backgroundUrl: m.src, [type === 'VIDEO' ? 'videoFile' : 'imageFile']: m.src } })
        .then(() => showNotice(`"${m.filename}" is now the Praise & Worship slide background.`))
        .catch(fail);
    },
    onQueue: (m) =>
      addToQueue([{ block: 'introductory', module: 'media', sourceId: String(m.id), label: m.filename }])
        .then(() => showNotice(`"${m.filename}" added to the Holy Mass Queue.`))
        .catch(fail),
    onUnfile: (m) => void moveToFolder(m.id, null),
    onRename: (m) => void rename(m),
    onReveal: (m) => void api.reveal(m.id).catch(fail),
    onDelete: (m) => void remove(m),
  };
  const closeMenu = useCallback(() => setMenu(null), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const openMenu = (e: MouseEvent, m: MediaAsset) => {
    e.preventDefault();
    setMenu({ asset: m, x: e.clientX, y: e.clientY });
  };
  const openMenuFromButton = (e: MouseEvent<HTMLButtonElement>, m: MediaAsset) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMenu({ asset: m, x: rect.right - 256, y: rect.bottom + 4 });
  };

  // ---- What the grid shows. ---------------------------------------------------------------------------------------------------------

  const counts = useMemo(() => {
    const quick = Object.fromEntries(QUICK.map((q) => [q.id, items.filter(q.test).length])) as Record<QuickFilter, number>;
    const byFolder = new Map<number, number>();
    for (const m of items) if (m.folderId !== null) byFolder.set(m.folderId, (byFolder.get(m.folderId) ?? 0) + 1);
    return { quick, byFolder };
  }, [items]);

  const visible = useMemo(() => {
    const sel = prefs.selection;
    const inScope =
      sel.kind === 'folder' ? (m: MediaAsset) => m.folderId === sel.id : (QUICK.find((q) => q.id === sel.id) ?? QUICK[0]).test;
    const needle = query.trim().toLowerCase();
    const list = items.filter((m) => inScope(m) && (!needle || m.filename.toLowerCase().includes(needle)));
    const pixels = (m: MediaAsset) => {
      const x = meta.get(m.src);
      return x?.width && x.height ? x.width * x.height : -1;
    };
    const length = (m: MediaAsset) => meta.get(m.src)?.duration ?? -1;
    // The list arrives newest first, which is the date order. Other orders put items with unknown details last.
    if (prefs.sort === 'name') list.sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: 'base' }));
    else if (prefs.sort === 'duration') list.sort((a, b) => length(b) - length(a));
    else if (prefs.sort === 'resolution') list.sort((a, b) => pixels(b) - pixels(a));
    return list;
    // meta changes in place as details arrive; items is the trigger for a fresh probe, and the bump re-renders this view.
  }, [items, prefs.selection, prefs.sort, query, meta, meta.size]);

  const scopeLabel =
    prefs.selection.kind === 'folder'
      ? (folders.find((f) => f.id === (prefs.selection as { id: number }).id)?.name ?? 'Folder')
      : (QUICK.find((q) => q.id === (prefs.selection as { id: QuickFilter }).id)?.label ?? 'All Media');

  const onGridDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setFileDrag(true);
  };
  const onGridDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setFileDrag(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) void runImport(files);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-line">
      <StatusBar
        staged={background.staged}
        live={background.live}
        stagedAsset={findBySrc(background.staged?.src)}
        onTakeStaged={takeStaged}
        onClear={clearBackground}
        onOpenLowerThird={() => setDrawerOpen(true)}
        labels={{ staged: t('stagedBackground'), live: t('liveBackground'), nothing: t('nothingStaged'), none: t('none'), clear: t('clearBackground') }}
      />

      <div className="flex min-h-0 flex-1">
        <FolderTree
          selection={prefs.selection}
          folders={folders}
          counts={counts}
          onSelect={(selection) => updatePrefs({ selection })}
          onCreate={createFolder}
          onDelete={deleteFolder}
          onDropItem={(id, folderId) => void moveToFolder(id, folderId)}
        />

        {/* Middle column: control bar and the asset grid. Files dropped from the desktop import into the open folder. */}
        <section
          aria-label="Media assets"
          className="relative flex min-w-0 flex-1 flex-col border-x border-line"
          onDragOver={onGridDragOver}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFileDrag(false);
          }}
          onDrop={onGridDrop}
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            <div className="relative min-w-48 flex-1">
              <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
                placeholder="Search media (Ctrl+F)"
                aria-label="Search media"
                className="h-8 w-full rounded-md border border-fg/15 bg-panel-2 pr-8 pl-8 text-sm text-fg outline-none placeholder:text-faint focus:border-accent focus:ring-1 focus:ring-accent/40 [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    searchRef.current?.focus();
                  }}
                  aria-label="Clear search"
                  className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded text-faint hover:bg-fg/10 hover:text-fg"
                >
                  <X size={12} aria-hidden />
                </button>
              )}
            </div>
            <label className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">
              Sort
              <select
                value={prefs.sort}
                onChange={(e) => updatePrefs({ sort: e.target.value as SortKey })}
                className="h-8 rounded-md border border-fg/15 bg-panel-2 px-2 text-xs font-semibold text-fg normal-case outline-none focus:border-accent"
              >
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <div role="radiogroup" aria-label="View" className="flex rounded-md border border-fg/15 bg-panel-2 p-0.5">
              {(['grid', 'list'] as const).map((mode) => {
                const Icon = mode === 'grid' ? LayoutGrid : List;
                return (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={prefs.mode === mode}
                    aria-label={mode === 'grid' ? 'Grid' : 'Compact list'}
                    title={mode === 'grid' ? 'Grid' : 'Compact list'}
                    onClick={() => updatePrefs({ mode })}
                    className={`grid h-6 w-7 place-items-center rounded transition ${prefs.mode === mode ? 'bg-accent text-on-accent' : 'text-muted hover:text-fg'}`}
                  >
                    <Icon size={14} aria-hidden />
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => void runImport(null)}
              disabled={busy}
              title="Click to choose files, or drop them here: PNG, JPG, GIF, WebP, SVG, MP4, MOV, MKV, WebM, MP3, WAV, AAC, FLAC, OGG"
              className="flex h-8 items-center gap-1.5 rounded-md border border-dashed border-accent bg-accent px-3 text-[11px] font-extrabold tracking-wide text-on-accent uppercase transition hover:brightness-110 disabled:opacity-50"
            >
              <Upload size={13} aria-hidden /> {busy ? t('importing') : `+ ${t('importMedia')}`}
            </button>
          </div>

          <div className="flex items-baseline justify-between gap-3 px-4 pt-3">
            <h1 className="truncate text-sm font-bold text-fg">{scopeLabel}</h1>
            <span className="shrink-0 font-mono text-[11px] text-faint tabular-nums">
              {visible.length} item{visible.length === 1 ? '' : 's'}
            </span>
          </div>

          {(error || notice) && (
            <div
              role={error ? 'alert' : 'status'}
              className={`mx-4 mt-2 flex items-start gap-2 rounded-md border px-3 py-1.5 text-xs ${error ? 'border-danger/50 bg-danger/10 text-danger' : 'border-ok/50 bg-ok/10 text-ok'}`}
            >
              <span className="flex-1">{error ?? notice}</span>
              <button type="button" onClick={() => (setError(null), setNotice(null))} aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100">
                <X size={12} aria-hidden />
              </button>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-6">
            {!loaded ? null : items.length === 0 ? (
              <EmptyLibrary title={t('emptyTitle')} body={t('emptyBody')} busy={busy} importLabel={busy ? t('importing') : t('importMedia')} onImport={() => void runImport(null)} />
            ) : visible.length === 0 ? (
              <p className="py-10 text-center text-sm text-faint">{query ? `Nothing in ${scopeLabel} matches "${query}".` : `${scopeLabel} is empty. Drag media here from the grid, or import into it.`}</p>
            ) : (
              <ul className={prefs.mode === 'grid' ? 'grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3' : 'flex flex-col gap-1'}>
                {visible.map((m) => (
                  <AssetCard
                    key={m.id}
                    asset={m}
                    mode={prefs.mode}
                    meta={meta.get(m.src)}
                    selected={m.id === selectedId}
                    isLive={background.live?.src === m.src}
                    isStaged={background.staged?.src === m.src && background.live?.src !== m.src}
                    onSelect={() => void select(m)}
                    onStage={() => stage(m, select(m))}
                    onTakeLive={() => takeLive(m, select(m))}
                    onMenu={(e) => openMenu(e, m)}
                    onMenuButton={(e) => openMenuFromButton(e, m)}
                    onDelete={() => void remove(m)}
                    deleteLabel={t('deleteLabel', { name: m.filename })}
                  />
                ))}
              </ul>
            )}
          </div>

          {fileDrag && (
            <div className="pointer-events-none absolute inset-2 z-10 grid place-items-center rounded-xl border-2 border-dashed border-accent bg-canvas/80">
              <div className="flex flex-col items-center gap-2 text-accent">
                <Upload size={28} aria-hidden />
                <span className="text-sm font-bold">Drop to import{prefs.selection.kind === 'folder' ? ` into ${scopeLabel}` : ''}</span>
                <span className="text-xs text-muted">PNG, JPG, GIF, MP4, WebM, WAV, MP3 and more</span>
              </div>
            </div>
          )}
        </section>

        <Inspector
          asset={selected}
          meta={selected ? meta.get(selected.src) : undefined}
          folders={folders}
          look={look}
          onLook={(patch) => setLook((l) => ({ ...l, ...patch }))}
          liveFrame={background.live}
          stagedFrame={background.staged}
          onStage={() => selected && stage(selected)}
          onTakeLive={() => selected && takeLive(selected)}
          onClear={clearBackground}
          onMove={(folderId) => selected && void moveToFolder(selected.id, folderId)}
        />
      </div>

      {menu && <MediaContextMenu state={menu} onClose={closeMenu} actions={menuActions} />}
      <LowerThirdDrawer open={drawerOpen} onClose={closeDrawer} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Status bar.
// ---------------------------------------------------------------------------------------------------------------------------------------

function StatusBar({
  staged,
  live,
  stagedAsset,
  onTakeStaged,
  onClear,
  onOpenLowerThird,
  labels,
}: {
  staged: MediaFrame | null;
  live: MediaFrame | null;
  stagedAsset: MediaAsset | null;
  onTakeStaged: () => void;
  onClear: () => void;
  onOpenLowerThird: () => void;
  labels: { staged: string; live: string; nothing: string; none: string; clear: string };
}) {
  const stagedIsNew = staged !== null && (live === null || staged.src !== live.src || !sameLook(lookOf(staged), lookOf(live)));
  const thumb = stagedAsset?.thumbSrc ?? (staged?.mediaType === 'image' ? staged.src : null);
  return (
    <header aria-label="Background status" className="flex flex-none flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel px-4 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="shrink-0 rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-warn uppercase">{labels.staged}</span>
        <span className="grid aspect-video h-7 shrink-0 place-items-center overflow-hidden rounded border border-line bg-canvas">
          {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : staged ? <Film size={12} aria-hidden className="text-faint" /> : null}
        </span>
        <span className="max-w-[18ch] truncate text-sm font-semibold text-fg" title={staged?.title}>
          {staged?.title ?? <span className="font-normal text-faint">{labels.nothing}</span>}
        </span>
        {stagedIsNew && (
          <button type="button" onClick={onTakeStaged} title="Put the staged background on the screen" className="flex h-6 items-center gap-1 rounded bg-danger px-2 text-[10px] font-extrabold tracking-wide text-white uppercase hover:brightness-110">
            <Play size={10} aria-hidden /> Take
          </button>
        )}
      </div>

      <span aria-hidden className="h-5 w-px bg-line" />

      <div className="flex min-w-0 items-center gap-2.5">
        <span className="shrink-0 text-[10px] font-extrabold tracking-wider text-faint uppercase">{labels.live}</span>
        {live ? (
          <>
            <span className="flex shrink-0 items-center gap-1 rounded bg-danger px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-white uppercase">
              <span className="size-1.5 animate-pulse rounded-full bg-white" aria-hidden /> Live
            </span>
            <span className="max-w-[18ch] truncate text-sm font-semibold text-fg" title={live.title}>
              {live.title}
            </span>
          </>
        ) : (
          <span className="text-sm text-faint">{labels.none}</span>
        )}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <BackgroundEverywhereToggle compact />
        <LowerThirdButton onOpen={onOpenLowerThird} />
        <button type="button" onClick={onClear} disabled={!live && !staged} className={BTN}>
          <X size={13} aria-hidden /> {labels.clear}
        </button>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Left column: quick filters and folders.
// ---------------------------------------------------------------------------------------------------------------------------------------

function FolderTree({
  selection,
  folders,
  counts,
  onSelect,
  onCreate,
  onDelete,
  onDropItem,
}: {
  selection: Selection;
  folders: MediaFolder[];
  counts: { quick: Record<QuickFilter, number>; byFolder: Map<number, number> };
  onSelect: (s: Selection) => void;
  onCreate: (name: string) => Promise<boolean>;
  onDelete: (f: MediaFolder) => void;
  onDropItem: (mediaId: number, folderId: number | null) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const submit = async () => {
    const clean = name.trim();
    if (!clean) return setAdding(false);
    if (await onCreate(clean)) {
      setName('');
      setAdding(false);
    }
  };

  /** Drop handlers for a row. `folderId` null is All Media, which takes the item out of its folder. */
  const dropProps = (key: string, folderId: number | null) => ({
    onDragOver: (e: DragEvent) => {
      if (!hasMediaDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropTarget(key);
    },
    onDragLeave: () => setDropTarget((k) => (k === key ? null : k)),
    onDrop: (e: DragEvent) => {
      if (!hasMediaDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setDropTarget(null);
      const id = readMediaDrag(e);
      if (id !== null) onDropItem(id, folderId);
    },
  });

  const row = (active: boolean, drop: boolean) =>
    `group flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[13px] transition ${
      drop ? 'bg-accent/20 ring-1 ring-accent' : active ? 'bg-accent/15 font-semibold text-accent' : 'text-fg/80 hover:bg-fg/[0.06] hover:text-fg'
    }`;

  return (
    <nav aria-label="Media folders" className="flex w-56 flex-none flex-col overflow-y-auto bg-panel/60 pb-4 xl:w-64">
      <div className={SECTION}>Library</div>
      <ul className="flex flex-col gap-0.5 px-2">
        {QUICK.map((q) => {
          const active = selection.kind === 'quick' && selection.id === q.id;
          const Icon = q.icon;
          return (
            <li key={q.id}>
              <button
                type="button"
                aria-current={active ? 'true' : undefined}
                onClick={() => onSelect({ kind: 'quick', id: q.id })}
                title={q.id === 'all' ? 'Drop an item here to take it out of its folder.' : q.id === 'countdown' ? 'Media whose name mentions a countdown, timer or clock.' : undefined}
                {...(q.id === 'all' ? dropProps('all', null) : {})}
                className={row(active, dropTarget === 'all' && q.id === 'all')}
              >
                <Icon size={14} aria-hidden className="shrink-0 opacity-80" />
                <span className="min-w-0 flex-1 truncate">{q.label}</span>
                <span className="font-mono text-[10px] text-faint tabular-nums">{counts.quick[q.id]}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className={`${SECTION} flex items-center justify-between`}>
        <span>Seasons &amp; folders</span>
        <button
          type="button"
          onClick={() => setAdding(true)}
          title="New folder"
          aria-label="New folder"
          className="grid size-5 place-items-center rounded text-faint hover:bg-fg/10 hover:text-fg"
        >
          <FolderPlus size={13} aria-hidden />
        </button>
      </div>
      <ul className="flex flex-col gap-0.5 px-2">
        {folders.map((f) => {
          const active = selection.kind === 'folder' && selection.id === f.id;
          const key = `f${f.id}`;
          return (
            <li key={f.id} className="group/folder relative">
              <button
                type="button"
                aria-current={active ? 'true' : undefined}
                onClick={() => onSelect({ kind: 'folder', id: f.id })}
                {...dropProps(key, f.id)}
                className={row(active, dropTarget === key)}
              >
                <FolderClosed size={14} aria-hidden className="shrink-0 opacity-80" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className={`font-mono text-[10px] text-faint tabular-nums ${f.builtin ? '' : 'group-hover/folder:invisible'}`}>{counts.byFolder.get(f.id) ?? 0}</span>
              </button>
              {!f.builtin && (
                <button
                  type="button"
                  onClick={() => onDelete(f)}
                  aria-label={`Delete folder ${f.name}`}
                  title="Delete folder"
                  className="absolute top-1/2 right-2 hidden size-5 -translate-y-1/2 place-items-center rounded text-faint group-hover/folder:grid hover:text-danger focus-visible:grid"
                >
                  <Trash2 size={12} aria-hidden />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="px-2 pt-1">
        {adding ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void submit()}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setName('');
                  setAdding(false);
                }
              }}
              maxLength={80}
              placeholder="Folder name"
              aria-label="New folder name"
              className="h-8 w-full rounded-md border border-accent bg-panel-2 px-3 text-[13px] text-fg outline-none"
            />
          </form>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[13px] text-muted hover:bg-fg/[0.06] hover:text-fg">
            <FolderPlus size={14} aria-hidden /> New Folder
          </button>
        )}
      </div>
      <p className="mt-auto px-4 pt-4 text-[11px] leading-snug text-faint">Drag media onto a folder to file it. Drop files from your desktop on the grid to import.</p>
    </nav>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Middle column: one asset.
// ---------------------------------------------------------------------------------------------------------------------------------------

/**
 * A library thumbnail. If the preview picture cannot be loaded, an image falls back to the file itself, and then to an icon, instead of showing
 * the browser's broken-image mark.
 */
function Thumb({ asset }: { asset: MediaAsset }) {
  const [stage, setStage] = useState<'thumb' | 'file' | 'icon'>(asset.thumbSrc ? 'thumb' : asset.mediaType === 'image' ? 'file' : 'icon');
  if (stage !== 'icon') {
    const src = (stage === 'thumb' ? asset.thumbSrc : asset.src) ?? undefined;
    return (
      <img
        key={stage}
        src={src}
        alt=""
        loading="lazy"
        draggable={false}
        onError={() => setStage(stage === 'thumb' && asset.mediaType === 'image' ? 'file' : 'icon')}
        className="h-full w-full object-cover"
      />
    );
  }
  const Icon = asset.mediaType === 'audio' ? Music : asset.mediaType === 'video' ? Film : ImageIcon;
  return (
    <div className="grid h-full place-items-center text-faint">
      <Icon size={24} strokeWidth={1.6} aria-hidden />
    </div>
  );
}

function Badge({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'live' | 'staged' }) {
  const cls = tone === 'live' ? 'bg-danger text-white' : tone === 'staged' ? 'bg-warn text-canvas' : 'bg-black/70 text-white';
  return <span className={`rounded px-1.5 py-0.5 text-[10px] leading-none font-bold tracking-wide ${cls}`}>{children}</span>;
}

function AssetCard({
  asset: m,
  mode,
  meta,
  selected,
  isLive,
  isStaged,
  onSelect,
  onStage,
  onTakeLive,
  onMenu,
  onMenuButton,
  onDelete,
  deleteLabel,
}: {
  asset: MediaAsset;
  mode: ViewMode;
  meta: Meta | undefined;
  selected: boolean;
  isLive: boolean;
  isStaged: boolean;
  onSelect: () => void;
  onStage: () => void;
  onTakeLive: () => void;
  onMenu: (e: MouseEvent) => void;
  onMenuButton: (e: MouseEvent<HTMLButtonElement>) => void;
  onDelete: () => void;
  deleteLabel: string;
}) {
  const [hover, setHover] = useState(false);
  const isAudio = m.mediaType === 'audio';
  const resolution = resolutionLabel(meta);
  const duration = formatDuration(meta?.duration);
  const format = extOf(m.filename);

  const onClick = (e: MouseEvent) => {
    if (e.shiftKey && !isAudio) onTakeLive();
    else onSelect();
  };
  const onDragStart = (e: DragEvent<HTMLLIElement>) => {
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData(MEDIA_DRAG, JSON.stringify({ id: m.id, label: m.filename }));
  };

  const ring = isLive ? 'border-danger ring-2 ring-danger' : isStaged ? 'border-warn ring-2 ring-warn' : selected ? 'border-accent ring-1 ring-accent' : 'border-line hover:border-fg/30';
  const stateBadge = isLive ? (
    <Badge tone="live">● LIVE</Badge>
  ) : isStaged ? (
    <Badge tone="staged">● STAGED</Badge>
  ) : null;
  const action = isAudio ? 'Click to select.' : 'Click to select, double-click to stage, Shift+click to take live.';

  const menuButton = (
    <button
      type="button"
      onClick={onMenuButton}
      onPointerDown={(e) => e.stopPropagation()}
      aria-haspopup="menu"
      aria-label={`More actions for ${m.filename}`}
      title="More actions"
      className="grid size-7 shrink-0 place-items-center rounded text-muted opacity-70 transition group-hover:opacity-100 hover:bg-fg/10 hover:text-fg focus:opacity-100"
    >
      <MoreHorizontal size={15} aria-hidden />
    </button>
  );

  if (mode === 'list') {
    return (
      <li
        draggable
        onDragStart={onDragStart}
        onContextMenu={onMenu}
        className={`group flex items-center gap-3 rounded-md border bg-panel px-2 py-1.5 transition ${ring}`}
      >
        <button type="button" onClick={onClick} onDoubleClick={() => !isAudio && onStage()} aria-pressed={selected} title={action} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="aspect-video h-9 shrink-0 overflow-hidden rounded bg-canvas">
            <Thumb asset={m} />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg" title={m.filename}>
            {m.filename}
          </span>
          {stateBadge}
          <span className="hidden w-14 shrink-0 text-right font-mono text-[11px] text-faint md:inline">{resolution ?? (isAudio ? 'Audio' : '')}</span>
          <span className="w-12 shrink-0 text-right font-mono text-[11px] text-faint tabular-nums">{duration ?? ''}</span>
          <span className="hidden w-12 shrink-0 text-right font-mono text-[11px] text-faint lg:inline">{format ?? ''}</span>
        </button>
        {menuButton}
      </li>
    );
  }

  return (
    <li
      draggable
      onDragStart={onDragStart}
      onContextMenu={onMenu}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`group relative overflow-hidden rounded-[10px] border bg-panel transition ${ring}`}
    >
      <button
        type="button"
        onClick={onClick}
        onDoubleClick={() => !isAudio && onStage()}
        aria-pressed={selected}
        aria-label={`${m.filename}. ${action}`}
        title={action}
        className="relative block aspect-video w-full overflow-hidden bg-canvas"
      >
        <Thumb asset={m} />
        {/* A moving preview while the pointer rests on a video. It is muted and plays in this window only. */}
        {hover && m.mediaType === 'video' && (
          <video src={m.src} autoPlay muted loop playsInline preload="auto" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
        )}
        <span className="absolute top-1.5 left-1.5 flex gap-1">{stateBadge}</span>
        <span className="absolute right-1.5 bottom-1.5 left-1.5 flex items-end justify-between gap-1">
          <span className="flex gap-1">
            {isAudio ? <Badge>Audio</Badge> : resolution && <Badge>{resolution}</Badge>}
            {format && <Badge>{format}</Badge>}
          </span>
          {duration && <Badge>{duration}</Badge>}
        </span>
      </button>
      <div className="flex items-center gap-1 px-2.5 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg" title={m.filename}>
          {m.filename}
        </span>
        {menuButton}
        <button
          type="button"
          onClick={onDelete}
          aria-label={deleteLabel}
          title={deleteLabel}
          className="grid size-7 shrink-0 place-items-center rounded text-muted opacity-0 transition group-hover:opacity-100 hover:text-danger focus:opacity-100"
        >
          <Trash2 size={13} aria-hidden />
        </button>
      </div>
    </li>
  );
}

function EmptyLibrary({ title, body, busy, importLabel, onImport }: { title: string; body: string; busy: boolean; importLabel: string; onImport: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="grid size-14 place-items-center rounded-[10px] border border-line bg-panel text-accent">
        <Film size={24} strokeWidth={1.6} aria-hidden />
      </div>
      <h2 className="mt-4 text-2xl font-bold tracking-tight text-fg">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-fg/70">{body}</p>
      <p className="mt-1 text-xs text-faint">Or drop files anywhere on this panel.</p>
      <button
        type="button"
        onClick={onImport}
        disabled={busy}
        className="mt-5 flex h-10 items-center gap-2 rounded-md border border-accent bg-accent px-5 text-xs font-extrabold tracking-wide text-on-accent uppercase transition hover:brightness-110 disabled:opacity-40"
      >
        <Upload size={14} aria-hidden /> {importLabel}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Right column: inspector and staging deck.
// ---------------------------------------------------------------------------------------------------------------------------------------

function Segmented<T extends string | number>({ label, value, options, onChange, disabled }: {
  label: string;
  value: T;
  options: { id: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`flex rounded-md border border-fg/15 bg-panel-2 p-0.5 ${disabled ? 'opacity-40' : ''}`}>
      {options.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          disabled={disabled}
          title={o.hint}
          onClick={() => onChange(o.id)}
          className={`h-7 flex-1 rounded px-2 text-[11px] font-bold transition disabled:cursor-not-allowed ${value === o.id ? 'bg-accent text-on-accent' : 'text-fg/70 hover:text-fg'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Inspector({
  asset,
  meta,
  folders,
  look,
  onLook,
  liveFrame,
  stagedFrame,
  onStage,
  onTakeLive,
  onClear,
  onMove,
}: {
  asset: MediaAsset | null;
  meta: Meta | undefined;
  folders: MediaFolder[];
  look: Look;
  onLook: (patch: Partial<Look>) => void;
  liveFrame: MediaFrame | null;
  stagedFrame: MediaFrame | null;
  onStage: () => void;
  onTakeLive: () => void;
  onClear: () => void;
  onMove: (folderId: number | null) => void;
}) {
  const previewRef = useRef<HTMLVideoElement>(null);
  const [previewEnded, setPreviewEnded] = useState(false);
  useEffect(() => {
    if (previewRef.current) previewRef.current.playbackRate = look.rate;
  }, [look.rate, asset?.src]);
  useEffect(() => setPreviewEnded(false), [asset?.src, look.playback]);

  const isVideo = asset?.mediaType === 'video';
  const isAudio = asset?.mediaType === 'audio';
  const isLive = Boolean(asset && liveFrame?.src === asset.src);
  const isStaged = Boolean(asset && stagedFrame?.src === asset.src);
  const liveLookDiffers = isLive && liveFrame !== null && !sameLook(lookOf(liveFrame), look);
  const stagedLookDiffers = isStaged && stagedFrame !== null && !sameLook(lookOf(stagedFrame), look);
  const tint = look.tint / 100;

  const takeLabel = isLive ? (liveLookDiffers ? 'Update Live' : 'On Air') : 'Take Live';

  return (
    <aside aria-label="Inspector" className="flex w-72 flex-none flex-col overflow-y-auto bg-panel/60 xl:w-80">
      <div className={SECTION}>Stage preview</div>
      <div className="px-3">
        {/* The preview applies the look exactly as the projector will: the media, then the tint, then sample text. */}
        <div className="relative aspect-video overflow-hidden rounded-md border border-line bg-black [container-type:inline-size]">
          {asset && !isAudio ? (
            <>
              {isVideo ? (
                <video
                  ref={previewRef}
                  key={`${asset.src}|${look.playback}`}
                  src={asset.src}
                  autoPlay
                  muted
                  loop={look.playback === 'loop'}
                  playsInline
                  onLoadedMetadata={(e) => (e.currentTarget.playbackRate = look.rate)}
                  onEnded={() => look.playback === 'once' && setPreviewEnded(true)}
                  className={`absolute inset-0 h-full w-full object-cover ${previewEnded ? 'invisible' : ''}`}
                />
              ) : (
                <img src={asset.src} alt="" className="absolute inset-0 h-full w-full object-cover" />
              )}
              <div aria-hidden data-testid="tint-overlay" className="absolute inset-0 bg-black transition-opacity" style={{ opacity: tint }} />
              <p aria-hidden className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-[6cqw] text-center text-[6cqw] leading-tight font-bold text-white [text-shadow:0_2px_10px_rgba(0,0,0,0.8)]">
                Glory to God in the highest
              </p>
            </>
          ) : isAudio && asset ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-3">
              <Music size={28} aria-hidden className="text-faint" />
              {/* The preview plays in this window only. Projector output is unaffected. */}
              <audio key={asset.src} src={asset.src} controls className="h-8 w-full" />
            </div>
          ) : (
            <p className="absolute inset-0 grid place-items-center px-6 text-center text-xs text-white/70">Select media to preview it here.</p>
          )}
          {isLive && (
            <span className="absolute top-1.5 left-1.5">
              <Badge tone="live">● LIVE</Badge>
            </span>
          )}
          {!isLive && isStaged && (
            <span className="absolute top-1.5 left-1.5">
              <Badge tone="staged">● STAGED</Badge>
            </span>
          )}
        </div>
      </div>

      {asset && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-4 pt-3 text-xs">
          <dt className="text-faint">Name</dt>
          <dd className="truncate font-semibold text-fg" title={asset.filename}>
            {asset.filename}
          </dd>
          <dt className="text-faint">Type</dt>
          <dd className="text-fg/85">
            {isVideo ? 'Motion background' : isAudio ? 'Audio track' : 'Still image'}
            {extOf(asset.filename) ? ` · ${extOf(asset.filename)}` : ''}
          </dd>
          {meta?.width && meta.height ? (
            <>
              <dt className="text-faint">Resolution</dt>
              <dd className="font-mono text-fg/85">
                {meta.width}×{meta.height} {resolutionLabel(meta) ? `(${resolutionLabel(meta)})` : ''}
              </dd>
            </>
          ) : null}
          {formatDuration(meta?.duration) && (
            <>
              <dt className="text-faint">Duration</dt>
              <dd className="font-mono text-fg/85">{formatDuration(meta?.duration)}</dd>
            </>
          )}
          <dt className="self-center text-faint">Folder</dt>
          <dd>
            <select
              value={asset.folderId ?? ''}
              onChange={(e) => onMove(e.target.value === '' ? null : Number(e.target.value))}
              aria-label="Folder"
              className="h-7 w-full rounded border border-fg/15 bg-panel-2 px-1.5 text-xs text-fg outline-none focus:border-accent"
            >
              <option value="">No folder</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </dd>
        </dl>
      )}

      <div className={SECTION}>Playback &amp; contrast</div>
      <div className="flex flex-col gap-3 px-4">
        <label className="flex flex-col gap-1.5">
          <span className="flex items-center justify-between text-xs text-fg/70">
            Text contrast dimmer
            <span className="font-mono text-fg tabular-nums">{look.tint}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={80}
            step={5}
            value={look.tint}
            disabled={!asset || isAudio}
            onChange={(e) => onLook({ tint: Number(e.target.value) })}
            aria-valuetext={`${look.tint} percent dark tint`}
            className="w-full accent-[var(--color-accent)] disabled:opacity-40"
          />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-fg/70">Playback speed</span>
          <Segmented label="Playback speed" value={look.rate} options={RATES.map((r) => ({ id: r, label: `${r.toFixed(1)}×` }))} onChange={(rate) => onLook({ rate })} disabled={!isVideo} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-fg/70">At the end</span>
          <Segmented label="Loop mode" value={look.playback} options={PLAYBACKS} onChange={(playback) => onLook({ playback })} disabled={!isVideo} />
        </div>
        {(liveLookDiffers || stagedLookDiffers) && (
          <p className="rounded border border-warn/40 bg-warn/10 px-2 py-1 text-[11px] text-warn">
            {liveLookDiffers ? 'Changed from what is on screen. Take live again to update it.' : 'Changed from what is staged. Stage again to update it.'}
          </p>
        )}
      </div>

      <div className="mt-auto flex flex-col gap-2 px-4 pt-5 pb-4">
        <button
          type="button"
          onClick={onStage}
          disabled={!asset || isAudio}
          className="flex h-10 items-center justify-center gap-2 rounded-md border border-warn bg-warn text-xs font-extrabold tracking-wider text-canvas uppercase transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Layers size={14} aria-hidden /> Stage background
        </button>
        <button
          type="button"
          onClick={onTakeLive}
          disabled={!asset || isAudio || (isLive && !liveLookDiffers)}
          aria-pressed={isLive}
          className={`flex h-10 items-center justify-center gap-2 rounded-md border text-xs font-extrabold tracking-wider uppercase transition disabled:cursor-not-allowed ${
            isLive && !liveLookDiffers
              ? 'border-danger bg-danger/15 text-danger'
              : 'border-danger bg-danger text-white hover:brightness-110 disabled:opacity-40'
          }`}
        >
          {isLive && !liveLookDiffers ? <span className="size-2 animate-pulse rounded-full bg-danger" aria-hidden /> : <Zap size={14} aria-hidden />}
          {takeLabel}
        </button>
        <button type="button" onClick={onClear} disabled={!liveFrame && !stagedFrame} className={`${BTN} h-9 justify-center`}>
          <X size={13} aria-hidden /> Clear staged / live
        </button>
        <p className="pt-1 text-center text-[10px] leading-snug text-faint">Double-click a card to stage · Shift+click to take live</p>
      </div>
    </aside>
  );
}

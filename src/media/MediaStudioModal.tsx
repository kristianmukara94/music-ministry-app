import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  Copy,
  Crop,
  Eye,
  FlipHorizontal2,
  FlipVertical2,
  Grid3x3,
  Pause,
  Play,
  Redo2,
  Repeat,
  RotateCcw,
  RotateCw,
  ScanLine,
  SkipBack,
  SkipForward,
  SplitSquareHorizontal,
  Undo2,
  X,
} from 'lucide-react';
import {
  DEFAULT_MEDIA_EDIT_SETTINGS,
  MEDIA_ASPECT_RATIOS,
  MEDIA_EDIT_RANGES,
  MEDIA_GRADE_PRESETS,
  MEDIA_TINT_BLEND_MODES,
  MIN_CROP,
  applyMediaPreset,
  aspectValue,
  cropForAspect,
  formatTimecode,
  matchingPreset,
  normalizeCrop,
  normalizeMediaEditSettings,
  resolveTrimWindow,
  type MediaAspectRatio,
  type MediaCrop,
  type MediaEditSettings,
  type NumericEditKey,
} from '../../shared/media-editor.js';
import { bridge } from '../live/bridge';
import { EditedMediaRenderer } from './EditedMediaRenderer';
import { canvasBytes, captureVideoThumbnail, renderEditedToCanvas } from './bake';
import { useMediaT, type MediaT } from './strings';
import type { MediaAsset } from './types';
import { DRAG, NO_DRAG, TITLE_BAR_CLEARANCE } from '../components/appRegion';

const api = bridge.media;
/** The projector's shape. The Studio frames every picture for it. */
const STAGE_ASPECT = 16 / 9;
/** Matches the stage's p-6, so the 16:9 frame keeps an even dark margin on all four sides. */
const STAGE_PADDING = 24;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const same = (a: MediaEditSettings, b: MediaEditSettings) => JSON.stringify(a) === JSON.stringify(b);

type Tab = 'transform' | 'color' | 'presets' | 'trim';
export type StudioResult = { kind: 'edit' | 'copy' | 'thumb'; asset: MediaAsset; message: string };

// ---------------------------------------------------------------------------------------------------------------------------------------
// Undo / redo. A burst of changes to one control (a slider drag) is one step.
// ---------------------------------------------------------------------------------------------------------------------------------------

const HISTORY_LIMIT = 100;
const COALESCE_MS = 700;

function useEditHistory(initial: MediaEditSettings) {
  const [state, setState] = useState({ stack: [initial], index: 0 });
  const last = useRef<{ key: string | null; at: number }>({ key: null, at: 0 });
  const current = state.stack[state.index];

  /** Records a change. Changes with the same `key` within a moment of each other replace the last step instead of adding one. */
  const set = useCallback((next: MediaEditSettings, key: string | null = null) => {
    const now = Date.now();
    const merge = key !== null && last.current.key === key && now - last.current.at < COALESCE_MS;
    last.current = { key, at: now };
    setState((s) => {
      const top = s.stack[s.index];
      const normal = normalizeMediaEditSettings(next);
      if (same(top, normal)) return s;
      const base = s.stack.slice(0, merge && s.index > 0 ? s.index : s.index + 1);
      const stack = [...base, normal].slice(-HISTORY_LIMIT);
      return { stack, index: stack.length - 1 };
    });
  }, []);
  const undo = useCallback(() => {
    last.current.key = null;
    setState((s) => (s.index > 0 ? { ...s, index: s.index - 1 } : s));
  }, []);
  const redo = useCallback(() => {
    last.current.key = null;
    setState((s) => (s.index < s.stack.length - 1 ? { ...s, index: s.index + 1 } : s));
  }, []);
  const undoSteps = state.index;
  const redoSteps = state.stack.length - 1 - state.index;
  return { current, set, undo, redo, canUndo: undoSteps > 0, canRedo: redoSteps > 0, undoSteps, redoSteps };
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Small controls.
// ---------------------------------------------------------------------------------------------------------------------------------------

const LABEL = 'text-[10px] font-bold tracking-[0.14em] text-faint uppercase';
const CHIP =
  'flex h-8 items-center justify-center gap-1.5 rounded-md border px-2.5 text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40';
const chip = (on: boolean) => `${CHIP} ${on ? 'border-accent bg-accent text-on-accent' : 'border-fg/15 bg-surface-2 text-fg/85 hover:bg-fg/10 hover:text-fg'}`;

/**
 * A precision slider with a right-aligned readout. Double-clicking the track, the label or the value puts it back to neutral; an accent
 * dot marks a slider that is off neutral.
 */
function EditSlider({
  label,
  field,
  value,
  onChange,
  format,
  disabled,
  resetHint,
}: {
  label: string;
  field: NumericEditKey;
  value: number;
  onChange: (value: number, field: NumericEditKey) => void;
  format?: (v: number) => string;
  disabled?: boolean;
  resetHint?: string;
}) {
  const range = MEDIA_EDIT_RANGES[field];
  const neutral = DEFAULT_MEDIA_EDIT_SETTINGS[field] as number;
  const shown = format ? format(value) : value > 0 && range.min < 0 ? `+${value}` : String(value);
  const changed = value !== neutral;
  const reset = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (!disabled && changed) onChange(neutral, field);
  };
  return (
    <label className={`flex flex-col gap-1 ${disabled ? 'opacity-40' : ''}`} data-slider={field} data-changed={changed || undefined}>
      <span className="flex items-center gap-2 text-xs text-muted select-none" onDoubleClick={reset} title={resetHint}>
        <span aria-hidden className={`size-1.5 flex-none rounded-full transition ${changed ? 'bg-accent' : 'bg-transparent'}`} />
        <span className={`min-w-0 flex-1 truncate ${changed ? 'font-semibold text-fg' : ''}`}>{label}</span>
        <span
          className={`min-w-[4.5ch] flex-none rounded px-1.5 py-0.5 text-right font-mono text-[11px] tabular-nums ${changed ? 'bg-accent/15 text-fg' : 'text-fg/80'}`}
        >
          {shown}
        </span>
      </span>
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value), field)}
        onDoubleClick={reset}
        aria-valuetext={`${label} ${shown}`}
        className="w-full accent-[var(--color-accent)]"
      />
    </label>
  );
}

/** A pill in the canvas toolbar under the preview. */
const TOOL = 'flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] font-bold transition select-none';
const tool = (on: boolean) => `${TOOL} ${on ? 'bg-accent text-on-accent' : 'text-white/80 hover:bg-white/10 hover:text-white'}`;

function Toggle({ on, onClick, icon, label, title }: { on: boolean; onClick: () => void; icon: ReactNode; label: string; title?: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} title={title ?? label} className={tool(on)}>
      {icon}
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

/** "1920×1080 · PNG": the picture's own size and the file type, from the loaded element and the file name. */
export function mediaInfo(size: { w: number; h: number } | null, filename: string, typeLabel: string) {
  const kind = /\.([a-z0-9]{2,5})$/i.exec(filename)?.[1]?.toUpperCase() ?? typeLabel;
  return size && size.w > 0 && size.h > 0 ? `${size.w}×${size.h} · ${kind}` : kind;
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// The crop frame.
// ---------------------------------------------------------------------------------------------------------------------------------------

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move';
const HANDLES: Exclude<Handle, 'move'>[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_POS: Record<Exclude<Handle, 'move'>, string> = {
  nw: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize',
  n: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize',
  ne: 'right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize',
  e: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize',
  se: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize',
  s: 'left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-ns-resize',
  sw: 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize',
  w: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize',
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * The crop after dragging `handle` by (dx, dy) frame shares from `start`. The opposite side stays put. With a ratio lock (`share` is the
 * crop's width share over its height share), a corner keeps the shape and an edge grows the other side around its centre.
 */
export function dragCrop(start: MediaCrop, handle: Handle, dx: number, dy: number, share: number | null): MediaCrop {
  if (handle === 'move') {
    return normalizeCrop({ ...start, x: clamp(start.x + dx, 0, 1 - start.width), y: clamp(start.y + dy, 0, 1 - start.height) });
  }
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes('w')) left = clamp(left + dx, 0, right - MIN_CROP);
  if (handle.includes('e')) right = clamp(right + dx, left + MIN_CROP, 1);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - MIN_CROP);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + MIN_CROP, 1);
  if (share === null) return normalizeCrop({ x: left, y: top, width: right - left, height: bottom - top });

  const horizontal = handle.includes('e') || handle.includes('w');
  const vertical = handle.includes('n') || handle.includes('s');
  let w = right - left;
  let h = bottom - top;
  if (horizontal && vertical) {
    // A corner: the width leads, limited by the room on the side the corner moves toward.
    const roomH = handle.includes('n') ? bottom : 1 - top;
    const roomW = handle.includes('w') ? right : 1 - left;
    h = Math.min(w / share, roomH);
    w = Math.min(h * share, roomW);
    h = w / share;
    if (handle.includes('w')) left = right - w;
    else right = left + w;
    if (handle.includes('n')) top = bottom - h;
    else bottom = top + h;
  } else if (horizontal) {
    const cy = (top + bottom) / 2;
    h = Math.min(w / share, 2 * Math.min(cy, 1 - cy));
    w = h * share;
    if (handle.includes('w')) left = right - w;
    else right = left + w;
    top = cy - h / 2;
  } else {
    const cx = (left + right) / 2;
    w = Math.min(h * share, 2 * Math.min(cx, 1 - cx));
    h = w / share;
    if (handle.includes('n')) top = bottom - h;
    else bottom = top + h;
    left = cx - w / 2;
  }
  return normalizeCrop({ x: left, y: top, width: w, height: h });
}

function CropOverlay({
  crop,
  ratio,
  grid,
  onChange,
}: {
  crop: MediaCrop;
  ratio: MediaAspectRatio;
  grid: boolean;
  onChange: (crop: MediaCrop) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: Handle; x: number; y: number; start: MediaCrop } | null>(null);
  const target = aspectValue(ratio);
  const share = target === null ? null : target / STAGE_ASPECT;

  const begin = (handle: Handle) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { handle, x: e.clientX, y: e.clientY, start: crop };
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    const box = boxRef.current?.getBoundingClientRect();
    if (!d || !box) return;
    onChange(dragCrop(d.start, d.handle, (e.clientX - d.x) / box.width, (e.clientY - d.y) / box.height, share));
  };
  const end = () => {
    drag.current = null;
  };

  return (
    <div ref={boxRef} className="absolute inset-0 overflow-hidden" onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <div
        role="group"
        aria-label="Crop frame"
        onPointerDown={begin('move')}
        className="absolute cursor-move border-2 border-accent"
        style={{
          left: `${crop.x * 100}%`,
          top: `${crop.y * 100}%`,
          width: `${crop.width * 100}%`,
          height: `${crop.height * 100}%`,
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)',
        }}
      >
        {grid && (
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute inset-y-0 left-1/3 w-px bg-white/50" />
            <div className="absolute inset-y-0 left-2/3 w-px bg-white/50" />
            <div className="absolute inset-x-0 top-1/3 h-px bg-white/50" />
            <div className="absolute inset-x-0 top-2/3 h-px bg-white/50" />
          </div>
        )}
        {HANDLES.map((h) => (
          <span
            key={h}
            onPointerDown={begin(h)}
            className={`absolute size-3.5 rounded-sm border-2 border-accent bg-white shadow ${HANDLE_POS[h]}`}
            aria-hidden
          />
        ))}
      </div>
    </div>
  );
}

/** Projector safe areas, the lower-third band and a sample lyric line, so a face or logo can be framed clear of the text. */
function SafeZoneOverlay({ sample }: { sample: string }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 [container-type:inline-size]">
      <div className="absolute inset-[5%] rounded-sm border border-dashed border-white/50" />
      <div className="absolute inset-[10%] rounded-sm border border-dashed border-accent/80" />
      <div className="absolute inset-x-[5%] bottom-[5%] h-[18%] rounded-sm border border-dashed border-sky-300/70 bg-sky-300/10" />
      <p className="absolute inset-x-[10%] top-1/2 -translate-y-1/2 text-center text-[5cqw] leading-tight font-bold text-white [text-shadow:0_2px_10px_rgba(0,0,0,0.85)]">
        {sample}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// The modal.
// ---------------------------------------------------------------------------------------------------------------------------------------

/**
 * The full-screen Media Studio: non-destructive framing, colour grade, liturgical presets and video trim for one library item, with a live
 * canvas (crop frame, safe zones, before/after split) and undo/redo. "Apply & Save" stores the edits on the item, and a staged or live
 * showing of it updates at once; "Save as New Copy" bakes the look into a new still. The file itself is never changed.
 * It is portalled to <body>, so no backdrop-blur or transform on the page can trap it.
 */
export function MediaStudioModal({ asset, onClose, onSaved }: { asset: MediaAsset; onClose: () => void; onSaved: (result: StudioResult) => void }) {
  const t = useMediaT();
  const isVideo = asset.mediaType === 'video';
  const initial = useMemo(() => normalizeMediaEditSettings(asset.edit), [asset.id]);
  const history = useEditHistory(initial);
  const s = history.current;
  const dirty = !same(s, initial);

  const [tab, setTab] = useState<Tab>('color');
  const [cropView, setCropView] = useState(false);
  const [grid, setGrid] = useState(false);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [safeZone, setSafeZone] = useState(false);
  const [compare, setCompare] = useState(false);
  const [split, setSplit] = useState(0.5);
  const [holdOriginal, setHoldOriginal] = useState(false);
  const [busy, setBusy] = useState<null | 'save' | 'copy' | 'thumb'>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const patch = useCallback((p: Partial<MediaEditSettings>, key: string | null = null) => history.set({ ...s, ...p }, key), [history, s]);
  const setNum = useCallback((value: number, field: NumericEditKey) => patch({ [field]: value } as Partial<MediaEditSettings>, field), [patch]);

  // ---- Video transport ----------------------------------------------------------------------------------------------------------------
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const originalRef = useRef<HTMLVideoElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loopPreview, setLoopPreview] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);

  useEffect(() => {
    if (!isVideo) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) {
        if (Number.isFinite(v.duration) && v.duration > 0) setDuration((d) => (Math.abs(d - v.duration) > 0.01 ? v.duration : d));
        setTime((old) => (Math.abs(old - v.currentTime) > 0.03 ? v.currentTime : old));
        setPlaying(!v.paused);
        // The original under the before/after split follows the edited one.
        const o = originalRef.current;
        if (o) {
          if (Math.abs(o.currentTime - v.currentTime) > 0.15) o.currentTime = v.currentTime;
          if (o.playbackRate !== v.playbackRate) o.playbackRate = v.playbackRate;
          if (v.paused !== o.paused) void (v.paused ? o.pause() : o.play().catch(() => undefined));
        }
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [isVideo]);

  const seek = (to: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = clamp(to, 0, Number.isFinite(v.duration) ? v.duration : to);
    setTime(v.currentTime);
  };
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  };
  const trim = resolveTrimWindow(s, duration || undefined);
  const setIn = () => patch(normalizeMediaEditSettings({ ...s, trimStart: time }, duration || undefined), 'trim');
  const setOut = () => patch(normalizeMediaEditSettings({ ...s, trimEnd: time }, duration || undefined), 'trim');

  // ---- Keyboard -------------------------------------------------------------------------------------------------------------------------
  const requestClose = useCallback(() => {
    if (dirty && !window.confirm(t('discardConfirm'))) return;
    onClose();
  }, [dirty, onClose, t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA');
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        history.undo();
      } else if ((e.ctrlKey || e.metaKey) && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        history.redo();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        requestClose();
      } else if (isVideo && !typing && e.key === '[') {
        e.preventDefault();
        setIn();
      } else if (isVideo && !typing && e.key === ']') {
        e.preventDefault();
        setOut();
      } else if (isVideo && !typing && e.key === ' ' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // ---- Stage size: the largest 16:9 box inside the padded centre stage (p-6 = 24px a side) ------------------------------------------
  const areaRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.min(el.clientWidth - STAGE_PADDING * 2, (el.clientHeight - STAGE_PADDING * 2) * STAGE_ASPECT);
      setStage({ w: Math.max(0, w), h: Math.max(0, w / STAGE_ASPECT) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ---- Drag on the picture: pans it (outside the crop view) ------------------------------------------------------------------------
  const panDrag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const onStagePointerDown = (e: ReactPointerEvent) => {
    if (cropView || compare || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    panDrag.current = { x: e.clientX, y: e.clientY, panX: s.panX, panY: s.panY };
  };
  const onStagePointerMove = (e: ReactPointerEvent) => {
    const d = panDrag.current;
    if (!d || !stage.w) return;
    patch({ panX: Math.round(clamp(d.panX + ((e.clientX - d.x) / stage.w) * 100, -50, 50)), panY: Math.round(clamp(d.panY + ((e.clientY - d.y) / stage.h) * 100, -50, 50)) }, 'pan');
  };
  const endPan = () => {
    panDrag.current = null;
  };

  // The split divider.
  const splitDrag = useRef(false);
  const onSplitMove = (e: ReactPointerEvent) => {
    if (!splitDrag.current) return;
    const box = stageRef.current?.getBoundingClientRect();
    if (box) setSplit(clamp((e.clientX - box.left) / box.width, 0, 1));
  };

  // What the canvas draws: the crop tool shows the whole fitted picture (with its grade) and the frame; otherwise the finished look.
  const cropBase = useMemo<MediaEditSettings>(() => ({ ...s, crop: { x: 0, y: 0, width: 1, height: 1 }, zoom: 1, panX: 0, panY: 0, rotate: 0, flipH: false, flipV: false }), [s]);
  const shownEdit = holdOriginal ? null : cropView ? cropBase : s;
  const showCrop = cropView && !holdOriginal;

  // ---- Actions ---------------------------------------------------------------------------------------------------------------------------
  const run = async (kind: 'save' | 'copy' | 'thumb', job: () => Promise<StudioResult>) => {
    setBusy(kind);
    setError(null);
    try {
      const result = await job();
      onSaved(result);
      if (kind === 'save') onClose();
      else setNote(result.message);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const applyAndSave = () =>
    run('save', async () => {
      const saved = await api.saveEditSettings(asset.id, s);
      return { kind: 'edit', asset: saved, message: t('editsSaved', { name: saved.filename }) };
    });

  const saveCopy = () =>
    run('copy', async () => {
      let source: HTMLImageElement | HTMLVideoElement;
      if (isVideo) {
        if (!videoRef.current) throw new Error('The video has not loaded yet.');
        source = videoRef.current;
      } else {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = asset.src;
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('The picture could not be read.'));
        });
        source = img;
      }
      const bytes = await canvasBytes(renderEditedToCanvas(source, s), 'image/png');
      const copy = await api.saveEditedCopy(asset.id, bytes);
      return { kind: 'copy', asset: copy, message: t('copySaved', { name: copy.filename }) };
    });

  const setThumbnail = () =>
    run('thumb', async () => {
      if (!videoRef.current) throw new Error('The video has not loaded yet.');
      const updated = await api.updateThumbnail(asset.id, await captureVideoThumbnail(videoRef.current));
      return { kind: 'thumb', asset: updated, message: t('thumbnailSet') };
    });

  const resetAll = () => history.set(normalizeMediaEditSettings({ aspectRatio: s.aspectRatio }), null);

  // A still has nothing to trim, so it gets three tabs, not a disabled fourth.
  const tabs: { id: Tab; label: string }[] = [
    { id: 'transform', label: t('tabTransform') },
    { id: 'color', label: t('tabColor') },
    { id: 'presets', label: t('tabPresets') },
    ...(isVideo ? [{ id: 'trim' as const, label: t('tabTrim') }] : []),
  ];

  // Switching away from Transform leaves the crop tool, so other tabs always show the finished look.
  const chooseTab = (id: Tab) => {
    setTab(id);
    if (id !== 'transform') setCropView(false);
  };

  const neutral = same(s, normalizeMediaEditSettings({ aspectRatio: s.aspectRatio }));
  // The status dot: amber while there are edits not yet saved, accent when the saved item already carries edits.
  const status = dirty ? { label: t('unsavedChanges'), dot: 'bg-warn', text: 'text-warn' } : asset.edited ? { label: t('edited'), dot: 'bg-accent', text: 'text-accent' } : null;
  const info = mediaInfo(naturalSize, asset.filename, isVideo ? t('typeVideo') : t('typeImage'));
  const comparing = compare && !cropView && !holdOriginal;

  return createPortal(
    <div className="fixed inset-0 z-[300] bg-black/70" data-media-studio-backdrop>
      {/* The caption strip above the studio stays a window handle; the studio itself is no-drag (see components/appRegion.ts). */}
      <div aria-hidden className="app-drag absolute inset-x-0 top-0" style={{ height: TITLE_BAR_CLEARANCE, ...DRAG }} data-media-studio-caption />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${t('studioTitle')}: ${asset.filename}`}
        className="no-drag absolute inset-x-0 bottom-0 flex flex-col border-t border-line-strong bg-canvas text-fg"
        style={{ top: TITLE_BAR_CLEARANCE, ...NO_DRAG }}
        data-media-studio
      >
        {/* Header: identity and history on the left, Close on the right. The right group never shrinks. */}
        <header className="no-drag flex h-13 flex-none items-center gap-3 border-b border-line-strong bg-surface px-5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="flex-none rounded border border-accent/60 bg-accent/10 px-2 py-0.5 text-[10px] font-extrabold tracking-[0.16em] text-accent uppercase">
              {t('studioTitle')}
            </span>
            <span className="max-w-[260px] min-w-0 truncate rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-fg" title={asset.filename} data-studio-filename>
              {asset.filename}
            </span>
            <span className="hidden flex-none rounded-full border border-line bg-surface-2 px-2.5 py-0.5 font-mono text-[11px] text-fg/80 tabular-nums sm:inline" data-studio-info>
              {info}
            </span>
            {status && (
              <span role="status" className={`flex flex-none items-center gap-1.5 text-[11px] font-bold ${status.text}`} data-studio-status={dirty ? 'unsaved' : 'edited'}>
                <span aria-hidden className={`size-2 rounded-full ${status.dot}`} />
                <span className="hidden md:inline">{status.label}</span>
              </span>
            )}
            <div role="group" aria-label={`${t('undo')} / ${t('redo')}`} className="ml-2 flex flex-none items-center gap-1 border-l border-line pl-3">
              <button
                type="button"
                onClick={history.undo}
                disabled={!history.canUndo}
                title={`${t('undo')} (Ctrl+Z)`}
                aria-label={`${t('undo')} (${history.undoSteps})`}
                className={chip(false)}
              >
                <Undo2 size={14} aria-hidden />
                {history.undoSteps > 0 && <span className="font-mono text-[10px] tabular-nums">{history.undoSteps}</span>}
              </button>
              <button
                type="button"
                onClick={history.redo}
                disabled={!history.canRedo}
                title={`${t('redo')} (Ctrl+Y)`}
                aria-label={`${t('redo')} (${history.redoSteps})`}
                className={chip(false)}
              >
                <Redo2 size={14} aria-hidden />
                {history.redoSteps > 0 && <span className="font-mono text-[10px] tabular-nums">{history.redoSteps}</span>}
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={requestClose}
            title={`${t('close')} (Esc)`}
            className="flex h-8 flex-none items-center gap-1.5 rounded-md border border-line-strong bg-surface-2 px-3 text-xs font-bold text-fg transition hover:border-danger/60 hover:bg-danger/15"
            data-studio-close
          >
            <X size={15} aria-hidden />
            {t('close')}
            <kbd className="rounded border border-line px-1 font-mono text-[10px] text-fg/70">Esc</kbd>
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* Studio stage: the 16:9 frame centred with an even margin, and the canvas toolbar under it. */}
          <div className="flex min-w-0 flex-1 flex-col bg-[#12100e]">
            <div ref={areaRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6" data-studio-stage>
              <div
                ref={stageRef}
                className={`relative flex-none overflow-hidden bg-black shadow-2xl ${!cropView && !compare ? 'cursor-grab active:cursor-grabbing' : ''}`}
                style={{ width: stage.w, height: stage.h, border: '1px solid rgba(255,255,255,0.18)' }}
                onPointerDown={onStagePointerDown}
                onPointerMove={(e) => {
                  onStagePointerMove(e);
                  onSplitMove(e);
                }}
                onPointerUp={() => {
                  endPan();
                  splitDrag.current = false;
                }}
                onPointerCancel={endPan}
              >
                {/* The original, under the split. Its video follows the edited one. */}
                {comparing && (
                  <EditedMediaRenderer mediaType={isVideo ? 'video' : 'image'} src={asset.src} edit={null} autoPlay={false} enforceTrim={false} videoRef={originalRef} crossOrigin="anonymous" />
                )}
                <div className="absolute inset-0" style={comparing ? { clipPath: `inset(0 0 0 ${split * 100}%)` } : undefined}>
                  <EditedMediaRenderer
                    mediaType={isVideo ? 'video' : 'image'}
                    src={asset.src}
                    edit={shownEdit}
                    rate={s.playbackSpeed}
                    audible={s.volume > 0}
                    autoPlay={false}
                    enforceTrim={loopPreview && !scrubbing}
                    videoRef={videoRef}
                    crossOrigin="anonymous"
                    onLoaded={(el) => {
                      if (el instanceof HTMLVideoElement) {
                        setDuration(el.duration);
                        setNaturalSize({ w: el.videoWidth, h: el.videoHeight });
                        void el.play().catch(() => undefined);
                      } else {
                        setNaturalSize({ w: el.naturalWidth, h: el.naturalHeight });
                      }
                    }}
                  />
                </div>
                {showCrop && <CropOverlay crop={s.crop} ratio={s.aspectRatio} grid={grid} onChange={(crop) => patch({ crop }, 'crop')} />}
                {!showCrop && grid && (
                  <div aria-hidden className="pointer-events-none absolute inset-0" data-studio-thirds>
                    <div className="absolute inset-y-0 left-1/3 w-px bg-white/35" />
                    <div className="absolute inset-y-0 left-2/3 w-px bg-white/35" />
                    <div className="absolute inset-x-0 top-1/3 h-px bg-white/35" />
                    <div className="absolute inset-x-0 top-2/3 h-px bg-white/35" />
                  </div>
                )}
                {safeZone && <SafeZoneOverlay sample={t('sampleLyric')} />}
                {comparing && (
                  <>
                    <div
                      role="slider"
                      aria-label={t('beforeAfter')}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(split * 100)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowLeft') setSplit((v) => clamp(v - 0.02, 0, 1));
                        if (e.key === 'ArrowRight') setSplit((v) => clamp(v + 0.02, 0, 1));
                      }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        stageRef.current?.setPointerCapture(e.pointerId);
                        splitDrag.current = true;
                      }}
                      className="absolute inset-y-0 z-10 w-6 -translate-x-1/2 cursor-ew-resize"
                      style={{ left: `${split * 100}%` }}
                    >
                      <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_6px_rgba(0,0,0,0.8)]" />
                      <div className="absolute top-1/2 left-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-[10px] font-black text-black shadow">⇆</div>
                    </div>
                    <span className="pointer-events-none absolute top-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white uppercase">{t('original')}</span>
                    <span className="pointer-events-none absolute top-2 right-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold text-on-accent uppercase">{t('edited')}</span>
                  </>
                )}
                {holdOriginal && <span className="pointer-events-none absolute top-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white uppercase">{t('original')}</span>}
              </div>
            </div>

            {/* Canvas toolbar: inspection aids that change only the preview, never the saved edit. */}
            <div className="flex flex-none justify-center px-6 pb-5">
              <div role="toolbar" aria-label={t('canvasTools')} className="flex flex-wrap items-center justify-center gap-1 rounded-full border border-white/10 bg-black/60 p-1 shadow-lg" data-studio-canvas-toolbar>
                <Toggle on={grid} onClick={() => setGrid((v) => !v)} icon={<Grid3x3 size={14} aria-hidden />} label={t('ruleOfThirds')} />
                <Toggle on={safeZone} onClick={() => setSafeZone((v) => !v)} icon={<ScanLine size={14} aria-hidden />} label={t('safeZone')} />
                <Toggle
                  on={compare}
                  onClick={() => {
                    setCompare((v) => !v);
                    setCropView(false);
                  }}
                  icon={<SplitSquareHorizontal size={14} aria-hidden />}
                  label={t('beforeAfter')}
                />
                <button
                  type="button"
                  onPointerDown={() => setHoldOriginal(true)}
                  onPointerUp={() => setHoldOriginal(false)}
                  onPointerLeave={() => setHoldOriginal(false)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setHoldOriginal(true)}
                  onKeyUp={() => setHoldOriginal(false)}
                  onBlur={() => setHoldOriginal(false)}
                  aria-pressed={holdOriginal}
                  title={t('holdCompare')}
                  className={tool(holdOriginal)}
                >
                  <Eye size={14} aria-hidden />
                  <span className="hidden md:inline">{t('holdCompareShort')}</span>
                </button>
                <span aria-hidden className="mx-1 h-5 w-px bg-white/15" />
                <span className="rounded-full bg-white/10 px-2.5 py-1 font-mono text-[11px] text-white/85 tabular-nums" data-studio-readout>
                  {s.aspectRatio === 'free' ? t('aspectFree') : s.aspectRatio} · {Math.round(s.zoom * 100)}%
                </span>
              </div>
            </div>
          </div>

          {/* Inspector */}
          <aside aria-label={t('studioTitle')} className="flex w-80 flex-none flex-col border-l border-line-strong bg-surface xl:w-96">
            <div className="flex-none border-b border-line p-3">
              <div
                role="tablist"
                aria-label={t('studioTitle')}
                className={`grid gap-1 rounded-lg border border-line bg-surface-2 p-1 ${tabs.length === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}
                data-studio-tabs={tabs.length}
              >
                {tabs.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === x.id}
                    title={x.label}
                    onClick={() => chooseTab(x.id)}
                    className={`h-8 rounded-md px-1 text-[11px] leading-tight font-bold transition ${tab === x.id ? 'bg-accent text-on-accent shadow' : 'text-fg/75 hover:bg-fg/10 hover:text-fg'}`}
                  >
                    {x.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {tab === 'transform' && <TransformTab t={t} s={s} patch={patch} setNum={setNum} cropView={cropView} setCropView={setCropView} />}
              {tab === 'color' && <ColorTab t={t} s={s} patch={patch} setNum={setNum} />}
              {tab === 'presets' && <PresetsTab t={t} s={s} asset={asset} onPick={(id) => history.set(applyMediaPreset(s, id), null)} />}
              {tab === 'trim' && isVideo && (
                <TrimTab
                  t={t}
                  s={s}
                  patch={patch}
                  setNum={setNum}
                  duration={duration}
                  time={time}
                  playing={playing}
                  trim={trim}
                  loopPreview={loopPreview}
                  setLoopPreview={setLoopPreview}
                  onSeek={seek}
                  onScrub={setScrubbing}
                  onTogglePlay={togglePlay}
                  onSetIn={setIn}
                  onSetOut={setOut}
                  onThumbnail={() => void setThumbnail()}
                  thumbBusy={busy === 'thumb'}
                />
              )}
            </div>

            {(error || note) && (
              <p role={error ? 'alert' : 'status'} className={`mx-4 mb-2 rounded-md border px-2.5 py-1.5 text-xs ${error ? 'border-danger/50 bg-danger/10 text-danger' : 'border-ok/50 bg-ok/10 text-ok'}`}>
                {error ?? note}
              </p>
            )}

            {/* Footer: secondary actions on top, then Cancel beside a wide primary Apply & Save. */}
            <footer className="flex flex-none flex-col gap-2 border-t border-line-strong bg-surface p-3" data-studio-footer>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={resetAll} disabled={neutral} className={`${CHIP} h-9 border-fg/15 bg-surface-2 text-fg/85 hover:bg-fg/10`}>
                  <RotateCcw size={13} aria-hidden /> {t('resetAll')}
                </button>
                <button
                  type="button"
                  onClick={() => void saveCopy()}
                  disabled={busy !== null}
                  title={isVideo ? t('saveAsCopyVideoHint') : undefined}
                  className={`${CHIP} h-9 border-accent/60 bg-surface-2 text-accent hover:bg-accent/10`}
                >
                  <Copy size={13} aria-hidden /> <span className="truncate">{busy === 'copy' ? t('saving') : t('saveAsCopy')}</span>
                </button>
              </div>
              <div className="grid grid-cols-[1fr_2fr] gap-2">
                <button type="button" onClick={requestClose} className={`${CHIP} h-11 border-fg/15 bg-surface-2 text-fg/85 hover:bg-fg/10`}>
                  {t('cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void applyAndSave()}
                  disabled={busy !== null}
                  className="flex h-11 items-center justify-center gap-1.5 rounded-md border border-accent bg-accent px-3 text-xs font-extrabold tracking-wide text-on-accent uppercase shadow transition hover:brightness-110 disabled:opacity-50"
                  data-studio-apply
                >
                  <Check size={15} aria-hidden /> {busy === 'save' ? t('saving') : t('applySave')}
                </button>
              </div>
            </footer>
          </aside>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Tabs.
// ---------------------------------------------------------------------------------------------------------------------------------------

type TabProps = {
  t: MediaT;
  s: MediaEditSettings;
  patch: (p: Partial<MediaEditSettings>, key?: string | null) => void;
  setNum: (value: number, field: NumericEditKey) => void;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 pb-5">
      <h3 className={LABEL}>{title}</h3>
      {children}
    </section>
  );
}

function TransformTab({
  t,
  s,
  patch,
  setNum,
  cropView,
  setCropView,
}: TabProps & { cropView: boolean; setCropView: (v: boolean) => void }) {
  // Moving the picture shows the finished framing, so the operator sees what the slider does.
  const setFraming = (value: number, field: NumericEditKey) => {
    setCropView(false);
    setNum(value, field);
  };
  return (
    <>
      <Section title={t('aspectRatio')}>
        <div className="grid grid-cols-5 gap-1">
          {MEDIA_ASPECT_RATIOS.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={s.aspectRatio === r}
              onClick={() => {
                setCropView(true);
                patch({ aspectRatio: r, crop: cropForAspect(s.crop, r, STAGE_ASPECT) }, null);
              }}
              className={chip(s.aspectRatio === r)}
            >
              {r === 'free' ? t('aspectFree') : r}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1">
          <button type="button" aria-pressed={cropView} onClick={() => setCropView(!cropView)} className={chip(cropView)}>
            <Crop size={13} aria-hidden /> {t('cropFrame')}
          </button>
          <button type="button" onClick={() => patch({ crop: { x: 0, y: 0, width: 1, height: 1 }, aspectRatio: '16:9' }, null)} className={chip(false)}>
            {t('resetCrop')}
          </button>
        </div>
      </Section>
      <Section title={t('fitMode')}>
        <div className="grid grid-cols-3 gap-1">
          {(['cover', 'contain', 'fill'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={s.fitMode === f} onClick={() => patch({ fitMode: f }, null)} className={chip(s.fitMode === f)}>
              {t(f === 'cover' ? 'fitCover' : f === 'contain' ? 'fitContain' : 'fitFill')}
            </button>
          ))}
        </div>
      </Section>
      <Section title={t('tabTransform')}>
        <EditSlider resetHint={t('resetToDefault')} label={t('zoom')} field="zoom" value={s.zoom} onChange={setFraming} format={(v) => `${v.toFixed(2)}×`} />
        <EditSlider resetHint={t('resetToDefault')} label={t('panX')} field="panX" value={s.panX} onChange={setFraming} format={(v) => `${v > 0 ? '+' : ''}${v}%`} />
        <EditSlider resetHint={t('resetToDefault')} label={t('panY')} field="panY" value={s.panY} onChange={setFraming} format={(v) => `${v > 0 ? '+' : ''}${v}%`} />
        <EditSlider resetHint={t('resetToDefault')} label={t('rotate')} field="rotate" value={s.rotate} onChange={setFraming} format={(v) => `${v}°`} />
        <div className="grid grid-cols-3 gap-1">
          <button
            type="button"
            onClick={() => {
              setCropView(false);
              // Quarter turns wrap within -180..180.
              const next = s.rotate + 90 > 180 ? s.rotate + 90 - 360 : s.rotate + 90;
              patch({ rotate: next }, null);
            }}
            className={chip(false)}
          >
            <RotateCw size={13} aria-hidden /> {t('rotate90')}
          </button>
          <button type="button" aria-pressed={s.flipH} onClick={() => (setCropView(false), patch({ flipH: !s.flipH }, null))} className={chip(s.flipH)}>
            <FlipHorizontal2 size={13} aria-hidden /> <span className="truncate">{t('flipH')}</span>
          </button>
          <button type="button" aria-pressed={s.flipV} onClick={() => (setCropView(false), patch({ flipV: !s.flipV }, null))} className={chip(s.flipV)}>
            <FlipVertical2 size={13} aria-hidden /> <span className="truncate">{t('flipV')}</span>
          </button>
        </div>
      </Section>
      <p className="text-[11px] text-faint">{t('sliderResetHint')}</p>
    </>
  );
}

function ColorTab({ t, s, patch, setNum }: TabProps) {
  const signed = (v: number) => (v > 0 ? `+${v}` : String(v));
  return (
    <>
      <Section title={t('tabColor')}>
        <EditSlider resetHint={t('resetToDefault')} label={t('brightness')} field="brightness" value={s.brightness} onChange={setNum} format={signed} />
        <EditSlider resetHint={t('resetToDefault')} label={t('contrast')} field="contrast" value={s.contrast} onChange={setNum} format={signed} />
        <EditSlider resetHint={t('resetToDefault')} label={t('saturation')} field="saturation" value={s.saturation} onChange={setNum} format={(v) => `${v}%`} />
        <EditSlider resetHint={t('resetToDefault')} label={t('warmth')} field="warmth" value={s.warmth} onChange={setNum} format={signed} />
        <EditSlider resetHint={t('resetToDefault')} label={t('hue')} field="hueRotate" value={s.hueRotate} onChange={setNum} format={(v) => `${v}°`} />
      </Section>
      <Section title={t('backdropBlur')}>
        <EditSlider resetHint={t('resetToDefault')} label={t('backdropBlur')} field="blur" value={s.blur} onChange={setNum} format={(v) => `${v}px`} />
        <EditSlider resetHint={t('resetToDefault')} label={t('vignette')} field="vignette" value={s.vignette} onChange={setNum} format={(v) => `${v}%`} />
      </Section>
      <Section title={t('tintColor')}>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={s.tintColor}
            onChange={(e) => patch({ tintColor: e.target.value, tintOpacity: s.tintOpacity === 0 ? 30 : s.tintOpacity }, 'tintColor')}
            aria-label={t('tintColor')}
            className="h-8 w-12 cursor-pointer rounded border border-fg/15 bg-surface-2"
          />
          <span className="font-mono text-xs text-muted uppercase">{s.tintColor}</span>
        </div>
        <EditSlider resetHint={t('resetToDefault')} label={t('tintOpacity')} field="tintOpacity" value={s.tintOpacity} onChange={setNum} format={(v) => `${v}%`} />
        <span className="text-xs text-muted">{t('blendMode')}</span>
        <div className="grid grid-cols-4 gap-1">
          {(['multiply', 'overlay', 'screen', 'normal'] as const).filter((m) => MEDIA_TINT_BLEND_MODES.includes(m)).map((m) => (
            <button key={m} type="button" aria-pressed={s.tintBlendMode === m} onClick={() => patch({ tintBlendMode: m }, null)} className={chip(s.tintBlendMode === m)}>
              {t(m === 'multiply' ? 'blendMultiply' : m === 'overlay' ? 'blendOverlay' : m === 'screen' ? 'blendScreen' : 'blendNormal')}
            </button>
          ))}
        </div>
      </Section>
      <p className="text-[11px] text-faint">{t('sliderResetHint')}</p>
    </>
  );
}

function PresetsTab({ t, s, asset, onPick }: { t: MediaT; s: MediaEditSettings; asset: MediaAsset; onPick: (id: string) => void }) {
  const active = matchingPreset(s);
  // The previews use the card's thumbnail (a still for videos too), so nine looks cost nine small pictures.
  const still = asset.thumbSrc ?? (asset.mediaType === 'image' ? asset.src : null);
  return (
    <div className="grid grid-cols-2 gap-2">
      {MEDIA_GRADE_PRESETS.map((p) => {
        const look = applyMediaPreset(s, p.id);
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={active === p.id}
            onClick={() => onPick(p.id)}
            aria-label={active === p.id ? `${t(p.labelKey)} · ${t('presetActive')}` : t(p.labelKey)}
            className={`group overflow-hidden rounded-md border bg-surface-2 text-left transition ${active === p.id ? 'border-accent ring-2 ring-accent' : 'border-line hover:-translate-y-px hover:border-fg/40 hover:shadow-md'}`}
          >
            <span className="relative block aspect-video bg-black">
              {still && <EditedMediaRenderer mediaType="image" src={still} edit={{ ...look, crop: { x: 0, y: 0, width: 1, height: 1 }, zoom: 1, panX: 0, panY: 0, rotate: 0 }} />}
              {active === p.id && (
                <span title={t('presetActive')} className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-accent text-on-accent shadow ring-2 ring-black/40" data-preset-check>
                  <Check size={12} strokeWidth={3} aria-hidden />
                </span>
              )}
            </span>
            <span className={`block truncate px-2 py-1.5 text-[11px] font-bold ${active === p.id ? 'bg-accent/15 text-fg' : 'text-fg/85'}`}>{t(p.labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}

function TrimTab({
  t,
  s,
  setNum,
  patch,
  duration,
  time,
  playing,
  trim,
  loopPreview,
  setLoopPreview,
  onSeek,
  onScrub,
  onTogglePlay,
  onSetIn,
  onSetOut,
  onThumbnail,
  thumbBusy,
}: TabProps & {
  duration: number;
  time: number;
  playing: boolean;
  trim: { start: number; end: number };
  loopPreview: boolean;
  setLoopPreview: (v: boolean) => void;
  onSeek: (t: number) => void;
  onScrub: (on: boolean) => void;
  onTogglePlay: () => void;
  onSetIn: () => void;
  onSetOut: () => void;
  onThumbnail: () => void;
  thumbBusy: boolean;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const drag = useRef<null | 'in' | 'out' | 'head'>(null);
  const d = duration > 0 ? duration : 1;
  const end = Number.isFinite(trim.end) ? trim.end : d;
  const pct = (v: number) => `${clamp(v / d, 0, 1) * 100}%`;
  const at = (clientX: number) => {
    const box = barRef.current?.getBoundingClientRect();
    return box ? clamp((clientX - box.left) / box.width, 0, 1) * d : 0;
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!drag.current) return;
    const v = at(e.clientX);
    if (drag.current === 'head') onSeek(v);
    else if (drag.current === 'in') patch(normalizeMediaEditSettings({ ...s, trimStart: Math.min(v, end - 0.1) }, duration), 'trim');
    else patch(normalizeMediaEditSettings({ ...s, trimEnd: Math.max(v, trim.start + 0.1) }, duration), 'trim');
  };
  const begin = (which: 'in' | 'out' | 'head') => (e: ReactPointerEvent) => {
    e.stopPropagation();
    barRef.current?.setPointerCapture(e.pointerId);
    drag.current = which;
    onScrub(true);
    if (which === 'head') onSeek(at(e.clientX));
  };
  const stop = () => {
    drag.current = null;
    onScrub(false);
  };

  return (
    <>
      <Section title={t('tabTrim')}>
        <div className="flex items-center justify-between font-mono text-xs tabular-nums">
          <span className="text-fg">{formatTimecode(time)}</span>
          <span className="text-faint">
            {formatTimecode(trim.start)} – {formatTimecode(end)} / {formatTimecode(duration)}
          </span>
        </div>
        <div
          ref={barRef}
          className="relative h-10 cursor-pointer touch-none rounded-md bg-surface-2 ring-1 ring-fg/15 select-none"
          onPointerDown={begin('head')}
          onPointerMove={onMove}
          onPointerUp={stop}
          onPointerCancel={stop}
        >
          <div aria-hidden className="absolute inset-y-0 rounded-sm bg-accent/25" style={{ left: pct(trim.start), width: `calc(${pct(end)} - ${pct(trim.start)})` }} />
          <div aria-hidden className="absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: pct(time) }} />
          {(['in', 'out'] as const).map((which) => (
            <span
              key={which}
              role="slider"
              aria-label={which === 'in' ? `${t('setIn')} [` : `${t('setOut')} ]`}
              aria-valuemin={0}
              aria-valuemax={Math.round(d * 10) / 10}
              aria-valuenow={Math.round((which === 'in' ? trim.start : end) * 10) / 10}
              tabIndex={0}
              onPointerDown={begin(which)}
              className={`absolute inset-y-0 w-3 -translate-x-1/2 cursor-ew-resize rounded-sm bg-accent ${which === 'in' ? 'rounded-r-none' : 'rounded-l-none'}`}
              style={{ left: pct(which === 'in' ? trim.start : end) }}
            >
              <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] font-black text-accent">{which === 'in' ? '[' : ']'}</span>
            </span>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-1">
          <button type="button" onClick={() => onSeek(time - 0.1)} title={t('stepBack')} aria-label={t('stepBack')} className={chip(false)}>
            <SkipBack size={13} aria-hidden /> -0.1s
          </button>
          <button type="button" onClick={onTogglePlay} aria-label={playing ? t('pause') : t('play')} className={chip(playing)}>
            {playing ? <Pause size={13} aria-hidden /> : <Play size={13} aria-hidden />} {playing ? t('pause') : t('play')}
          </button>
          <button type="button" onClick={() => onSeek(time + 0.1)} title={t('stepForward')} aria-label={t('stepForward')} className={chip(false)}>
            +0.1s <SkipForward size={13} aria-hidden />
          </button>
          <button type="button" onClick={onSetIn} title="[" className={chip(false)}>
            [ {t('setIn')}
          </button>
          <button type="button" onClick={onSetOut} title="]" className={chip(false)}>
            {t('setOut')} ]
          </button>
          <button type="button" onClick={() => patch({ trimStart: 0, trimEnd: null }, null)} disabled={trim.start === 0 && s.trimEnd === null} className={chip(false)}>
            {t('clearTrim')}
          </button>
        </div>
        <button type="button" aria-pressed={loopPreview} onClick={() => setLoopPreview(!loopPreview)} className={chip(loopPreview)}>
          <Repeat size={13} aria-hidden /> {t('loopPreview')}
        </button>
      </Section>
      <Section title={t('playbackSpeed')}>
        <EditSlider resetHint={t('resetToDefault')} label={t('playbackSpeed')} field="playbackSpeed" value={s.playbackSpeed} onChange={setNum} format={(v) => `${v.toFixed(2)}×`} />
        <EditSlider resetHint={t('resetToDefault')} label={t('fadeIn')} field="fadeInSec" value={s.fadeInSec} onChange={setNum} format={(v) => `${v.toFixed(1)}s`} />
        <EditSlider resetHint={t('resetToDefault')} label={t('fadeOut')} field="fadeOutSec" value={s.fadeOutSec} onChange={setNum} format={(v) => `${v.toFixed(1)}s`} />
        <EditSlider resetHint={t('resetToDefault')} label={t('volume')} field="volume" value={s.volume} onChange={setNum} format={(v) => `${v}%`} />
      </Section>
      <button type="button" onClick={onThumbnail} disabled={thumbBusy} className={`${chip(false)} h-9 w-full`}>
        {thumbBusy ? t('saving') : t('setThumbnail')}
      </button>
    </>
  );
}

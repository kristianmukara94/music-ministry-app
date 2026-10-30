import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Eye, Lock, Minus, Unlock, X } from 'lucide-react';
import { useLive } from '../live/store';
import { setUi } from '../state/ui';
import { ProjectorView } from '../output/ProjectorView';

const ICON = 'grid size-7 place-items-center rounded-lg p-1 text-fg/60 transition hover:bg-fg/10 hover:text-fg';

/** The pinned lock: a gold outline and fill, so it is clear the header is held open. */
const PINNED_ICON = 'grid size-7 place-items-center rounded-lg border border-accent/50 bg-accent/20 p-1 text-accent transition hover:bg-accent/30';

/** Where the panel was last left, and how big it was, so it reopens exactly the same. */
const POSITION_KEY = 'apcc_preview_position';
const SIZE_KEY = 'apcc_preview_size';
const DEFAULT_SIZE = { width: 480, height: 270 };
/** The gap kept between the panel and the edge of the screen, so it is never cut off. */
const EDGE = 16;

function readJson(key: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null');
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: object) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the position lasts for this session */
  }
}

/** The panel's rectangle on screen, in pixels: where its top left corner is, and its width and height. */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Corner = 'nw' | 'ne' | 'sw' | 'se';

/** The panel can be resized, but not so small the header breaks, nor so large it covers the whole screen. */
const MIN_W = 360;
const MIN_H = 240;
const maxW = () => window.innerWidth * 0.8;
const maxH = () => window.innerHeight * 0.8;

/** The size, kept within the panel's limits for the window as it is now. */
const fitSize = (w: number, h: number) => ({
  w: Math.min(Math.max(w, MIN_W), maxW()),
  h: Math.min(Math.max(h, MIN_H), maxH()),
});

/**
 * A position kept on screen. The stored position is pulled back in when the window has shrunk or the saved spot
 * would now be off screen.
 */
const clampToScreen = (x: number, y: number, w: number, h: number) => ({
  x: Math.max(EDGE, Math.min(x, window.innerWidth - w - EDGE)),
  y: Math.max(EDGE, Math.min(y, window.innerHeight - h - EDGE)),
});

/** The rectangle the panel opens at: the saved position and size, or the defaults, always on screen. */
function savedRect(): Rect {
  const size = readJson(SIZE_KEY);
  const position = readJson(POSITION_KEY);
  const { w, h } = fitSize(
    typeof size?.width === 'number' ? size.width : DEFAULT_SIZE.width,
    typeof size?.height === 'number' ? size.height : DEFAULT_SIZE.height,
  );
  const x = typeof position?.x === 'number' ? position.x : window.innerWidth - 500;
  const y = typeof position?.y === 'number' ? position.y : 70;
  return { ...clampToScreen(x, y, w, h), w, h };
}

/** Saves the position and size, so the panel reopens exactly as it was left. */
function saveRect(r: Rect) {
  writeJson(POSITION_KEY, { x: r.x, y: r.y });
  writeJson(SIZE_KEY, { width: r.w, height: r.h });
}

/**
 * The rectangle after a drag from one corner. The two edges that corner does not hold stay where they are, and the
 * size is clamped to the limits, so the held edge moves with the pointer and the opposite one stays put.
 */
function resizedRect(start: Rect, corner: Corner, dx: number, dy: number): Rect {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (corner.includes('w')) left += dx;
  else right += dx;
  if (corner.includes('n')) top += dy;
  else bottom += dy;

  const w = Math.min(Math.max(right - left, MIN_W), maxW());
  const h = Math.min(Math.max(bottom - top, MIN_H), maxH());
  if (corner.includes('w')) left = right - w;
  else right = left + w;
  if (corner.includes('n')) top = bottom - h;
  else bottom = top + h;
  return { x: Math.max(0, left), y: Math.max(0, top), w, h };
}

/** One corner's grip: a small bracket that shows on hover, with the diagonal cursor for its direction. */
function Grip({ corner, onDown, onMove, onUp }: {
  corner: Corner;
  onDown: (corner: Corner, e: PointerEvent<HTMLSpanElement>) => void;
  onMove: (e: PointerEvent<HTMLSpanElement>) => void;
  onUp: () => void;
}) {
  const place = { nw: 'left-0 top-0', ne: 'right-0 top-0', sw: 'left-0 bottom-0', se: 'right-0 bottom-0' }[corner];
  const cursor = corner === 'nw' || corner === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize';
  // Each bracket points into the panel from its corner.
  const flip = { nw: 'rotate(0)', ne: 'rotate(90)', se: 'rotate(180)', sw: 'rotate(270)' }[corner];
  return (
    <span
      role="presentation"
      onPointerDown={(e) => onDown(corner, e)}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      className={`absolute z-30 grid size-5 place-items-center text-fg/40 opacity-0 transition-[opacity,color] group-hover:opacity-100 hover:text-accent ${place} ${cursor}`}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" style={{ transform: flip }} aria-hidden>
        <path d="M1 9 L1 1 L9 1" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/**
 * The floating live preview: what the congregation screen shows, with no frame inside the panel. The picture is
 * always live. The header is an overlay across the top: the lock pins it open, and unpinned it shows while the
 * pointer is over the panel. The panel can be dragged by its header and resized from any corner.
 */
export function PreviewPanel() {
  const projectorOn = useLive((s) => s.state.outputs.projector);
  const paused = useLive((s) => s.state.projector.paused);
  // The lock pins the header open. It does not freeze the picture, which keeps following the output.
  const [headerPinned, setHeaderPinned] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [rect, setRect] = useState<Rect>(savedRect);
  // The latest rectangle, read when a drag or resize ends, so the saved value is the one on screen.
  const latest = useRef(rect);  // The drag and resize in progress: where the pointer started, and the rectangle at that moment.
  const drag = useRef<{ px: number; py: number; start: Rect } | null>(null);
  const resize = useRef<{ corner: Corner; px: number; py: number; start: Rect } | null>(null);

  /** Starts a drag from the header, unless the press was on one of its buttons. */
  const startDrag = (e: PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    drag.current = { px: e.clientX, py: e.clientY, start: rect };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  /** Moves the panel with the pointer, kept on screen so its header can always be reached. */
  const moveDrag = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const x = d.start.x + e.clientX - d.px;
    const y = d.start.y + e.clientY - d.py;
    const next = {
      ...d.start,
      x: Math.min(Math.max(x, 0), window.innerWidth - 120),
      y: Math.min(Math.max(y, 0), window.innerHeight - 48),
    };
    latest.current = next;
    setRect(next);
  };

  const endDrag = () => {
    if (drag.current) saveRect(latest.current);
    drag.current = null;
  };

  const startResize = (corner: Corner, e: PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    resize.current = { corner, px: e.clientX, py: e.clientY, start: rect };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const moveResize = (e: PointerEvent<HTMLSpanElement>) => {
    const r = resize.current;
    if (!r) return;
    const next = resizedRect(r.start, r.corner, e.clientX - r.px, e.clientY - r.py);
    latest.current = next;
    setRect(next);
  };

  const endResize = () => {
    if (resize.current) saveRect(latest.current);
    resize.current = null;
  };

  // The window can change size while the panel is open: the panel is kept on screen, and not larger than the window allows.
  useEffect(() => {
    const onWindowResize = () =>
      setRect((r) => {
        const { w, h } = fitSize(r.w, r.h);
        return { ...clampToScreen(r.x, r.y, w, h), w, h };
      });
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, []);

  const frame: CSSProperties = { left: rect.x, top: rect.y, width: rect.w, height: rect.h };

  return (
    <section
      aria-label="Live preview"
      style={frame}
      className="group fixed z-50 flex flex-col overflow-hidden rounded-xl border border-line/80 bg-panel shadow-2xl shadow-black/40"
    >
      {/* The header is a band of its own, above the picture, so the picture (and its text) never sits under it. */}
      <header
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="flex h-14 shrink-0 cursor-move select-none items-center justify-between gap-3 border-b border-line bg-panel px-3"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <Eye size={16} className="shrink-0 text-accent" aria-hidden />
          <div className="flex min-w-0 flex-col">
            <h2 className="text-[11px] font-semibold tracking-wider text-fg/70 uppercase">Preview</h2>
            <span className="text-[11px] text-fg/60">Live preview</span>
          </div>
          {/* While the projector is paused, the audience keeps the frame on air. Edits show here only, until the projector resumes. */}
          {paused && (
            <span role="status" className="shrink-0 rounded-md border border-accent bg-accent/15 px-2 py-1 text-[10px] font-extrabold tracking-wider text-accent uppercase">
              Projector paused · editing staged
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* The status: a breathing gold badge while the output is live, a steady one while it is paused, a muted one while it is off. */}
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${
              projectorOn && !paused
                ? 'live-breathe border-accent/50 bg-accent/20 text-accent shadow-lg shadow-black/50'
                : projectorOn
                  ? 'border-info/50 bg-info/15 text-info'
                  : 'border-line bg-panel-2/80 text-fg/50'
            }`}
          >
            {projectorOn && !paused && (
              <span className="relative mr-1.5 inline-flex size-2 items-center justify-center" aria-hidden>
                <span className="absolute size-2 animate-ping rounded-full bg-accent" />
                <span className="relative size-2 rounded-full bg-accent" />
              </span>
            )}
            {projectorOn ? (paused ? 'Projector paused' : 'LIVE') : 'OFF'}
          </span>

          <button
            type="button"
            onClick={() => setHeaderPinned((pinned) => !pinned)}
            aria-pressed={headerPinned}
            aria-label="Pin the header"
            title="The header stays above the picture"
            className={headerPinned ? PINNED_ICON : ICON}
          >
            {headerPinned ? <Lock size={15} aria-hidden /> : <Unlock size={15} aria-hidden />}
          </button>
          <button type="button" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Show preview' : 'Hide preview'} title={collapsed ? 'Show preview' : 'Hide preview'} className={ICON}>
            <Minus size={15} aria-hidden />
          </button>
          <button type="button" onClick={() => setUi({ previewOpen: false })} aria-label="Close preview" title="Close preview" className={ICON}>
            <X size={15} aria-hidden />
          </button>
        </div>
      </header>

      {/* The picture sits under the header and keeps its 16:9 shape, centred. It is the projector itself, live, so it matches the output. */}
      {!collapsed && (
        <div className="relative flex min-h-0 flex-1 items-center justify-center [container-type:size]">
          <div className="relative overflow-hidden" style={{ width: 'min(100cqw, calc(100cqh * 16 / 9))', height: 'min(100cqh, calc(100cqw * 9 / 16))' }}>
            <ProjectorView mirror embedded />
          </div>
        </div>
      )}

      {/* One grip per corner: each resizes from that corner, with the edges opposite it held in place. */}
      {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
        <Grip key={corner} corner={corner} onDown={startResize} onMove={moveResize} onUp={endResize} />
      ))}
    </section>
  );
}

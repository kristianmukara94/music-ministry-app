import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { Crosshair, ImagePlus, Loader2, Maximize, Minimize, RotateCcw, Upload } from 'lucide-react';
import { bridge } from '../live/bridge';
import { LOGO_SRC } from '../brand/logo';
import { setChurchProfile } from './profile';
import { CHURCH_NAME_MAX, DEFAULT_MINISTRY_NAME, MINISTRY_NAME_MAX, type ChurchProfile } from './types';
import {
  FRAME_FIT,
  LOGO_ACCEPT,
  ZOOM_MAX,
  ZOOM_MIN,
  autoCenterFrame,
  clampZoom,
  drawLogo,
  exportLogoPng,
  fillFrame,
  loadLogoFile,
  previewLogo,
  type LoadedLogo,
  type LogoFrame,
} from './logoImage';

/** What the save will do with the logo. */
export type LogoChoice =
  | { kind: 'keep' }
  | { kind: 'default' }
  | { kind: 'new'; logo: LoadedLogo; frame: LogoFrame };

const FIELD = 'h-11 w-full rounded-md border border-fg/15 bg-panel-2 px-3 text-sm outline-none focus:border-accent disabled:opacity-60';
const SMALL_BUTTON =
  'flex h-8 items-center gap-1.5 rounded-md border border-fg/15 px-2.5 text-xs font-semibold hover:bg-fg/10 disabled:cursor-not-allowed disabled:opacity-40';
const EDITOR_SIDE = 224;
/** Pixels of an arrow key's pan, as a share of the square. */
const KEY_PAN = 0.02;

const errorText = (err: unknown) => (err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err));

/** The logo on the four backgrounds it will meet: a dark and a light theme, in a round and a square tile. */
function LogoPreviews({ src }: { src: string }) {
  const tiles = [
    { label: 'Dark, round', bg: 'bg-[#0b0d12]', round: true },
    { label: 'Light, round', bg: 'bg-[#f5f3ee]', round: true },
    { label: 'Dark, square', bg: 'bg-[#0b0d12]', round: false },
    { label: 'Light, square', bg: 'bg-[#f5f3ee]', round: false },
  ];
  return (
    <div className="flex flex-col gap-2">
      <span className="eyebrow">Preview</span>
      <div className="grid grid-cols-4 gap-2">
        {tiles.map((tile) => (
          <figure key={tile.label} className="flex flex-col items-center gap-1">
            <div className={`grid size-16 place-items-center overflow-hidden border border-fg/15 ${tile.bg} ${tile.round ? 'rounded-full' : 'rounded-lg'}`}>
              <img src={src} alt="" draggable={false} className="size-full object-contain" />
            </div>
            <figcaption className="text-center text-[10px] leading-tight text-muted">{tile.label}</figcaption>
          </figure>
        ))}
      </div>
      <p className="text-[11px] text-muted">Check the logo is clear on both backgrounds. A logo with a transparent background works best.</p>
    </div>
  );
}

/** The square crop: drag to move, scroll or use the slider to zoom. */
export function LogoCropper({ logo, frame, onFrame, disabled }: { logo: LoadedLogo; frame: LogoFrame; onFrame: (f: LogoFrame) => void; disabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; frame: LogoFrame } | null>(null);
  // The latest frame for the wheel listener, which is added once.
  const frameRef = useRef(frame);
  frameRef.current = frame;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(EDITOR_SIDE * ratio);
    canvas.height = Math.round(EDITOR_SIDE * ratio);
    drawLogo(canvas, logo, frame);
  }, [logo, frame]);

  // Not a React onWheel: that listener is passive, so it could not stop the page scrolling while zooming.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || disabled) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const f = frameRef.current;
      onFrame({ ...f, zoom: clampZoom(f.zoom * Math.exp(-e.deltaY * 0.0015)) });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [disabled, onFrame]);

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, frame };
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const start = drag.current;
    if (!start) return;
    onFrame({
      ...start.frame,
      offsetX: start.frame.offsetX + (e.clientX - start.x) / EDITOR_SIDE,
      offsetY: start.frame.offsetY + (e.clientY - start.y) / EDITOR_SIDE,
    });
  };
  const endDrag = () => {
    drag.current = null;
  };

  // Arrow keys move, + and - zoom. Stopped here, so the arrows never step the projector behind the form.
  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    const moves: Record<string, [number, number]> = { ArrowLeft: [-KEY_PAN, 0], ArrowRight: [KEY_PAN, 0], ArrowUp: [0, -KEY_PAN], ArrowDown: [0, KEY_PAN] };
    const move = moves[e.key];
    if (move) onFrame({ ...frame, offsetX: frame.offsetX + move[0], offsetY: frame.offsetY + move[1] });
    else if (e.key === '+' || e.key === '=') onFrame({ ...frame, zoom: clampZoom(frame.zoom * 1.1) });
    else if (e.key === '-') onFrame({ ...frame, zoom: clampZoom(frame.zoom / 1.1) });
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="flex flex-col gap-3">
      {/* A checkerboard behind the canvas shows which parts of the logo are transparent. */}
      <div
        className="relative mx-auto overflow-hidden rounded-lg border border-fg/20"
        style={{
          width: EDITOR_SIDE,
          height: EDITOR_SIDE,
          backgroundColor: '#e7e5e4',
          backgroundImage:
            'linear-gradient(45deg, #c4c2bf 25%, transparent 25%), linear-gradient(-45deg, #c4c2bf 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #c4c2bf 75%), linear-gradient(-45deg, transparent 75%, #c4c2bf 75%)',
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
        }}
      >
        <canvas
          ref={canvasRef}
          tabIndex={disabled ? -1 : 0}
          role="img"
          aria-label="Logo crop. Drag or use the arrow keys to move it; scroll or press plus and minus to zoom."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
          className="size-full cursor-grab touch-none outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
        />
        {/* The round tile's edge, so the operator sees what the sidebar's circle would cut off. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-full border-2 border-dashed border-accent/70" />
      </div>
      <label className="flex items-center gap-3 text-xs">
        <span className="w-10 font-semibold">Zoom</span>
        <input
          type="range"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={0.01}
          value={frame.zoom}
          disabled={disabled}
          onChange={(e) => onFrame({ ...frame, zoom: Number(e.target.value) })}
          className="flex-1 accent-accent"
        />
        <span className="w-10 text-right tabular-nums text-muted">{Math.round(frame.zoom * 100)}%</span>
      </label>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" className={SMALL_BUTTON} disabled={disabled} onClick={() => onFrame(autoCenterFrame(logo))} title="Trim empty margins and centre the logo">
          <Crosshair size={13} aria-hidden /> Auto-center
        </button>
        <button type="button" className={SMALL_BUTTON} disabled={disabled} onClick={() => onFrame(FRAME_FIT)} title="Show the whole image">
          <Minimize size={13} aria-hidden /> Fit
        </button>
        <button type="button" className={SMALL_BUTTON} disabled={disabled} onClick={() => onFrame(fillFrame(logo))} title="Fill the square, cropping the longer side">
          <Maximize size={13} aria-hidden /> Fill
        </button>
      </div>
    </div>
  );
}

/**
 * The parish name and logo. Used by the first-time setup wizard and by Settings › Parish Profile & Logo. Saving sends the name and,
 * when the logo changed, a square PNG of it.
 */
export function ChurchProfileForm({
  initialName,
  initialMinistry,
  currentLogo,
  submitLabel,
  savingLabel = 'Saving…',
  onSaved,
  requireChange = false,
}: {
  initialName: string;
  /** The saved ministry name, empty when none was set. */
  initialMinistry: string;
  /** The saved custom logo as a data URL, or null when the built-in emblem is in use. */
  currentLogo: string | null;
  submitLabel: string;
  savingLabel?: string;
  onSaved: (profile: ChurchProfile) => void;
  /** True in Settings: the button stays off until something was changed. */
  requireChange?: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [ministry, setMinistry] = useState(initialMinistry);
  const [choice, setChoice] = useState<LogoChoice>({ kind: 'keep' });
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // New initial names (the profile loaded after the form mounted, or a save from another window) replace untouched fields.
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) setName(initialName);
  }, [initialName]);
  const ministryTouched = useRef(false);
  useEffect(() => {
    if (!ministryTouched.current) setMinistry(initialMinistry);
  }, [initialMinistry]);

  // The previews follow the crop. Drawn on the next frame, so a fast drag does not encode a PNG on every pointer move.
  useEffect(() => {
    if (choice.kind !== 'new') return;
    const id = requestAnimationFrame(() => setPreview(previewLogo(choice.logo, choice.frame)));
    return () => cancelAnimationFrame(id);
  }, [choice]);

  const trimmed = name.trim();
  const nameError = trimmed.length > CHURCH_NAME_MAX ? `Use ${CHURCH_NAME_MAX} characters or fewer.` : null;
  const ministryTrimmed = ministry.trim();
  const ministryError = ministryTrimmed.length > MINISTRY_NAME_MAX ? `Use ${MINISTRY_NAME_MAX} characters or fewer.` : null;
  const changed =
    trimmed !== initialName.trim() ||
    ministryTrimmed !== initialMinistry.trim() ||
    choice.kind === 'new' ||
    (choice.kind === 'default' && currentLogo !== null);
  const canSave = trimmed !== '' && !nameError && !ministryError && !saving && !loading && (!requireChange || changed);
  const busy = saving || loading;

  const shownLogo = choice.kind === 'new' ? (preview ?? LOGO_SRC) : choice.kind === 'default' ? LOGO_SRC : (currentLogo ?? LOGO_SRC);
  const usingDefault = choice.kind === 'default' || (choice.kind === 'keep' && currentLogo === null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setLoading(true);
    try {
      const logo = await loadLogoFile(file);
      setPreview(null);
      setChoice({ kind: 'new', logo, frame: autoCenterFrame(logo) });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
      // The same file can be picked again after a change of mind.
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (!busy) void pick(e.dataTransfer.files[0]);
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const logo = choice.kind === 'new' ? await exportLogoPng(choice.logo, choice.frame) : choice.kind === 'default' ? null : undefined;
      const profile = await bridge.church.saveProfile({ name: trimmed, ministry: ministryTrimmed, ...(logo !== undefined ? { logo } : {}) });
      setChurchProfile(profile);
      touched.current = false;
      ministryTouched.current = false;
      setChoice({ kind: 'keep' });
      onSaved(profile);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-bold tracking-wider uppercase">
          Parish / Church Name <span className="text-danger">*</span>
        </span>
        <input
          type="text"
          value={name}
          onChange={(e) => {
            touched.current = true;
            setName(e.target.value);
          }}
          placeholder="e.g. Sto. Niño de Cebu Parish"
          maxLength={CHURCH_NAME_MAX + 20}
          required
          aria-required="true"
          aria-invalid={nameError ? true : undefined}
          disabled={saving}
          className={FIELD}
        />
        <span className={`flex justify-between text-[11px] ${nameError ? 'text-danger' : 'text-muted'}`}>
          <span>{nameError ?? 'Shown in the sidebar, the dashboard header and on lower thirds.'}</span>
          <span className="tabular-nums">
            {trimmed.length} / {CHURCH_NAME_MAX}
          </span>
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-bold tracking-wider uppercase">Ministry Name</span>
        <input
          type="text"
          value={ministry}
          onChange={(e) => {
            ministryTouched.current = true;
            setMinistry(e.target.value);
          }}
          placeholder={`e.g. Charismatic Music Ministry (blank shows "${DEFAULT_MINISTRY_NAME}")`}
          maxLength={MINISTRY_NAME_MAX + 20}
          aria-invalid={ministryError ? true : undefined}
          disabled={saving}
          className={FIELD}
        />
        <span className={`flex justify-between text-[11px] ${ministryError ? 'text-danger' : 'text-muted'}`}>
          <span>{ministryError ?? 'Optional. Shown under the parish name and as the second line of the parish nameplate.'}</span>
          <span className="tabular-nums">
            {ministryTrimmed.length} / {MINISTRY_NAME_MAX}
          </span>
        </span>
      </label>

      <div className="flex flex-col gap-3">
        <span className="text-xs font-bold tracking-wider uppercase">Church Logo</span>
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            {choice.kind === 'new' ? (
              <LogoCropper logo={choice.logo} frame={choice.frame} onFrame={(frame) => setChoice({ ...choice, frame })} disabled={saving} />
            ) : (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                disabled={busy}
                className={`flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition ${
                  dragOver ? 'border-accent bg-accent/10' : 'border-fg/20 hover:border-accent/60 hover:bg-fg/[0.04]'
                } disabled:opacity-60`}
              >
                {loading ? <Loader2 size={28} className="animate-spin text-accent" aria-hidden /> : <ImagePlus size={28} className="text-accent" aria-hidden />}
                <span className="text-sm font-semibold">{loading ? 'Opening image…' : 'Drop the logo here, or click to choose'}</span>
                <span className="text-[11px] text-muted">PNG, JPG, WEBP or SVG, up to 10 MB</span>
              </button>
            )}
            <div className="flex flex-wrap gap-2">
              {choice.kind === 'new' && (
                <button type="button" className={SMALL_BUTTON} onClick={() => fileInput.current?.click()} disabled={busy}>
                  <Upload size={13} aria-hidden /> Choose another
                </button>
              )}
              {choice.kind !== 'keep' && currentLogo !== null && (
                <button type="button" className={SMALL_BUTTON} onClick={() => setChoice({ kind: 'keep' })} disabled={busy}>
                  <RotateCcw size={13} aria-hidden /> Keep current logo
                </button>
              )}
              <button
                type="button"
                className={SMALL_BUTTON}
                onClick={() => setChoice({ kind: 'default' })}
                disabled={busy || usingDefault}
                aria-pressed={usingDefault}
              >
                <img src={LOGO_SRC} alt="" className="size-4 object-contain" /> {usingDefault ? 'Using default APCCMMA emblem' : 'Use Default APCCMMA Emblem'}
              </button>
            </div>
            <input ref={fileInput} type="file" accept={LOGO_ACCEPT} className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
          </div>
          <LogoPreviews src={shownLogo} />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-4">
        {!trimmed && <span className="text-xs text-muted">Enter the parish name to continue.</span>}
        <button
          type="submit"
          disabled={!canSave}
          className="flex h-11 items-center gap-2 rounded-md bg-accent px-6 text-sm font-bold uppercase text-on-accent shadow-md transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving && <Loader2 size={15} className="animate-spin" aria-hidden />}
          {saving ? savingLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}

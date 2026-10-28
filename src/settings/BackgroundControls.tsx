import { useEffect, useRef, useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import { WELCOME_CANVAS_COLOR, backgroundMissing, type BackgroundSettings, type BackgroundType, type ImageFit } from '../../shared/welcome-settings.js';
import { bridge } from '../live/bridge';
import { useMediaFailed } from '../output/mediaStatus';
import type { MediaAsset } from '../media/types';

/**
 * One background's controls: the colour, a picture or a video clip, Fill screen or Show whole picture, Loop, and the shade. The Welcome settings
 * page and the Live screen's Background panel use this same component, each for its own saved background: `value` is that background's
 * settings, and `save` writes a change to it only. So changing one never changes the other.
 */

const SUB = 'text-xs text-stone-400';
const LABEL = 'text-sm font-semibold text-stone-100';
const INPUT = 'rounded-lg border border-stone-800 bg-stone-950 text-sm text-stone-100 outline-none focus:border-amber-500';
const SEG = 'rounded-md px-3 py-1.5 text-[11px] font-bold tracking-wider transition-colors';
const SEG_ON = 'bg-amber-500 text-stone-950 shadow-md shadow-amber-950/40';
const SEG_OFF = 'text-stone-400 hover:text-stone-100';
const SWITCH_OFF = 'border border-stone-700 text-stone-400 hover:text-stone-100';

const TYPE_OPTIONS: { id: BackgroundType; label: string }[] = [
  { id: 'COLOR', label: 'Colour' },
  { id: 'IMAGE', label: 'Image' },
  { id: 'VIDEO', label: 'Video clip' },
];

const FIT_OPTIONS: { id: ImageFit; label: string }[] = [
  { id: 'FILL', label: 'Fill screen' },
  { id: 'FIT', label: 'Show whole picture' },
];

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Runs `run` once the value has settled for a moment, so dragging a colour picker does not save on every move. */
function useSettled(delay = 150) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (run: () => void) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(run, delay);
  };
}

export function BackgroundControls({
  value,
  save,
  previewMissing = false,
  unsetColor = WELCOME_CANVAS_COLOR,
}: {
  /** This background's settings: the Welcome background, or the Live slide background. */
  value: BackgroundSettings;
  /** Saves a change to this background only. */
  save: (patch: Partial<BackgroundSettings>) => Promise<unknown>;
  /** Set when this background's preview could not load its file: the warning then shows here. */
  previewMissing?: boolean;
  /** The colour the surface uses while none is set: the swatch shows it, so it matches what the screen shows. */
  unsetColor?: string;
}) {
  const [library, setLibrary] = useState<MediaAsset[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settle = useSettled();
  const [colorDraft, setColorDraft] = useState<string | null>(null);

  useEffect(() => {
    bridge.media
      .list()
      .then(setLibrary)
      .catch(() => undefined);
  }, []);
  // The saved colour is the truth: once it is saved (or changed elsewhere), the draft is dropped.
  useEffect(() => setColorDraft(null), [value.backgroundColor]);

  const change = (patch: Partial<BackgroundSettings>) => {
    setError(null);
    save(patch).catch((err) => setError(errorText(err)));
  };

  const kind = value.backgroundType === 'VIDEO' ? 'video' : 'image';
  const items = (library ?? []).filter((a) => a.mediaType === kind);
  const missing = previewMissing || backgroundMissing(value, library ? library.map((a) => a.src) : null);
  // A file that is in the library but would not play in the app: this setting's own panel says so.
  const playFailed = useMediaFailed(value.backgroundType === 'COLOR' ? null : value.backgroundUrl);

  /** The setting that keeps the file of a kind: the picture's or the video's. */
  const fileField = (type: BackgroundType): 'imageFile' | 'videoFile' | null => (type === 'IMAGE' ? 'imageFile' : type === 'VIDEO' ? 'videoFile' : null);

  /**
   * Switches the type. Each picture and video keeps its own file, so Video brings back the video last chosen and Image the picture last chosen,
   * and Colour keeps both. The file being left is remembered first.
   */
  const chooseType = (id: BackgroundType) => {
    if (id === 'COLOR') return change({ backgroundType: 'COLOR' });
    const leaving = fileField(value.backgroundType);
    const remembered: Partial<BackgroundSettings> = leaving && value.backgroundUrl ? { [leaving]: value.backgroundUrl } : {};
    const returning = id === 'VIDEO' ? value.videoFile : value.imageFile;
    change({ ...remembered, backgroundType: id, backgroundUrl: returning });
  };

  /** Uses a file of the current kind, and remembers it for that kind. */
  const chooseFile = (src: string | null) => {
    const field = fileField(value.backgroundType);
    change({ backgroundUrl: src, ...(field ? { [field]: src } : {}) });
  };

  /** Imports a file into the Media Library, then uses the newest one of this kind for this background. */
  const importFile = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await bridge.media.importMedia();
      const list = await bridge.media.list();
      setLibrary(list);
      const wanted = list.filter((a) => a.mediaType === kind);
      if (result.imported > 0 && wanted.length > 0) {
        const newest = wanted.reduce((a, b) => (b.id > a.id ? b : a));
        const field = fileField(value.backgroundType);
        await save({ backgroundUrl: newest.src, backgroundType: value.backgroundType, ...(field ? { [field]: newest.src } : {}) });
      }
      if (result.failed.length > 0) setError(`Could not import: ${result.failed.join(', ')}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="Background type" className="inline-flex w-fit flex-wrap gap-1 rounded-lg border border-stone-800 bg-stone-950 p-1">
        {TYPE_OPTIONS.map(({ id, label }) => {
          const on = value.backgroundType === id;
          return (
            <button key={id} type="button" role="radio" aria-checked={on} onClick={() => chooseType(id)} className={`${SEG} ${on ? SEG_ON : SEG_OFF}`}>
              {label}
            </button>
          );
        })}
      </div>

      {value.backgroundType === 'COLOR' ? (
        <label className="flex flex-wrap items-center justify-between gap-3">
          <span className="min-w-0">
            <span className={`block ${LABEL}`}>Colour</span>
            <span className={`block ${SUB}`}>The colour behind the slides or the welcome text. Fills the whole screen.</span>
          </span>
          <input
            type="color"
            aria-label="Background colour picker"
            value={(colorDraft ?? value.backgroundColor ?? unsetColor).toLowerCase()}
            onChange={(e) => {
              const hex = e.target.value.toUpperCase();
              setColorDraft(hex);
              settle(() => change({ backgroundType: 'COLOR', backgroundColor: hex }));
            }}
            className="h-9 w-10 cursor-pointer rounded-md border border-stone-800 bg-stone-950 p-1"
          />
        </label>
      ) : (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => void importFile()}
            disabled={busy}
            className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-stone-700 bg-stone-950 p-5 text-center transition-colors hover:border-amber-500/40 disabled:opacity-40"
          >
            <Upload size={18} className="text-amber-300" aria-hidden />
            <span className="text-sm font-bold text-stone-100">{busy ? 'Importing…' : kind === 'video' ? 'Choose a video file' : 'Choose an image file'}</span>
            <span className={SUB}>The file is copied into the Media Library, so it is kept with the app.</span>
          </button>
          {items.length > 0 && (
            <label className="flex flex-col gap-2">
              <span className={SUB}>Or use a file already in the Media Library</span>
              <select value={value.backgroundUrl ?? ''} onChange={(e) => chooseFile(e.target.value || null)} className={`${INPUT} h-9 max-w-full px-3`}>
                <option value="">None</option>
                {items.map((m) => (
                  <option key={m.id} value={m.src}>
                    {m.filename}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div>
            <div className={LABEL}>Fit on screen</div>
            <p className={`mt-0.5 ${SUB}`}>
              {value.backgroundFit === 'FIT'
                ? 'The whole picture shows, with the colour in the bars.'
                : 'The picture covers the whole screen. Its edges are cropped, and the colour is not seen.'}
            </p>
          </div>
          <div role="radiogroup" aria-label="Fit on screen" className="inline-flex w-fit flex-wrap gap-1 rounded-lg border border-stone-800 bg-stone-950 p-1">
            {FIT_OPTIONS.map(({ id, label }) => {
              const on = value.backgroundFit === id;
              return (
                <button key={id} type="button" role="radio" aria-checked={on} onClick={() => change({ backgroundFit: id })} className={`${SEG} ${on ? SEG_ON : SEG_OFF}`}>
                  {label}
                </button>
              );
            })}
          </div>

          {kind === 'video' && (
            <label className="flex flex-wrap items-center justify-between gap-3">
              <span className="min-w-0">
                <span className={`block ${LABEL}`}>Loop</span>
                <span className={`block ${SUB}`}>On: the clip plays again and again. Off: it plays once and stays on its last frame. The sound is always off.</span>
              </span>
              <button type="button" role="switch" aria-checked={value.videoLoop} onClick={() => change({ videoLoop: !value.videoLoop })} className={`${SEG} ${value.videoLoop ? SEG_ON : SWITCH_OFF}`}>
                {value.videoLoop ? 'Loop on' : 'Loop off'}
              </button>
            </label>
          )}

          <label className="flex flex-wrap items-center justify-between gap-3">
            <span className="min-w-0">
              <span className={`block ${LABEL}`}>Shade behind the text</span>
              <span className={`block ${SUB}`}>A dark shade behind the words, so light pictures and videos do not hide them.</span>
            </span>
            <button type="button" role="switch" aria-checked={value.textShade} onClick={() => change({ textShade: !value.textShade })} className={`${SEG} ${value.textShade ? SEG_ON : SWITCH_OFF}`}>
              {value.textShade ? 'Shade on' : 'Shade off'}
            </button>
          </label>

          {value.backgroundUrl && (
            <button type="button" onClick={() => {
                const field = fileField(value.backgroundType);
                change({ backgroundUrl: null, backgroundType: 'COLOR', ...(field ? { [field]: null } : {}) });
              }} className="flex w-fit shrink-0 items-center gap-1.5 text-[11px] font-bold tracking-wider text-stone-400 uppercase transition-colors hover:text-amber-300">
              <Trash2 size={13} aria-hidden /> Remove background
            </button>
          )}

          {playFailed && !missing && (
            <p role="alert" className="rounded-md border border-amber-500/40 bg-stone-950 px-3 py-2 text-sm text-amber-300">
              {kind === 'video' ? 'This video cannot play' : 'This picture cannot be shown'}: {playFailed}. The screen shows the background colour
              instead. Choose another file.
            </p>
          )}

          {missing && (
            <p role="alert" className="rounded-md border border-amber-500/40 bg-stone-950 px-3 py-2 text-sm text-amber-300">
              The background file is missing, so the screen shows the background colour instead. Choose the file again.
            </p>
          )}
        </div>
      )}

      {error && (
        <div role="alert" className="text-sm text-danger">
          {error}
        </div>
      )}
    </div>
  );
}

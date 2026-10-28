import { useEffect, useState, type ReactNode } from 'react';
import { CheckCircle2, Grid3x3, Monitor, MonitorUp, Presentation, RotateCcw } from 'lucide-react';
import { FADE_MAX_MS, FADE_MIN_MS, SLIDE_FONTS, type ProjectorSettings as Settings } from '../../shared/projector-settings.js';
import { TEXT_FONT_GROUPS, TEXT_FONTS, slideFontCss } from '../../shared/text-style.js';
import { dispatch, useLive } from '../live/store';
import { bridge, type DisplayInfo } from '../live/bridge';
import type { MediaAsset } from '../media/types';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const CARD = 'flex flex-col gap-4 rounded-xl border border-stone-800 bg-stone-900/60 p-5 shadow-lg';
const HEADING = 'text-sm font-black tracking-widest text-stone-100 uppercase';
const SUB = 'text-xs text-stone-400';
/** The app's primary gold button. */
const PRIMARY = 'flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold tracking-wider text-stone-950 uppercase shadow-md shadow-amber-950/40 transition-all hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40';
const SECONDARY = 'flex items-center gap-2 rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-xs font-bold tracking-wider text-stone-200 uppercase transition-colors hover:border-amber-500/40 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40';
const RESET = 'flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-stone-400 uppercase transition-colors hover:text-amber-300';

/** A segmented control: one of the options is lit gold. */
function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { id: T; text: string }[];
  onChange: (id: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1 rounded-lg border border-stone-800 bg-stone-950 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-md px-3 py-1.5 text-[11px] font-bold tracking-wider uppercase transition-colors ${
            value === o.id ? 'border border-amber-500/40 bg-amber-500/20 text-amber-300' : 'border border-transparent text-stone-400 hover:text-stone-200'
          }`}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

/** A switch lit gold when on. */
function GoldSwitch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className="flex items-center gap-2">
      <span className={`relative h-5 w-9 rounded-full border transition ${on ? 'border-amber-400 bg-amber-500' : 'border-stone-700 bg-stone-900'}`}>
        <span className={`absolute top-0.5 size-3.5 rounded-full transition-all ${on ? 'left-[18px] bg-stone-950' : 'left-0.5 bg-stone-400'}`} aria-hidden />
      </span>
    </button>
  );
}

/** One labelled row inside a card: the name and its explanation on the left, the control on the right. */
function Row({ title, detail, children }: { title: string; detail: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-t border-stone-800 pt-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-stone-100">{title}</div>
        <div className={SUB}>{detail}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/**
 * The projector's settings: the display it opens on, its picture, what it shows at startup and between changes,
 * and what it shows when nothing is live. Every change saves at once, so the page is never out of step with the output.
 */
export function ProjectorSettingsPanel() {
  const settings = useLive((s) => s.state.settings);
  const calibration = useLive((s) => s.state.calibration);
  const projectorOn = useLive((s) => s.state.outputs.projector);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  // The display picked in the cards but not yet applied. Applying saves it as the projector's display.
  const [pending, setPending] = useState<number | null>(settings.displayId);
  const [fadeDraft, setFadeDraft] = useState(settings.fadeMs);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadDisplays = () =>
    bridge.displays
      .list()
      .then(setDisplays)
      .catch((err) => setError(errorText(err)));

  useEffect(() => {
    void loadDisplays();
    bridge.media
      .list()
      .then((list) => setMedia(list.filter((m) => m.mediaType === 'image')))
      .catch(() => undefined);
  }, []);

  // A display saved from somewhere else shows in the cards at once.
  useEffect(() => setPending(settings.displayId), [settings.displayId]);
  // The slider follows the saved duration when it changes from somewhere else.
  useEffect(() => setFadeDraft(settings.fadeMs), [settings.fadeMs]);

  /** Saves a change. The live state then carries it to the projector and the preview. */
  const save = (patch: Partial<Settings>) => {
    setError(null);
    bridge.projector.save(patch).catch((err) => setError(errorText(err)));
  };

  const togglePicking = () => dispatch({ type: 'output/toggle', output: 'projector' });

  const identify = () => {
    setError(null);
    setNotice('Numbers are showing on each display for a few seconds.');
    bridge.displays.identify().catch((err) => setError(errorText(err)));
  };

  const chosenMissing = settings.displayId !== null && !displays.some((d) => d.id === settings.displayId);

  return (
    <div className="flex flex-col gap-6">
      {/* Header: the category, the title, and the auto-save note. */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold tracking-[0.2em] text-stone-500 uppercase">Output</div>
          <h1 className="mt-1 text-4xl font-black tracking-wide text-stone-100 uppercase">Projector</h1>
          <p className="mt-2 max-w-xl text-sm text-stone-400">Choose the display the congregation sees, then open or close the projector.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-stone-900/80 px-3 py-1 text-xs font-semibold text-amber-300/90 shadow-sm">
          <CheckCircle2 size={13} aria-hidden /> Changes save automatically
        </span>
      </header>

      {error && <div role="alert" className="rounded-md border border-danger/40 bg-stone-900 px-4 py-2 text-sm text-danger">{error}</div>}
      {notice && !error && <div role="status" className="rounded-md border border-stone-800 bg-stone-900 px-4 py-2 text-sm text-stone-300">{notice}</div>}

      {/* The window toggle: its state, and the one action that changes it. */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-stone-800 bg-stone-900/60 p-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-lg border border-amber-500/30 bg-stone-950 text-amber-300">
            <Monitor size={22} aria-hidden />
          </div>
          <div>
            <span
              className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-bold tracking-wider uppercase ${
                projectorOn ? 'border-amber-500/40 bg-amber-500/20 text-amber-300' : 'border-stone-700 bg-stone-800 text-stone-400'
              }`}
            >
              {projectorOn ? '● Projector open' : '○ Projector closed'}
            </span>
            <p className="mt-1.5 text-sm text-stone-400">Choose a display before opening the projector.</p>
          </div>
        </div>
        <button type="button" onClick={togglePicking} className={PRIMARY}>
          <Presentation size={14} aria-hidden /> {projectorOn ? 'Close projector window' : '► Open projector window'}
        </button>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Picture: the aspect ratio and how the content fits the screen. */}
        <section className={CARD} aria-labelledby="picture-heading">
          <h2 id="picture-heading" className={HEADING}>Picture</h2>
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {([
              ['16:9', '16:9 Widescreen', '1920×1080'],
              ['4:3', '4:3 Standard', '1024×768'],
            ] as const).map(([id, name, size]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={settings.aspect === id}
                onClick={() => save({ aspect: id })}
                className={`flex flex-col items-start gap-0.5 rounded-lg border p-3 text-left transition ${
                  settings.aspect === id ? 'border-amber-400 bg-amber-500/10 text-amber-200' : 'border-stone-800 bg-stone-950/60 text-stone-200 hover:border-stone-600'
                }`}
              >
                <span className="text-sm font-bold">{name}</span>
                <span className="font-mono text-xs text-stone-400">{size}</span>
              </button>
            ))}
          </div>
          <div role="radiogroup" aria-label="Content fit" className="flex flex-col gap-2">
            {([
              ['contain', 'Aspect fit / contain', 'Keeps the proportions, with black bars where the screen does not match.'],
              ['fill', 'Fill / stretch', 'Covers the whole screen. Content is stretched to match.'],
            ] as const).map(([id, name, detail]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={settings.fit === id}
                onClick={() => save({ fit: id })}
                className={`flex items-start gap-3 rounded-lg border p-3 text-left transition ${
                  settings.fit === id ? 'border-amber-400 bg-amber-500/10' : 'border-stone-800 hover:border-stone-600'
                }`}
              >
                <span className={`mt-0.5 size-3.5 shrink-0 rounded-full border-2 ${settings.fit === id ? 'border-amber-400 bg-amber-400' : 'border-stone-500'}`} aria-hidden />
                <span className="flex flex-col">
                  <span className="text-sm font-semibold text-stone-100">{name}</span>
                  <span className={SUB}>{detail}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* Display assignment: the connected screens as cards, and the one that receives the output. */}
        <section className={CARD} aria-labelledby="display-heading">
          <div>
            <h2 id="display-heading" className={HEADING}>Display assignment</h2>
            <p className={SUB}>Pick the physical display that receives congregation output.</p>
          </div>
          <div>
            <div className="text-sm font-semibold text-stone-100">Projector display</div>
            <p className={SUB}>Select one display, then apply the pending assignment.</p>
          </div>
          <div role="radiogroup" aria-label="Projector display" className="grid gap-2">
            {displays.map((d) => {
              const selected = pending === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setPending(d.id)}
                  className={`flex items-start gap-3 rounded-lg border p-3 text-left transition ${
                    selected ? 'border-amber-400 bg-amber-500/10 shadow-md shadow-amber-950/30' : 'border-stone-800 bg-stone-950/60 hover:border-stone-600'
                  }`}
                >
                  <Monitor size={18} className={`mt-0.5 shrink-0 ${selected ? 'text-amber-300' : 'text-stone-400'}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-stone-100">Display {d.index}</span>
                      {d.label && <span className="text-xs text-stone-400">{d.label}</span>}
                      {d.primary && (
                        <span className="rounded border border-stone-600 bg-stone-800 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-stone-300 uppercase">Primary</span>
                      )}
                    </div>
                    <div className="mt-1 font-mono text-xs text-stone-200">
                      {d.width} × {d.height}
                    </div>
                    <div className="font-mono text-[11px] text-stone-500">
                      Position {d.x}, {d.y}
                    </div>
                  </div>
                </button>
              );
            })}
            {displays.length === 0 && <p className={SUB}>No displays were detected.</p>}
          </div>
          {chosenMissing && (
            <p className="text-xs text-amber-400">The chosen display is not connected. The projector uses the automatic choice until it is back.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => save({ displayId: pending })} disabled={pending === settings.displayId} className={PRIMARY}>
              Apply assignment
            </button>
            <button type="button" onClick={() => setPending(null)} className={SECONDARY}>
              Use automatic choice
            </button>
            <button type="button" onClick={identify} className={SECONDARY}>
              <MonitorUp size={14} aria-hidden /> Identify displays
            </button>
          </div>
          <Row title="Fullscreen on the active projector" detail="Off opens a windowed preview of the output instead.">
            <GoldSwitch label="Fullscreen on the active projector" on={settings.fullscreen} onChange={(on) => save({ fullscreen: on })} />
          </Row>
        </section>

        {/* Startup: what the projector shows when its window first opens. */}
        <section className={CARD} aria-labelledby="startup-heading">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="startup-heading" className={HEADING}>Startup</h2>
              <p className={SUB}>Choose what the projector displays when it first opens or after a display reconnects.</p>
            </div>
            <button type="button" onClick={() => save({ startupScreen: 'black' })} className={RESET}>
              <RotateCcw size={12} aria-hidden /> Reset to defaults
            </button>
          </div>
          <Row title="Default startup screen" detail="Choose what appears when the projector window first opens.">
            <Segmented
              label="Default startup screen"
              value={settings.startupScreen}
              options={[
                { id: 'welcome', text: '🏠 Welcome screen' },
                { id: 'black', text: '🌙 Black screen' },
                { id: 'last', text: '🕒 Last content' },
              ]}
              onChange={(startupScreen) => save({ startupScreen })}
            />
          </Row>
        </section>

        {/* Transitions: how projected content changes. */}
        <section className={CARD} aria-labelledby="transitions-heading">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="transitions-heading" className={HEADING}>Transitions</h2>
              <p className={SUB}>Control how projected content changes between slides and passages.</p>
            </div>
            <button
              type="button"
              onClick={() => save({ transitionsOn: true, transitionStyle: 'fade', fadeMs: 500 })}
              className={RESET}
            >
              <RotateCcw size={12} aria-hidden /> Reset to defaults
            </button>
          </div>
          <Row title="Use transitions" detail="Animate changes on the preview and projector when supported.">
            <GoldSwitch label="Use transitions" on={settings.transitionsOn} onChange={(transitionsOn) => save({ transitionsOn })} />
          </Row>
          <Row title="Transition style" detail="How new content arrives.">
            <Segmented
              label="Transition style"
              value={settings.transitionStyle}
              options={[
                { id: 'fade', text: 'Fade' },
                { id: 'slideLeft', text: 'Slide left' },
                { id: 'slideRight', text: 'Slide right' },
                { id: 'slideUp', text: 'Slide up' },
                { id: 'zoomIn', text: 'Zoom in' },
              ]}
              onChange={(transitionStyle) => save({ transitionStyle })}
            />
          </Row>
          <div className="flex flex-col gap-2 border-t border-stone-800 pt-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-stone-100">Transition duration</div>
                <div className={SUB}>From 100ms to 1000ms.</div>
              </div>
              <span className="rounded-full border border-amber-500/30 bg-stone-950 px-2.5 py-1 font-mono text-xs font-semibold text-amber-300 tabular-nums">
                {fadeDraft}ms
              </span>
            </div>
            <input
              type="range"
              min={FADE_MIN_MS}
              max={FADE_MAX_MS}
              step={50}
              value={fadeDraft}
              aria-label="Transition duration in milliseconds"
              onChange={(e) => setFadeDraft(Number(e.target.value))}
              onPointerUp={() => save({ fadeMs: fadeDraft })}
              onKeyUp={() => save({ fadeMs: fadeDraft })}
              onBlur={() => fadeDraft !== settings.fadeMs && save({ fadeMs: fadeDraft })}
              className="h-1.5 w-full cursor-pointer accent-amber-400"
            />
          </div>
        </section>

        {/* Intro slide: the first slide of a Praise & Worship item, as its title card or a solid black screen. */}
        <section className={CARD} aria-labelledby="intro-heading">
          <h2 id="intro-heading" className={HEADING}>Intro slide</h2>
          <Row
            title="First slide of an item"
            detail="The title card at the start of a song or item, or a solid black screen. The Live panel changes this for the item on air."
          >
            <Segmented
              label="Default intro slide"
              value={settings.defaultIntroSlideMode}
              options={[
                { id: 'title', text: 'Title card' },
                { id: 'black', text: 'Solid black' },
              ]}
              onChange={(defaultIntroSlideMode) => save({ defaultIntroSlideMode })}
            />
          </Row>
        </section>

        {/* Slide font: the face for slide text on the projector and the TV. */}
        <section className={`${CARD} lg:col-span-2`} aria-labelledby="font-heading">
          <h2 id="font-heading" className={HEADING}>Slide font</h2>
          <Row
            title="Font for slide text"
            detail="Applies to lyrics, readings, prayers and announcements on the projector and the TV. Keep the current look leaves each slide's own font."
          >
            <select
              aria-label="Slide font"
              value={settings.slideFont ?? ''}
              onChange={(e) => save({ slideFont: e.target.value || null })}
              className="h-10 rounded-lg border border-stone-700 bg-stone-950 px-3 text-sm text-stone-100 outline-none focus:border-amber-400"
            >
              <option value="">Keep the current look</option>
              {TEXT_FONT_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.keys.filter((key) => SLIDE_FONTS.includes(key)).map((key) => (
                    <option key={key} value={key}>
                      {TEXT_FONTS[key].label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Row>
          <p aria-label="Font preview" className="rounded-lg border border-stone-800 bg-stone-950 px-4 py-3 text-2xl text-stone-100" style={{ fontFamily: slideFontCss(settings.slideFont) }}>
            Lord, have mercy on us
          </p>
        </section>

        {/* Idle screen and calibration. */}
        <section className={`${CARD} lg:col-span-2`} aria-labelledby="idle-heading">
          <h2 id="idle-heading" className={HEADING}>Idle screen and calibration</h2>
          <Row title="When nothing is live" detail="What the projector shows between items.">
            <Segmented
              label="Idle screen"
              value={settings.idle}
              options={[
                { id: 'black', text: 'Solid black' },
                { id: 'crest', text: 'Parish crest' },
                { id: 'media', text: 'Custom background' },
              ]}
              onChange={(idle) => save({ idle })}
            />
          </Row>
          {settings.idle === 'media' && (
            <label className="flex flex-col gap-2">
              <span className={SUB}>Image shown while nothing is live</span>
              <select
                value={settings.idleMedia ?? ''}
                onChange={(e) => save({ idleMedia: e.target.value || null })}
                className="h-10 rounded-lg border border-stone-700 bg-stone-950 px-3 text-sm text-stone-100 outline-none focus:border-amber-400"
              >
                <option value="">Choose an image…</option>
                {media.map((m) => (
                  <option key={m.id} value={m.src}>{m.filename}</option>
                ))}
              </select>
              {media.length === 0 && <span className={SUB}>No images in the Media Library yet.</span>}
            </label>
          )}
          <Row title="Calibration grid" detail="Shows a grid on the projector for lining up the picture. Open the projector window first.">
            <button type="button" aria-pressed={calibration} onClick={() => dispatch({ type: 'calibration/toggle' })} className={calibration ? PRIMARY : SECONDARY}>
              <Grid3x3 size={14} aria-hidden /> {calibration ? 'Hide calibration grid' : 'Test calibration grid'}
            </button>
          </Row>
        </section>
      </div>
    </div>
  );
}

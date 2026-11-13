import { useEffect, useState } from 'react';
import { Check, CheckCircle2, Grid3x3, History, House, Monitor, MonitorUp, Moon, Power, PowerOff } from 'lucide-react';
import { PROJECTOR_SETTINGS_DEFAULTS as DEFAULTS, type ProjectorSettings as Settings } from '../../shared/projector-settings.js';
import { dispatch, useLive } from '../live/store';
import { LICENSE_LOCKED_TIP, useProjectionLocked } from '../live/license';
import { bridge, type DisplayInfo } from '../live/bridge';
import type { MediaAsset } from '../media/types';
import { CARD, CardHeader, FOCUS, GoldSwitch, HEADING, Row, SUB, Segmented } from './settingsControls';
import { OutputSettingsPanel } from './OutputSettingsPanel';
import { EdidLockPanel, useEdidStatus } from '../golive/EdidLockBadge';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The app's primary gold button. */
const PRIMARY = `flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-bold tracking-wider whitespace-nowrap text-on-accent uppercase shadow-md shadow-black/40 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none ${FOCUS}`;
const SECONDARY = `flex items-center gap-2 rounded-lg border border-fg/20 bg-panel-2 px-3 py-2 text-xs font-bold tracking-wider whitespace-nowrap text-fg/90 uppercase transition-colors hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS}`;
/**
 * A picture of the output on the chosen display: the screen, and the content inside it. "Aspect fit" leaves bars where
 * the content's shape differs from the screen's, "Fill" stretches it to the edges, so the choice can be seen before it is made.
 */
function PicturePreview({ screen, aspect, fit }: { screen: { width: number; height: number }; aspect: Settings['aspect']; fit: Settings['fit'] }) {
  const [aw, ah] = aspect.split(':').map(Number);
  const content = aw / ah;
  const display = screen.width / screen.height;
  return (
    <figure className="flex flex-col items-center gap-2">
      <div className="flex w-full max-w-xs items-center justify-center overflow-hidden rounded-md border-2 border-fg/25 bg-black" style={{ aspectRatio: `${screen.width} / ${screen.height}` }} role="img" aria-label={`Preview: ${aspect} content, ${fit === 'fill' ? 'stretched to fill' : 'fitted with bars'}, on a ${screen.width} by ${screen.height} display`}>
        <div
          className="grid place-items-center border border-accent/60 bg-accent/15 text-[9px] font-bold tracking-wider text-accent uppercase"
          style={fit === 'fill' ? { width: '100%', height: '100%' } : { aspectRatio: `${aw} / ${ah}`, ...(content > display ? { width: '100%' } : { height: '100%' }) }}
        >
          {aspect}
        </div>
      </div>
      <figcaption className={SUB}>{fit === 'fill' ? 'Content is stretched to the screen edges.' : 'Black bars appear where the shapes differ.'}</figcaption>
    </figure>
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
  const edidStatus = useEdidStatus();
  // The display picked in the cards but not yet applied. Applying saves it as the projector's display.
  const [pending, setPending] = useState<number | null>(settings.displayId);
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
  // A confirmation is read once, then it gets out of the way.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  /** Saves a change. The live state then carries it to the projector and the preview. Resolves true once it is saved. */
  const save = (patch: Partial<Settings>) => {
    setError(null);
    return bridge.projector.save(patch).then(
      () => true,
      (err) => {
        setError(errorText(err));
        return false;
      },
    );
  };

  const togglePicking = () => dispatch({ type: 'output/toggle', output: 'projector' });
  const locked = useProjectionLocked();

  const identify = () => {
    setError(null);
    setNotice('Numbers are showing on each display for a few seconds.');
    bridge.displays.identify().catch((err) => setError(errorText(err)));
  };

  const apply = () => {
    void save({ displayId: pending }).then((ok) => {
      if (!ok) return;
      const chosen = displays.find((d) => d.id === pending);
      setNotice(chosen ? `The projector will use Display ${chosen.index}.` : 'The projector will choose its display automatically.');
    });
  };

  const chosen = displays.find((d) => d.id === settings.displayId);
  const chosenMissing = settings.displayId !== null && !chosen;
  const automatic = settings.displayId === null || chosenMissing;
  const dirty = pending !== settings.displayId;
  // The screen the preview is drawn for: the chosen display, the one being picked, or a 16:9 screen when none is known.
  const previewDisplay = displays.find((d) => d.id === (pending ?? settings.displayId)) ?? displays.find((d) => d.primary) ?? { width: 1920, height: 1080 };
  const target = chosen ? `Display ${chosen.index}` : 'the automatic display';

  const isDefault = <K extends keyof Settings>(...keys: K[]) => keys.every((k) => settings[k] === DEFAULTS[k]);
  const resetTo = (...keys: (keyof Settings)[]) => void save(Object.fromEntries(keys.map((k) => [k, DEFAULTS[k]])) as Partial<Settings>);

  return (
    <div className="flex flex-col gap-6">
      {/* Header: the category, the title, and the auto-save note. */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold tracking-[0.2em] text-faint uppercase">Output</div>
          <h1 className="mt-1 text-4xl leading-tight font-extrabold tracking-tight text-fg xl:text-[44px]">Projector</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">Choose the display the congregation sees, then open or close the projector.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-panel-2/80 px-3 py-1 text-xs font-semibold text-accent/90 shadow-sm">
          <CheckCircle2 size={13} aria-hidden /> Changes save automatically
        </span>
      </header>

      {error && <div role="alert" className="rounded-md border border-danger/40 bg-panel-2 px-4 py-2 text-sm text-danger">{error}</div>}
      {notice && !error && (
        <div role="status" className="flex items-center justify-between gap-3 rounded-md border border-line bg-panel-2 px-4 py-2 text-sm text-fg/80">
          {notice}
        </div>
      )}

      {/* The window toggle: its state, where it shows, and the one action that changes it. */}
      <section aria-label="Projector window" className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-panel-2/60 p-5">
        <div className="flex min-w-0 flex-wrap items-center gap-4">
          <div className={`grid size-12 shrink-0 place-items-center rounded-lg border bg-panel ${projectorOn ? 'border-ok/50 text-ok' : 'border-accent/30 text-accent'}`}>
            <Monitor size={22} aria-hidden />
          </div>
          <div className="min-w-0">
            <span
              role="status"
              className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-xs font-bold tracking-wider uppercase ${
                projectorOn ? 'border-ok/50 bg-ok/15 text-ok' : 'border-fg/20 bg-fg/10 text-fg/70'
              }`}
            >
              <span className={`size-2 rounded-full ${projectorOn ? 'animate-pulse bg-ok' : 'border border-fg/50'}`} aria-hidden />
              {projectorOn ? 'Projector open' : 'Projector closed'}
            </span>
            <p className="mt-1.5 text-sm text-muted">
              {projectorOn ? `Showing on ${target}${chosen ? ` · ${chosen.width} × ${chosen.height}` : ''}.` : `Opens on ${target}. Change the display below first if needed.`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={togglePicking}
          disabled={locked && !projectorOn}
          title={locked && !projectorOn ? LICENSE_LOCKED_TIP : undefined}
          className={projectorOn ? `${SECONDARY} h-10 border-danger/50 text-danger hover:border-danger hover:text-danger` : `${PRIMARY} h-10 disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {projectorOn ? <PowerOff size={14} aria-hidden /> : <Power size={14} aria-hidden />}
          {projectorOn ? 'Close projector window' : 'Open projector window'}
        </button>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Picture: the aspect ratio and how the content fits the screen, with a preview of both. */}
        <section className={CARD} aria-labelledby="picture-heading">
          <CardHeader id="picture-heading" title="Picture" detail="The shape of the content, and how it sits on the screen." onReset={() => resetTo('aspect', 'fit')} resetDisabled={isDefault('aspect', 'fit')} />
          <PicturePreview screen={previewDisplay} aspect={settings.aspect} fit={settings.fit} />
          <div role="radiogroup" aria-label="Aspect ratio" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {([
              ['16:9', '16:9 Widescreen', '1920×1080'],
              ['4:3', '4:3 Standard', '1024×768'],
            ] as const).map(([id, name, size]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={settings.aspect === id}
                onClick={() => void save({ aspect: id })}
                className={`flex flex-col items-start gap-0.5 rounded-lg border p-3 text-left transition ${FOCUS} ${
                  settings.aspect === id ? 'border-accent bg-accent/10 text-accent' : 'border-line bg-panel/60 text-fg/90 hover:border-fg/30'
                }`}
              >
                <span className="text-sm font-bold">{name}</span>
                <span className="font-mono text-xs text-muted">{size}</span>
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
                onClick={() => void save({ fit: id })}
                className={`flex items-start gap-3 rounded-lg border p-3 text-left transition ${FOCUS} ${
                  settings.fit === id ? 'border-accent bg-accent/10' : 'border-line hover:border-fg/30'
                }`}
              >
                <span className={`mt-0.5 size-3.5 shrink-0 rounded-full border-2 ${settings.fit === id ? 'border-accent bg-accent' : 'border-fg/40'}`} aria-hidden />
                <span className="flex flex-col">
                  <span className="text-sm font-semibold text-fg">{name}</span>
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-fg">Projector display</div>
              <p className={SUB}>Select one display, then apply it.</p>
            </div>
            {automatic && <span className="rounded border border-accent/40 bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-accent uppercase">Automatic</span>}
          </div>
          <div role="radiogroup" aria-label="Projector display" className="grid gap-2">
            {displays.map((d) => {
              const selected = pending === d.id;
              const inUse = settings.displayId === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setPending(d.id)}
                  className={`flex items-start gap-3 rounded-lg border p-3 text-left transition ${FOCUS} ${
                    selected ? 'border-accent bg-accent/10 shadow-md shadow-black/30' : 'border-line bg-panel/60 hover:border-fg/30'
                  }`}
                >
                  <Monitor size={18} className={`mt-0.5 shrink-0 ${selected ? 'text-accent' : 'text-muted'}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-fg">Display {d.index}</span>
                      {d.label && <span className="text-xs text-muted">{d.label}</span>}
                      {d.primary && (
                        <span className="rounded border border-fg/30 bg-fg/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-fg/80 uppercase">Primary</span>
                      )}
                      {inUse && (
                        <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-on-accent uppercase">In use</span>
                      )}
                    </div>
                    <div className="mt-1 font-mono text-xs text-fg/90">
                      {d.width} × {d.height}
                    </div>
                    <div className="font-mono text-[11px] text-faint">
                      Position {d.x}, {d.y}
                    </div>
                  </div>
                  {selected && <Check size={16} strokeWidth={3} className="mt-0.5 shrink-0 text-accent" aria-hidden />}
                </button>
              );
            })}
            {displays.length === 0 && <p className={SUB}>No displays were detected. Connect the projector, then choose Identify displays.</p>}
            {displays.length === 1 && <p className={SUB}>Only one display is connected, so the projector opens on it. Connect the projector to show on a second screen.</p>}
          </div>
          {chosenMissing && (
            <p role="status" className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
              The chosen display is not connected. The projector uses the automatic choice until it is back.
            </p>
          )}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={apply} disabled={!dirty} className={PRIMARY}>
                Apply assignment
              </button>
              <button type="button" onClick={() => setPending(null)} disabled={pending === null} className={SECONDARY}>
                Use automatic choice
              </button>
              <button type="button" onClick={identify} className={SECONDARY}>
                <MonitorUp size={14} aria-hidden /> Identify displays
              </button>
            </div>
            <p className={SUB} aria-live="polite">
              {dirty ? 'You have an unapplied choice. Select Apply assignment to use it.' : 'Automatic uses the first external display, or the primary when there is none.'}
            </p>
          </div>
          <Row title="Fullscreen on the active projector" detail="Off opens a windowed preview of the output instead.">
            <GoldSwitch label="Fullscreen on the active projector" on={settings.fullscreen} onChange={(on) => void save({ fullscreen: on })} />
          </Row>
          {/* The hardware lock: once pinned, it overrides the display chosen above, and follows the physical monitor instead. */}
          {bridge.isElectron && (
            <div className="flex flex-col gap-2 border-t border-line pt-4">
              <div>
                <div className="text-sm font-semibold text-fg">Hardware lock (EDID)</div>
                <p className={SUB}>
                  Pins the projector to the physical sanctuary monitor and the graphics port it is plugged into. Once pinned, it overrides the choice above.
                </p>
              </div>
              <EdidLockPanel status={edidStatus} />
            </div>
          )}
        </section>

        {/* Startup: what the projector shows when its window first opens. */}
        <section className={CARD} aria-labelledby="startup-heading">
          <CardHeader
            id="startup-heading"
            title="Startup"
            detail="Choose what the projector displays when it first opens or after a display reconnects."
            onReset={() => resetTo('startupScreen')}
            resetDisabled={isDefault('startupScreen')}
          />
          <Row title="Default startup screen" detail="Choose what appears when the projector window first opens." stacked>
            <Segmented
              label="Default startup screen"
              value={settings.startupScreen}
              options={[
                { id: 'welcome', text: 'Welcome screen', icon: House },
                { id: 'black', text: 'Black screen', icon: Moon },
                { id: 'last', text: 'Last content', icon: History },
              ]}
              onChange={(startupScreen) => void save({ startupScreen })}
            />
          </Row>
        </section>

        {/* Intro slide: the first slide of a Praise & Worship item, as its title card or a solid black screen. */}
        <section className={CARD} aria-labelledby="intro-heading">
          <CardHeader id="intro-heading" title="Intro slide" onReset={() => resetTo('defaultIntroSlideMode')} resetDisabled={isDefault('defaultIntroSlideMode')} />
          <Row
            title="First slide of an item"
            detail="The title card at the start of a song or item, or a solid black screen. The Live panel changes this for the item on air."
            stacked
          >
            <Segmented
              label="Default intro slide"
              value={settings.defaultIntroSlideMode}
              options={[
                { id: 'title', text: 'Title card' },
                { id: 'black', text: 'Solid black' },
              ]}
              onChange={(defaultIntroSlideMode) => void save({ defaultIntroSlideMode })}
            />
          </Row>
        </section>

        {/* Transitions, the background on every slide, the slide text and Advanced mode. */}
        <OutputSettingsPanel settings={settings} save={save} isDefault={isDefault} resetTo={resetTo} />

        {/* Idle screen and calibration. */}
        <section className={`${CARD} lg:col-span-2`} aria-labelledby="idle-heading">
          <CardHeader id="idle-heading" title="Idle screen and calibration" onReset={() => resetTo('idle', 'idleMedia')} resetDisabled={isDefault('idle', 'idleMedia')} />
          <Row title="When nothing is live" detail="What the projector shows between items." stacked>
            <Segmented
              label="Idle screen"
              value={settings.idle}
              options={[
                { id: 'black', text: 'Solid black' },
                { id: 'crest', text: 'Parish crest' },
                { id: 'media', text: 'Custom background' },
              ]}
              onChange={(idle) => void save({ idle })}
            />
          </Row>
          {settings.idle === 'media' && (
            <label className="flex flex-col gap-2">
              <span className={SUB}>Image shown while nothing is live</span>
              <select
                value={settings.idleMedia ?? ''}
                onChange={(e) => void save({ idleMedia: e.target.value || null })}
                className={`h-10 rounded-lg border border-fg/20 bg-panel px-3 text-sm text-fg outline-none focus:border-accent ${FOCUS}`}
              >
                <option value="">Choose an image…</option>
                {media.map((m) => (
                  <option key={m.id} value={m.src}>{m.filename}</option>
                ))}
              </select>
              {media.length === 0 && <span className={SUB}>No images in the Media Library yet.</span>}
              {media.length > 0 && !settings.idleMedia && <span className="text-xs text-accent">Choose an image, or the projector shows black until you do.</span>}
            </label>
          )}
          <Row title="Calibration grid" detail={projectorOn ? 'Shows a grid on the projector for lining up the picture.' : 'Open the projector window first, then show a grid to line up the picture.'}>
            <button
              type="button"
              aria-pressed={calibration}
              disabled={!projectorOn && !calibration}
              onClick={() => dispatch({ type: 'calibration/toggle' })}
              className={calibration ? PRIMARY : SECONDARY}
            >
              <Grid3x3 size={14} aria-hidden /> {calibration ? 'Hide calibration grid' : 'Test calibration grid'}
            </button>
          </Row>
        </section>
      </div>
    </div>
  );
}

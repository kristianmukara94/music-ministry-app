import { useEffect, useState, type ReactNode } from 'react';
import { Camera, CheckCircle2, Copy, Info, Monitor, Plus, RotateCcw } from 'lucide-react';
import { LOWER_THIRD_PRESETS, LOWER_THIRD_RANGES, type LowerThirdStyle } from '../../shared/lower-third-style.js';
import { BACKGROUND_COLORS, TEXT_COLORS, TEXT_FONTS } from '../../shared/text-style.js';
import { bridge, type DisplayInfo } from '../live/bridge';
import { useLive } from '../live/store';
import { LowerThirdStage } from '../output/LowerThirdView';
import { addLowerThirdBrowserSource, loadObsSettings, obs, saveObsSettings, testObsConnection, type ObsSettings, type ObsStatus } from '../obs/obsClient';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const CARD = 'flex flex-col gap-4 rounded-xl border border-line bg-panel-2/60 p-5 shadow-lg';
const HEADING = 'text-[11px] font-semibold tracking-wider text-fg/70 uppercase';
const SUB = 'text-xs text-fg/60';
const PRIMARY = 'flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-bold tracking-wider text-on-accent uppercase shadow-md shadow-black/40 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40';
const SECONDARY = 'flex items-center gap-2 rounded-lg border border-fg/20 bg-panel-2 px-3 py-2 text-xs font-bold tracking-wider text-fg/90 uppercase transition-colors hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40';
const RESET = 'flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-fg/60 uppercase transition-colors hover:text-accent';
const FIELD = 'h-9 rounded-lg border border-fg/20 bg-panel px-3 text-sm text-fg outline-none focus:border-accent';

/** Gold switch, lit when on. */
function GoldSwitch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className="flex shrink-0 items-center">
      <span className={`relative h-5 w-9 rounded-full border transition ${on ? 'border-accent bg-accent' : 'border-fg/20 bg-panel-2'}`}>
        <span className={`absolute top-0.5 size-3.5 rounded-full transition-all ${on ? 'left-[18px] bg-panel' : 'left-0.5 bg-fg/50'}`} aria-hidden />
      </span>
    </button>
  );
}

/** A segmented control with one lit option. */
function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { id: T; text: string }[];
  onChange: (id: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1 rounded-lg border border-line bg-panel p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-md px-3 py-1.5 text-[11px] font-bold tracking-wider uppercase transition-colors ${
            value === o.id ? 'border border-accent/40 bg-accent/20 text-accent' : 'border border-transparent text-fg/60 hover:text-fg/90'
          }`}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

/** A slider that shows its value in a pill. It saves when the operator lets go, so a drag makes one change. */
function Slider({ label, value, range, unit, onCommit }: {
  label: string;
  value: number;
  range: [number, number];
  unit: string;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-fg">{label}</span>
        <span className="rounded-full border border-accent/30 bg-panel px-2.5 py-0.5 font-mono text-xs font-semibold text-accent tabular-nums">
          {draft}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={range[0]}
        max={range[1]}
        step={1}
        value={draft}
        aria-label={label}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="h-1.5 w-full cursor-pointer accent-accent"
      />
    </div>
  );
}

/** A colour: a swatch that opens the native picker, and a hex box that stays in step with it. */
function ColorField({ label, value, presets, onCommit }: {
  label: string;
  value: string;
  presets: { label: string; hex: string }[];
  onCommit: (hex: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const normal = (raw: string) => (/^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toUpperCase() : null);
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold text-fg">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="color"
          value={normal(value) ?? '#000000'}
          aria-label={`${label} picker`}
          onChange={(e) => onCommit(e.target.value.toUpperCase())}
          className="h-9 w-10 cursor-pointer rounded-md border border-fg/20 bg-panel p-1"
        />
        <input
          value={text}
          aria-label={`${label} hex`}
          onChange={(e) => {
            setText(e.target.value);
            const hex = normal(e.target.value);
            if (hex) onCommit(hex);
          }}
          onBlur={() => setText(value)}
          className={`${FIELD} w-28 font-mono uppercase`}
        />
        <div className="flex flex-wrap gap-1">
          {presets.map((p) => (
            <button
              key={p.hex}
              type="button"
              aria-label={`${label} ${p.label}`}
              title={p.label}
              onClick={() => onCommit(p.hex)}
              className={`size-6 rounded-full border ${value.toUpperCase() === p.hex ? 'border-accent' : 'border-fg/30'}`}
              style={{ backgroundColor: p.hex }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** A labelled row: the explanation on the left, the control on the right. */
function Row({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-fg">{title}</div>
        {detail && <div className={SUB}>{detail}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** A callout with an info icon, for the notes that explain a control. */
function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-lg border border-accent/25 bg-accent/5 px-4 py-3 text-xs leading-relaxed text-accent/90">
      <Info size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

/** The sample shown in the live preview. It is a verse, so the look is judged on real text. */
const SAMPLE = { template: 'nameplate' as const, line1: 'For God so loved the world...', line2: 'John 3:16' };

/**
 * Lower 3rd and OBS. The look of the lower third (position, background, type, reference, outline, logo), the window it
 * can open on, a live preview of the look, and the OBS connection. Each change saves at once and reaches the output
 * and the preview straight away.
 */
export function LowerThirdSettings() {
  const style = useLive((s) => s.state.lowerStyle);
  const lowerLive = useLive((s) => s.state.lowerThird.live);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  // The saved display, when it cannot be used: it is the primary display, or it is no longer connected. Not judged until the list has loaded.
  const targetUnusable = style.target !== null && displays.length > 0 && !displays.some((d) => d.id === style.target && !d.primary);
  const [urls, setUrls] = useState<{ local: string; lan: string | null } | null>(null);
  const [conn, setConn] = useState<ObsSettings>(loadObsSettings);
  // The password is only kept while the page is open. It is never written to disk.
  const [password, setPassword] = useState('');
  const [obsStatus, setObsStatus] = useState<ObsStatus>(obs.current);
  const [obsNote, setObsNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => obs.onStatus(setObsStatus), []);

  useEffect(() => {
    bridge.displays
      .list()
      .then(setDisplays)
      .catch(() => undefined);
    bridge.lowerThird
      .info()
      .then((info) => setUrls({ local: info.local, lan: info.lan }))
      .catch(() => undefined);
  }, []);

  /** Saves a change to the look. The live state carries it to the output and the preview. */
  const save = (patch: Partial<LowerThirdStyle>) => {
    setError(null);
    bridge.lowerThird.save(patch).catch((err) => setError(errorText(err)));
  };

  const changeConn = (next: ObsSettings) => {
    setConn(next);
    saveObsSettings(next);
  };

  const connect = () => {
    setError(null);
    setObsNote(null);
    obs.connect(conn, password).catch((err) => setError(errorText(err)));
  };

  const test = () => {
    setError(null);
    setObsNote(null);
    testObsConnection(conn, password)
      .then((answer) => setObsNote(`Connected. ${answer}`))
      .catch((err) => setError(errorText(err)));
  };

  const addToObs = () => {
    if (!urls) return;
    setError(null);
    setObsNote(null);
    addLowerThirdBrowserSource(conn, password, urls.local)
      .then(setObsNote)
      .catch((err) => setError(errorText(err)));
  };

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).catch(() => setError('Could not copy. Select the address and copy it by hand.'));
  };

  const fontOptions = Object.entries(TEXT_FONTS).map(([id, font]) => ({ id, label: font.label }));
  const connected = obsStatus === 'connected';
  const statusLabel = obsStatus === 'connected' ? 'Connected' : obsStatus === 'connecting' ? 'Connecting' : 'Not connected';

  return (
    <div className="flex flex-col gap-6">
      {/* Header, the OBS status banner, and the note that OBS is optional. */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold tracking-[0.2em] text-fg/50 uppercase">Output</div>
          <h1 className="mt-1 text-4xl leading-tight font-extrabold tracking-tight text-fg xl:text-[44px]">Lower 3rd &amp; OBS</h1>
          <p className="mt-2 max-w-xl text-sm text-fg/60">Style the lower 3rd overlay for your stream and connect to OBS.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-panel-2/80 px-3 py-1 text-xs font-semibold text-accent/90 shadow-sm">
          <CheckCircle2 size={13} aria-hidden /> Changes save automatically
        </span>
      </header>

      {error && <div role="alert" className="rounded-md border border-danger/40 bg-panel-2 px-4 py-2 text-sm text-danger">{error}</div>}
      {obsNote && !error && <div role="status" className="rounded-md border border-line bg-panel-2 px-4 py-2 text-sm text-fg/80">{obsNote}</div>}

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-panel-2/60 p-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-lg border border-accent/30 bg-panel text-accent">
            <Camera size={22} aria-hidden />
          </div>
          <div>
            <span
              className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-bold tracking-wider uppercase ${
                connected ? 'border-accent/40 bg-accent/20 text-accent' : 'border-fg/20 bg-fg/10 text-fg/60'
              }`}
            >
              {connected ? '● Connected' : '○ Not connected'}
            </span>
            <p className="mt-1.5 text-sm text-fg/60">Optional connection at {conn.address}:{conn.port}</p>
          </div>
        </div>
        <button type="button" onClick={connect} disabled={connected || obsStatus === 'connecting'} className={PRIMARY}>
          Connect
        </button>
      </section>

      <Callout>
        <span className="font-bold text-accent">Connecting to OBS is optional:</span> the browser source works without it. Connect when you want the app to add the lower 3rd to OBS or control OBS.
      </Callout>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="flex min-w-0 flex-col gap-6">
          {/* Lower 3rd in OBS: the browser source addresses, and the one action that adds it. */}
          <section className={CARD} aria-labelledby="obs-source-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="obs-source-heading" className={HEADING}>Lower 3rd in OBS</h2>
              <span className="rounded-full border border-accent/40 bg-accent/15 px-2.5 py-0.5 text-[11px] font-bold tracking-wider text-accent uppercase">● Ready for OBS</span>
            </div>
            {(['Local URL', 'LAN network URL'] as const).map((label, i) => {
              const value = i === 0 ? urls?.local ?? '' : urls?.lan ?? '';
              return (
                <label key={label} className="flex flex-col gap-1.5">
                  <span className="text-xs font-bold tracking-wider text-fg/60 uppercase">{label}</span>
                  <div className="flex flex-wrap gap-2">
                    <input readOnly value={value || 'Not available: no network connection found'} aria-label={label} className={`${FIELD} min-w-[12rem] flex-1 font-mono text-xs`} />
                    <button type="button" onClick={() => copy(value)} disabled={!value} className={SECONDARY}>
                      <Copy size={13} aria-hidden /> Copy
                    </button>
                  </div>
                </label>
              );
            })}
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={addToObs} disabled={!urls} className={PRIMARY}>
                <Plus size={14} aria-hidden /> Add to OBS
              </button>
              <span className={SUB}>Adds a browser source named APCCMMA Lower Third to the scene OBS is showing.</span>
            </div>
          </section>

          {/* Window target: no window (for OBS only), or a display. */}
          <section className={CARD} aria-labelledby="target-heading">
            <div>
              <h2 id="target-heading" className={HEADING}>Lower 3rd window</h2>
              <p className={SUB}>An extra screen for the lower third, such as a second projector or a stream monitor. It never opens on the primary display, where this console runs.</p>
            </div>
            <div role="radiogroup" aria-label="Lower third window" className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
              <button
                type="button"
                role="radio"
                aria-checked={style.target === null}
                onClick={() => save({ target: null })}
                className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition ${
                  style.target === null ? 'border-accent bg-accent/10' : 'border-line bg-panel/60 hover:border-fg/30'
                }`}
              >
                <span className="text-sm font-bold text-fg">No window</span>
                <span className="text-[11px] text-fg/60">OBS browser source only</span>
                {style.target === null && <span className="mt-1 rounded border border-accent/40 bg-accent/20 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-accent uppercase">Selected</span>}
              </button>
              {displays.map((d) => {
                const selected = style.target === d.id && !d.primary;
                return (
                  <button
                    key={d.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-disabled={d.primary || undefined}
                    disabled={d.primary}
                    title={d.primary ? 'This is the primary display, where the console runs. The lower third window never opens here.' : undefined}
                    onClick={() => save({ target: d.id })}
                    className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition ${
                      d.primary ? 'cursor-not-allowed border-line bg-panel/40 opacity-60' : selected ? 'border-accent bg-accent/10' : 'border-line bg-panel/60 hover:border-fg/30'
                    }`}
                  >
                    <span className="flex items-center gap-2 text-sm font-bold text-fg">
                      <Monitor size={14} aria-hidden /> Display {d.index}
                    </span>
                    <span className="font-mono text-[11px] text-fg/60">
                      {d.width} × {d.height}
                    </span>
                    {d.primary && <span className="rounded border border-fg/30 bg-fg/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-fg/80 uppercase">Console screen · not available</span>}
                    {selected && <span className="mt-1 rounded border border-accent/40 bg-accent/20 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-accent uppercase">Selected</span>}
                  </button>
                );
              })}
            </div>
            {targetUnusable && (
              <p role="alert" className="flex gap-3 rounded-lg border border-warn/50 bg-warn/10 px-4 py-3 text-xs leading-relaxed text-warn">
                <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
                <span>The display saved for the Lower 3rd window is the primary display, or is not connected, so no window opens. The lower third still shows on the projector and in the OBS browser source. Choose another display, or No window.</span>
              </p>
            )}
            <Callout>Changes apply right away, even while the Lower 3rd is on. The OBS browser source keeps showing it.</Callout>
          </section>

          {/* Presets: one click sets a whole look. The window target is kept. */}
          <section className={CARD} aria-labelledby="presets-heading">
            <h2 id="presets-heading" className={HEADING}>Style presets</h2>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
              {(Object.entries(LOWER_THIRD_PRESETS) as [keyof typeof LOWER_THIRD_PRESETS, (typeof LOWER_THIRD_PRESETS)[keyof typeof LOWER_THIRD_PRESETS]][]).map(([id, preset]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => save({ ...preset.values })}
                  className="flex flex-col items-start gap-1 rounded-lg border border-line bg-panel/60 p-3 text-left transition hover:border-accent/40 hover:bg-fg/10"
                >
                  <span className="text-sm font-bold text-fg">{preset.label}</span>
                  <span className="text-[11px] leading-snug text-fg/60">{preset.description}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Position and size. */}
          <section className={CARD} aria-labelledby="position-heading">
            <div className="flex items-start justify-between gap-3">
              <h2 id="position-heading" className={HEADING}>Position &amp; size</h2>
              <button type="button" onClick={() => save({ position: 'bottom', offset: 0, width: 100, padding: 20, radius: 0 })} className={RESET}>
                <RotateCcw size={12} aria-hidden /> Reset to defaults
              </button>
            </div>
            <Row title="Bar position" detail="Bottom sits above the lower edge; top sits below the upper edge.">
              <Segmented label="Bar position" value={style.position} options={[{ id: 'bottom', text: 'Bottom' }, { id: 'top', text: 'Top' }]} onChange={(position) => save({ position })} />
            </Row>
            <Slider label="Vertical offset" value={style.offset} range={LOWER_THIRD_RANGES.offset} unit="px" onCommit={(offset) => save({ offset })} />
            <Slider label="Overlay width" value={style.width} range={LOWER_THIRD_RANGES.width} unit="%" onCommit={(width) => save({ width })} />
            <Slider label="Padding" value={style.padding} range={LOWER_THIRD_RANGES.padding} unit="px" onCommit={(padding) => save({ padding })} />
            <Slider label="Corner radius" value={style.radius} range={LOWER_THIRD_RANGES.radius} unit="px" onCommit={(radius) => save({ radius })} />
          </section>

          {/* Background. */}
          <section className={CARD} aria-labelledby="background-heading">
            <h2 id="background-heading" className={HEADING}>Background</h2>
            <ColorField label="Background color" value={style.bgColor} presets={BACKGROUND_COLORS} onCommit={(bgColor) => save({ bgColor })} />
            <Slider label="Background opacity" value={style.bgOpacity} range={LOWER_THIRD_RANGES.bgOpacity} unit="%" onCommit={(bgOpacity) => save({ bgOpacity })} />
          </section>

          {/* Text typography. */}
          <section className={CARD} aria-labelledby="type-heading">
            <h2 id="type-heading" className={HEADING}>Text typography</h2>
            <Row title="Font family">
              <select value={style.fontFamily} aria-label="Font family" onChange={(e) => save({ fontFamily: e.target.value })} className={`${FIELD} min-w-48`}>
                {fontOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Row>
            <ColorField label="Text color" value={style.textColor} presets={TEXT_COLORS} onCommit={(textColor) => save({ textColor })} />
            <Slider label="Font size" value={style.fontSize} range={LOWER_THIRD_RANGES.fontSize} unit="px" onCommit={(fontSize) => save({ fontSize })} />
            <Row title="Text alignment">
              <Segmented
                label="Text alignment"
                value={style.align}
                options={[
                  { id: 'left', text: 'Left' },
                  { id: 'center', text: 'Center' },
                  { id: 'right', text: 'Right' },
                ]}
                onChange={(align) => save({ align })}
              />
            </Row>
            <Row title="Bold text with depth" detail="Heavier type with a soft shadow beneath it.">
              <GoldSwitch label="Bold text with depth" on={style.boldDepth} onChange={(boldDepth) => save({ boldDepth })} />
            </Row>
          </section>

          {/* Text effects. */}
          <section className={CARD} aria-labelledby="effects-heading">
            <h2 id="effects-heading" className={HEADING}>Text effects</h2>
            <Row title="Text outline">
              <GoldSwitch label="Text outline" on={style.outline} onChange={(outline) => save({ outline })} />
            </Row>
            <Slider label="Outline width" value={style.outlineWidth} range={LOWER_THIRD_RANGES.outlineWidth} unit="px" onCommit={(outlineWidth) => save({ outlineWidth })} />
            <ColorField label="Outline color" value={style.outlineColor} presets={BACKGROUND_COLORS} onCommit={(outlineColor) => save({ outlineColor })} />
            <Row title="Drop shadow">
              <GoldSwitch label="Drop shadow" on={style.shadow} onChange={(shadow) => save({ shadow })} />
            </Row>
          </section>

          {/* Reference styling. */}
          <section className={CARD} aria-labelledby="reference-heading">
            <h2 id="reference-heading" className={HEADING}>Reference styling</h2>
            <Row title="Show reference separately" detail="Off folds the reference into the main text.">
              <GoldSwitch label="Show reference separately" on={style.showReference} onChange={(showReference) => save({ showReference })} />
            </Row>
            <Row title="Reference position">
              <Segmented
                label="Reference position"
                value={style.refPosition}
                options={[
                  { id: 'left', text: 'Left' },
                  { id: 'center', text: 'Center' },
                  { id: 'right', text: 'Right' },
                ]}
                onChange={(refPosition) => save({ refPosition })}
              />
            </Row>
            <Slider label="Reference size" value={style.refSize} range={LOWER_THIRD_RANGES.refSize} unit="%" onCommit={(refSize) => save({ refSize })} />
            <ColorField label="Reference color" value={style.refColor} presets={TEXT_COLORS} onCommit={(refColor) => save({ refColor })} />
            <Row title="Reference background">
              <GoldSwitch label="Reference background" on={style.refBackground} onChange={(refBackground) => save({ refBackground })} />
            </Row>
            <ColorField label="Reference background color" value={style.refBgColor} presets={BACKGROUND_COLORS} onCommit={(refBgColor) => save({ refBgColor })} />
            <Slider label="Reference background opacity" value={style.refBgOpacity} range={LOWER_THIRD_RANGES.refBgOpacity} unit="%" onCommit={(refBgOpacity) => save({ refBgOpacity })} />
          </section>

          {/* Logo overlay. */}
          <section className={CARD} aria-labelledby="logo-heading">
            <h2 id="logo-heading" className={HEADING}>Logo overlay</h2>
            <Row title="Show logo" detail="Shows the parish crest at the start of each lower third.">
              <GoldSwitch label="Show logo" on={style.showLogo} onChange={(showLogo) => save({ showLogo })} />
            </Row>
          </section>

          {/* OBS WebSocket connection. */}
          <section className={CARD} aria-labelledby="ws-heading">
            <h2 id="ws-heading" className={HEADING}>OBS WebSocket connection</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_8rem]">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold tracking-wider text-fg/60 uppercase">Address</span>
                <input value={conn.address} onChange={(e) => changeConn({ ...conn, address: e.target.value })} className={`${FIELD} font-mono`} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold tracking-wider text-fg/60 uppercase">Port</span>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={conn.port}
                  onChange={(e) => changeConn({ ...conn, port: Number(e.target.value) })}
                  className={`${FIELD} font-mono`}
                />
              </label>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold tracking-wider text-fg/60 uppercase">Password (optional)</span>
              <input
                type="password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave empty if OBS has no password"
                className={FIELD}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={test} className={SECONDARY}>
                Test connection
              </button>
              <button type="button" onClick={connect} disabled={connected || obsStatus === 'connecting'} className={PRIMARY}>
                Connect
              </button>
              <span className="self-center text-xs text-fg/60">{statusLabel}</span>
            </div>
            <Callout>In OBS, enable WebSocket server in Tools, then match the address, port, and password here.</Callout>
          </section>
        </div>

        {/* Live preview: sticky on a wide screen, so it stays beside the controls as they are changed. */}
        <aside className="flex flex-col gap-3 xl:sticky xl:top-4 xl:self-start">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[11px] font-semibold tracking-wider text-fg/70 uppercase">Live preview</h2>
              <p className={SUB}>This mirrors the lower 3rd output styling.</p>
            </div>
            <span className="shrink-0 rounded-full border border-accent/40 bg-accent/15 px-2 py-0.5 text-[10px] font-bold tracking-wider text-accent uppercase">
              Updates in real time
            </span>
          </div>
          <div className="relative aspect-video w-full max-w-full overflow-hidden rounded-lg border border-accent/30 bg-gradient-to-br from-fg/10 to-panel [container-type:inline-size]">
            <div className="absolute inset-0 flex items-center justify-center text-xs tracking-widest text-fg/40 uppercase">Screen</div>
            <LowerThirdStage value={{ ...SAMPLE, template: SAMPLE.template }} />
          </div>
          <p className="text-[11px] text-fg/50">
            {lowerLive ? 'A lower third is on the output now.' : 'Nothing is on the output. The preview uses sample text.'}
          </p>
        </aside>
      </div>
    </div>
  );
}

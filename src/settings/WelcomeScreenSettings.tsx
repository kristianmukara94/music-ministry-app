import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Megaphone,
  Plus,
  RotateCcw,
  Timer,
  Trash2,
  Type,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import {
  COUNTDOWN_DEFAULTS,
  COUNTDOWN_DURATION_MAX,
  COUNTDOWN_DURATION_MIN,
  COUNTDOWN_LABEL_MAX,
  WELCOME_DEFAULTS,
  WELCOME_DWELLS,
  WELCOME_DWELL_DEFAULT,
  WELCOME_FONT_MAX,
  WELCOME_FONT_MIN,
  WELCOME_FONT_STACKS,
  WELCOME_MESSAGE_MAX,
  WELCOME_SCRIM_MAX,
  WELCOME_SLIDES_MAX,
  WELCOME_STYLE_DEFAULTS,
  WELCOME_TITLE_MAX,
  WELCOME_TYPOGRAPHY_DEFAULTS,
  carouselPosition,
  formatCountdown,
  sanitizeWelcomeSettings,
  type CountdownMode,
  type CountdownOnZero,
  type ImageFit,
  type WelcomeCountdown,
  type WelcomeDwell,
  type WelcomeFont,
  type WelcomeSettings,
  type WelcomeShadow,
  type WelcomeSlide,
  type WelcomeSlideType,
} from '../../shared/welcome-settings.js';
import { bridge } from '../live/bridge';
import { useLive } from '../live/store';
import type { MediaAsset } from '../media/types';
import { WelcomeCanvas, type WelcomeAnchor } from '../output/WelcomeScreen';
import { BackgroundControls } from './BackgroundControls';

const CARD = 'flex flex-col gap-5 rounded-xl border border-line bg-panel-2 p-6 shadow-lg';
const CARD_TITLE = 'text-base font-bold tracking-tight text-fg';
const SUB = 'text-xs text-muted';
const LABEL = 'text-sm font-semibold text-fg';
const FOCUS = 'focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none';
const INPUT = 'rounded-lg border border-line bg-panel text-sm text-fg outline-none focus:border-accent';
const RESET = `flex shrink-0 items-center gap-1.5 text-[11px] font-bold tracking-wider text-muted uppercase transition-colors hover:text-accent disabled:opacity-40 ${FOCUS}`;
const ICON_BUTTON = `flex size-8 items-center justify-center rounded-md border border-line bg-panel text-fg/70 transition-colors hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-30 ${FOCUS}`;
const HEX = /^#[0-9a-fA-F]{6}$/;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const newSlideId = () => `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const IMAGE_FIT_OPTIONS: { id: ImageFit; label: string }[] = [
  { id: 'FILL', label: 'Fill screen' },
  { id: 'FIT', label: 'Show whole picture' },
];
const SLIDE_TYPES: { id: WelcomeSlideType; label: string; icon: LucideIcon }[] = [
  { id: 'TEXT', label: 'Text Message', icon: Type },
  { id: 'IMAGE', label: 'Image', icon: ImageIcon },
  { id: 'ANNOUNCEMENT', label: 'Announcement Card', icon: Megaphone },
];
const dwellLabel = (d: WelcomeDwell) => (d === 0 ? 'Manual Step' : `${d}s`);
const FONT_OPTIONS: { id: WelcomeFont; label: string }[] = [
  { id: 'INTER', label: 'Inter (Default)' },
  { id: 'CINZEL', label: 'Cinzel / Liturgical Serif' },
  { id: 'ROBOTO', label: 'Roboto' },
  { id: 'CLASSIC', label: 'Cormorant (Classic)' },
];
const SHADOW_OPTIONS: { id: WelcomeShadow; label: string }[] = [
  { id: 'NONE', label: 'None' },
  { id: 'SOFT', label: 'Soft Drop Shadow' },
  { id: 'OUTLINE', label: 'Hard Outline' },
];
const MODE_OPTIONS: { id: CountdownMode; label: string }[] = [
  { id: 'TARGET', label: 'Target Start Time' },
  { id: 'DURATION', label: 'Countdown Duration' },
];
const ON_ZERO_OPTIONS: { id: CountdownOnZero; label: string; hint: string }[] = [
  { id: 'HOLD', label: 'Hold on 00:00', hint: 'The timer stays on screen reading 00:00.' },
  { id: 'FADE', label: 'Fade to Black', hint: 'The whole welcome screen fades to black over two seconds.' },
  { id: 'CLEAR', label: 'Auto-Clear Background', hint: 'The timer and the background picture or video go; the slides stay over the plain colour.' },
];
const DURATION_PRESETS = [5, 10, 15, 30];

/**
 * A value the operator types or drags. It shows at once (in the field and, through `onLive`, in the preview), and saves a moment after the
 * last change, so a save coming back from the main process never overwrites a change still being made.
 */
function useDraft<T>(stored: T, save: (value: T) => void, delay = 150, onLive?: (value: T) => void) {
  const [draft, setDraft] = useState(stored);
  const timer = useRef<number | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (timer.current === null) setDraft(stored);
  }, [stored]);
  const change = (value: T) => {
    setDraft(value);
    onLive?.(value);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      saveRef.current(value);
    }, delay);
  };
  return [draft, change] as const;
}

/** The time, refreshed a few times a second. */
function useNow(ms = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/** A card header: the title and subtitle on the left, and the reset button on the right, over a rule. */
function CardHeader({ id, title, subtitle, onReset, action }: { id: string; title: string; subtitle: string; onReset?: () => void; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line pb-4">
      <div className="min-w-0">
        <h2 id={id} className={CARD_TITLE}>{title}</h2>
        <p className={`mt-1 ${SUB}`}>{subtitle}</p>
      </div>
      {action}
      {onReset && (
        <button type="button" onClick={onReset} className={RESET}>
          <RotateCcw size={13} aria-hidden /> Reset to defaults
        </button>
      )}
    </div>
  );
}

/** One setting: its label and hint on the left, its control on the right. `stacked` puts a wide control on its own line. */
function SettingRow({ label, hint, children, stacked = false }: { label: string; hint: string; children: ReactNode; stacked?: boolean }) {
  return (
    <div className={stacked ? 'flex flex-col gap-2.5' : 'flex flex-wrap items-center justify-between gap-3'}>
      <div className="min-w-0">
        <div className={LABEL}>{label}</div>
        <p className={`mt-0.5 ${SUB}`}>{hint}</p>
      </div>
      <div className={stacked ? 'flex flex-wrap items-center gap-2' : 'flex shrink-0 items-center gap-2'}>{children}</div>
    </div>
  );
}

/** A segmented choice: the chosen option is filled gold. */
function Choice<T extends string | number>({ label, value, options, onChange, size = 'md' }: {
  label: string;
  value: T;
  options: { id: T; label: string; icon?: LucideIcon; style?: CSSProperties }[];
  onChange: (id: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-fit flex-wrap gap-1 rounded-lg border border-line bg-panel p-1">
      {options.map(({ id, label: text, icon: Icon, style }) => {
        const on = value === id;
        return (
          <button
            key={String(id)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(id)}
            style={style}
            className={`flex items-center gap-1.5 rounded-md font-bold tracking-wide transition-colors ${FOCUS} ${size === 'sm' ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-[11px]'} ${
              on ? 'bg-accent text-on-accent shadow-md shadow-black/40' : 'text-muted hover:text-fg'
            }`}
          >
            {Icon && <Icon size={13} aria-hidden />} {text}
          </button>
        );
      })}
    </div>
  );
}

/** A switch lit gold when on. */
function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`flex items-center gap-2 rounded-full ${FOCUS}`}>
      <span className={`relative h-5 w-9 rounded-full border transition ${on ? 'border-accent bg-accent' : 'border-fg/20 bg-panel'}`}>
        <span className={`absolute top-0.5 size-3.5 rounded-full transition-all ${on ? 'left-[18px] bg-panel' : 'left-0.5 bg-fg/50'}`} aria-hidden />
      </span>
      <span className="w-6 text-[11px] font-bold tracking-wider text-fg/70 uppercase">{on ? 'On' : 'Off'}</span>
    </button>
  );
}

/** A text box that shows each keystroke in the preview at once and saves a moment after the last one. */
function DraftText({ label, value, max, rows, placeholder, onLive, onSave }: {
  label: string;
  value: string;
  max: number;
  rows?: number;
  placeholder?: string;
  onLive: (text: string) => void;
  onSave: (text: string) => void;
}) {
  const [draft, change] = useDraft(value, onSave, 350, onLive);
  return rows ? (
    <textarea aria-label={label} value={draft} maxLength={max} rows={rows} placeholder={placeholder} onChange={(e) => change(e.target.value)} className={`${INPUT} w-full resize-y p-3`} />
  ) : (
    <input aria-label={label} value={draft} maxLength={max} placeholder={placeholder} onChange={(e) => change(e.target.value)} className={`${INPUT} h-9 w-full px-3`} />
  );
}

/** A colour: a swatch to pick with, and a hex box to type into. Only a complete hex value is saved. */
function ColorRow({ label, hint, value, onSave }: { label: string; hint: string; value: string; onSave: (hex: string) => void }) {
  const [draft, change] = useDraft(value, (hex) => {
    if (HEX.test(hex)) onSave(hex.toUpperCase());
  });
  return (
    <SettingRow label={label} hint={hint}>
      <input type="color" value={value.toLowerCase()} aria-label={`${label} picker`} onChange={(e) => onSave(e.target.value.toUpperCase())} className="h-9 w-10 cursor-pointer rounded-md border border-line bg-panel p-1" />
      <input value={draft} maxLength={7} aria-label={`${label} hex`} onChange={(e) => change(e.target.value)} className={`${INPUT} h-9 w-28 px-3 font-mono uppercase`} />
    </SettingRow>
  );
}

/** A slider with its value in a pill. It moves the preview as it is dragged, and saves once it is still. */
function SliderRow({ label, hint, value, min, max, unit, onLive, onSave }: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onLive: (n: number) => void;
  onSave: (n: number) => void;
}) {
  const [draft, change] = useDraft(value, onSave, 200, onLive);
  return (
    <SettingRow label={label} hint={hint}>
      <input type="range" min={min} max={max} step={1} value={draft} aria-label={label} onChange={(e) => change(Number(e.target.value))} className="w-40 accent-accent" />
      <output aria-label={`${label} value`} className="min-w-[4.5rem] rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-center font-mono text-xs font-bold text-accent">
        {draft}
        {unit}
      </output>
    </SettingRow>
  );
}

/** One slide in the queue: a header to select and reorder it, and its editor while it is selected. */
function SlideItem({ slide, index, count, selected, images, busy, onSelect, onChange, onLive, onMove, onDelete, onImport }: {
  slide: WelcomeSlide;
  index: number;
  count: number;
  selected: boolean;
  images: MediaAsset[];
  busy: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<WelcomeSlide>) => void;
  onLive: (patch: Partial<WelcomeSlide>) => void;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
  onImport: () => void;
}) {
  const kind = SLIDE_TYPES.find((t) => t.id === slide.type) ?? SLIDE_TYPES[0];
  const Icon = kind.icon;
  const summary =
    slide.type === 'IMAGE'
      ? images.find((m) => m.src === slide.imageUrl)?.filename ?? (slide.imageUrl ? 'Picture' : 'No picture chosen')
      : (slide.type === 'ANNOUNCEMENT' && slide.title) || slide.text.split('\n')[0] || 'Empty slide';
  return (
    <li className={`rounded-lg border transition-colors ${selected ? 'border-accent/50 bg-accent/[0.04]' : 'border-line bg-panel/60'}`}>
      <div className="flex flex-wrap items-center gap-2 p-2.5">
        <button type="button" onClick={onSelect} aria-expanded={selected} className={`flex min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-0.5 text-left ${FOCUS}`}>
          <span className={`flex size-7 shrink-0 items-center justify-center rounded-md font-mono text-xs font-bold ${selected ? 'bg-accent text-on-accent' : 'bg-panel-2 text-fg/70'}`}>{index + 1}</span>
          <Icon size={15} className="shrink-0 text-accent" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-fg">{summary}</span>
            <span className="block text-[11px] text-faint">{kind.label}</span>
          </span>
        </button>
        <Choice size="sm" label={`Slide ${index + 1} dwell time`} value={slide.dwell} options={WELCOME_DWELLS.map((d) => ({ id: d, label: dwellLabel(d) }))} onChange={(dwell) => onChange({ dwell })} />
        <div className="flex items-center gap-1">
          <button type="button" aria-label={`Move slide ${index + 1} up`} disabled={index === 0} onClick={() => onMove(-1)} className={ICON_BUTTON}>
            <ArrowUp size={14} aria-hidden />
          </button>
          <button type="button" aria-label={`Move slide ${index + 1} down`} disabled={index === count - 1} onClick={() => onMove(1)} className={ICON_BUTTON}>
            <ArrowDown size={14} aria-hidden />
          </button>
          <button type="button" aria-label={`Delete slide ${index + 1}`} onClick={onDelete} className={`${ICON_BUTTON} hover:border-danger/50 hover:text-danger`}>
            <Trash2 size={14} aria-hidden />
          </button>
        </div>
      </div>

      {selected && (
        <div className="flex flex-col gap-4 border-t border-line p-4">
          <SettingRow label="Slide type" hint="What this slide shows." stacked>
            <Choice label="Slide type" value={slide.type} options={SLIDE_TYPES.map(({ id, label, icon }) => ({ id, label, icon }))} onChange={(type) => onChange({ type })} />
          </SettingRow>

          {slide.type === 'IMAGE' ? (
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={onImport}
                disabled={busy}
                className={`flex items-center justify-center gap-2 rounded-lg border border-dashed border-fg/20 bg-panel p-4 text-sm font-bold text-fg transition-colors hover:border-accent/40 disabled:opacity-40 ${FOCUS}`}
              >
                <Upload size={16} className="text-accent" aria-hidden /> {busy ? 'Importing…' : 'Choose an image from your computer'}
              </button>
              {images.length > 0 && (
                <label className="flex flex-col gap-1.5">
                  <span className={SUB}>Or use an image already in the Media Library</span>
                  <select value={slide.imageUrl ?? ''} onChange={(e) => onChange({ imageUrl: e.target.value || null })} className={`${INPUT} h-9 max-w-full px-3`}>
                    <option value="">None</option>
                    {images.map((m) => (
                      <option key={m.id} value={m.src}>{m.filename}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {slide.type === 'ANNOUNCEMENT' && (
                <label className="flex flex-col gap-1.5">
                  <span className={LABEL}>Heading</span>
                  <DraftText label="Announcement heading" value={slide.title} max={WELCOME_TITLE_MAX} placeholder="e.g. Parish Fiesta" onLive={(title) => onLive({ title })} onSave={(title) => onChange({ title })} />
                </label>
              )}
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>{slide.type === 'ANNOUNCEMENT' ? 'Body' : 'Message'}</span>
                <DraftText
                  label={slide.type === 'ANNOUNCEMENT' ? 'Announcement body' : 'Welcome message'}
                  value={slide.text}
                  max={WELCOME_MESSAGE_MAX}
                  rows={3}
                  onLive={(text) => onLive({ text })}
                  onSave={(text) => onChange({ text })}
                />
              </label>
              <span className={SUB}>A line break starts a new line on the screen.</span>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** The countdown settings. The minutes box keeps its own text while typed, so clearing it to type a new number does not snap back. */
function CountdownCard({ countdown, onChange }: { countdown: WelcomeCountdown; onChange: (patch: Partial<WelcomeCountdown>) => void }) {
  const minutes = Math.round((countdown.durationSec / 60) * 10) / 10;
  const [minutesText, setMinutesText] = useState(String(minutes));
  useEffect(() => setMinutesText(String(minutes)), [minutes]);
  const onZero = ON_ZERO_OPTIONS.find((o) => o.id === countdown.onZero) ?? ON_ZERO_OPTIONS[0];
  return (
    <section className={CARD} aria-labelledby="welcome-countdown-heading">
      <CardHeader
        id="welcome-countdown-heading"
        title="Pre-service countdown"
        subtitle="A timer over the welcome screen, counting down to the start of the service."
        onReset={() => onChange({ ...COUNTDOWN_DEFAULTS, enabled: countdown.enabled })}
      />
      <SettingRow label="Enable Pre-Service Countdown Timer" hint="Shown at the bottom of the welcome screen while it is live.">
        <Switch label="Enable Pre-Service Countdown Timer" on={countdown.enabled} onChange={(enabled) => onChange({ enabled })} />
      </SettingRow>

      <div className={`flex flex-col gap-5 ${countdown.enabled ? '' : 'pointer-events-none opacity-40'}`} aria-disabled={!countdown.enabled}>
        <SettingRow label="Target mode" hint="Count down to a time of day, or for a set length from when the welcome screen goes live." stacked>
          <Choice label="Target mode" value={countdown.mode} options={MODE_OPTIONS} onChange={(mode) => onChange({ mode })} />
        </SettingRow>

        {countdown.mode === 'TARGET' ? (
          <SettingRow label="Start time" hint="Today, on this computer's clock. Past times read 00:00.">
            <input
              type="time"
              aria-label="Countdown target start time"
              value={countdown.targetTime}
              onChange={(e) => e.target.value && onChange({ targetTime: e.target.value })}
              className={`${INPUT} h-9 px-3 font-mono`}
            />
          </SettingRow>
        ) : (
          <SettingRow label="Duration" hint="Starts when the welcome screen goes live." stacked>
            <Choice
              label="Countdown duration preset"
              value={DURATION_PRESETS.includes(minutes) ? minutes : -1}
              options={DURATION_PRESETS.map((m) => ({ id: m, label: `${m}:00 min` }))}
              onChange={(m) => onChange({ durationSec: m * 60 })}
            />
            <label className="flex items-center gap-2">
              <input
                type="number"
                min={COUNTDOWN_DURATION_MIN / 60}
                max={COUNTDOWN_DURATION_MAX / 60}
                step={0.5}
                aria-label="Countdown duration in minutes"
                value={minutesText}
                onChange={(e) => setMinutesText(e.target.value)}
                onBlur={() => {
                  const m = Number(minutesText);
                  if (Number.isFinite(m) && m > 0) onChange({ durationSec: Math.round(m * 60) });
                  else setMinutesText(String(minutes));
                }}
                className={`${INPUT} h-8 w-20 px-2 font-mono`}
              />
              <span className={SUB}>min</span>
            </label>
          </SettingRow>
        )}

        <SettingRow label="Action on zero" hint={onZero.hint} stacked>
          <Choice label="Action on zero" value={countdown.onZero} options={ON_ZERO_OPTIONS} onChange={(id) => onChange({ onZero: id })} />
        </SettingRow>

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Label</span>
          <DraftText label="Countdown label" value={countdown.label} max={COUNTDOWN_LABEL_MAX} placeholder="Holy Mass begins in" onLive={() => undefined} onSave={(label) => onChange({ label })} />
        </label>
      </div>
    </section>
  );
}

/** The Live Preview: the same canvas as the projector, running its own carousel and countdown, with controls to step and restart it. */
function LivePreview({ settings, onBackgroundMissing }: { settings: WelcomeSettings; onBackgroundMissing: () => void }) {
  const [anchor, setAnchor] = useState<Required<WelcomeAnchor>>(() => {
    const now = Date.now();
    return { shownAt: now, slide: 0, slideAt: now };
  });
  const now = useNow();
  const { countdown, slides } = settings;
  // A change to the countdown restarts it, so the preview shows the new length from the top.
  useEffect(() => setAnchor((a) => ({ ...a, shownAt: Date.now() })), [countdown.enabled, countdown.mode, countdown.durationSec, countdown.targetTime]);

  const position = carouselPosition(slides, anchor.slide, now - anchor.slideAt);
  const go = (index: number) => setAnchor((a) => ({ ...a, slide: (index + slides.length) % slides.length, slideAt: Date.now() }));
  const restart = () => {
    const t = Date.now();
    setAnchor({ shownAt: t, slide: 0, slideAt: t });
  };

  return (
    <section className={CARD} aria-labelledby="welcome-preview-heading">
      <CardHeader
        id="welcome-preview-heading"
        title="Live preview"
        subtitle="Exactly what the projector draws, at 16:9."
        action={
          <button type="button" onClick={restart} className={RESET}>
            <RotateCcw size={13} aria-hidden /> Restart
          </button>
        }
      />
      <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-line bg-black shadow-inner [container-type:size]">
        <WelcomeCanvas settings={settings} anchor={anchor} onBackgroundMissing={onBackgroundMissing} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5" role="group" aria-label="Preview slides">
          <button type="button" aria-label="Previous slide" disabled={slides.length < 2} onClick={() => go(position.index - 1)} className={ICON_BUTTON}>
            <ChevronLeft size={15} aria-hidden />
          </button>
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              aria-label={`Show slide ${i + 1}`}
              aria-current={i === position.index}
              onClick={() => go(i)}
              className={`h-2 rounded-full transition-all ${FOCUS} ${i === position.index ? 'w-6 bg-accent' : 'w-2 bg-fg/25 hover:bg-fg/50'}`}
            />
          ))}
          <button type="button" aria-label="Next slide" disabled={slides.length < 2} onClick={() => go(position.index + 1)} className={ICON_BUTTON}>
            <ChevronRight size={15} aria-hidden />
          </button>
        </div>
        <p className="font-mono text-[11px] text-muted" aria-live="off">
          {slides.length === 0
            ? 'No slides'
            : `Slide ${position.index + 1} of ${slides.length} · ${
                slides.length < 2 ? 'single slide' : position.remainingMs === null ? 'waits for Next Slide' : `next in ${Math.ceil(position.remainingMs / 1000)}s`
              }`}
        </p>
      </div>
      <p className={SUB}>
        On the projector, the carousel and a countdown duration start when the Welcome Screen goes live. Slides set to Manual Step wait for the
        Next Slide button in the top bar.
      </p>
    </section>
  );
}

export function WelcomeScreenSettings() {
  const welcome = useLive((s) => s.state.welcome);
  const [images, setImages] = useState<MediaAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Set when the preview could not load the chosen background file (it is then shown in colour, and the warning says so).
  const [previewMissing, setPreviewMissing] = useState(false);
  useEffect(() => setPreviewMissing(false), [welcome.backgroundUrl, welcome.backgroundType]);
  const [error, setError] = useState<string | null>(null);

  // Changes still on their way to the main process. The preview shows them at once; each is dropped once the saved settings carry it.
  const [overlay, setOverlay] = useState<Partial<WelcomeSettings>>({});
  const shown = useMemo(() => sanitizeWelcomeSettings({ ...welcome, ...overlay }), [welcome, overlay]);
  useEffect(() => {
    setOverlay((prev) => {
      const keys = Object.keys(prev) as (keyof WelcomeSettings)[];
      if (keys.length === 0) return prev;
      const merged = sanitizeWelcomeSettings({ ...welcome, ...prev });
      const next: Partial<WelcomeSettings> = {};
      for (const k of keys) if (JSON.stringify(merged[k]) !== JSON.stringify(welcome[k])) Object.assign(next, { [k]: prev[k] });
      return Object.keys(next).length === keys.length ? prev : next;
    });
  }, [welcome]);
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    bridge.media
      .list()
      .then((list) => setImages(list.filter((a) => a.mediaType === 'image')))
      .catch(() => undefined);
  }, []);

  /** Shows a change in the preview now, without saving it. */
  const live = (patch: Partial<WelcomeSettings>) => setOverlay((prev) => ({ ...prev, ...patch }));
  /** Saves a change. The live state carries it to the projector. */
  const update = (patch: Partial<WelcomeSettings>) => {
    live(patch);
    setError(null);
    bridge.welcome.save(patch).catch((err) => setError(errorText(err)));
  };

  const slides = shown.slides;
  const setSlides = (next: WelcomeSlide[], save = true) => (save ? update({ slides: next }) : live({ slides: next }));
  const patchSlide = (id: string, patch: Partial<WelcomeSlide>, save = true) =>
    setSlides(shownRef.current.slides.map((s) => (s.id === id ? { ...s, ...patch } : s)), save);
  const addSlide = (type: WelcomeSlideType) => {
    if (slides.length >= WELCOME_SLIDES_MAX) return;
    const slide: WelcomeSlide = {
      id: newSlideId(),
      type,
      text: type === 'TEXT' ? 'Welcome to Church' : type === 'ANNOUNCEMENT' ? 'Details of the announcement' : '',
      title: type === 'ANNOUNCEMENT' ? 'Announcement' : '',
      imageUrl: null,
      dwell: WELCOME_DWELL_DEFAULT,
    };
    setSlides([...slides, slide]);
    setSelectedId(slide.id);
  };
  const moveSlide = (index: number, delta: -1 | 1) => {
    const next = [...slides];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    setSlides(next);
  };
  const deleteSlide = (id: string) => {
    setSlides(slides.filter((s) => s.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  /** Imports a picture into the Media Library, then puts the newest picture there on the slide. */
  const importImage = async (slideId: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await bridge.media.importMedia();
      const list = (await bridge.media.list()).filter((a) => a.mediaType === 'image');
      setImages(list);
      if (result.imported > 0 && list.length > 0) {
        const newest = list.reduce((a, b) => (b.id > a.id ? b : a));
        patchSlide(slideId, { imageUrl: newest.src });
      }
      if (result.failed.length > 0) setError(`Could not import: ${result.failed.join(', ')}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const hasImageSlide = slides.some((s) => s.type === 'IMAGE');

  return (
    <div className="flex w-full flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold tracking-[0.2em] text-faint uppercase">Output</div>
          <h1 className="mt-1 text-4xl leading-tight font-extrabold tracking-tight text-fg xl:text-[44px]">Welcome Screen</h1>
          <p className="mt-2 text-sm text-muted">What the projector shows before the service starts.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-panel-2 px-3 py-1 text-xs font-semibold text-accent/90">
          <CheckCircle2 size={13} aria-hidden /> Changes save automatically
        </span>
      </header>

      {error && (
        <div role="alert" className="rounded-md border border-danger/40 bg-panel-2 px-4 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {/* 60 % form, 40 % preview. The preview stays in view while the form scrolls. Below lg the preview comes first. */}
      <div className="flex flex-col-reverse gap-6 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-col gap-6 lg:w-3/5">
          <section className={CARD} aria-labelledby="welcome-slides-heading">
            <CardHeader
              id="welcome-slides-heading"
              title="Welcome slides"
              subtitle="The slides take turns on the welcome screen, in this order, then start again."
              onReset={() => {
                update({ slides: WELCOME_DEFAULTS.slides, imageFit: WELCOME_DEFAULTS.imageFit });
                setSelectedId(null);
              }}
            />
            {slides.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">No slides. The welcome screen shows only its background.</p>
            ) : (
              <ol className="flex flex-col gap-2" aria-label="Welcome slide queue">
                {slides.map((slide, i) => (
                  <SlideItem
                    key={slide.id}
                    slide={slide}
                    index={i}
                    count={slides.length}
                    selected={selectedId === slide.id}
                    images={images}
                    busy={busy}
                    onSelect={() => setSelectedId(selectedId === slide.id ? null : slide.id)}
                    onChange={(patch) => patchSlide(slide.id, patch)}
                    onLive={(patch) => patchSlide(slide.id, patch, false)}
                    onMove={(delta) => moveSlide(i, delta)}
                    onDelete={() => deleteSlide(slide.id)}
                    onImport={() => void importImage(slide.id)}
                  />
                ))}
              </ol>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {SLIDE_TYPES.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  disabled={slides.length >= WELCOME_SLIDES_MAX}
                  onClick={() => addSlide(id)}
                  className={`flex items-center gap-1.5 rounded-lg border border-fg/20 bg-panel px-3 py-2 text-xs font-bold text-fg/90 transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-40 ${FOCUS}`}
                >
                  <Plus size={13} aria-hidden /> <Icon size={13} aria-hidden /> {label}
                </button>
              ))}
              <span className={`ml-auto ${SUB}`}>
                {slides.length} / {WELCOME_SLIDES_MAX}
              </span>
            </div>
            {hasImageSlide && (
              <SettingRow
                label="Picture fit"
                hint={shown.imageFit === 'FIT' ? 'The whole picture shows, with the background colour in the bars.' : 'Pictures cover the whole screen; their edges are cropped.'}
              >
                <Choice label="Picture fit" value={shown.imageFit} options={IMAGE_FIT_OPTIONS} onChange={(imageFit) => update({ imageFit })} />
              </SettingRow>
            )}
          </section>

          <CountdownCard countdown={shown.countdown} onChange={(patch) => update({ countdown: { ...shownRef.current.countdown, ...patch } })} />

          <section className={CARD} aria-labelledby="welcome-background-heading">
            <CardHeader
              id="welcome-background-heading"
              title="Background"
              subtitle="The colour, picture or video behind the welcome slides."
              onReset={() => update({ backgroundType: WELCOME_STYLE_DEFAULTS.backgroundType, backgroundColor: WELCOME_STYLE_DEFAULTS.backgroundColor })}
            />
            {/* The Welcome background: used only by the Welcome screen. */}
            <BackgroundControls value={welcome} save={(patch) => bridge.welcome.save(patch)} previewMissing={previewMissing} />
          </section>

          <section className={CARD} aria-labelledby="welcome-type-heading">
            <CardHeader
              id="welcome-type-heading"
              title="Typography & contrast"
              subtitle="The typeface, colour and size of the welcome text, and what keeps it readable over a picture."
              onReset={() => update({ ...WELCOME_TYPOGRAPHY_DEFAULTS, textColor: WELCOME_STYLE_DEFAULTS.textColor, fontSize: WELCOME_STYLE_DEFAULTS.fontSize })}
            />
            <SettingRow label="Font" hint="Used for every welcome slide and the countdown." stacked>
              <Choice
                label="Font"
                value={shown.fontFamily}
                options={FONT_OPTIONS.map((f) => ({ ...f, style: { fontFamily: WELCOME_FONT_STACKS[f.id], letterSpacing: 0 } }))}
                onChange={(fontFamily) => update({ fontFamily })}
              />
            </SettingRow>
            <SettingRow label="Text shadow" hint="A shadow or outline lifts the text off a busy background." stacked>
              <Choice label="Text shadow" value={shown.textShadow} options={SHADOW_OPTIONS} onChange={(textShadow) => update({ textShadow })} />
            </SettingRow>
            <SliderRow
              label="Background contrast scrim"
              hint="0% is transparent; higher values darken a gradient behind the text."
              value={welcome.scrim}
              min={0}
              max={WELCOME_SCRIM_MAX}
              unit="%"
              onLive={(scrim) => live({ scrim })}
              onSave={(scrim) => update({ scrim })}
            />
            <ColorRow label="Text colour" hint="The colour of the welcome text and the countdown." value={shown.textColor} onSave={(textColor) => update({ textColor })} />
            <SliderRow
              label="Font size"
              hint="The message size in pixels on a 1920-wide screen. Headings and card text scale from it."
              value={welcome.fontSize}
              min={WELCOME_FONT_MIN}
              max={WELCOME_FONT_MAX}
              unit="px"
              onLive={(fontSize) => live({ fontSize })}
              onSave={(fontSize) => update({ fontSize })}
            />
          </section>
        </div>

        <aside className="flex min-w-0 flex-col lg:sticky lg:top-0 lg:w-2/5" aria-label="Welcome screen preview">
          <LivePreview settings={shown} onBackgroundMissing={() => setPreviewMissing(true)} />
          {shown.countdown.enabled && (
            <p className={`mt-3 flex items-center gap-1.5 ${SUB}`}>
              <Timer size={13} aria-hidden /> Countdown on: {shown.countdown.mode === 'TARGET' ? `to ${shown.countdown.targetTime}` : `${formatCountdown(shown.countdown.durationSec * 1000)} from going live`}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

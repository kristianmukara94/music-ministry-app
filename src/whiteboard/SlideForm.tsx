import { useEffect, useState, type ReactNode } from 'react';
import { BookOpen, ImageOff, Plus, Trash2 } from 'lucide-react';
import {
  ALIGNMENTS,
  BORDER_STYLES,
  BULLET_STYLES,
  MAX_VERSES,
  PATTERNS,
  SLIDE_THEME_PRESETS,
  WHITEBOARD_FONTS,
  type WhiteboardDesign,
} from '../../shared/whiteboard.js';
import { BACKGROUND_COLORS, TEXT_COLORS } from '../../shared/text-style.js';
import { bridge } from '../live/bridge';
import type { MediaAsset } from '../media/types';
import { ColorField } from '../announcements/StyleControls';
import { AddBibleVerseModal } from './AddBibleVerseModal';
import type { WhiteboardVerse } from './types';

const SECTION = 'flex flex-col gap-4 rounded-lg border border-line bg-panel-2/60 p-4';
export const LABEL = 'text-[11px] font-bold tracking-wider text-muted uppercase';
export const FIELD = 'w-full rounded-md border border-fg/20 bg-panel px-3 py-2 text-sm text-fg outline-none focus:border-accent';
export const CHIP = 'rounded-md border px-3 py-1.5 text-xs font-bold tracking-wider uppercase transition-colors';
export const CHIP_OFF = 'border-fg/20 bg-panel text-fg/80 hover:border-accent/40 hover:text-accent';
const CHIP_ON = 'border-accent/50 bg-accent/20 text-accent';

const FONT_LABELS: Record<string, string> = {
  roboto: 'Sans Serif (Clean)',
  serif: 'Serif (Traditional)',
  mono: 'Monospace',
  playfair: 'Playfair Display',
  sans: 'Inter',
};

const BULLET_LABELS: Record<string, string> = {
  bullet: 'Bullet •',
  number: 'Number 1.',
  check: 'Check ✓',
  arrow: 'Arrow →',
  star: 'Star ★',
  none: 'None -',
};

const ALIGN_LABELS: Record<string, string> = { left: 'Left', center: 'Center', right: 'Right', justify: 'Justify' };
const PATTERN_LABELS: Record<string, string> = { none: 'None (Solid)', grid: 'Subtle Grid', gradient: 'Gradient', dots: 'Dots Pattern' };
const BORDER_LABELS: Record<string, string> = { solid: 'Solid Line', dashed: 'Dashed', dotted: 'Dotted', gradient: 'Gradient (Fancy)' };

/** A labelled slider with its value in a pill. */
function Range({ label, value, min, max, unit, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="flex items-center justify-between">
        <span className={LABEL}>{label}</span>
        <span className="rounded-full border border-accent/30 bg-panel px-2.5 py-0.5 font-mono text-xs font-semibold text-accent tabular-nums">
          {value}
          {unit}
        </span>
      </span>
      <input type="range" min={min} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1.5 w-full cursor-pointer accent-accent" />
    </label>
  );
}

/** An on/off switch, lit gold when on. */
function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className="flex items-center gap-2 text-sm text-fg/90">
      <span className={`relative h-5 w-9 rounded-full border transition ${on ? 'border-accent bg-accent' : 'border-fg/20 bg-panel-2'}`}>
        <span className={`absolute top-0.5 size-3.5 rounded-full transition-all ${on ? 'left-[18px] bg-panel' : 'left-0.5 bg-fg/50'}`} aria-hidden />
      </span>
      {label}
    </button>
  );
}

/** A row of toggle chips, one lit at a time. */
function Chips<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { id: T; text: string }[];
  onChange: (id: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)} className={`${CHIP} ${value === o.id ? CHIP_ON : CHIP_OFF}`}>
          {o.text}
        </button>
      ))}
    </div>
  );
}

/** A section of the form with a heading, for the customizer's groups. */
function Group({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className={SECTION}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-semibold tracking-wider text-accent uppercase">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

const TEXT_TONES = TEXT_COLORS;

/** A picture of the slide's own that can be its background, such as its PowerPoint background without the words. */
export interface SlidePicture {
  src: string;
  label: string;
}

/**
 * Picks the slide's background picture from the slide's own pictures (for a slide that came from PowerPoint) and the Media Library, and how
 * it fills the slide and how much it is dimmed. A slide's own picture is set to fill the slide edge to edge and not be darkened, as it was.
 */
export function BackgroundImageGroup({
  design,
  slidePictures,
  onDesign,
  allowDim = true,
}: {
  design: WhiteboardDesign;
  slidePictures: SlidePicture[];
  onDesign: (patch: Partial<WhiteboardDesign>) => void;
  /** Whether the picture can be darkened. Without the slider, a chosen picture is shown as it is. */
  allowDim?: boolean;
}) {
  const [pictures, setPictures] = useState<MediaAsset[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    bridge.media
      .list()
      .then((list) => {
        if (alive) setPictures(list.filter((m) => m.mediaType === 'image'));
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // A slide that came from PowerPoint can always use its own pictures as the background, whether or not it does now. A slide picture in use
  // that is not among them (one chosen before) is still shown, so the current choice is always visible.
  const own = [...slidePictures];
  const current = design.bgImage;
  if (current && /^apcc-media:\/\/(slide|wb)\//.test(current) && !own.some((p) => p.src === current)) own.push({ src: current, label: 'PowerPoint' });
  const fromSlide = own.length > 0;
  const tile = (selected: boolean) =>
    `relative aspect-video w-full overflow-hidden rounded-md border-2 bg-black transition ${selected ? 'border-accent ring-1 ring-accent' : 'border-fg/15 hover:border-accent/50'}`;

  return (
    <Group title="Background image">
      {failed ? (
        <p className="rounded-md border border-dashed border-fg/20 px-3 py-3 text-xs text-muted">The Media Library could not be read.</p>
      ) : pictures === null ? (
        <div className="grid grid-cols-3 gap-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="aspect-video animate-pulse rounded-md border border-line bg-panel" />
          ))}
        </div>
      ) : (
        <div role="radiogroup" aria-label="Background image" className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto pr-1">
          <button type="button" role="radio" aria-checked={design.bgImage == null} onClick={() => onDesign({ bgImage: null })} className={tile(design.bgImage == null)} title="No picture">
            <span className="absolute inset-0 grid place-items-center gap-1 text-[10px] font-bold tracking-wider text-fg/70 uppercase">
              <ImageOff size={16} aria-hidden /> None
            </span>
          </button>
          {own.map((p) => (
            <button key={p.src} type="button" role="radio" aria-checked={design.bgImage === p.src} onClick={() => onDesign({ bgImage: p.src, bgFit: 'stretch', bgDim: 0 })} className={tile(design.bgImage === p.src)} title={p.label}>
              <img src={p.src} alt="" draggable={false} className="h-full w-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-1 py-0.5 text-[9px] font-bold tracking-wider text-fg/90 uppercase">{p.label}</span>
            </button>
          ))}
          {pictures.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={design.bgImage === m.src} onClick={() => onDesign(allowDim ? { bgImage: m.src } : { bgImage: m.src, bgDim: 0 })} className={tile(design.bgImage === m.src)} title={m.filename}>
              <img src={m.thumbSrc ?? m.src} alt={m.filename} draggable={false} loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
      {pictures !== null && pictures.length === 0 && !fromSlide && (
        <p className="rounded-md border border-dashed border-fg/20 px-3 py-3 text-xs text-muted">No pictures in the Media Library yet. Add pictures in Media, and they will appear here.</p>
      )}
      {design.bgImage && (
        <>
          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>Picture fit</span>
            <Chips
              label="Picture fit"
              value={design.bgFit}
              options={[
                { id: 'cover' as const, text: 'Fill slide' },
                { id: 'contain' as const, text: 'Show whole picture' },
                { id: 'stretch' as const, text: 'Stretch to edges' },
              ]}
              onChange={(bgFit) => onDesign({ bgFit })}
            />
          </div>
          {allowDim && <Range label="Darken picture" value={design.bgDim} min={0} max={85} unit="%" onChange={(bgDim) => onDesign({ bgDim })} />}
        </>
      )}
    </Group>
  );
}

/**
 * Every field of a Whiteboard text slide: its title and content, text formatting, visual effects and Bible verses. The form holds no
 * state of its own: the slide editor (a dialog) and the Go Live editor (a live panel) each keep the slide and pass changes in.
 */
export function SlideForm({
  title,
  content,
  design,
  onTitle,
  onContent,
  onDesign,
  slidePictures = [],
  showContent = true,
  titleLabel = 'Slide title *',
}: {
  title: string;
  content: string;
  design: WhiteboardDesign;
  onTitle: (title: string) => void;
  onContent: (content: string) => void;
  /** Applies a change to the design. Called with only the fields that changed. */
  onDesign: (patch: Partial<WhiteboardDesign>) => void;
  /** The slide's own pictures, when it came from PowerPoint, so they can be chosen as the background. */
  slidePictures?: SlidePicture[];
  /**
   * Whether the slide's content and its formatting are offered. A slide from PowerPoint keeps its words in text boxes, edited on the slide
   * itself, so for it only the title and the slide-wide settings are shown.
   */
  showContent?: boolean;
  /** What the title field is called. A slide from PowerPoint shows its heading in a text box, so its title is only its name in the list. */
  titleLabel?: string;
}) {
  const [addingVerse, setAddingVerse] = useState(false);
  const set = onDesign;

  /** Adds the verse the Bible dialog read from the database. The slide keeps its limit on how many verses it holds. */
  const addVerseFromBible = (verse: WhiteboardVerse) => {
    set({ verses: [...design.verses, verse].slice(0, MAX_VERSES) });
    setAddingVerse(false);
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {addingVerse && <AddBibleVerseModal onAdd={addVerseFromBible} onClose={() => setAddingVerse(false)} />}
      <Group title="Content">
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>{titleLabel}</span>
          <input data-field="title" value={title} maxLength={200} onChange={(e) => onTitle(e.target.value)} className={FIELD} />
        </label>
        {showContent && (
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Slide content (use &quot;-&quot; or &quot;*&quot; for bullet points)</span>
            <textarea data-field="content" rows={6} maxLength={4000} value={content} onChange={(e) => onContent(e.target.value)} className={`${FIELD} resize-y font-mono text-xs leading-relaxed`} />
          </label>
        )}
        {!showContent && (
          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>Background colour (behind the picture)</span>
            <ColorField label="Background colour" value={design.bgColor} presets={BACKGROUND_COLORS} onChange={(hex) => hex && set({ bgColor: hex })} />
          </div>
        )}
      </Group>

      {showContent && (
      <Group title="Text formatting">
        <Range label="Font size" value={design.fontSize} min={20} max={72} unit="px" onChange={(fontSize) => set({ fontSize })} />
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Font family</span>
          <select value={design.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })} className={FIELD}>
            {WHITEBOARD_FONTS.map((f) => (
              <option key={f} value={f}>{FONT_LABELS[f] ?? f}</option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1.5">
          <span className={LABEL}>Text alignment</span>
          <Chips label="Text alignment" value={design.align} options={ALIGNMENTS.map((a) => ({ id: a as WhiteboardDesign['align'], text: ALIGN_LABELS[a] }))} onChange={(align) => set({ align })} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <ColorField label="Background" value={design.bgColor} presets={BACKGROUND_COLORS} onChange={(hex) => hex && set({ bgColor: hex })} />
          <ColorField label="Text color" value={design.textColor} presets={TEXT_TONES} onChange={(hex) => hex && set({ textColor: hex })} />
        </div>
        <Toggle label="Title visible on slide" on={design.titleVisible} onChange={(titleVisible) => set({ titleVisible })} />
        <div className="flex flex-col gap-1.5">
          <span className={LABEL}>Theme presets</span>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(SLIDE_THEME_PRESETS).map(([id, preset]) => (
              <button key={id} type="button" onClick={() => set({ ...preset.values })} className={`${CHIP} ${CHIP_OFF}`}>
                {preset.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className={LABEL}>Bullet style</span>
          <Chips label="Bullet style" value={design.bulletStyle} options={BULLET_STYLES.map((b) => ({ id: b as WhiteboardDesign['bulletStyle'], text: BULLET_LABELS[b] }))} onChange={(bulletStyle) => set({ bulletStyle })} />
        </div>
        <ColorField label="Bullet color" value={design.bulletColor} presets={TEXT_TONES} onChange={(hex) => hex && set({ bulletColor: hex })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <span className={LABEL}>Title format</span>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" aria-pressed={design.titleBold} onClick={() => set({ titleBold: !design.titleBold })} className={`${CHIP} ${design.titleBold ? CHIP_ON : CHIP_OFF} w-9 font-black`}>B</button>
              <button type="button" aria-pressed={design.titleItalic} onClick={() => set({ titleItalic: !design.titleItalic })} className={`${CHIP} ${design.titleItalic ? CHIP_ON : CHIP_OFF} w-9 italic`}>I</button>
            </div>
            <Range label="Title size" value={design.titleSize} min={24} max={96} unit="px" onChange={(titleSize) => set({ titleSize })} />
          </div>
          <div className="flex flex-col gap-2">
            <span className={LABEL}>Content format</span>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" aria-pressed={design.bodyBold} onClick={() => set({ bodyBold: !design.bodyBold })} className={`${CHIP} ${design.bodyBold ? CHIP_ON : CHIP_OFF} w-9 font-black`}>B</button>
              <button type="button" aria-pressed={design.bodyItalic} onClick={() => set({ bodyItalic: !design.bodyItalic })} className={`${CHIP} ${design.bodyItalic ? CHIP_ON : CHIP_OFF} w-9 italic`}>I</button>
            </div>
          </div>
        </div>
      </Group>
      )}

      <BackgroundImageGroup design={design} slidePictures={slidePictures} onDesign={set} />

      <Group title="Visual effects">
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Background pattern</span>
          <select value={design.pattern} onChange={(e) => set({ pattern: e.target.value as WhiteboardDesign['pattern'] })} className={FIELD}>
            {PATTERNS.map((p) => (
              <option key={p} value={p}>{PATTERN_LABELS[p]}</option>
            ))}
          </select>
        </label>
        <Toggle label="Border enabled" on={design.border} onChange={(border) => set({ border })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Border style</span>
            <select value={design.borderStyle} onChange={(e) => set({ borderStyle: e.target.value as WhiteboardDesign['borderStyle'] })} className={FIELD}>
              {BORDER_STYLES.map((b) => (
                <option key={b} value={b}>{BORDER_LABELS[b]}</option>
              ))}
            </select>
          </label>
          <ColorField label="Border color" value={design.borderColor} presets={TEXT_TONES} onChange={(hex) => hex && set({ borderColor: hex })} />
        </div>
        <Range label="Border width" value={design.borderWidth} min={1} max={10} unit="px" onChange={(borderWidth) => set({ borderWidth })} />
      </Group>

      <Group
        title="Bible verses"
        action={
          <button type="button" onClick={() => setAddingVerse(true)} disabled={design.verses.length >= MAX_VERSES} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-on-accent hover:bg-accent disabled:opacity-40">
            <Plus size={12} aria-hidden /> Add Verse
          </button>
        }
      >
        {design.verses.length === 0 && (
          <p className="flex items-center gap-2 rounded-md border border-dashed border-fg/20 px-3 py-3 text-xs text-muted">
            <BookOpen size={14} aria-hidden /> No verses added yet. Click &apos;Add Verse&apos; to include scripture
          </p>
        )}
        {design.verses.map((v, i) => (
          <div key={i} className="flex items-start gap-2 rounded-md border border-line bg-panel p-3">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold tracking-wider text-accent uppercase">{v.reference}</div>
              <div className="mt-1 line-clamp-3 text-sm text-fg/80">{v.text}</div>
              <div className="mt-1 font-mono text-[10px] text-faint">
                {v.style} • {v.position} • {v.align} • {v.fontSize}px
              </div>
            </div>
            <button type="button" onClick={() => set({ verses: design.verses.filter((_, j) => j !== i) })} aria-label={`Remove ${v.reference || 'verse'}`} className="grid size-7 shrink-0 place-items-center rounded text-muted hover:text-danger">
              <Trash2 size={13} aria-hidden />
            </button>
          </div>
        ))}
      </Group>
    </div>
  );
}

import { useEffect, useState, type ReactNode } from 'react';
import { BookOpen, Plus, Trash2, X } from 'lucide-react';
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
import { ColorField } from '../announcements/StyleControls';
import { SlideCanvas } from './SlideCanvas';
import { AddBibleVerseModal } from './AddBibleVerseModal';
import type { WhiteboardSlideInput, WhiteboardVerse } from './types';

const SECTION = 'flex flex-col gap-4 rounded-lg border border-stone-800 bg-stone-900/60 p-4';
const LABEL = 'text-[11px] font-bold tracking-wider text-stone-400 uppercase';
const FIELD = 'w-full rounded-md border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100 outline-none focus:border-amber-400';
const CHIP = 'rounded-md border px-3 py-1.5 text-xs font-bold tracking-wider uppercase transition-colors';
const CHIP_OFF = 'border-stone-700 bg-stone-950 text-stone-300 hover:border-amber-500/40 hover:text-amber-300';
const CHIP_ON = 'border-amber-500/50 bg-amber-500/20 text-amber-300';

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
        <span className="rounded-full border border-amber-500/30 bg-stone-950 px-2.5 py-0.5 font-mono text-xs font-semibold text-amber-300 tabular-nums">
          {value}
          {unit}
        </span>
      </span>
      <input type="range" min={min} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1.5 w-full cursor-pointer accent-amber-400" />
    </label>
  );
}

/** An on/off switch, lit gold when on. */
function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className="flex items-center gap-2 text-sm text-stone-200">
      <span className={`relative h-5 w-9 rounded-full border transition ${on ? 'border-amber-400 bg-amber-500' : 'border-stone-700 bg-stone-900'}`}>
        <span className={`absolute top-0.5 size-3.5 rounded-full transition-all ${on ? 'left-[18px] bg-stone-950' : 'left-0.5 bg-stone-400'}`} aria-hidden />
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
        <h3 className="text-xs font-black tracking-widest text-amber-300 uppercase">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

const TEXT_TONES = TEXT_COLORS;

/**
 * The slide customizer. Content and every part of the design are edited on the left; the live preview on the right
 * shows the slide as it will look. Nothing is saved until Create slide.
 */
export function SlideEditorModal({ initial, onSave, onClose, onUseTemplate, mode }: {
  initial: WhiteboardSlideInput;
  onSave: (input: WhiteboardSlideInput) => Promise<void>;
  onClose: () => void;
  onUseTemplate: () => void;
  mode: 'create' | 'edit';
}) {
  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState(initial.content);
  const [design, setDesign] = useState<WhiteboardDesign>(initial.design);
  const [addingVerse, setAddingVerse] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<WhiteboardDesign>) => setDesign((d) => ({ ...d, ...patch }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    if (!title.trim()) {
      setError('A slide needs a title.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave({ id: initial.id, title, content, design });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  /** Adds the verse the Bible dialog read from the database. The slide keeps its limit on how many verses it holds. */
  const addVerseFromBible = (verse: WhiteboardVerse) => {
    set({ verses: [...design.verses, verse].slice(0, MAX_VERSES) });
    setAddingVerse(false);
  };

  const preview = { title: title || 'Sermon Title', content: content.trim() ? content : 'Add content to see preview...', design };

  return (
    <div role="dialog" aria-modal="true" aria-label={mode === 'create' ? 'Create new slide' : 'Edit slide'} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      {addingVerse && <AddBibleVerseModal onAdd={addVerseFromBible} onClose={() => setAddingVerse(false)} />}
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-stone-700 bg-stone-950 shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-stone-800 px-6 py-4">
          <div>
            <div className="text-[11px] font-bold tracking-[0.2em] text-stone-500 uppercase">Slide</div>
            <h2 className="mt-0.5 text-lg font-black tracking-widest text-stone-100 uppercase">{mode === 'create' ? 'Create new slide' : 'Edit slide'}</h2>
            <p className="text-xs text-stone-400">Customize your presentation slide</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-md border border-stone-700 text-stone-400 hover:text-stone-100">
            <X size={16} aria-hidden />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <Group title="Content">
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Slide title *</span>
                <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} className={FIELD} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Slide content (use &quot;-&quot; or &quot;*&quot; for bullet points)</span>
                <textarea rows={6} maxLength={4000} value={content} onChange={(e) => setContent(e.target.value)} className={`${FIELD} resize-y font-mono text-xs leading-relaxed`} />
              </label>
            </Group>

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
                <button type="button" onClick={() => setAddingVerse(true)} disabled={design.verses.length >= MAX_VERSES} className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-stone-950 hover:bg-amber-500 disabled:opacity-40">
                  <Plus size={12} aria-hidden /> Add Verse
                </button>
              }
            >
              {design.verses.length === 0 && (
                <p className="flex items-center gap-2 rounded-md border border-dashed border-stone-700 px-3 py-3 text-xs text-stone-400">
                  <BookOpen size={14} aria-hidden /> No verses added yet. Click &apos;Add Verse&apos; to include scripture
                </p>
              )}
              {design.verses.map((v, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md border border-stone-800 bg-stone-950 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold tracking-wider text-amber-300 uppercase">{v.reference}</div>
                    <div className="mt-1 line-clamp-3 text-sm text-stone-300">{v.text}</div>
                    <div className="mt-1 font-mono text-[10px] text-stone-500">
                      {v.style} • {v.position} • {v.align} • {v.fontSize}px
                    </div>
                  </div>
                  <button type="button" onClick={() => set({ verses: design.verses.filter((_, j) => j !== i) })} aria-label={`Remove ${v.reference || 'verse'}`} className="grid size-7 shrink-0 place-items-center rounded text-stone-400 hover:text-red-400">
                    <Trash2 size={13} aria-hidden />
                  </button>
                </div>
              ))}
            </Group>
          </div>

          <div className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-0 lg:self-start">
            <div className="text-[11px] font-bold tracking-widest text-stone-400 uppercase">Live preview</div>
            <div className="aspect-video w-full overflow-hidden rounded-xl border-[3px] border-amber-400 shadow-xl">
              <SlideCanvas slide={preview} className="h-full w-full" />
            </div>
            <p className="text-xs text-stone-500">The slide updates as you change it. Double-clicking it in the library projects it.</p>
          </div>
        </div>

        {error && <div role="alert" className="border-t border-red-500/40 bg-red-500/10 px-6 py-2 text-sm text-red-300">{error}</div>}

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-stone-800 px-6 py-4">
          <button type="button" onClick={onUseTemplate} className={`${CHIP} ${CHIP_OFF}`}>
            Use template
          </button>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onClose} className={`${CHIP} ${CHIP_OFF}`}>
              Cancel
            </button>
            <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold tracking-wider text-stone-950 uppercase shadow-md shadow-amber-950/40 transition-all hover:bg-amber-400 disabled:opacity-40">
              {mode === 'create' ? 'Create slide' : 'Save changes'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { PW_TYPES, withCardType, type PwSegment, type PwType } from '../../shared/pw.js';
import { updateSegment } from './store';
import type { PwT } from './strings';
import { TYPE_ICON } from './cardTypeIcons';

/** Gives the card at `index` another function and saves it at once. Returns false when nothing changed. */
export function switchCardType(index: number, segment: PwSegment, type: PwType): boolean {
  const patch = withCardType(segment, type);
  if (!patch) return false;
  updateSegment(index, patch);
  return true;
}

/**
 * Song, Prayer and Scripture as one segmented control: the card's function. Choosing one switches the card at once (see withCardType).
 * Buttons keep focus where it was on mouse down, so the rename field beside it does not lose focus and close the editor first.
 */
export function CardTypePicker({ value, onChange, t, label }: { value: PwType; onChange: (type: PwType) => void; t: PwT; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex overflow-hidden rounded-lg border border-line-strong bg-surface-2">
      {PW_TYPES.map((type) => {
        const Icon = TYPE_ICON[type];
        const on = type === value;
        return (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={on}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange(type)}
            className={`flex h-8 items-center gap-1.5 px-2.5 text-xs font-semibold transition focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none ${
              on ? 'bg-accent text-on-accent' : 'text-fg hover:bg-fg/10'
            }`}
          >
            <Icon size={13} aria-hidden />
            {t(`type_${type}`)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The card's type icon as a button: one click opens Song / Prayer / Scripture beside it, and a second click on a choice switches the card.
 * Escape or a click elsewhere closes it.
 */
export function CardTypeBadge({ segment, onChange, t }: { segment: PwSegment; onChange: (type: PwType) => void; t: PwT }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const Icon = TYPE_ICON[segment.type];
  useEffect(() => {
    if (!open) return undefined;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  const label = t('cardFunctionFor', { name: segment.name });
  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${label}: ${t(`type_${segment.type}`)}`}
        title={label}
        onClick={() => setOpen((o) => !o)}
        className="grid size-9 place-items-center rounded-lg bg-panel-2 text-accent transition hover:ring-1 hover:ring-accent/60 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
      >
        <Icon size={16} aria-hidden />
      </button>
      {open && (
        <div className="absolute top-full left-0 z-30 mt-1 flex flex-col gap-1.5 rounded-lg border border-line-strong bg-surface p-2 shadow-xl">
          <span className="px-0.5 text-[10px] font-semibold tracking-wider text-muted uppercase">{t('cardFunction')}</span>
          <CardTypePicker
            value={segment.type}
            label={label}
            t={t}
            onChange={(type) => {
              setOpen(false);
              onChange(type);
            }}
          />
        </div>
      )}
    </div>
  );
}

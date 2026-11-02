import type { ReactNode } from 'react';
import { RotateCcw, type LucideIcon } from 'lucide-react';

// The small controls the output settings pages share: a gold segmented choice, a gold switch, a labelled row and a card heading.

export const FOCUS = 'focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none';
export const CARD = 'flex flex-col gap-4 rounded-xl border border-line bg-panel-2/60 p-5 shadow-lg';
export const HEADING = 'text-[11px] font-semibold tracking-wider text-fg/70 uppercase';
export const SUB = 'text-xs text-fg/60';
const RESET = `flex shrink-0 items-center gap-1.5 rounded text-[11px] font-bold tracking-wider whitespace-nowrap text-fg/60 uppercase transition-colors hover:text-accent disabled:cursor-default disabled:opacity-40 disabled:hover:text-fg/60 ${FOCUS}`;

/** A segmented control: one of the options is lit gold. */
export function Segmented<T extends string>({ label, value, options, onChange, disabled = false }: {
  label: string;
  value: T;
  options: { id: T; text: string; icon?: LucideIcon }[];
  onChange: (id: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} aria-disabled={disabled} className={`flex flex-wrap gap-1 rounded-lg border border-line bg-panel p-1 ${disabled ? 'opacity-40' : ''}`}>
      {options.map((o) => {
        const Icon = o.icon;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            disabled={disabled}
            onClick={() => onChange(o.id)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-bold tracking-wider whitespace-nowrap uppercase transition-colors disabled:cursor-not-allowed ${FOCUS} ${
              value === o.id ? 'border border-accent/40 bg-accent/20 text-accent' : 'border border-transparent text-fg/60 hover:text-fg/90'
            }`}
          >
            {Icon && <Icon size={13} aria-hidden />}
            {o.text}
          </button>
        );
      })}
    </div>
  );
}

/** A switch lit gold when on. */
export function GoldSwitch({ label, on, onChange, disabled = false }: { label: string; on: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`flex items-center gap-2 rounded-full disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS}`}
    >
      <span className={`relative h-5 w-9 rounded-full border transition ${on ? 'border-accent bg-accent' : 'border-fg/20 bg-panel-2'}`}>
        <span className={`absolute top-0.5 size-3.5 rounded-full transition-all ${on ? 'left-[18px] bg-panel' : 'left-0.5 bg-fg/50'}`} aria-hidden />
      </span>
      <span className="w-6 text-[11px] font-bold tracking-wider text-fg/70 uppercase">{on ? 'On' : 'Off'}</span>
    </button>
  );
}

/**
 * One labelled row inside a card: the name and its explanation, and the control. `stacked` puts a wide control (a
 * segmented choice) on its own line under the text, so it never squeezes the explanation into a narrow column.
 */
export function Row({ title, detail, children, stacked = false }: { title: string; detail: string; children: ReactNode; stacked?: boolean }) {
  return (
    <div className={`border-t border-line pt-4 ${stacked ? 'flex flex-col gap-3' : 'flex flex-wrap items-start justify-between gap-3'}`}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-fg">{title}</div>
        <div className={SUB}>{detail}</div>
      </div>
      <div className={stacked ? '' : 'shrink-0'}>{children}</div>
    </div>
  );
}

/** A section heading with its explanation, and an optional "Reset to defaults" that is off while the section already matches them. */
export function CardHeader({ id, title, detail, onReset, resetDisabled }: { id: string; title: string; detail?: string; onReset?: () => void; resetDisabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 id={id} className={HEADING}>{title}</h2>
        {detail && <p className={SUB}>{detail}</p>}
      </div>
      {onReset && (
        <button type="button" onClick={onReset} disabled={resetDisabled} className={RESET}>
          <RotateCcw size={12} aria-hidden /> Reset to defaults
        </button>
      )}
    </div>
  );
}

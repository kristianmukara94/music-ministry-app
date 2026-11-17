import { TEXT_CASES, type TextCase } from '../../shared/text-fit.js';

/** The glyph each mode shows on its button: it reads as the case it gives. */
export const TEXT_CASE_GLYPH: Record<TextCase, string> = { original: 'Aa', uppercase: 'AA', lowercase: 'aa' };

export interface TextCaseLabels {
  /** The group's name, such as "Text case". */
  group: string;
  original: string;
  uppercase: string;
  lowercase: string;
}

/**
 * A compact three-way switch for the text case: Aa (as typed), AA (UPPERCASE), aa (lowercase). Used in the Live Quick Controls, where it sets
 * the projector's case (and on the Go Live bottom bar, where it sets the same projector case), and in the planners' toolbars, where it sets how the lineup, the lyrics drawers and the printed lineup read.
 */
export function TextCaseSwitch({
  value,
  onChange,
  labels,
  size = 'sm',
  error = null,
}: {
  value: TextCase;
  onChange: (mode: TextCase) => void;
  labels: TextCaseLabels;
  /** 'sm' is h-8, as the Live Quick Controls; 'md' is h-10, as the planner toolbars; 'xs' is h-8 with narrow buttons, for the Go Live bar. */
  size?: 'xs' | 'sm' | 'md';
  /** A failed save, shown on the group's tooltip and in red. */
  error?: string | null;
}) {
  const height = size === 'md' ? 'h-10' : 'h-8';
  return (
    <div
      role="radiogroup"
      aria-label={labels.group}
      title={error ?? labels.group}
      data-text-case={value}
      className={`flex ${height} shrink-0 overflow-hidden rounded-md border ${error ? 'border-danger' : 'border-fg/15'} bg-panel-2`}
    >
      {TEXT_CASES.map((mode) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          aria-label={labels[mode]}
          title={labels[mode]}
          onClick={() => onChange(mode)}
          className={`${size === 'xs' ? 'min-w-7 px-1' : 'min-w-9 px-2'} font-mono text-[11px] font-extrabold tracking-wide normal-case transition focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none ${
            value === mode ? 'bg-accent text-on-accent' : 'text-fg/75 hover:bg-fg/10 hover:text-fg'
          }`}
        >
          {TEXT_CASE_GLYPH[mode]}
        </button>
      ))}
    </div>
  );
}

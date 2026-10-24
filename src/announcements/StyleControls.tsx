import { useEffect, useRef, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react';
import type { TextAlign, TextFontFamily, TextStyle } from '../../shared/text-style';
import { normalizeHex, TEXT_COLORS, TEXT_FONT_GROUPS, TEXT_FONTS, TEXT_SIZES } from '../../shared/text-style.js';

const CONTROL = 'h-8 rounded-md border border-line-strong bg-canvas px-2 text-xs outline-none focus:border-accent';
// One height and padding for every toolbar button, and no wrapping inside a button, so "Extra Large [80px]" stays on one line.
const SEG = 'flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-3 text-xs font-medium';
const segClass = (on: boolean) => `${SEG} ${on ? 'border-accent/40 bg-accent/15 text-accent' : 'border-line-strong text-fg/70 hover:bg-panel-2'}`;
const swatchClass = (on: boolean) => `size-7 rounded-md border ${on ? 'border-accent ring-2 ring-accent/40' : 'border-line-strong'}`;
const ALIGN_ICON = { left: AlignLeft, center: AlignCenter, right: AlignRight };

/**
 * A colour control: preset swatches, a custom swatch that opens the native colour wheel, and a #HEX text box. The three stay
 * in step. A preset or the wheel fills the text box, and a valid code updates the swatch and the colour straight away.
 */
export function ColorField({
  label,
  value,
  presets,
  onChange,
  prefix,
  clearLabel,
}: {
  label: string;
  value: string | undefined;
  presets: { label: string; hex: string }[];
  onChange: (hex: string | undefined) => void;
  prefix?: string;
  clearLabel?: string;
}) {
  const wheel = useRef<HTMLInputElement>(null);
  // The text as typed. It can be incomplete while the operator types, so it is kept apart from the colour itself.
  const [draft, setDraft] = useState(value ?? '');

  useEffect(() => {
    // Only a change to the colour itself refills the text box. A valid code being typed is never overwritten.
    if (normalizeHex(draft) !== (value ?? null)) setDraft(value ?? '');
  }, [value]);

  /** A bare 3- or 6-digit code gets its # as it is typed or pasted, so 1a2b3c becomes #1a2b3c. */
  const onDraft = (raw: string) => {
    const text = /^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw.trim()) ? `#${raw.trim()}` : raw;
    setDraft(text);
    const hex = normalizeHex(text);
    if (hex) onChange(hex);
  };

  const invalid = draft.trim() !== '' && !normalizeHex(draft);
  const custom = Boolean(value) && !presets.some((p) => p.hex === value);

  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {prefix && <span className="mr-1 text-xs font-bold uppercase text-faint">{prefix}</span>}
      {presets.map((p) => (
        <button
          key={p.hex}
          type="button"
          aria-label={p.label}
          title={p.label}
          aria-pressed={value === p.hex}
          onClick={() => onChange(p.hex)}
          className={swatchClass(value === p.hex)}
          style={{ backgroundColor: p.hex }}
        />
      ))}
      <button
        type="button"
        aria-label={`Open the colour wheel: ${label.toLowerCase()}`}
        title="Choose any colour"
        onClick={() => wheel.current?.click()}
        className={swatchClass(custom)}
        style={{ background: value ?? 'conic-gradient(#ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)' }}
      />
      {/* The native colour wheel opens from the swatch above. The input itself is hidden. */}
      <input
        ref={wheel}
        type="color"
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        value={value?.toLowerCase() ?? '#ffffff'}
        onChange={(e) => onChange(normalizeHex(e.target.value) ?? undefined)}
      />
      <input
        type="text"
        aria-label={`${label} hex code`}
        aria-invalid={invalid}
        placeholder="#FFFFFF"
        maxLength={7}
        spellCheck={false}
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        className={`${CONTROL} w-24 font-mono uppercase ${invalid ? 'border-danger text-danger' : ''}`}
      />
      {invalid && <span className="text-xs text-danger">Use #RGB or #RRGGBB</span>}
      {clearLabel && value && (
        <button type="button" onClick={() => onChange(undefined)} className="ml-1 text-xs text-muted hover:text-fg">
          {clearLabel}
        </button>
      )}
    </div>
  );
}

/**
 * The typography row: font, size, alignment and text colour. `style` is the current choice, and `onChange` receives the
 * fields that changed. An unset font shows as "Default", which is the projector's own face.
 */
/** Smallest and largest custom sizes. The main process keeps only sizes in this range (text-style.js). */
const SIZE_MIN = 20;
const SIZE_MAX = 200;

/**
 * The custom size box. It keeps what is typed, so a number can be entered digit by digit. A value outside
 * the range is shown but not applied until it is in range, and an empty box means Default.
 */
function SizeInput({ value, onChange }: { value: number | undefined; onChange: (px: number | undefined) => void }) {
  const [draft, setDraft] = useState(value ? String(value) : '');

  // A preset click, or a saved style, changes the size from outside. The box shows it unless it already matches.
  useEffect(() => {
    setDraft((current) => (Number(current) === (value ?? 0) ? current : value ? String(value) : ''));
  }, [value]);

  const change = (text: string) => {
    setDraft(text);
    if (text.trim() === '') {
      onChange(undefined);
      return;
    }
    const px = Number(text);
    if (Number.isInteger(px) && px >= SIZE_MIN && px <= SIZE_MAX) onChange(px);
  };

  return (
    <input
      type="number"
      inputMode="numeric"
      aria-label="Custom font size in pixels"
      min={SIZE_MIN}
      max={SIZE_MAX}
      placeholder="px"
      value={draft}
      onChange={(e) => change(e.target.value)}
      // Typing in the box must not trigger the operator's global shortcuts (arrows, space, numbers).
      onKeyDown={(e) => e.stopPropagation()}
      onBlur={() => {
        // Leaves an out-of-range entry without applying it: the box goes back to the size in use.
        const px = Number(draft);
        if (draft.trim() !== '' && !(Number.isInteger(px) && px >= SIZE_MIN && px <= SIZE_MAX)) setDraft(value ? String(value) : '');
      }}
      className="h-8 w-20 shrink-0 rounded-md border border-line-strong bg-canvas px-3 text-xs outline-none focus:border-accent"
    />
  );
}

export function StyleToolbar({ style, onChange }: { style: TextStyle; onChange: (patch: TextStyle) => void }) {
  return (
    <div role="toolbar" aria-label="Text formatting" className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-canvas p-2">
      <select
        aria-label="Font family"
        value={style.fontFamily ?? ''}
        onChange={(e) => onChange({ fontFamily: (e.target.value || undefined) as TextFontFamily | undefined })}
        className={CONTROL}
      >
        <option value="">Default</option>
        {TEXT_FONT_GROUPS.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.keys.map((key) => (
              <option key={key} value={key}>{TEXT_FONTS[key].label}</option>
            ))}
          </optgroup>
        ))}
      </select>

      <div role="group" aria-label="Font size" className="flex flex-wrap items-center gap-1">
        <button type="button" aria-pressed={!style.fontSize} onClick={() => onChange({ fontSize: undefined })} className={segClass(!style.fontSize)}>
          Default
        </button>
        {TEXT_SIZES.map((size) => (
          <button
            key={size.key}
            type="button"
            aria-pressed={style.fontSize === size.px}
            onClick={() => onChange({ fontSize: size.px })}
            className={segClass(style.fontSize === size.px)}
          >
            {size.label} [{size.px}px]
          </button>
        ))}
        {/* A custom size, in pixels on the 1920 slide. Only sizes the main process keeps (20 to 200) are applied. */}
        <SizeInput value={style.fontSize} onChange={(px) => onChange({ fontSize: px })} />
      </div>

      <div role="group" aria-label="Alignment" className="flex shrink-0 gap-1">
        {(['left', 'center', 'right'] as TextAlign[]).map((align) => {
          const Icon = ALIGN_ICON[align];
          const on = (style.textAlign ?? 'center') === align;
          return (
            <button key={align} type="button" aria-label={`Align ${align}`} aria-pressed={on} onClick={() => onChange({ textAlign: align })} className={`${segClass(on)} w-9 justify-center px-0`}>
              <Icon size={14} aria-hidden />
            </button>
          );
        })}
      </div>

      <ColorField label="Text colour" value={style.textColor} presets={TEXT_COLORS} onChange={(hex) => onChange({ textColor: hex })} />
    </div>
  );
}

import { CONTINUATION, PART_CHOICES } from '../../shared/lyric-slides.js';

/** Which part a slide is, as a colour: verses carry the accent, a chorus is green, a bridge blue, a tag, outro, coda or ending amber. */
export const partTone = (type: string) =>
  /^Chorus/.test(type)
    ? 'border-ok/50 text-ok'
    : /^Bridge/.test(type)
      ? 'border-info/50 text-info'
      : /^(Tag|Outro|Coda|Ending)/.test(type)
        ? 'border-warn/50 text-warn'
        : 'border-accent/50 text-accent';

/**
 * A slide card's part: Continuation (no label of its own, it carries on the slide before it), Verse 1–5, Chorus, Bridge, Tag or Outro.
 * A slide whose part is not in that list (Verse 6, Chorus 2) keeps it as a choice. The first slide cannot be a continuation.
 */
export function PartSelect({
  n,
  value,
  first,
  onChange,
  labels,
  small = false,
}: {
  /** The slide's number, for its accessible name. */
  n: number;
  /** The slide's part, or CONTINUATION. */
  value: string;
  first: boolean;
  onChange: (part: string) => void;
  labels: { part: string; continuation: string; firstSlide: string };
  small?: boolean;
}) {
  const continuation = value === CONTINUATION;
  const choices = value && !PART_CHOICES.includes(value) ? [...PART_CHOICES, value] : PART_CHOICES;
  return (
    <select
      value={value}
      onChange={(ev) => onChange(ev.target.value)}
      aria-label={`${labels.part}: #${n}`}
      title={labels.part}
      className={`${small ? 'h-6 text-[10px]' : 'h-7 text-[11px]'} max-w-[13rem] min-w-0 cursor-pointer rounded-md border bg-surface-2 px-1.5 font-mono font-bold tracking-wider uppercase outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
        continuation ? 'border-dashed border-line-strong text-muted' : partTone(value)
      }`}
    >
      <option value={CONTINUATION} disabled={first} title={first ? labels.firstSlide : undefined} className="bg-surface text-fg">
        {continuation ? `— ${labels.continuation}` : labels.continuation}
      </option>
      {choices.map((p) => (
        <option key={p} value={p} className="bg-surface text-fg">
          {p}
        </option>
      ))}
    </select>
  );
}

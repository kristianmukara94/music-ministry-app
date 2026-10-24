import type { NoteOverlay } from '../../shared/live.js';

/** The colour choices for the note. Dark text switches the callout to a light box, so the text stays readable. */
export const NOTE_WHITE = '#FFFFFF';
export const NOTE_GOLD = '#ECC98A';
export const NOTE_DARK = '#1A1A1A';

/**
 * A sermon note callout: a centred card in the app's theme, with a prefix pill (NOTE:), the note text, and the
 * verse citation beneath. The default look is the app's amber-on-stone theme. A chosen text colour or accent
 * overrides it inline. Sizes are shares of the stage, so the callout is the same size in the mirror and the panel.
 */
export function NoteCallout({ value, className = '' }: { value: NoteOverlay; className?: string }) {
  const light = value.textColor === NOTE_DARK;
  const custom = value.accent !== NOTE_GOLD || value.textColor !== NOTE_WHITE;
  return (
    <div
      className={`flex min-w-[min(280px,80cqw)] max-w-[70cqw] flex-col items-center gap-[0.8cqh] rounded-xl border border-amber-500/50 bg-stone-900/95 px-[2cqw] py-[1.8cqh] shadow-2xl shadow-amber-950/40 ${className}`}
      style={
        custom
          ? {
              borderColor: value.accent,
              color: light ? NOTE_DARK : value.textColor,
              backgroundColor: light ? 'rgba(255,255,255,0.95)' : undefined,
            }
          : undefined
      }
    >
      <div className="flex items-center gap-[0.8cqw]">
        {value.prefix && (
          <span
            className="inline-block rounded border border-amber-500/40 bg-amber-500/20 px-[0.8cqw] py-[0.3cqh] text-[1.5cqw] font-bold tracking-wide text-amber-300"
            style={custom ? { color: value.accent } : undefined}
          >
            {value.prefix}:
          </span>
        )}
        <span className="text-[2.2cqw] leading-snug font-bold whitespace-pre-line text-stone-100">{value.text}</span>
      </div>
      {value.citation && (
        <span className="text-[1.3cqw] font-medium tracking-wider text-stone-400">{value.citation}</span>
      )}
    </div>
  );
}

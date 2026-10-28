import { dispatch, useLive } from '../live/store';

/** The intro slide's two looks. Title Card is the first slide of a Praise & Worship item; Solid Black is a black screen. */
const OPTIONS: { id: 'title' | 'black'; label: string }[] = [
  { id: 'title', label: 'Title Card' },
  { id: 'black', label: 'Solid Black' },
];

// The card holds its own padding and border, so the toggle sits inside it at every width and never clips the header.
const CARD = 'inline-flex shrink-0 flex-nowrap items-center gap-3 whitespace-nowrap rounded-2xl border border-zinc-700 bg-zinc-900 p-4';
const SEG_GROUP = 'inline-flex h-9 flex-nowrap items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-950 p-0.5';
const SEG = 'inline-flex h-8 items-center whitespace-nowrap rounded-md px-3 text-xs font-bold tracking-wider transition-colors';
const SEG_ON = 'bg-amber-500 text-zinc-950';
const SEG_OFF = 'text-zinc-400 hover:text-zinc-100';

/**
 * The look of the intro slide for the item on air: its title card, or a solid black screen. It changes the projector and the TV at once,
 * and does not change the saved default in Settings.
 */
export function IntroSlideToggle() {
  const mode = useLive((s) => s.state.introSlideMode);
  return (
    <div className={CARD}>
      <span className="text-sm font-semibold text-zinc-200">Intro slide</span>
      <div role="radiogroup" aria-label="Intro slide" className={SEG_GROUP}>
        {OPTIONS.map(({ id, label }) => {
          const on = mode === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => dispatch({ type: 'introSlide/set', value: id })}
              className={`${SEG} ${on ? SEG_ON : SEG_OFF}`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

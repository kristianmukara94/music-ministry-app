import { dispatch, useLive } from '../live/store';

/** The intro slide's two looks. Title Card is the first slide of a Praise & Worship item; Solid Black is a black screen. */
const OPTIONS: { id: 'title' | 'black'; label: string }[] = [
  { id: 'title', label: 'Title Card' },
  { id: 'black', label: 'Solid Black' },
];

// The toggle sits inside the Live view's status bar, which holds the card, the padding and the border.
const CARD = 'inline-flex shrink-0 flex-nowrap items-center gap-3 whitespace-nowrap';
const SEG_GROUP = 'inline-flex h-9 flex-nowrap items-center gap-1 rounded-lg border border-fg/15 bg-panel-2 p-0.5';
const SEG = 'inline-flex h-8 items-center whitespace-nowrap rounded-md px-3 text-xs font-bold tracking-wider transition-colors';
const SEG_ON = 'bg-accent text-on-accent';
const SEG_OFF = 'text-fg/60 hover:text-fg';

/**
 * The look of the intro slide for the item on air: its title card, or a solid black screen. It changes the projector and the TV at once,
 * and does not change the saved default in Settings.
 */
export function IntroSlideToggle() {
  const mode = useLive((s) => s.state.introSlideMode);
  return (
    <div className={CARD}>
      <span className="text-sm font-semibold text-fg/90">Intro slide</span>
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

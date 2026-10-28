import { dispatch, useLive } from '../live/store';
import type { DisplayState } from '../../shared/live.js';

/**
 * The Secondary display's controls on the Live panel: its mode (dual mirrors the projector; independent shows its own frame), its On AIR
 * switch, and in independent mode a push of the staged frame. The switch and the mode never change the projector.
 */
const MODES: { id: DisplayState['mode']; label: string }[] = [
  { id: 'dual', label: 'DUAL (Mirror)' },
  { id: 'independent', label: 'INDEPENDENT' },
];

const SEG = 'rounded-md px-3 py-1.5 text-[11px] font-bold tracking-wider transition-colors';
const SEG_ON = 'bg-amber-500 text-stone-950 shadow-md shadow-amber-950/40';
const SEG_OFF = 'text-stone-400 hover:text-stone-100';

export function SecondaryControls() {
  const display = useLive((s) => s.state.display);
  const staged = useLive((s) => s.state.projector.staged);
  const secondary = display.targets.secondary;
  const independent = display.mode === 'independent';

  return (
    <section aria-labelledby="secondary-controls" className="flex flex-col gap-3 rounded-2xl border border-line bg-panel p-4">
      <h2 id="secondary-controls" className="text-lg font-bold">
        Secondary display (TV)
      </h2>

      <div role="radiogroup" aria-label="Secondary display mode" className="inline-flex w-fit flex-wrap gap-1 rounded-lg border border-line-strong p-1">
        {MODES.map(({ id, label }) => {
          const on = display.mode === id;
          return (
            <button key={id} type="button" role="radio" aria-checked={on} onClick={() => dispatch({ type: 'display/mode', value: id })} className={`${SEG} ${on ? SEG_ON : SEG_OFF}`}>
              {label}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        aria-pressed={secondary.live}
        onClick={() => dispatch({ type: 'display/live', value: !secondary.live })}
        className={`min-h-11 rounded-xl border px-4 text-sm font-bold transition ${
          secondary.live ? 'border-danger bg-danger/15 text-danger' : 'border-line-strong text-muted hover:bg-panel-2'
        }`}
      >
        {secondary.live ? 'ON AIR' : 'OFF'}
      </button>

      {independent && (
        <button
          type="button"
          onClick={() => dispatch({ type: 'display/show', frame: staged })}
          className="min-h-11 rounded-xl border border-line-strong px-4 text-sm font-semibold transition hover:bg-panel-2"
        >
          Push the staged slide to the Secondary display
        </button>
      )}

      <p className="text-xs text-muted">
        {independent
          ? 'The Secondary display shows only what is pushed to it. The projector is not changed.'
          : 'The Secondary display mirrors the projector while it is on air.'}
      </p>
    </section>
  );
}

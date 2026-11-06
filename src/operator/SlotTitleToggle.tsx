import { useState } from 'react';
import { Heading } from 'lucide-react';
import { slotTitleShown } from '../../shared/live.js';
import { bridge } from '../live/bridge';
import { useLive } from '../live/store';
import { setPlanSlotTitle } from '../planner/plan-api';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Show slot title: the switch for the small banner above a slide's text that names its Holy Mass slot or reading ("FIRST READING",
 * "CONGREGATION RESPONSE"). Off, the slide shows only its words.
 *
 * `live` is the Live panel's compact toolbar switch. It shows what the projector does now: when the Holy Mass plan in the queue has its own
 * choice (set in the planner) it changes that plan's choice, so it never seems to do nothing; otherwise it changes the projector setting.
 * Without `live` (the Settings page) it is always the projector setting, which every slide and plan without its own choice follows.
 */
export function SlotTitleToggle({ live = false }: { live?: boolean }) {
  const setting = useLive((s) => s.state.settings.showSlotTitle);
  const shown = useLive((s) => slotTitleShown(s.state));
  const planId = useLive((s) => s.state.queuePlanId);
  const planHasChoice = useLive((s) => s.state.queuePlanId != null && typeof s.state.queueSlotTitle === 'boolean');
  const [error, setError] = useState<string | null>(null);

  const forPlan = live && planId != null && planHasChoice;
  const on = live ? shown : setting;
  const toggle = () => {
    setError(null);
    const saving = forPlan ? setPlanSlotTitle(planId, !on) : bridge.projector.save({ showSlotTitle: !on });
    saving.catch((err: unknown) => setError(errorText(err)));
  };

  const what = on
    ? 'On: slides show the small slot title (such as "First Reading") above their text. Click to hide it.'
    : 'Off: slides show only their words, with no slot title above. Click to show it.';
  const scope = forPlan ? 'The Holy Mass plan in the queue has its own choice, and this changes it.' : 'This is the projector setting, for every plan without its own choice.';
  return (
    <div className={live ? 'flex shrink-0 items-center gap-1' : 'flex flex-col gap-1'}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Show slot title"
        onClick={toggle}
        title={`${what} ${scope}`}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border font-bold tracking-wide whitespace-nowrap uppercase transition focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
          live ? 'h-8 px-2 text-[11px]' : 'h-9 self-start px-3 text-xs'
        } ${on ? 'border-accent bg-accent/15 text-accent' : 'border-fg/15 bg-panel-2 text-fg/80 hover:border-accent/50 hover:text-fg'}`}
      >
        <Heading size={14} aria-hidden />
        {live ? 'Title' : 'Show slot title'}
        {!live && <span className={`rounded px-1.5 py-0.5 text-[10px] ${on ? 'bg-accent text-on-accent' : 'bg-fg/10 text-fg/60'}`}>{on ? 'On' : 'Off'}</span>}
      </button>
      {error && <p role="alert" className="text-xs whitespace-nowrap text-danger">{error}</p>}
    </div>
  );
}

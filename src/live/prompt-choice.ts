import { setUi } from '../state/ui';
import { useLive } from './store';

/**
 * Resets the projector-prompt choice to 'ask' when the operator has a reason to be asked again: the projector turns on by
 * any route, or a different Mass queue or Praise & Worship session is loaded. Returns the function that stops watching.
 */
export function watchProjectorPromptChoice(): () => void {
  return useLive.subscribe((next, prev) => {
    const now = next.state;
    const before = prev.state;
    const projectorTurnedOn = !before.outputs.projector && now.outputs.projector;
    const loadedSomethingNew = before.queuePlanId !== now.queuePlanId || before.pw?.sessionId !== now.pw?.sessionId;
    if (projectorTurnedOn || loadedSomethingNew) setUi({ projectorPromptChoice: 'ask' });
  });
}

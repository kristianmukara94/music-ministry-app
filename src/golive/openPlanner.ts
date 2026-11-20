import type { PlannerTarget } from '../../shared/planner-target.js';
import { setUi } from '../state/ui';

/**
 * The Go Live console's Planner tab: switches the operator's view to the Planner, which opens the target plan (or its kind's calendar) from
 * `plannerRequest`. Only the view changes: nothing is dispatched to the live state, so the projector, the queue and a lineup on air carry on,
 * and the top bar's Go Live shortcut brings the operator straight back to the console.
 */
export function openMatchingPlanner(target: PlannerTarget): void {
  setUi({ plannerRequest: target, view: 'planner' });
}

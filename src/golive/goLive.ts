import { loadPlanToQueue } from '../planner/plan-api';
import { setUi } from '../state/ui';
import { flushSave, openSession, setPwState } from '../praise-worship/store';

/**
 * Loads a saved Mass plan into the Mass Queue and opens the queue. Nothing goes live here: the take is the queue's own
 * Go Live button, which runs through playQueueAt.
 */
export async function loadMassPlanToQueue(planId: number): Promise<void> {
  await loadPlanToQueue(planId);
  setUi({ queueOpen: true });
}

/**
 * Opens a Praise & Worship session on its Live tab. It stops there: the module's own Go Live takes the session live, and
 * shows its projector prompt when the projector is off. Pending edits are saved first, as the module does before it leaves.
 */
export async function openPwLive(sessionId: number): Promise<void> {
  await flushSave();
  await openSession(sessionId);
  setPwState({ tab: 'live' });
  setUi({ view: 'praiseWorship' });
}

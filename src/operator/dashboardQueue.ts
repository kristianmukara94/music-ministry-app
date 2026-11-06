import { useEffect, useState } from 'react';
import { isAnyOutputLive, type LiveState, type QueueItem } from '../../shared/live.js';
import { SHOW_STAGED_UI, frameKey } from '../../shared/stage-plan-row.js';
import { bridge } from '../live/bridge';
import { dispatch, useLive } from '../live/store';
import { goLiveMassAt, massShowing, playMassAt, whenLive } from '../golive/massLive';
import { openQueueItem } from '../planner/routing';
import type { PlanSummary } from '../planner/types';
import { setUi } from '../state/ui';

/** The first queue item that can be shown (its source still exists), or -1. */
export function firstPlayable(queue: QueueItem[]): number {
  return queue.findIndex((q) => !q.stale);
}

/** The next showable item after the queue's place, or the first one before the Mass has started. -1 at the end of the queue. */
export function nextPlayable(state: Pick<LiveState, 'queue' | 'queueCursor'>): number {
  for (let i = Math.max(0, state.queueCursor + 1); i < state.queue.length; i += 1) {
    if (!state.queue[i].stale) return i;
  }
  return -1;
}

/**
 * Start Mass from the dashboard: the first item of the loaded plan goes on screen, with the plan's Holy Mass band staged on the lower third,
 * exactly as the Go Live console's own Go Live does. The operator stays on the dashboard. With the projector off, the usual projector prompt asks first.
 */
export async function startMass(planName: string | null): Promise<void> {
  const { queue } = useLive.getState().state;
  const first = firstPlayable(queue);
  if (first < 0) return;
  await goLiveMassAt(first, planName);
}

/**
 * Stage Next: the next item of the queue is staged, not taken, and the floating preview opens on it, as the planner's ▷ does. The queue's place
 * moves to it, so Take (or the console's Next) carries on from there. Resolves the index staged, or -1 when nothing could be staged.
 */
export async function stageNext(): Promise<{ index: number; key: string } | null> {
  const state = useLive.getState().state;
  const index = nextPlayable(state);
  if (index < 0) return null;
  const before = frameKey(state.projector.staged);
  const staged = await openQueueItem(state.queue[index], index, { inPlace: true });
  if (!staged) return null;
  // The cursor and the staged slide come back from the main process one after the other: wait for the slide itself, as playMassFromEnd does.
  await whenLive((s) => s.queueCursor === index && frameKey(s.projector.staged) !== before);
  setUi(SHOW_STAGED_UI);
  return { index, key: frameKey(useLive.getState().state.projector.staged) };
}

/**
 * Takes the item Stage Next staged. With an output live, the staged slide goes straight up as the queue's take. With none, it goes through the
 * queue's play, which asks to turn the projector on first.
 */
export async function takeStaged(index: number): Promise<void> {
  const state = useLive.getState().state;
  if (isAnyOutputLive(state)) {
    dispatch({ type: 'projector/take', source: 'MASS_QUEUE' });
    return;
  }
  await playMassAt(index);
}

/** Whether Start Mass would cut into a Mass already on screen. */
export const massOnScreen = (state: LiveState) => massShowing(state);

/** Every saved Mass plan, reloaded when the queue's plan changes (a plan made or renamed elsewhere shows up here then). Null while loading. */
export function usePlanList(): PlanSummary[] | null {
  const planId = useLive((s) => s.state.queuePlanId);
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  useEffect(() => {
    let alive = true;
    bridge.plans
      .list()
      .then((list) => alive && setPlans(list))
      .catch(() => alive && setPlans([]));
    return () => {
      alive = false;
    };
  }, [planId]);
  return plans;
}

import { bridge } from '../live/bridge';
import { dispatch, useLive } from '../live/store';
import { queueFromPlan } from './logic';
import type { PlanItem } from './types';

const api = bridge.plans;

/** Name of the plan made when the Service Queue has no plan loaded. */
export const QUICK_PLAN_NAME = 'Quick passages';

const isoToday = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * Appends items to the end of a plan. The plan's rows keep their blocks, so an appended row
 * lands last in its block. The database checks every source before anything is saved.
 */
export async function appendToPlan(planId: number, added: PlanItem[]): Promise<void> {
  const plan = await api.get(planId);
  await api.save(planId, [...plan.items, ...added]);
  syncQueueIfLoaded(planId, (await api.get(planId)).items);
}

/**
 * Re-sends the Service Queue when the plan loaded there has changed, so the drawer never shows an old order.
 * Plans that are not loaded are left alone.
 */
export function syncQueueIfLoaded(planId: number, items: PlanItem[]): void {
  if (useLive.getState().state.queuePlanId !== planId) return;
  dispatch({ type: 'queue/set', items: queueFromPlan(items), planId });
}

/** Loads a plan into the Service Queue, the same way the Mass Planner does. */
export async function loadPlanToQueue(planId: number): Promise<void> {
  const plan = await api.get(planId);
  dispatch({ type: 'queue/set', items: queueFromPlan(plan.items), planId });
}

/**
 * Adds items to the plan loaded in the Service Queue. When no plan is loaded, a "Quick passages"
 * plan for today is created and loaded. Returns the plan that received the items.
 */
export async function addToQueue(added: PlanItem[]): Promise<number> {
  let planId = useLive.getState().state.queuePlanId;
  if (planId == null) {
    const created = await api.create({ name: QUICK_PLAN_NAME, liturgicalDate: isoToday() });
    planId = created.id;
  }
  await appendToPlan(planId, added);
  await loadPlanToQueue(planId);
  return planId;
}

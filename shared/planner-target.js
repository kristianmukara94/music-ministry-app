// The Go Live console's Planner tab: which Planner workspace it opens, and on which plan. Pure, so the console and the tests read it the same
// way. Opening the Planner only changes the operator's view: nothing here touches the live state or what the projector shows.
import { mainLiveStatus } from './main-live.js';

/**
 * The Planner the console's Planner tab opens.
 *   A run on air wins: a Praise & Worship lineup on air opens the Praise & Worship Planner on its session, a Holy Mass on air opens the Holy
 *   Mass Planner on the loaded plan. With nothing on air, the console's active tab decides, on the session or plan picked there.
 *   `date` is the plan's liturgical date when it is in the lists, so the Planner's calendar opens on its month. `id` is null when there is no
 *   plan to open: the Planner then shows that kind's calendar.
 *
 * @param {import('./live.js').LiveState} state
 * @param {{ tab: 'pw' | 'mass', pickedPw?: number | null, pickedMass?: number | null,
 *   sessions?: { id: number, liturgicalDate: string }[] | null, plans?: { id: number, liturgicalDate: string }[] | null }} console
 * @returns {{ kind: 'pw' | 'mass', id: number | null, date: string | null }}
 */
export function resolveMatchingPlannerTarget(state, { tab, pickedPw = null, pickedMass = null, sessions = null, plans = null }) {
  const { onAir } = mainLiveStatus(state);
  const kind = onAir ?? (tab === 'mass' ? 'mass' : 'pw');
  const onAirId = onAir === 'pw' ? (state.pw?.sessionId ?? null) : onAir === 'mass' ? state.queuePlanId : null;
  const id = onAirId ?? (kind === 'pw' ? pickedPw : pickedMass) ?? null;
  const list = kind === 'pw' ? sessions : plans;
  const date = id == null ? null : (list?.find((p) => p.id === id)?.liturgicalDate ?? null);
  return { kind, id, date };
}

/** The Planner tab's tooltip key, in shared/golive-i18n.js: it names the Planner the tab opens. */
export function plannerTabTipKey(target) {
  return target.kind === 'mass' ? 'plannerTipMass' : 'plannerTipPw';
}

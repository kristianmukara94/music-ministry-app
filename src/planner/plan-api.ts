import { bridge } from '../live/bridge';
import { dispatch, useLive } from '../live/store';
import {
  flowRowsOf,
  followCursor,
  insertIntoMassFlow,
  massOrderReset,
  newFlowRows,
  removeFromMassFlow,
  replaceSlotInMassFlow,
  type FlowRow,
  type MassFlowTarget,
  type PictureDeck,
} from '../../shared/flow-insert.js';
import { withDailyReadings, type DailyReadingsOutcome } from '../../shared/daily-readings.js';
import { queueOnAir, whenLive } from '../golive/massLive';
import { queueFromPlan } from './logic';
import { playQueueAt } from './routing';
import type { MassLanguage, PlanItem } from './types';

const api = bridge.plans;

/** Name of the plan made when the Service Queue has no plan loaded. */
export const QUICK_PLAN_NAME = 'Quick passages';

const isoToday = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Each plan's language, as last read or set, so a Mass Order part going on air speaks its plan's language without reading the whole plan.
const languages = new Map<number, MassLanguage>();

/** The language plan `planId` is celebrated in, or null with no plan (or one that cannot be read). */
export async function planLanguage(planId: number | null): Promise<MassLanguage | null> {
  if (planId == null) return null;
  const known = languages.get(planId);
  if (known) return known;
  const plan = await api.get(planId).catch(() => null);
  if (plan) languages.set(planId, plan.language);
  return plan?.language ?? null;
}

/** Saves a plan's language. Its readings and Mass Order rows are changed by the planner (see switchPlanLanguage). */
export async function setPlanLanguage(planId: number, language: MassLanguage): Promise<void> {
  await api.setLanguage(planId, language);
  languages.set(planId, language);
}

/** The plan's own choice for slot titles on its slides: true, false, or null to follow the projector setting. Null when it cannot be read. */
export async function planSlotTitle(planId: number): Promise<boolean | null> {
  return api.slotTitle(planId).catch(() => null);
}

/** Saves a plan's slot-title choice, and applies it at once when the plan is the one loaded in the queue. */
export async function setPlanSlotTitle(planId: number, show: boolean | null): Promise<void> {
  await api.setSlotTitle(planId, show);
  if (useLive.getState().state.queuePlanId === planId) dispatch({ type: 'queue/slotTitle', planId, show });
}

/**
 * Keeps the live state's slot-title choice in step with the plan loaded in the queue: each time a different plan is loaded, its choice is read
 * and sent, so the projector shows or hides slot titles as that plan says. Run once in the operator window. Returns the unsubscribe.
 */
export function watchPlanSlotTitle(): () => void {
  let lastPlan: number | null | undefined;
  const follow = (planId: number | null) => {
    if (planId === lastPlan) return;
    lastPlan = planId;
    if (planId == null) return;
    void planSlotTitle(planId).then((show) => dispatch({ type: 'queue/slotTitle', planId, show }));
  };
  follow(useLive.getState().state.queuePlanId);
  return useLive.subscribe(({ state }) => follow(state.queuePlanId));
}

/** Notes a plan's language as read from the database. */
export function rememberPlanLanguage(planId: number, language: MassLanguage): void {
  languages.set(planId, language);
}

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
 * Sends a plan's rows to the Service Queue. When it is the plan already loaded, CURRENT follows the row it was on, wherever that row now
 * sits, so a row added or removed ahead of it (an append the database files into an earlier block) never moves the queue off the slide on air.
 */
function setQueue(planId: number, items: PlanItem[]): void {
  const { queue, queuePlanId, queueCursor } = useLive.getState().state;
  const next = queueFromPlan(items);
  if (queuePlanId === planId && queueCursor >= 0) dispatch({ type: 'queue/set', items: next, planId, cursor: followCursor(queue, next, queueCursor) });
  else dispatch({ type: 'queue/set', items: next, planId });
}

/**
 * Re-sends the Service Queue when the plan loaded there has changed, so the drawer never shows an old order.
 * Plans that are not loaded are left alone.
 */
export function syncQueueIfLoaded(planId: number, items: PlanItem[]): void {
  if (useLive.getState().state.queuePlanId !== planId) return;
  setQueue(planId, items);
}

/**
 * A plan's items with the day's Responsorial Psalm and Prayer of the Faithful from the Lectionary for `planDate`, the
 * plan's liturgical date. Only slots with nothing usable in them are filled, unless `replace` (see withDailyReadings). Nothing is saved here.
 */
export async function autoPopulateDailyReadings(items: PlanItem[], planDate: string, opts: { replace?: boolean } = {}): Promise<DailyReadingsOutcome<PlanItem>> {
  const day = await bridge.lectionary.getDay(planDate);
  return withDailyReadings(items, planDate, day, opts);
}

/**
 * Fills a plan's empty psalm and prayer slots from the Lectionary for its date, and saves it: done whenever a plan is opened in the planner
 * or loaded for Go Live, so a plan made before the readings were pasted in picks them up. Resolves to the stored items and the slots filled.
 * A plan that cannot be saved as it is (a song deleted since) is left as it is; the planner's Auto-fill button says why.
 */
export async function fillDailyReadings(planId: number): Promise<{ items: PlanItem[]; filled: string[] }> {
  const plan = await api.get(planId);
  languages.set(planId, plan.language);
  try {
    const daily = await autoPopulateDailyReadings(plan.items, plan.liturgicalDate);
    if (daily.filled.length === 0 && daily.moved.length === 0) return { items: plan.items, filled: [] };
    await api.save(planId, daily.items);
    return { items: (await api.get(planId)).items, filled: daily.filled };
  } catch {
    return { items: plan.items, filled: [] };
  }
}

/** Loads a plan into the Service Queue, the same way the Mass Planner does, with the day's psalm and prayers in their empty slots. */
export async function loadPlanToQueue(planId: number): Promise<void> {
  const { items } = await fillDailyReadings(planId);
  setQueue(planId, items);
}

/**
 * Adds items to the plan loaded in the Service Queue. When no plan is loaded, a "Quick passages"
 * plan for today is created and loaded. Returns the plan that received the items.
 */
export async function addToQueue(added: PlanItem[]): Promise<number> {
  const planId = await queuePlanOrQuick();
  await appendToPlan(planId, added);
  await loadPlanToQueue(planId);
  return planId;
}

/** The plan loaded in the Service Queue, or a new "Quick passages" plan for today when none is. */
export async function queuePlanOrQuick(): Promise<number> {
  const planId = useLive.getState().state.queuePlanId;
  if (planId != null) return planId;
  return (await api.create({ name: QUICK_PLAN_NAME, liturgicalDate: isoToday() })).id;
}

// Inserts run one after another, so a second one (a double click, a repeated request) reads the plan the first one saved and finds its rows.
let inserting: Promise<unknown> = Promise.resolve();

/**
 * Puts a PowerPoint deck or text slides into the Holy Mass flow loaded in the Service Queue: into a slot, or straight after the row
 * on air. A deck always goes in as one row that steps through its slides, never a row per slide, and a deck or slide already in the Mass is
 * not put in again. With no plan loaded, a "Quick passages" plan is made and loaded. The change is made without touching the projector: what
 * is on air stays on air, and CURRENT moves with its row when the new rows go in ahead of it, in the same queue change (see
 * shared/flow-insert.js). Every slot and row already in the plan stays.
 * Resolves to the plan that received the rows, how many went in, and how many were left out as already there.
 */
export function insertDeckIntoFlow(payload: (PictureDeck | FlowRow)[], target: MassFlowTarget): Promise<{ planId: number; added: number; skipped: number }> {
  const run = inserting.then(() => insertNow(flowRowsOf(payload), target));
  inserting = run.catch(() => undefined);
  return run;
}

async function insertNow(wanted: FlowRow[], target: MassFlowTarget): Promise<{ planId: number; added: number; skipped: number }> {
  const planId = await queuePlanOrQuick();
  const plan = await api.get(planId);
  const { rows, duplicates } = newFlowRows(plan.items, wanted);
  if (duplicates.length > 0) console.warn('Left out of the Holy Mass, already in it:', duplicates.map((d) => d.label));
  if (rows.length === 0) {
    const what = wanted.length === 1 ? `"${wanted[0].label}" is` : 'These slides are';
    throw new Error(`${what} already in the Holy Mass. Nothing was added.`);
  }
  const live = useLive.getState().state;
  const loaded = live.queuePlanId === planId;
  // The cursor counts rows of the queue, which is the plan as the database returns it. A queue out of step with the plan (an edit not yet
  // sent back) is followed onto the plan first, so the position that moves is the right one.
  const cursor = loaded ? followCursor(live.queue, queueFromPlan(plan.items), live.queueCursor) : -1;
  const placed = insertIntoMassFlow(plan.items, rows, target, cursor);
  if (!placed) throw new Error('That place is not in the plan any more. Choose another.');
  await api.save(planId, placed.items as PlanItem[]);
  const saved = (await api.get(planId)).items;
  const next = queueFromPlan(saved);
  if (loaded && placed.cursor >= 0) dispatch({ type: 'queue/set', items: next, planId, cursor: placed.cursor });
  else dispatch({ type: 'queue/set', items: next, planId });
  return { planId, added: rows.length, skipped: duplicates.length };
}

/**
 * Replace on a Holy Mass slot: the deck (or text slides) takes the place of the song, text or deck that fills `slot` in the plan loaded in
 * the Service Queue, as one row tied to the slot, and the old item is taken out (see replaceSlotInMassFlow). An empty slot is simply filled.
 * The rows put in after the slot stay. A deck already elsewhere in the Mass is not put in again. When the item replaced was on air, the new
 * one goes on air in its place, from its first slide, so the projector never keeps showing a row that is gone.
 * Resolves to the plan, how many rows went in, how many were left out as already there, and the label of the item replaced (null for none).
 */
export function replaceSlotInFlow(payload: (PictureDeck | FlowRow)[], slot: string): Promise<{ planId: number; added: number; skipped: number; replaced: string | null }> {
  const run = inserting.then(() => replaceNow(flowRowsOf(payload), slot));
  inserting = run.catch(() => undefined);
  return run;
}

async function replaceNow(wanted: FlowRow[], slot: string): Promise<{ planId: number; added: number; skipped: number; replaced: string | null }> {
  const planId = await queuePlanOrQuick();
  const plan = await api.get(planId);
  const old = plan.items.find((it) => it.slot === slot);
  // The item being replaced does not count as a copy: replacing a slot with what already fills it changes nothing.
  const { rows, duplicates } = newFlowRows(
    plan.items.filter((it) => it !== old),
    wanted,
  );
  if (rows.length === 0) {
    const what = wanted.length === 1 ? `"${wanted[0].label}" is` : 'These slides are';
    throw new Error(`${what} already in the Holy Mass. Nothing was replaced.`);
  }
  const live = useLive.getState().state;
  const loaded = live.queuePlanId === planId;
  const cursor = loaded ? followCursor(live.queue, queueFromPlan(plan.items), live.queueCursor) : -1;
  const placed = replaceSlotInMassFlow(plan.items, rows, slot, cursor);
  if (!placed) throw new Error('That slot is not in the plan any more. Choose another.');
  const wasOnAir = loaded && placed.replacedCurrent && queueOnAir(live);
  await api.save(planId, placed.items as PlanItem[]);
  const next = queueFromPlan((await api.get(planId)).items);
  if (loaded && placed.cursor >= 0) dispatch({ type: 'queue/set', items: next, planId, cursor: placed.cursor });
  else dispatch({ type: 'queue/set', items: next, planId });
  if (wasOnAir) await playWhenQueued(next, placed.cursor);
  return { planId, added: rows.length, skipped: duplicates.length, replaced: placed.replaced?.label ?? null };
}

/**
 * Remove (✕) on a row of the Go Live lineup: takes the queue row at `index` out of the plan loaded in the Service Queue. A row that filled a
 * Holy Mass slot leaves the slot empty, shown again as an empty slot; any other row is gone. The queue and CURRENT change together, in one
 * queue change, so CURRENT never points past the end or at another row. When the row taken out was on air, the nearest row that can play
 * goes on air in its place (the one that came next, or the one before at the end of the Mass); with none left, the projector is cleared.
 * Resolves to the item taken out.
 */
export function removeFromFlow(index: number): Promise<PlanItem> {
  const run = inserting.then(() => removeNow(index));
  inserting = run.catch(() => undefined);
  return run;
}

async function removeNow(index: number): Promise<PlanItem> {
  const live = useLive.getState().state;
  const planId = live.queuePlanId;
  if (planId == null) throw new Error('No Holy Mass plan is loaded in the queue.');
  const plan = await api.get(planId);
  // The row is found by what it plays, so a queue out of step with the plan takes out the row the operator clicked.
  const saved = queueFromPlan(plan.items);
  const at = followCursor(live.queue, saved, index);
  const cursor = followCursor(live.queue, saved, live.queueCursor);
  const out = at >= 0 ? removeFromMassFlow(plan.items, at, cursor) : null;
  if (!out) throw new Error('That row is not in the plan any more.');
  const wasOnAir = out.removedCurrent && queueOnAir(live);
  await api.save(planId, out.items);
  const next = queueFromPlan((await api.get(planId)).items);
  dispatch({ type: 'queue/set', items: next, planId, cursor: Math.min(out.cursor, next.length - 1) });
  if (wasOnAir) {
    if (out.cursor >= 0) await playWhenQueued(next, out.cursor);
    else dispatch({ type: 'projector/clear' });
  }
  return out.removed;
}

/**
 * Puts `row` in place of the queue row at `index`, in the plan loaded in the Service Queue: same place, same block, same slot. Used by Go
 * Live's Edit slide on air and Add slide, which swap an item for this plan's own copy of it. CURRENT stays on the row. The projector is not
 * touched here; the caller puts the new slide up. Resolves to the row's index in the saved plan.
 */
export function replaceRowInFlow(index: number, row: Pick<PlanItem, 'module' | 'sourceId' | 'label'>): Promise<number> {
  const run = inserting.then(() => replaceRowNow(index, row));
  inserting = run.catch(() => undefined);
  return run;
}

async function replaceRowNow(index: number, row: Pick<PlanItem, 'module' | 'sourceId' | 'label'>): Promise<number> {
  const live = useLive.getState().state;
  const planId = live.queuePlanId;
  if (planId == null) throw new Error('No Holy Mass plan is loaded in the queue.');
  const plan = await api.get(planId);
  // The row is found by what it plays, so a queue out of step with the plan changes the row the operator is on.
  const at = followCursor(live.queue, queueFromPlan(plan.items), index);
  const old = at >= 0 ? plan.items[at] : undefined;
  if (!old) throw new Error('That row is not in the plan any more.');
  const replaced: PlanItem = { block: old.block, slot: old.slot ?? null, module: row.module, sourceId: row.sourceId, label: row.label };
  await api.save(planId, plan.items.map((it, i) => (i === at ? replaced : it)));
  const saved = (await api.get(planId)).items;
  const next = queueFromPlan(saved);
  // The database keeps the rows in block order, so the row stays where it was; it is looked up anyway, by what it now plays.
  const found = saved.findIndex((it, i) => it.module === row.module && it.sourceId === row.sourceId && (i === at || it.block === old.block));
  const cursor = found >= 0 ? found : at;
  dispatch({ type: 'queue/set', items: next, planId, cursor: live.queuePlanId === planId && live.queueCursor === index ? cursor : followCursor(live.queue, next, live.queueCursor) });
  return cursor;
}

/** Plays queue row `index` once the main process has taken the queue change `next`, so the row played is the new one, not the old. */
async function playWhenQueued(next: ReturnType<typeof queueFromPlan>, index: number): Promise<void> {
  const want = next[index]?.id;
  if (!want) return;
  if (await whenLive((s) => s.queue.length === next.length && s.queue[index]?.id === want)) await playQueueAt(index, { inPlace: true });
}

/**
 * Puts the plan loaded in the Service Queue back to its Holy Mass order, for a plan that was filled with slide rows by mistake: the slots
 * and what fills them stay, as do the readings, passages and notes; the slides and PowerPoints put in around the slots go (see massOrderReset).
 * The queue is reloaded from the saved plan. The projector is not touched, and CURRENT stays on its row when that row is kept.
 * Resolves to how many rows were taken out.
 */
export async function resetMassOrder(): Promise<number> {
  const planId = useLive.getState().state.queuePlanId;
  if (planId == null) throw new Error('No Holy Mass plan is loaded in the queue.');
  const plan = await api.get(planId);
  const { items, removed } = massOrderReset(plan.items);
  if (removed > 0) await api.save(planId, items);
  setQueue(planId, (await api.get(planId)).items);
  return removed;
}

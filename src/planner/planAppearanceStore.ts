// Plan Appearance in the operator window: each plan's look as last read or changed (for the Planner's button and drawer), its saving, and the
// watcher that puts the look of the plans loaded for Go Live into the live state, where every output draws it (shared/plan-appearance.js).
import { create } from 'zustand';
import { bridge } from '../live/bridge';
import { dispatch, useLive } from '../live/store';
import { createDebouncedWriter, type DebouncedWriter } from '../../shared/debounced-writer.js';
import { sanitizePlanAppearance, type PlanAppearance, type PlanKind } from '../../shared/plan-appearance.js';

/** How long the Planner waits after the last change before it saves the plan and sends the look to the outputs. */
export const PLAN_APPEARANCE_SAVE_MS = 300;

const keyOf = (kind: PlanKind, id: number) => `${kind}:${id}`;

interface PlanAppearanceStore {
  /** Each plan's look as last read or changed here, by `kind:id`. */
  byPlan: Record<string, PlanAppearance>;
  /** A save that failed, by `kind:id`, so the drawer can say so. */
  errors: Record<string, string>;
}

export const usePlanAppearances = create<PlanAppearanceStore>(() => ({ byPlan: {}, errors: {} }));

/** The plan's look as known here, or undefined before it has been read. */
export const usePlanAppearance = (kind: PlanKind, id: number | null | undefined): PlanAppearance | undefined =>
  usePlanAppearances((s) => (id == null ? undefined : s.byPlan[keyOf(kind, id)]));

const remember = (kind: PlanKind, id: number, appearance: PlanAppearance) =>
  usePlanAppearances.setState((s) => ({ byPlan: { ...s.byPlan, [keyOf(kind, id)]: appearance } }));

const setError = (kind: PlanKind, id: number, message: string | null) =>
  usePlanAppearances.setState((s) => {
    const errors = { ...s.errors };
    if (message) errors[keyOf(kind, id)] = message;
    else delete errors[keyOf(kind, id)];
    return { errors };
  });

/** Reads a plan's look from the database and keeps it here. A plan that cannot be read follows the Global Appearance. */
export async function loadPlanAppearance(kind: PlanKind, id: number): Promise<PlanAppearance> {
  const appearance = await bridge.planAppearance.get(kind, id).catch(() => sanitizePlanAppearance(null));
  remember(kind, id, appearance);
  return appearance;
}

/** Whether the plan is the one of its kind loaded for Go Live. */
function isLoaded(kind: PlanKind, id: number): boolean {
  const state = useLive.getState().state;
  return kind === 'mass' ? state.queuePlanId === id : state.pw?.sessionId === id;
}

/** Sends the look to the outputs when the plan is the one loaded. Any other plan's look waits until it is loaded (see watchPlanAppearance). */
function sendIfLoaded(kind: PlanKind, id: number, appearance: PlanAppearance): void {
  if (isLoaded(kind, id)) dispatch({ type: 'planLook/set', kind, planId: id, appearance });
}

// One writer per plan, so changes made quickly to one plan are saved once, and a change to another plan never drops it.
const writers = new Map<string, DebouncedWriter<{ appearance: PlanAppearance }>>();

function writerFor(kind: PlanKind, id: number) {
  const key = keyOf(kind, id);
  let writer = writers.get(key);
  if (!writer) {
    writer = createDebouncedWriter<{ appearance: PlanAppearance }>({
      delay: PLAN_APPEARANCE_SAVE_MS,
      write: ({ appearance }) =>
        bridge.planAppearance
          .set(kind, id, appearance)
          .then((kept) => {
            setError(kind, id, null);
            sendIfLoaded(kind, id, kept);
          })
          .catch((err: unknown) => setError(kind, id, err instanceof Error ? err.message : String(err))),
    });
    writers.set(key, writer);
  }
  return writer;
}

/**
 * The Planner's change to a plan's look: shown at once in the drawer and its preview, then saved and sent to the outputs once the operator
 * pauses (PLAN_APPEARANCE_SAVE_MS).
 */
export function changePlanAppearance(kind: PlanKind, id: number, appearance: PlanAppearance): void {
  const clean = sanitizePlanAppearance(appearance);
  remember(kind, id, clean);
  writerFor(kind, id).push({ appearance: clean });
}

/** Saves any change still waiting, at once: when the drawer closes or the plan changes. */
export function flushPlanAppearance(kind: PlanKind, id: number): void {
  writers.get(keyOf(kind, id))?.flush();
}

/**
 * Keeps the live state's plan looks in step with the plans loaded for Go Live: each time a different Holy Mass plan is loaded in the queue, or
 * a different Praise & Worship plan is loaded, its look is read and sent. Run once in the operator window. Returns the unsubscribe.
 */
export function watchPlanAppearance(): () => void {
  const last: Record<PlanKind, number | null | undefined> = { mass: undefined, pw: undefined };
  const follow = (kind: PlanKind, id: number | null | undefined) => {
    if (id === last[kind]) return;
    last[kind] = id;
    if (id == null) return;
    void loadPlanAppearance(kind, id).then((appearance) => sendIfLoaded(kind, id, appearance));
  };
  const both = () => {
    const state = useLive.getState().state;
    follow('mass', state.queuePlanId);
    follow('pw', state.pw?.sessionId ?? null);
  };
  both();
  return useLive.subscribe(both);
}

/**
 * Plan Appearance's Overwrite All Slide Overrides: drops the looks set on air (Go Live "This Slide") for the plan's slides, so the plan's look
 * governs every one of them. Only the plan loaded for Go Live has any.
 */
export function clearPlanSlideOverrides(kind: PlanKind, id: number): void {
  dispatch({ type: 'slideLook/clearPlan', kind, planId: id });
}

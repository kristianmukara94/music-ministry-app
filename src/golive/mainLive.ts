import { bandFixAction, mainLiveStatus, mainLiveTab, restoreMassActions } from '../../shared/main-live.js';
import { bridge } from '../live/bridge';
import { dispatch, useLive } from '../live/store';
import { resumeLive } from '../praise-worship/live';
import { setGoLiveFocused } from '../praise-worship/useGoLiveFocus';
import { setUi } from '../state/ui';
import { goLiveMassAt, holyMassBand } from './massLive';

/** The loaded plan's name, for the Holy Mass lower third band. Null when it cannot be read. */
async function planName(planId: number | null): Promise<string | null> {
  if (planId == null) return null;
  return bridge.plans
    .get(planId)
    .then((plan) => plan.name)
    .catch(() => null);
}

/**
 * The top bar's Go Live shortcut. It always opens the Go Live console, on the tab of the run that is on air (or parked). When an ad-hoc LIVE
 * item has taken the screen from the Holy Mass or a Praise & Worship lineup, it also puts that run's slide straight back on the screen
 * (Back to Main Live): the Mass on the slide it showed, the lineup at its segment and slide.
 */
export async function goToMainLive(): Promise<void> {
  const state = useLive.getState().state;
  const { parked } = mainLiveStatus(state);
  const tab = mainLiveTab(state);
  setUi({ view: 'goLive', ...(tab ? { goLiveTabRequest: tab } : {}) });
  if (!parked) return;
  // The ad-hoc song's focus view is left, so the operator lands on the console that now has the screen.
  setGoLiveFocused(false);

  if (parked === 'pw') {
    await resumeLive();
    return;
  }

  // The slide goes back at once, so the screen never waits on the plan's name. The band is put right once the name is read.
  const actions = restoreMassActions(state);
  const parkedRow = state.queueParked?.index ?? -1;
  if (actions) actions.forEach(dispatch);
  const name = await planName(state.queuePlanId);
  // No slide was kept (the Mass was parked before its first slide went up): the row plays again from its start.
  if (!actions && parkedRow >= 0) await goLiveMassAt(parkedRow, name);
  const fix = bandFixAction(useLive.getState().state, holyMassBand(name));
  if (fix) dispatch(fix);
}

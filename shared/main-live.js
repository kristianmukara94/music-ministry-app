// The top bar's Go Live shortcut: which main run (the Holy Mass queue or a Praise & Worship lineup) has the screen, which one is parked behind an
// ad-hoc LIVE item (a song, prayer, reading or passage sent straight to the projector), and the actions that put the parked Mass slide back.
// Pure, so the operator window and the tests read it the same way.

/** The Holy Mass has the screen: it has a place, its last take came from the queue, and something is showing. */
function massOnAir(state) {
  return state.queueCursor >= 0 && state.projector.source === 'MASS_QUEUE' && state.projector.live.kind !== 'idle';
}

/** The parked Holy Mass row, when it is still in the loaded plan and can be played. */
function parkedMassRow(state) {
  const q = state.queueParked;
  if (!q || q.planId !== state.queuePlanId) return null;
  const item = state.queue[q.index];
  return item && !item.stale ? item : null;
}

/**
 * Where the main service is.
 *   onAir: the run that has the screen now ('mass' or 'pw'), or null.
 *   parked: with nothing on air, the run that was taken off the screen and can be put back ('mass' before 'pw': a Mass is only parked after it
 *     last had the screen, while a Praise & Worship place outlives any later Mass). Null when there is nothing to go back to.
 *   override: something else is on the screen over the parked run, so Back to Main Live is lit.
 */
export function mainLiveStatus(state) {
  if (massOnAir(state)) return { onAir: 'mass', parked: null, override: false };
  if (state.pw?.onAir === true) return { onAir: 'pw', parked: null, override: false };
  const parked = parkedMassRow(state) ? 'mass' : state.pw && state.pw.segmentKey != null ? 'pw' : null;
  return { onAir: null, parked, override: parked !== null && state.projector.live.kind !== 'idle' };
}

/** The Go Live console tab the shortcut opens: the run on air or parked, else null (the console's own choice). */
export function mainLiveTab(state) {
  const { onAir, parked } = mainLiveStatus(state);
  return onAir ?? parked;
}

/**
 * The actions that put a parked Holy Mass back on the screen at the slide it showed: its row becomes CURRENT again, and the slide goes up on
 * the queue's own take. A segment band left on the lower third by the ad-hoc item (a song's title) is replaced by `band`, so the lower third
 * names the Mass again. Null when no Mass is parked, or its slide was not kept: the caller then plays the row from its start.
 */
export function restoreMassActions(state, band) {
  const q = state.queueParked;
  if (!parkedMassRow(state) || !q.frame) return null;
  const actions = [
    { type: 'queue/cursor', index: q.index },
    { type: 'projector/stage', frame: q.frame },
    { type: 'projector/take', source: 'MASS_QUEUE' },
  ];
  const fix = bandFixAction(state, band);
  if (fix) actions.push(fix);
  return actions;
}

/**
 * Replaces a segment band on air (the title an ad-hoc song put up) with the main run's `band`. A band of another kind (a speaker's name) is
 * the operator's own and is left alone, as is a lower third that is off. Null when nothing needs to change.
 */
export function bandFixAction(state, band) {
  const live = state.lowerThird.live;
  if (!band || live?.template !== 'segment' || JSON.stringify(live) === JSON.stringify(band)) return null;
  return { type: 'lowerThird/show', value: band };
}

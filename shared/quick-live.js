// The Quick-Live Mini Output Preview: the small popup that opens when a planner library LIVE button (a song, prayer, reading or passage)
// sends an item straight to the projector. It shows the slide on air and the next one, steps through the item with Back and Next, and on exit
// puts the parked Holy Mass or Praise & Worship run back (or clears the screen when nothing was running).
//
// The popup keeps only the item's slides and the run it parked. Where it is in the item is always read from the live state, so a step that
// goes over IPC, a Blackout or a pause never leaves the popup showing the wrong place. Pure, so the operator window and the tests agree.

import { mainLiveStatus } from './main-live.js';

/**
 * A new popup session for an item that just went live. `before` is the live state as it was before the LIVE press: the run on air then (or one
 * already parked) is the one the popup's exit puts back. A LIVE press over an open popup keeps the run the first one parked.
 */
export function quickLiveSession(before, { title, frames }, previous = null) {
  const status = before ? mainLiveStatus(before) : { onAir: null, parked: null };
  const parked = previous ? previous.parked : (status.onAir ?? status.parked ?? null);
  return { title: String(title ?? ''), frames: Array.isArray(frames) ? frames : [], parked };
}

/**
 * The item slide the projector holds for the operator: the slide on air, the one Blackout covers, or the one waiting while the output is
 * paused. The welcome screen is not the item's, so under it the item is not on screen.
 */
export function heldFrame(projector) {
  if (!projector) return null;
  if (projector.paused) return projector.staged ?? null;
  if (projector.live?.kind === 'blackout') return projector.beforeBlackout ?? null;
  return projector.live ?? null;
}

/** Where a frame sits in its item: a song's stanza, a prayer's page, a reading's or passage's slide. */
function placeOf(frame) {
  switch (frame?.kind) {
    case 'lyrics':
      return frame.song?.position ?? 0;
    case 'text':
      return frame.page?.index ?? 0;
    case 'deck':
    case 'psalm':
      return frame.index ?? 0;
    case 'image':
      return frame.deck?.index ?? 0;
    case 'pw':
      return frame.index ?? 0;
    default:
      return 0;
  }
}

/** What a frame shows, apart from its place: its kind and its key (a passage, which has none, by its verses; else its title). */
function itemOf(frame) {
  if (!frame) return '';
  const id = frame.key ?? (frame.passage ? JSON.stringify(frame.passage) : (frame.title ?? frame.segmentName ?? ''));
  return `${frame.kind}|${id}`;
}

/** True when two frames are the same slide of the same item. An edited song or prayer (new words, same place) still counts. */
export function sameSlide(a, b) {
  return Boolean(a && b) && itemOf(a) === itemOf(b) && placeOf(a) === placeOf(b);
}

/** The 0-based slide of the item on air, or -1 when the item is not on the projector any more (a run, Clear or another item took it). */
export function quickLiveIndex(session, projector) {
  if (!session || !projector || projector.source !== 'DIRECT_DECK') return -1;
  const held = heldFrame(projector);
  return held ? session.frames.findIndex((f) => sameSlide(f, held)) : -1;
}

/** The item slide after the one on air, or null on its last slide (End of item) or when the item is off screen. */
export function quickLiveNextFrame(session, projector) {
  const i = quickLiveIndex(session, projector);
  return i >= 0 ? (session.frames[i + 1] ?? null) : null;
}

/**
 * The action for Back (-1) or Next (+1): the neighbouring slide as a direct show, so the parked run's place is never touched. Under Blackout
 * the slide waits behind it, as any step does. Null at the first or last slide, or when the item is off screen.
 */
export function quickLiveStepAction(session, projector, delta) {
  const i = quickLiveIndex(session, projector);
  if (i < 0) return null;
  const frame = session.frames[i + delta];
  return frame ? { type: 'projector/show', frame, source: 'DIRECT_DECK' } : null;
}

/** "01 / 12": the operator's place in the item, or null when the item is off screen. */
export function quickLiveCounter(session, projector) {
  const i = quickLiveIndex(session, projector);
  if (i < 0) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(i + 1)} / ${pad(session.frames.length)}`;
}

/**
 * What leaving the popup does (its Return / End button, the × and Escape):
 *   'restore': a run was parked by this item and is still parked, so it goes back on air at its slide (Back to Main Live).
 *   'clear':   nothing was parked and the item is still on the projector (or behind Blackout), so the screen is cleared.
 *   'none':    something else already has the screen; it is left alone and the popup only closes.
 */
export function quickLiveExit(session, state) {
  if (!session || !state) return 'none';
  if (session.parked && mainLiveStatus(state).parked) return 'restore';
  return quickLiveIndex(session, state.projector) >= 0 ? 'clear' : 'none';
}

/**
 * The popup closes by itself once a main run is back on air (the top bar's Back to Main Live, the Go Live console, a clicker step), so a stale
 * popup never sits over the run. `seen` says the popup has seen its item on air at least once, so the live state that still lags behind the
 * LIVE press (it arrives over IPC) does not close it as soon as it opens.
 */
export function quickLiveShouldClose(session, state, seen) {
  if (!session || !state || !seen) return false;
  return mainLiveStatus(state).onAir !== null;
}

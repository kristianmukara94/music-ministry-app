// Crash recovery for the live session. The main process saves what the congregation sees after every change, and a launch after a crash
// puts it back: the projector's frames, the lower third, the Secondary display, the Mass Queue's place and the Praise & Worship position.
// Pure: no Electron, no database. The store (electron/session-store.js) writes the rows; the timer is passed in so tests drive it.

export const SESSION_VERSION = 1;

/** A saved session older than this is not restored: it is from another service, not a crash a moment ago. */
export const RECOVERY_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const IDLE = { kind: 'idle' };
const SOURCES = ['MASS_QUEUE', 'DIRECT_DECK', 'PW_SESSION'];

const isFrame = (f) => f != null && typeof f === 'object' && typeof f.kind === 'string';
const frameOr = (f, fallback) => (isFrame(f) ? f : fallback);
const isObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/** True when something is on air: the session is worth restoring after a crash. Off air, there is nothing to put back. */
export function sessionIsLive(state) {
  return (
    state.outputs?.projector === true ||
    state.outputs?.lowerThird === true ||
    state.display?.targets?.secondary?.live === true ||
    state.pw?.onAir === true ||
    state.queueCursor >= 0
  );
}

/** The part of the live state a crash would lose. Null when nothing is on air. Settings and looks come from config.json, and the queue from the plan. */
export function sessionSnapshot(state, savedAt) {
  if (!sessionIsLive(state)) return null;
  const p = state.projector;
  return {
    v: SESSION_VERSION,
    savedAt,
    outputs: { ...state.outputs },
    projector: {
      live: p.live,
      staged: p.staged,
      paused: p.paused,
      beforeBlackout: p.beforeBlackout,
      background: p.background,
      source: p.source,
      look: p.look ?? null,
    },
    lowerThird: state.lowerThird,
    display: state.display,
    introSlideMode: state.introSlideMode,
    noteOverlay: state.noteOverlay,
    counter: state.counter,
    queuePlanId: state.queuePlanId,
    queueSlotTitle: state.queueSlotTitle ?? null,
    queueCursor: state.queueCursor,
    pw: state.pw,
  };
}

/** Which page of its frame is on screen (0 when the frame has one page). Under Blackout, the page the blackout covers. */
export function slideIndexOf(snapshot) {
  const p = snapshot.projector;
  const f = p.live?.kind === 'blackout' && p.beforeBlackout ? p.beforeBlackout : p.live;
  if (p.source === 'PW_SESSION' && Number.isInteger(snapshot.pw?.slide)) return snapshot.pw.slide;
  if (f?.kind === 'image' && f.deck) return f.deck.index;
  if (f?.kind === 'lyrics' && f.song) return f.song.position;
  if (f?.kind === 'text' && f.page) return f.page.index;
  return Number.isInteger(f?.index) ? f.index : 0;
}

/** The row for `live_session_state`: the snapshot as JSON, and its main facts as columns for reading at a glance. */
export function sessionRow(snapshot, queue) {
  const p = snapshot.projector;
  const lt = snapshot.lowerThird?.live;
  const slot = snapshot.queueCursor >= 0 ? queue?.[snapshot.queueCursor]?.slot : null;
  return {
    active_plan_id: snapshot.queuePlanId == null ? null : String(snapshot.queuePlanId),
    active_pw_session_id: snapshot.pw?.sessionId == null ? null : String(snapshot.pw.sessionId),
    active_slot_id: slot == null ? null : String(slot),
    active_slide_index: slideIndexOf(snapshot),
    lower_third_enabled: lt ? 1 : 0,
    lower_third_text: lt ? [lt.line1, lt.line2].filter(Boolean).join('\n') : null,
    blackout_enabled: p.live?.kind === 'blackout' ? 1 : 0,
    clear_text_enabled: snapshot.outputs.projector && p.live?.kind === 'idle' ? 1 : 0,
    queue_cursor_index: snapshot.queueCursor,
    presentation_mode: p.source ?? null,
    snapshot: JSON.stringify(snapshot),
  };
}

/**
 * Puts a saved session back into a freshly started state. `queue` is the saved plan's queue as rebuilt from the database (null when the plan
 * is gone), and `pwExists` says whether the saved Praise & Worship session still exists. Returns null when the snapshot cannot be used:
 * a newer or unreadable format, or one older than RECOVERY_MAX_AGE_MS.
 */
export function restoreSession(state, snapshot, { queue, pwExists, now }) {
  if (!isObject(snapshot) || snapshot.v !== SESSION_VERSION || !isObject(snapshot.projector) || !isObject(snapshot.outputs)) return null;
  if (!Number.isFinite(snapshot.savedAt) || now - snapshot.savedAt > RECOVERY_MAX_AGE_MS || snapshot.savedAt > now + 60_000) return null;

  const sp = snapshot.projector;
  const hasPlan = snapshot.queuePlanId != null && Array.isArray(queue);
  const cursor = hasPlan && Number.isInteger(snapshot.queueCursor) && snapshot.queueCursor < queue.length ? snapshot.queueCursor : -1;
  const pw = isObject(snapshot.pw) && pwExists ? snapshot.pw : null;

  // A frame whose plan or session is gone stays on screen, as a direct projection: what the congregation saw does not change.
  let source = SOURCES.includes(sp.source) ? sp.source : null;
  if ((source === 'MASS_QUEUE' && cursor < 0) || (source === 'PW_SESSION' && !pw?.onAir)) source = 'DIRECT_DECK';

  const background = isObject(sp.background) ? { live: sp.background.live ?? null, staged: sp.background.staged ?? null } : state.projector.background;
  const lowerThird = isObject(snapshot.lowerThird)
    ? {
        live: snapshot.lowerThird.live ?? null,
        staged: snapshot.lowerThird.staged ?? null,
        paused: snapshot.lowerThird.paused === true,
        choice: ['on', 'off'].includes(snapshot.lowerThird.choice) ? snapshot.lowerThird.choice : null,
      }
    : state.lowerThird;
  const display = isObject(snapshot.display?.targets?.secondary) ? snapshot.display : state.display;
  const paused = sp.paused === true;

  const next = {
    ...state,
    rev: state.rev + 1,
    outputs: Object.fromEntries(Object.keys(state.outputs).map((k) => [k, snapshot.outputs[k] === true])),
    projector: {
      ...state.projector,
      live: frameOr(sp.live, IDLE),
      staged: frameOr(sp.staged, IDLE),
      paused,
      beforeBlackout: isFrame(sp.beforeBlackout) ? sp.beforeBlackout : null,
      background,
      source,
      ...(paused && isObject(sp.look) ? { look: sp.look } : {}),
    },
    lowerThird,
    display,
    introSlideMode: ['title', 'black'].includes(snapshot.introSlideMode) ? snapshot.introSlideMode : state.introSlideMode,
    noteOverlay: snapshot.noteOverlay ?? null,
    counter: snapshot.counter ?? null,
    pw,
  };
  if (hasPlan) {
    next.queue = queue;
    next.queuePlanId = snapshot.queuePlanId;
    next.queueSlotTitle = typeof snapshot.queueSlotTitle === 'boolean' ? snapshot.queueSlotTitle : null;
  }
  next.queueCursor = cursor;
  return next;
}

/**
 * Saves the session after changes, at most once per turn of the event loop: a burst of actions from one click is one write. A write that
 * would store what is already stored is skipped. When nothing is on air the row is cleared, so only a crash mid-service leaves one behind.
 *
 * @param {{ save: (row: object) => void, clear: () => void, now?: () => number, schedule?: (fn: () => void) => unknown, onError?: (err: unknown) => void }} options
 */
export function createSessionWriter({ save, clear, now = Date.now, schedule = setImmediate, onError = () => {} }) {
  let latest = null;
  let scheduled = false;
  // What is in the store now: the JSON of the last snapshot written (without its time), or null for no row. Undefined until the first write.
  let stored;

  const flush = () => {
    scheduled = false;
    if (latest === null) return;
    const state = latest;
    latest = null;
    try {
      const snapshot = sessionSnapshot(state, 0);
      const key = snapshot ? JSON.stringify(snapshot) : null;
      if (key === stored) return;
      if (snapshot) {
        snapshot.savedAt = now();
        save(sessionRow(snapshot, state.queue));
      } else {
        clear();
      }
      stored = key;
    } catch (err) {
      // Left unmarked, so the next change tries again.
      stored = undefined;
      onError(err);
    }
  };

  return {
    /** The live state changed. The write happens on the next turn of the event loop, with the newest state by then. */
    push(state) {
      latest = state;
      if (scheduled) return;
      scheduled = true;
      schedule(flush);
    },
    /** Writes the pending change now (before quitting). */
    flush,
    /** Drops the pending change and forgets what is stored, for a clean quit that clears the row itself. */
    reset() {
      latest = null;
      stored = undefined;
    },
  };
}

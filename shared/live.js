import { sanitizeProjectorSettings, PROJECTOR_SETTINGS_DEFAULTS } from './projector-settings.js';
import { WELCOME_DEFAULTS, sanitizeWelcomeSettings } from './welcome-settings.js';
import { sanitizeLowerThirdStyle, LOWER_THIRD_DEFAULTS } from './lower-third-style.js';
// Single source of truth for what the congregation sees.
// Plain JS so the Electron main process (authoritative copy) and the
// renderer (browser fallback + optimistic UI) run the exact same reducer.
// Types live in live.d.ts.
//
// The projector has two layers:
//   background  looping media (image or video) behind everything
//   foreground  text, lyrics, readings, announcements (the `live` / `staged` frames)

export const OUTPUTS = ['projector', 'lowerThird', 'preview'];

const IDLE = { kind: 'idle' };
const NO_BACKGROUND = { live: null, staged: null };

// Older saved browser state has no background layer; treat it as empty.
const backgroundOf = (p) => p.background ?? NO_BACKGROUND;

export function initialLiveState() {
  return {
    rev: 0,
    outputs: { projector: false, lowerThird: false, preview: false },
    settings: PROJECTOR_SETTINGS_DEFAULTS,
    welcome: WELCOME_DEFAULTS,
    calibration: false,
    counter: null,
    noteOverlay: null,
    lowerStyle: LOWER_THIRD_DEFAULTS,
    projector: { live: IDLE, staged: IDLE, paused: false, beforeBlackout: null, background: NO_BACKGROUND, source: null },
    lowerThird: { live: null, staged: null, paused: false },
    queue: [],
    queuePlanId: null,
    queueCursor: -1,
    // Praise & Worship: the session loaded for live use and where the operator is in it. Null when none is loaded.
    pw: null,
  };
}

export function liveReducer(state, action) {
  const next = reduce(state, action);
  return next === state ? state : { ...next, rev: state.rev + 1 };
}

// Staging rules: content always lands in `staged`. It only reaches `live`
// when the output is not paused and not blacked out.
function showFrame(p, frame) {
  if (p.paused) return { ...p, staged: frame };
  if (p.live.kind === 'blackout') return { ...p, staged: frame, beforeBlackout: frame };
  return { ...p, staged: frame, live: frame };
}

function showLowerThird(l, value) {
  return l.paused ? { ...l, staged: value } : { ...l, staged: value, live: value };
}

// The Mass Queue's CURRENT selection ends whenever the projector stops showing queue content. Spread into a reducer result.
function endQueueSelection(s) {
  return s.queueCursor === -1 ? {} : { queueCursor: -1 };
}

// Praise & Worship is on air until something else takes the projector. Its session and position are kept, so it can take over again.
function endPwAir(s) {
  return s.pw?.onAir ? { pw: { ...s.pw, onAir: false } } : {};
}

function reduce(s, a) {
  switch (a.type) {
    case 'output/toggle': {
      const outputs = { ...s.outputs, [a.output]: !s.outputs[a.output] };
      const ended = a.output === 'projector' && !outputs.projector ? { ...endQueueSelection(s), ...endPwAir(s) } : {};
      return { ...s, ...ended, outputs };
    }

    case 'output/set': {
      if (s.outputs[a.output] === a.on) return s;
      // Switching the projector off ends a pause, since Resume is disabled while the projector is off. The next turn-on
      // then shows the latest state, not the frame that was frozen.
      if (a.output === 'projector' && !a.on && s.projector.paused) s = reduce(s, { type: 'projector/pause', paused: false });
      const outputs = { ...s.outputs, [a.output]: a.on };
      const ended = a.output === 'projector' && !a.on ? { ...endQueueSelection(s), ...endPwAir(s) } : {};
      return { ...s, ...ended, outputs };
    }

    // Only a direct show ends the selection. The startup screen is not one, so a restored selection survives launch.
    // Praise & Worship's show is tagged with its source, so the console can tell who has the projector. It also ends
    // the Mass Queue's selection: whichever took the projector last is the one on air.
    case 'projector/show': {
      if (a.source === 'PW_SESSION') {
        return { ...s, ...endQueueSelection(s), projector: { ...showFrame(s.projector, a.frame), source: 'PW_SESSION' } };
      }
      const ended = a.source === 'DIRECT_DECK' ? { ...endQueueSelection(s), ...endPwAir(s) } : {};
      return { ...s, ...ended, projector: showFrame(s.projector, a.frame) };
    }

    // Clear touches only the foreground: the background keeps playing.
    case 'projector/clear':
      return { ...s, ...endQueueSelection(s), ...endPwAir(s), projector: { ...showFrame(s.projector, IDLE), source: null } };

    case 'projector/blackout': {
      const p = s.projector;
      if (p.live.kind === 'blackout') {
        return { ...s, projector: { ...p, live: p.beforeBlackout ?? IDLE, beforeBlackout: null } };
      }
      // Blackout deliberately ignores pause: it is the emergency exit.
      return { ...s, ...endQueueSelection(s), projector: { ...p, live: { kind: 'blackout' }, beforeBlackout: p.live } };
    }

    case 'projector/pause': {
      const p = s.projector;
      const paused = a.paused ?? !p.paused;
      if (paused === p.paused) return s;
      if (paused) return { ...s, projector: { ...p, paused } };
      if (p.live.kind === 'blackout') return { ...s, projector: { ...p, paused, beforeBlackout: p.staged } };
      return { ...s, projector: { ...p, paused, live: p.staged } };
    }

    case 'projector/step': {
      const f = s.projector.staged;
      const count = f.kind === 'deck' ? f.slides.length : f.kind === 'psalm' ? f.pages.length : 0;
      if (count === 0) return s;
      const index = Math.min(Math.max(f.index + a.delta, 0), count - 1);
      if (index === f.index) return s;
      return { ...s, projector: showFrame(s.projector, { ...f, index }) };
    }

    // Stage loads a frame without touching the screen; take moves staged → live.
    case 'projector/stage':
      return { ...s, projector: { ...s.projector, staged: a.frame } };

    case 'projector/take': {
      const p = s.projector;
      if (p.paused || p.live === p.staged) return s;
      // Who sent the frame: the Mass Queue, or a module deck. A module deck's take is a direct projection, so it ends the selection.
      const source = a.source ?? 'DIRECT_DECK';
      const ended = source === 'DIRECT_DECK' ? endQueueSelection(s) : {};
      if (source !== 'PW_SESSION') Object.assign(ended, endPwAir(s));
      if (p.live.kind === 'blackout') return { ...s, ...ended, projector: { ...p, beforeBlackout: p.staged } };
      return { ...s, ...ended, projector: { ...p, live: p.staged, source } };
    }

    // Background layer: stage a media item, then take it live. Blackout hides it without clearing it.
    case 'background/stage':
      return { ...s, projector: { ...s.projector, background: { ...backgroundOf(s.projector), staged: a.media } } };

    case 'background/take': {
      const bg = backgroundOf(s.projector);
      if (bg.live === bg.staged) return s;
      return { ...s, projector: { ...s.projector, background: { ...bg, live: bg.staged } } };
    }

    case 'background/clear':
      return { ...s, projector: { ...s.projector, background: NO_BACKGROUND } };

    case 'lowerThird/show':
      return { ...s, lowerThird: showLowerThird(s.lowerThird, a.value) };

    // Clearing takes the lower third off the screen but keeps the last value staged, so toggling it on brings it back.
    // Stages a lower third without showing it. The header toggle or lowerThird/toggle takes it live.
    // Projector output settings, saved by the main process and broadcast to every window.
    case 'settings/projector':
      return { ...s, settings: sanitizeProjectorSettings({ ...s.settings, ...a.value }) };

    case 'settings/welcome':
      return { ...s, welcome: sanitizeWelcomeSettings({ ...s.welcome, ...a.value }) };

    // The lower third's look: position, background, type, reference and outline. Saved in config.json.
    case 'lowerStyle/set':
      return { ...s, lowerStyle: sanitizeLowerThirdStyle({ ...s.lowerStyle, ...a.value }) };

    // The Bible note overlay: a short callout sent to the projector, or cleared.
    case 'noteOverlay/show':
      return { ...s, noteOverlay: a.value };

    case 'noteOverlay/clear':
      return { ...s, noteOverlay: null };

    // The Announcements deck's counter: which slide it is on, out of how many, and whether to project it.
    case 'counter/set':
      return { ...s, counter: a.counter };

    // Shows or hides the calibration grid on the projector.
    case 'calibration/toggle':
      return { ...s, calibration: !s.calibration };

    case 'lowerThird/stage':
      return { ...s, lowerThird: { ...s.lowerThird, staged: a.value } };

    case 'lowerThird/clear':
      return { ...s, lowerThird: { ...s.lowerThird, live: null } };

    // The header button: on, it shows the staged lower third; off, it clears it. Nothing is shown if nothing was staged.
    case 'lowerThird/toggle': {
      const l = s.lowerThird;
      if (l.live) return { ...s, lowerThird: { ...l, live: null } };
      return l.staged ? { ...s, lowerThird: { ...l, live: l.staged } } : s;
    }

    case 'lowerThird/pause': {
      const l = s.lowerThird;
      const paused = a.paused ?? !l.paused;
      if (paused === l.paused) return s;
      return { ...s, lowerThird: paused ? { ...l, paused } : { ...l, paused, live: l.staged } };
    }

    // Stop ends everything on the projector, background included.
    case 'stop':
      return {
        ...s,
        ...endQueueSelection(s),
        ...endPwAir(s),
        projector: { live: IDLE, staged: IDLE, paused: false, beforeBlackout: null, background: NO_BACKGROUND, source: null },
        lowerThird: { live: null, staged: null, paused: false },
      };

    // Loading a different plan resets the position to before the first item. Re-sending the same plan
    // (after the planner saves it) keeps the position, so an edit does not lose the place in the service.
    case 'queue/set': {
      const samePlan = a.planId != null && a.planId === s.queuePlanId;
      return { ...s, queue: a.items, queuePlanId: a.planId ?? null, queueCursor: samePlan ? s.queueCursor : -1 };
    }

    // The item the operator last opened from the queue. Persisted, so a restart resumes here.
    case 'queue/cursor':
      if (s.queueCursor === a.index) return s;
      return { ...s, queueCursor: a.index };

    // Loads a Praise & Worship session for live use, at its start and off air. Reloading the same session keeps the place.
    case 'pw/load':
      if (s.pw?.sessionId === a.sessionId) return s;
      return { ...s, pw: { sessionId: a.sessionId, segmentKey: null, slide: 0, startedAt: null, liveSince: null, onAir: false } };

    // Moves the live position and puts Praise & Worship on air. Sent with the projector/show of the same slide.
    // Times come from the action, so the reducer stays pure. A new segment restarts the segment timer.
    case 'pw/cursor': {
      if (!s.pw) return s;
      const newSegment = a.segmentKey !== s.pw.segmentKey || s.pw.startedAt == null;
      return {
        ...s,
        ...endQueueSelection(s),
        pw: {
          ...s.pw,
          segmentKey: a.segmentKey,
          slide: a.slide,
          startedAt: newSegment ? a.now : s.pw.startedAt,
          liveSince: s.pw.liveSince ?? a.now,
          onAir: true,
        },
      };
    }

    case 'pw/end':
      return s.pw ? { ...s, pw: null } : s;

    default:
      return s;
  }
}

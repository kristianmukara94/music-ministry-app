import { sanitizeProjectorSettings, PROJECTOR_SETTINGS_DEFAULTS, INTRO_SLIDE_MODES } from './projector-settings.js';
import { WELCOME_DEFAULTS, sanitizeWelcomeSettings } from './welcome-settings.js';
import { sanitizeLowerThirdStyle, LOWER_THIRD_DEFAULTS } from './lower-third-style.js';
import { sanitizeAlert } from './sanctuary-alert.js';
// Single source of truth for what the congregation sees.
// Plain JS so the Electron main process (authoritative copy) and the
// renderer (browser fallback + optimistic UI) run the exact same reducer.
// Types live in live.d.ts.
//
// The projector has two layers:
//   background  looping media (image or video) behind everything
//   foreground  text, lyrics, readings, announcements (the `live` / `staged` frames)

export const OUTPUTS = ['projector', 'lowerThird', 'preview'];

/** The two display targets. `primary` is the projector (the `projector` output); `secondary` is the TV and the Secondary port's viewers. */
export const DISPLAY_MODES = ['dual', 'independent'];

/**
 * What the secondary display shows. In dual mode it mirrors the primary (the projector's frame). In independent mode it shows its own frame,
 * pushed with display/show, and its own live switch decides whether it is on air.
 */
export function secondaryFrame(state) {
  return state.display.mode === 'dual' ? state.projector.live : state.display.targets.secondary.frame;
}

const IDLE = { kind: 'idle' };
const NO_BACKGROUND = { live: null, staged: null };

// Older saved browser state has no background layer; treat it as empty.
const backgroundOf = (p) => p.background ?? NO_BACKGROUND;

/**
 * The frame an output shows for a live frame. The intro slide is the Praise & Worship title card; in black mode it is a solid black
 * screen, with no text, icon or background. Every other frame is shown as it is.
 */
export function presentedFrame(frame, introSlideMode) {
  return introSlideMode === 'black' && frame?.kind === 'pw' && frame.slide?.kind === 'title' ? { kind: 'black' } : frame;
}

/**
 * True when any output is live: the projector, or the Secondary display (the TV and the phones). A slide goes live straight away when this
 * is true. The projector prompt only asks when both are off.
 */
export function isAnyOutputLive(state) {
  return state.outputs.projector === true || state.display?.targets?.secondary?.live === true;
}

/**
 * True when the welcome screen is up over a Holy Mass slide. The welcome screen only covers the Mass: the queue keeps its place, and the slide
 * it covers waits as the staged frame, so Next, Back, a section jump or Welcome again puts that slide back.
 */
export function welcomeOverMass(state) {
  return state.queueCursor >= 0 && state.projector.source === 'MASS_QUEUE' && state.projector.live.kind === 'welcome';
}

/**
 * True when Blackout is up over a Holy Mass slide. Like the welcome screen, it only covers the Mass: the queue keeps its place, the slide it
 * covers waits as the staged frame, and Next, Back, a section jump or Blackout again puts that slide back.
 */
export function blackoutOverMass(state) {
  return state.queueCursor >= 0 && state.projector.source === 'MASS_QUEUE' && state.projector.live.kind === 'blackout';
}

/**
 * True when the welcome screen is up over a Praise & Worship slide. As over the Holy Mass, it is only a cover: the session stays on air at its
 * place, its timers keep running, and the slide it covers waits as the staged frame.
 */
export function welcomeOverPw(state) {
  return state.pw?.onAir === true && state.projector.source === 'PW_SESSION' && state.projector.live.kind === 'welcome';
}

/**
 * True when Blackout is up over a Praise & Worship slide (the operator's Blackout, or a segment's own fade-to-black step). The session stays on
 * air at its place, and Next, Back or a jump lifts it onto the slide they go to.
 */
export function blackoutOverPw(state) {
  return state.pw?.onAir === true && state.projector.source === 'PW_SESSION' && state.projector.live.kind === 'blackout';
}

// The Holy Mass or a Praise & Worship session has the projector. The welcome screen and Blackout over either are covers that keep its place.
function liveRunOnAir(s) {
  const source = s.projector.source;
  return (source === 'MASS_QUEUE' && s.queueCursor >= 0) || (source === 'PW_SESSION' && s.pw?.onAir === true);
}

export function initialLiveState() {
  return {
    rev: 0,
    outputs: { projector: false, lowerThird: false, preview: false },
    settings: PROJECTOR_SETTINGS_DEFAULTS,
    welcome: WELCOME_DEFAULTS,
    calibration: false,
    // The operator's choice for the intro slide. It starts as the saved default, and changes only from the Live panel or a new default.
    introSlideMode: 'title',
    counter: null,
    noteOverlay: null,
    // The Sanctuary Alert banner over the projector (a car blocking the driveway, a nursery tag), or null. Its own layer: nothing else changes with it.
    sanctuaryAlert: null,
    lowerStyle: LOWER_THIRD_DEFAULTS,
    projector: { live: IDLE, staged: IDLE, paused: false, beforeBlackout: null, background: NO_BACKGROUND, source: null },
    // `choice` is the operator's last On or Off (null until the operator presses the toggle). Only the operator changes it.
    lowerThird: { live: null, staged: null, paused: false, choice: null },
    // The secondary display. Dual mirrors the projector; independent shows its own frame. Its live switch is separate from the projector's.
    display: { mode: 'dual', targets: { secondary: { live: false, frame: IDLE, staged: IDLE, layout: 'screen-16x9' } } },
    queue: [],
    queuePlanId: null,
    // The loaded plan's own choice for slot titles on its slides: true or false, or null to follow the projector setting (showSlotTitle).
    queueSlotTitle: null,
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

/** The settings the outputs draw from, as the operator has set them. The Preview and the thumbnails read these. */
/** The advanced text styling, which the audience sees as it was at a pause, like the font. */
const TEXT_LOOK_KEYS = ['advancedOutput', 'textColor', 'textShadow', 'textOutline'];

function lookOf(s) {
  return {
    slideFont: s.settings.slideFont,
    slideFontScale: s.settings.slideFontScale,
    introSlideMode: s.introSlideMode,
    welcome: s.welcome,
    text: Object.fromEntries(TEXT_LOOK_KEYS.map((k) => [k, s.settings[k]])),
  };
}

/**
 * The look the audience sees. While the projector is paused it is the look captured at the pause, so the Projector window and the TV keep
 * what was on air. Otherwise it is the working look. The Preview always reads the working look.
 */
export function outputLookOf(s) {
  return s.projector.paused && s.projector.look ? s.projector.look : lookOf(s);
}

/** The state with the on-air look in place of the working one. Returns the same state when the two looks are the same. */
/**
 * Whether slides show their slot title banner: the loaded Holy Mass plan's own choice when it has one, otherwise the projector setting.
 */
export function slotTitleShown(s) {
  if (s.queuePlanId != null && typeof s.queueSlotTitle === 'boolean') return s.queueSlotTitle;
  return s.settings?.showSlotTitle !== false;
}

export function applyLook(s) {
  const look = outputLookOf(s);
  const same =
    look.slideFont === s.settings.slideFont &&
    look.slideFontScale === s.settings.slideFontScale &&
    look.introSlideMode === s.introSlideMode &&
    look.welcome === s.welcome &&
    // A look captured before the text styling was part of it has none, and leaves the working styling in place.
    TEXT_LOOK_KEYS.every((k) => !look.text || look.text[k] === s.settings[k]);
  if (same) return s;
  return {
    ...s,
    settings: { ...s.settings, slideFont: look.slideFont, slideFontScale: look.slideFontScale, ...(look.text ?? {}) },
    introSlideMode: look.introSlideMode,
    welcome: look.welcome,
  };
}

// A slide's own cue shows its lower third, unless the operator has turned it Off: then it is only staged, and stays Off until the operator turns it On.
function showLowerThird(l, value) {
  if (l.paused || l.choice === 'off') return { ...l, staged: value };
  return { ...l, staged: value, live: value };
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
      // The welcome screen over a Holy Mass or Praise & Worship slide is an overlay: the queue or session keeps its place and its source (so
      // Praise & Worship stays on air), and the slide stays staged under it.
      const p = s.projector;
      if (a.frame.kind === 'welcome' && liveRunOnAir(s) && !p.paused && p.live.kind !== 'idle' && p.live.kind !== 'blackout') {
        return { ...s, projector: { ...p, live: a.frame, staged: p.live.kind === 'welcome' ? p.staged : p.live } };
      }
      const ended = a.source === 'DIRECT_DECK' ? { ...endQueueSelection(s), ...endPwAir(s) } : {};
      return { ...s, ...ended, projector: showFrame(s.projector, a.frame) };
    }

    // A live slide whose song or prayer was edited. The new frame replaces the one on screen, and the one staged or held for after a
    // blackout, when it is the same slide. Nothing else changes: the source, the queue and the lower third stay as they are.
    case 'projector/refresh': {
      const p = s.projector;
      const swap = (f) => (f && f.key === a.key ? a.frame : f);
      const live = swap(p.live);
      const staged = swap(p.staged);
      const beforeBlackout = swap(p.beforeBlackout);
      if (live === p.live && staged === p.staged && beforeBlackout === p.beforeBlackout) return s;
      return { ...s, projector: { ...p, live, staged, beforeBlackout } };
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
      // Over a Holy Mass or Praise & Worship slide it is only a cover: the queue or session keeps its place, and the covered slide waits staged under it.
      if (liveRunOnAir(s) && p.live.kind !== 'idle') {
        const staged = p.paused || p.live.kind === 'welcome' ? p.staged : p.live;
        return { ...s, projector: { ...p, live: { kind: 'blackout' }, staged, beforeBlackout: p.live } };
      }
      return { ...s, ...endQueueSelection(s), projector: { ...p, live: { kind: 'blackout' }, beforeBlackout: p.live } };
    }

    case 'projector/pause': {
      const p = s.projector;
      const paused = a.paused ?? !p.paused;
      if (paused === p.paused) return s;
      // Pausing freezes the audience's look where it is now: the frame on air, and the settings the outputs draw from.
      if (paused) return { ...s, projector: { ...p, paused, look: lookOf(s) } };
      // Resuming puts the staged frame and the staged background on air, and returns the look to the working settings.
      const background = backgroundOf(p);
      const onAirBackground = { ...background, live: background.staged };
      if (p.live.kind === 'blackout') return { ...s, projector: { ...p, paused, look: null, background: onAirBackground, beforeBlackout: p.staged } };
      return { ...s, projector: { ...p, paused, look: null, live: p.staged, background: onAirBackground } };
    }

    case 'projector/step': {
      const f = s.projector.staged;
      // A picture that belongs to a deck of pictures (a PowerPoint) steps to the neighbouring picture.
      if (f.kind === 'image' && f.deck) {
        const index = Math.min(Math.max(f.deck.index + a.delta, 0), f.deck.slides.length - 1);
        if (index === f.deck.index) return s;
        const { title, src, notes } = f.deck.slides[index];
        return { ...s, projector: showFrame(s.projector, { kind: 'image', title, src, ...(notes ? { notes } : {}), deck: { slides: f.deck.slides, index } }) };
      }
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
    // With the background on every slide, a staged background goes on screen at once, unless the projector is paused (a take waits then too).
    case 'background/stage': {
      const background = { ...backgroundOf(s.projector), staged: a.media };
      if (s.settings?.backgroundEverywhere && !s.projector.paused) background.live = a.media;
      return { ...s, projector: { ...s.projector, background } };
    }

    case 'background/take': {
      const bg = backgroundOf(s.projector);
      // While paused, a take waits for resume: the audience keeps the background it had when the projector paused.
      if (bg.live === bg.staged || s.projector.paused) return s;
      return { ...s, projector: { ...s.projector, background: { ...bg, live: bg.staged } } };
    }

    case 'background/clear':
      return { ...s, projector: { ...s.projector, background: NO_BACKGROUND } };

    case 'lowerThird/show':
      return { ...s, lowerThird: showLowerThird(s.lowerThird, a.value) };

    // Clearing takes the lower third off the screen but keeps the last value staged, so toggling it on brings it back.
    // Stages a lower third without showing it. The header toggle or lowerThird/toggle takes it live.
    // Projector output settings, saved by the main process and broadcast to every window.
    case 'settings/projector': {
      const settings = sanitizeProjectorSettings({ ...s.settings, ...a.value });
      // A changed default moves the live choice to it. Otherwise the operator's own choice stands.
      const introSlideMode = settings.defaultIntroSlideMode !== s.settings.defaultIntroSlideMode ? settings.defaultIntroSlideMode : s.introSlideMode;
      return { ...s, settings, introSlideMode };
    }

    case 'introSlide/set':
      return INTRO_SLIDE_MODES.includes(a.value) && a.value !== s.introSlideMode ? { ...s, introSlideMode: a.value } : s;

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

    // The Sanctuary Alert. Showing one replaces any alert already up. The slides, the queue and the lower third are left as they are.
    case 'sanctuaryAlert/show': {
      const alert = sanitizeAlert(a.value, a.now);
      return alert ? { ...s, sanctuaryAlert: alert } : s;
    }

    // Clears the alert. With an `id`, only that alert: a timer that runs out after a newer alert went up leaves the newer one.
    case 'sanctuaryAlert/clear':
      if (!s.sanctuaryAlert || (a.id != null && a.id !== s.sanctuaryAlert.id)) return s;
      return { ...s, sanctuaryAlert: null };

    // The Announcements deck's counter: which slide it is on, out of how many, and whether to project it.
    case 'counter/set':
      return { ...s, counter: a.counter };

    // Shows or hides the calibration grid on the projector.
    case 'calibration/toggle':
      return { ...s, calibration: !s.calibration };

    // The secondary display's mode: dual (mirror the projector) or independent (its own frame).
    case 'display/mode':
      return DISPLAY_MODES.includes(a.value) ? { ...s, display: { ...s.display, mode: a.value } } : s;

    // The secondary display's own live switch. It does not change the projector.
    case 'display/live': {
      const secondary = s.display.targets.secondary;
      return { ...s, display: { ...s.display, targets: { ...s.display.targets, secondary: { ...secondary, live: a.value === true } } } };
    }

    // Pushes a frame to the secondary display alone (independent mode). The projector is not changed.
    case 'display/show': {
      const secondary = s.display.targets.secondary;
      return { ...s, display: { ...s.display, targets: { ...s.display.targets, secondary: { ...secondary, frame: a.frame, staged: a.frame } } } };
    }

    case 'lowerThird/stage':
      return { ...s, lowerThird: { ...s.lowerThird, staged: a.value } };

    case 'lowerThird/clear':
      return { ...s, lowerThird: { ...s.lowerThird, live: null } };

    // The header button: on, it shows the staged lower third; off, it clears it. Nothing is shown if nothing was staged.
    case 'lowerThird/toggle': {
      const l = s.lowerThird;
      if (l.live) return { ...s, lowerThird: { ...l, live: null, choice: 'off' } };
      return l.staged ? { ...s, lowerThird: { ...l, live: l.staged, choice: 'on' } } : s;
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
        lowerThird: { live: null, staged: null, paused: false, choice: s.lowerThird.choice },
      };

    // Loading a different plan resets the position to before the first item. Re-sending the same plan
    // (after the planner saves it) keeps the position, so an edit does not lose the place in the service.
    // A change that moves rows around the one on air (a deck put in ahead of it) sends `cursor`, the row's new position, so the queue and its
    // CURRENT row change together and the projector's slide never looks like another row's. Without it, the same plan keeps its position.
    case 'queue/set': {
      const samePlan = a.planId != null && a.planId === s.queuePlanId;
      const given = samePlan && Number.isInteger(a.cursor) && a.cursor >= -1 && a.cursor < a.items.length ? a.cursor : null;
      // A different plan brings its own slot-title choice, which the operator window reads and sends (queue/slotTitle). Until then, the setting applies.
      return {
        ...s,
        queue: a.items,
        queuePlanId: a.planId ?? null,
        queueSlotTitle: samePlan ? (s.queueSlotTitle ?? null) : null,
        queueCursor: given ?? (samePlan ? s.queueCursor : -1),
      };
    }

    // The loaded plan's slot-title choice. Ignored when it is for a plan that is no longer loaded (a slow read that lost a race).
    case 'queue/slotTitle': {
      const show = typeof a.show === 'boolean' ? a.show : null;
      if (a.planId == null || a.planId !== s.queuePlanId || (s.queueSlotTitle ?? null) === show) return s;
      return { ...s, queueSlotTitle: show };
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

    case 'pw/end': {
      if (!s.pw) return s;
      const { pwLineup, ...rest } = s;
      return { ...rest, pw: null };
    }

    // The segment names a phone can pick from. Sent by the operator window, which holds the lineup.
    case 'pw/lineup':
      return JSON.stringify(s.pwLineup ?? null) === JSON.stringify(a.items) ? s : { ...s, pwLineup: a.items };

    // The operator asked, from a mirror or a preview, to split a stanza cut off on the slide. The operator window opens the split for it.
    case 'operator/splitStanza':
      return Number.isInteger(a.hymnId) && Number.isInteger(a.position)
        ? { ...s, splitRequest: { hymnId: a.hymnId, position: a.position, seq: (s.splitRequest?.seq ?? 0) + 1 } }
        : s;

    case 'remote/command':
      return { ...s, remoteCmd: { ...a.command, seq: (s.remoteCmd?.seq ?? 0) + 1 } };

    case 'remote/panel': {
      if (JSON.stringify(s.remotePanel ?? null) === JSON.stringify(a.panel)) return s;
      const { remotePanel, ...rest } = s;
      return a.panel ? { ...rest, remotePanel: a.panel } : rest;
    }

    case 'remote/pwstep':
      return { ...s, pwStep: { ...(Number.isInteger(a.segment) ? { segment: a.segment } : Number.isInteger(a.index) ? { index: a.index } : { delta: a.delta === -1 ? -1 : 1 }), seq: (s.pwStep?.seq ?? 0) + 1 } };

    default:
      return s;
  }
}

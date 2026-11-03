import { outputLookOf, presentedFrame, secondaryFrame } from './live.js';
import { welcomeBackground } from './welcome-settings.js';
// Remote view: the settings for the two phone viewers, the snapshot of the live screen they show, and the control requests
// the Primary viewer may send. Shared by the main process (saved to config.json, sent to phones) and tested without
// Electron. Pure: its only import is the live state's secondary display selector.

/** Primary can control the output. Secondary only watches. */
export const REMOTE_ROLES = ['primary', 'secondary'];
export const REMOTE_VIEW_PORTS = { primary: 8787, secondary: 8788 };
export const REMOTE_PORT_MIN = 1024;
export const REMOTE_PORT_MAX = 65535;
/** A PIN is 4 to 8 digits. Digits only, so it is easy to type on a phone. */
export const REMOTE_PIN_PATTERN = /^\d{4,8}$/;
/** Phones across both viewers. Past this the page turns new phones away, so the laptop is not overloaded. */
export const REMOTE_DEVICE_LIMIT = 20;
/** On a laptop hotspot, more phones than this make the connection unreliable. The settings warn above it. */
export const REMOTE_HOTSPOT_WARN_ABOVE = 8;

export const REMOTE_VIEW_DEFAULTS = {
  primary: { enabled: false, port: REMOTE_VIEW_PORTS.primary, pin: null },
  secondary: { enabled: false, port: REMOTE_VIEW_PORTS.secondary, pin: null },
};

const isPort = (value) => Number.isInteger(value) && value >= REMOTE_PORT_MIN && value <= REMOTE_PORT_MAX;

function sanitizeRole(raw, defaultPort) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: r.enabled === true,
    port: isPort(r.port) ? r.port : defaultPort,
    pin: typeof r.pin === 'string' && REMOTE_PIN_PATTERN.test(r.pin) ? r.pin : null,
  };
}

/**
 * Keeps only known keys with valid values, for each viewer. A config saved before the two viewers existed has one set of
 * values. Those belong to the Primary viewer, so an existing setup keeps its port and PIN.
 */
export function sanitizeRemoteView(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const hasRoles = 'primary' in r || 'secondary' in r;
  return {
    primary: sanitizeRole(hasRoles ? r.primary : r, REMOTE_VIEW_DEFAULTS.primary.port),
    secondary: sanitizeRole(hasRoles ? r.secondary : null, REMOTE_VIEW_DEFAULTS.secondary.port),
  };
}

/**
 * Refuses a bad port or PIN the operator typed, with a message the settings page can show. Blank or null PIN means none.
 * `current` is the saved settings, so two viewers cannot be given the same port.
 */
export function validateRemoteViewPatch(patch, current = REMOTE_VIEW_DEFAULTS) {
  if ('port' in patch && !isPort(patch.port)) {
    throw new Error(`The port must be a number from ${REMOTE_PORT_MIN} to ${REMOTE_PORT_MAX}.`);
  }
  if ('pin' in patch && patch.pin !== null && patch.pin !== '' && !REMOTE_PIN_PATTERN.test(patch.pin)) {
    throw new Error('The PIN must be 4 to 8 digits.');
  }
  if (!REMOTE_ROLES.includes(patch.role)) throw new Error('Choose the Primary or the Secondary viewer.');
  if ('port' in patch) {
    const other = patch.role === 'primary' ? 'secondary' : 'primary';
    if (patch.port === current[other]?.port) throw new Error('The Primary and Secondary viewers need different ports.');
  }
}

/** Splits text into the lines a phone shows. Trailing spaces go, and blank lines at the ends go. */
function linesOf(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((line) => line.trimEnd());
  while (lines.length && lines[0] === '') lines.shift();
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** "3 of 8" for a 1-based position. Null when there is nothing to count. */
const counted = (current, total) => (total > 1 ? `${current} of ${total}` : null);

/**
 * What a projector frame says on screen: its title, where it is in its set, and its text lines.
 * Frames with nothing to read (an image, the announcements) give a title and no lines.
 */
export function presentFrame(frame, welcome) {
  switch (frame.kind) {
    case 'welcome':
      return { title: 'Welcome', position: null, lines: welcome?.welcomeType === 'TEXT' ? linesOf(welcome.message) : [] };
    case 'announcements':
      return { title: 'Announcements', position: null, lines: [] };
    case 'deck':
      return {
        title: frame.title,
        position: counted(frame.index + 1, frame.slides.length),
        lines: linesOf((frame.slides[frame.index] ?? []).map((line) => line.text).join('\n')),
      };
    case 'lyrics':
      return { title: frame.title, position: frame.label || null, lines: linesOf(frame.text) };
    case 'psalm':
      // The response stays on screen while the verses change, so the congregation sees both.
      return {
        title: frame.title,
        position: counted(frame.index + 1, frame.pages.length),
        lines: [...linesOf(frame.response), '', ...linesOf(frame.pages[frame.index])],
      };
    case 'text':
      return { title: frame.headline || frame.title, position: null, lines: linesOf(frame.text) };
    case 'rosary':
      return {
        title: frame.mystery || frame.section,
        position: frame.part ? counted(frame.part.index, frame.part.total) : null,
        lines: linesOf(frame.text),
      };
    case 'whiteboard':
      // A slide's words are its content and, for a slide from PowerPoint, its text boxes, read in the order they are drawn.
      return {
        title: frame.slide.title,
        position: null,
        lines: linesOf([frame.slide.content, ...(frame.slide.design?.boxes ?? []).map((b) => b.text)].filter((t) => t && t.trim()).join('\n')),
      };
    case 'pw': {
      const slide = frame.slide;
      // A PowerPoint slide has no words to send: the phone shows its name.
      const lines = slide.kind === 'title' ? [slide.label, slide.subtitle] : slide.kind === 'picture' ? [slide.label] : linesOf(slide.text);
      return { title: frame.segmentName, position: counted(frame.index + 1, frame.total), lines: linesOf(lines.join('\n')) };
    }
    case 'image':
      return { title: frame.title, position: frame.deck ? counted(frame.deck.index + 1, frame.deck.slides.length) : null, lines: [] };
    default:
      return { title: '', position: null, lines: [] };
  }
}

/** The slides or verses a frame steps through, and the current one (0-based). Null for a frame that has no steps. */
export function sectionsOf(frame) {
  if (frame?.kind === 'deck') return { index: frame.index, count: frame.slides.length };
  if (frame?.kind === 'psalm') return { index: frame.index, count: frame.pages.length };
  if (frame?.kind === 'image' && frame.deck) return { index: frame.deck.index, count: frame.deck.slides.length };
  return null;
}

/**
 * The live screen as a phone sees it. `screen` says what the projector is doing: `off` (the projector output is
 * closed), `idle`, `blackout`, or `live` (text on screen). `title` and `next` come from the Service Queue, so the
 * singers see what is coming even when the projector is off. `nextLines` is the slide after this one, and `sections`
 * is where this slide sits in its set. `paused` says the operator has paused the projector. Nothing else is included.
 */
export function remoteViewSnapshot(state, now = Date.now()) {
  return snapshotOf(state, { live: primaryDrives(state), frame: state.projector.live, paused: state.projector.paused }, now);
}

/**
 * Whether the Primary viewer's controls can move what is on air. That is when the projector is on, or when the Remote display follows the
 * projector (dual mode) and is on air, so the TV shows the frame these controls move. In independent mode the TV shows its own frame, which
 * these controls do not move, so they stay off rather than appear to work.
 */
export function primaryDrives(state) {
  return state.outputs.projector === true || (state.display?.mode === 'dual' && state.display?.targets?.secondary?.live === true);
}

/** The secondary display's snapshot: what the Secondary port shows, the TV and the viewers on it. */
export function secondaryViewSnapshot(state, now = Date.now()) {
  const live = state.display.targets.secondary.live;
  const frame = secondaryFrame(state);
  const base = snapshotOf(state, { live, frame, paused: false }, now);
  return { ...base, live, frame: frameSnapshot(state, frame, base) };
}

/** The Announcements slide id in a slide picture's address (`apcc-media://slide/<id>`), or null for anything else. */
export function slideIdOf(src) {
  const match = /^apcc-media:\/\/slide\/(\d+)$/.exec(String(src ?? ''));
  return match ? match[1] : null;
}

/** The Media Library id in a library address (`apcc-media://media/<id>`), or null for anything else. */
export function mediaIdOf(src) {
  const match = /^apcc-media:\/\/media\/(\d+)$/.exec(String(src ?? ''));
  return match ? match[1] : null;
}

/**
 * The frame the secondary display draws, in plain terms: its kind, its text, and the background behind it. The background is the Welcome
 * background for a welcome frame and the Live slide background for a slide; the media is named by its library id, which the TV fetches
 * from the Secondary port.
 */
function frameSnapshot(state, frame, base) {
  const kind = base.screen === 'live' ? 'slide' : base.screen === 'blackout' ? 'blackout' : base.screen === 'idle' ? 'idle' : 'off';
  if (kind !== 'slide') return { kind, title: '', lines: [], image: null, mediaId: null, font: null, fontScale: 1 };
  const look = outputLookOf(state);
  const settings = frame.kind === 'welcome' ? look.welcome : frame.kind === 'pw' ? look.welcome.slideBackground : null;
  const bg = settings ? welcomeBackground(settings) : { color: null, media: null, shade: false };
  return {
    kind,
    title: base.title,
    lines: base.lines,
    image: base.image,
    color: bg.color,
    mediaId: bg.media ? mediaIdOf(bg.media.src) : null,
    mediaKind: bg.media ? bg.media.kind : null,
    fit: bg.media ? bg.media.fit : null,
    loop: bg.media ? bg.media.loop : null,
    shade: bg.shade,
    font: outputLookOf(state).slideFont ?? null,
    fontScale: outputLookOf(state).slideFontScale ?? 1,
  };
}

/** Frames whose own panel steps them (by its own keys), so a phone's Next and Previous are always offered for them. */
const STEPPED_BY_PANEL = new Set(['lyrics', 'text', 'rosary']);

/** The snapshot of one display's target: its live switch, the frame it shows, and whether it is paused. */
function snapshotOf(state, target, now) {
  const current = state.queueCursor >= 0 ? state.queue[state.queueCursor] : null;
  const next = state.queue[state.queueCursor + 1] ?? null;
  const base = {
    screen: 'off',
    title: current?.label ?? '',
    next: next?.label ?? null,
    position: null,
    lines: [],
    nextLines: [],
    sections: null,
    image: null,
    lineup: state.pw && state.pwLineup ? { items: state.pwLineup, current: state.pwLineup.findIndex((x) => x.key === state.pw.segmentKey) } : null,
    paused: target.paused,
    updatedAt: now,
  };
  if (!target.live) return base;

  const frame = presentedFrame(target.frame, outputLookOf(state).introSlideMode);
  if (frame.kind === 'idle') return { ...base, screen: 'idle' };
  // A solid black intro slide is a blackout for the phones and the TV: a blank screen, with no text or media.
  if (frame.kind === 'blackout' || frame.kind === 'black') return { ...base, screen: 'blackout' };

  const shown = presentFrame(frame, outputLookOf(state).welcome);
  // For Praise & Worship, what comes after this is the next item of its lineup, not of the Mass queue.
  const lineup = frame.kind === 'pw' ? base.lineup : null;
  const nextInLineup = lineup && lineup.current >= 0 ? lineup.items[lineup.current + 1]?.name ?? null : undefined;
  // Praise & Worship has no list of slides to jump to. Next and Previous cross from one segment to the next, so they stay on (`steps`).
  // A panel that publishes its own steps and sections (the Rosary) is mirrored: the phone shows them and drives them.
  const panel = state.remotePanel && state.remotePanel.panel === frame.kind ? state.remotePanel : null;
  const sections = panel
    ? { index: panel.step.index, count: panel.step.count }
    : frame.kind === 'pw'
      ? { index: frame.index, count: frame.total, steps: true }
      : STEPPED_BY_PANEL.has(frame.kind)
        ? { index: 0, count: 1, steps: true }
        : sectionsOf(frame);
  // A picture has no text, so what comes next is the title of the next picture.
  const following = sections && !sections.steps && sections.index + 1 < sections.count
    ? frame.kind === 'image'
      ? { lines: [frame.deck.slides[sections.index + 1].title] }
      : presentFrame({ ...frame, index: frame.index + 1 }, outputLookOf(state).welcome)
    : null;
  return {
    ...base,
    screen: 'live',
    title: current?.label ?? shown.title,
    ...(nextInLineup !== undefined ? { next: nextInLineup } : {}),
    position: shown.position,
    lines: shown.lines,
    nextLines: following?.lines ?? [],
    sections,
    ...(panel
      ? {
          position: `${panel.step.index + 1} of ${panel.step.count}`,
          lineup: { title: panel.title, items: panel.sections.map((x) => ({ key: x.label, name: x.label })), current: panel.sections.findIndex((x) => x.current) },
        }
      : {}),
    image: frame.kind === 'image' ? slideIdOf(frame.src) : null,
  };
}

/**
 * What a viewer may see. Secondary gets the screen text and the titles only. Primary also gets the next slide, the
 * section list, and whether the projector is paused, since those are what its controls use.
 */
export function snapshotForRole(snapshot, role) {
  if (role === 'primary') return snapshot;
  const { nextLines, sections, paused, lineup, ...viewer } = snapshot;
  return viewer;
}

/**
 * The live action a phone's control request means, in the operator's own terms. Next and Previous step the staged frame
 * exactly as the arrow keys do. Jump moves to a slide by its number, through the same step action. Returns
 * `{ ok: true, action }` (action is null when nothing changes), or `{ ok: false, status, error }` when it is refused.
 */
export function controlAction(state, request) {
  if (!request || typeof request !== 'object') return { ok: false, status: 400, error: 'The request was not understood.' };
  if (!primaryDrives(state)) {
    return { ok: false, status: 409, error: 'Nothing this remote controls is on air. Turn the projector on, or set Remote to follow it.' };
  }
  if (state.projector.paused) return { ok: false, status: 409, error: 'Paused by operator' };

  // A panel that publishes its own steps and sections (the Rosary) is driven through that panel, the same as its own buttons.
  const onAir = state.projector.live;
  const panel = state.remotePanel && onAir?.kind === state.remotePanel.panel ? state.remotePanel : null;
  if (panel) {
    if (request.action === 'next' || request.action === 'previous') {
      return { ok: true, action: { type: 'remote/command', command: { action: 'step', delta: request.action === 'next' ? 1 : -1 } } };
    }
    if (request.action === 'jump' || request.action === 'segment') {
      const limit = request.action === 'jump' ? panel.step.count : panel.sections.length;
      if (!Number.isInteger(request.index) || request.index < 0 || request.index >= limit) return { ok: false, status: 409, error: 'That is not in this item.' };
      return { ok: true, action: { type: 'remote/command', command: { action: request.action === 'jump' ? 'jump' : 'section', index: request.index } } };
    }
  }
  if (STEPPED_BY_PANEL.has(onAir?.kind) && (request.action === 'next' || request.action === 'previous')) {
    return { ok: true, action: { type: 'remote/command', command: { action: 'step', delta: request.action === 'next' ? 1 : -1 } } };
  }

  // Picking a segment of the lineup puts its first slide on air.
  if (request.action === 'segment') {
    const count = state.pwLineup?.length ?? 0;
    if (!state.pw || !Number.isInteger(request.index) || request.index < 0 || request.index >= count) {
      return { ok: false, status: 409, error: 'That item is not in the lineup.' };
    }
    return { ok: true, action: { type: 'remote/pwstep', segment: request.index } };
  }

  // Praise & Worship steps through its own lineup (slides, then the next segment). The operator window carries the step out.
  // Whatever the on-air flag says, a Praise & Worship slide on screen is stepped through its lineup.
  if (state.pw && state.projector.live?.kind === 'pw') {
    if (request.action === 'next' || request.action === 'previous') {
      return { ok: true, action: { type: 'remote/pwstep', delta: request.action === 'next' ? 1 : -1 } };
    }
    if (request.action === 'jump') {
      const total = state.projector.live.total;
      if (!Number.isInteger(request.index) || request.index < 0 || request.index >= total) return { ok: false, status: 409, error: 'That slide is not in this item.' };
      return { ok: true, action: state.projector.live.index === request.index ? null : { type: 'remote/pwstep', index: request.index } };
    }
    return { ok: false, status: 400, error: 'The request was not understood.' };
  }

  const sections = sectionsOf(state.projector.staged);
  if (request.action === 'next' || request.action === 'previous') {
    if (!sections) return { ok: false, status: 409, error: 'This item has no other slide to show.' };
    return { ok: true, action: { type: 'projector/step', delta: request.action === 'next' ? 1 : -1 } };
  }
  if (request.action === 'jump') {
    if (!sections || !Number.isInteger(request.index) || request.index < 0 || request.index >= sections.count) {
      return { ok: false, status: 409, error: 'That slide is not in this item.' };
    }
    const delta = request.index - sections.index;
    return { ok: true, action: delta === 0 ? null : { type: 'projector/step', delta } };
  }
  return { ok: false, status: 400, error: 'The request was not understood.' };
}

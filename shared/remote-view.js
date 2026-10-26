// Remote view: the settings for the two phone viewers, the snapshot of the live screen they show, and the control requests
// the Primary viewer may send. Shared by the main process (saved to config.json, sent to phones) and tested without
// Electron. Pure: no imports.

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
      return { title: frame.slide.title, position: null, lines: linesOf(frame.slide.content) };
    case 'pw': {
      const slide = frame.slide;
      const lines = slide.kind === 'title' ? [slide.label, slide.subtitle] : linesOf(slide.text);
      return { title: frame.segmentName, position: counted(frame.index + 1, frame.total), lines: linesOf(lines.join('\n')) };
    }
    case 'image':
      return { title: frame.title, position: null, lines: [] };
    default:
      return { title: '', position: null, lines: [] };
  }
}

/** The slides or verses a frame steps through, and the current one (0-based). Null for a frame that has no steps. */
export function sectionsOf(frame) {
  if (frame?.kind === 'deck') return { index: frame.index, count: frame.slides.length };
  if (frame?.kind === 'psalm') return { index: frame.index, count: frame.pages.length };
  return null;
}

/**
 * The live screen as a phone sees it. `screen` says what the projector is doing: `off` (the projector output is
 * closed), `idle`, `blackout`, or `live` (text on screen). `title` and `next` come from the Service Queue, so the
 * singers see what is coming even when the projector is off. `nextLines` is the slide after this one, and `sections`
 * is where this slide sits in its set. `paused` says the operator has paused the projector. Nothing else is included.
 */
export function remoteViewSnapshot(state, now = Date.now()) {
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
    paused: state.projector.paused,
    updatedAt: now,
  };
  if (!state.outputs.projector) return base;

  const frame = state.projector.live;
  if (frame.kind === 'idle') return { ...base, screen: 'idle' };
  if (frame.kind === 'blackout') return { ...base, screen: 'blackout' };

  const shown = presentFrame(frame, state.welcome);
  const sections = sectionsOf(frame);
  const following = sections && sections.index + 1 < sections.count ? presentFrame({ ...frame, index: frame.index + 1 }, state.welcome) : null;
  return {
    ...base,
    screen: 'live',
    title: current?.label ?? shown.title,
    position: shown.position,
    lines: shown.lines,
    nextLines: following?.lines ?? [],
    sections,
  };
}

/**
 * What a viewer may see. Secondary gets the screen text and the titles only. Primary also gets the next slide, the
 * section list, and whether the projector is paused, since those are what its controls use.
 */
export function snapshotForRole(snapshot, role) {
  if (role === 'primary') return snapshot;
  const { nextLines, sections, paused, ...viewer } = snapshot;
  return viewer;
}

/**
 * The live action a phone's control request means, in the operator's own terms. Next and Previous step the staged frame
 * exactly as the arrow keys do. Jump moves to a slide by its number, through the same step action. Returns
 * `{ ok: true, action }` (action is null when nothing changes), or `{ ok: false, status, error }` when it is refused.
 */
export function controlAction(state, request) {
  if (!request || typeof request !== 'object') return { ok: false, status: 400, error: 'The request was not understood.' };
  if (state.projector.paused) return { ok: false, status: 409, error: 'Paused by operator' };

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

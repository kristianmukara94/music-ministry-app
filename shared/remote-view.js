// Remote view: the settings for the phone page, and the snapshot of the live screen that the page shows.
// Shared by the main process (saved to config.json, sent to phones) and tested without Electron. Pure: no imports.

/** The port the phone page starts on. If it is taken, the next free ports are tried, and the address shows which one is used. */
export const REMOTE_VIEW_PORT = 3003;
export const REMOTE_PORT_MIN = 1024;
export const REMOTE_PORT_MAX = 65535;
/** A PIN is 4 to 8 digits. Digits only, so it is easy to type on a phone. */
export const REMOTE_PIN_PATTERN = /^\d{4,8}$/;

export const REMOTE_VIEW_DEFAULTS = { enabled: false, port: REMOTE_VIEW_PORT, pin: null };

const isPort = (value) => Number.isInteger(value) && value >= REMOTE_PORT_MIN && value <= REMOTE_PORT_MAX;

/** Keeps only known keys with valid values. Anything else falls back to the default. */
export function sanitizeRemoteView(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: r.enabled === true,
    port: isPort(r.port) ? r.port : REMOTE_VIEW_DEFAULTS.port,
    pin: typeof r.pin === 'string' && REMOTE_PIN_PATTERN.test(r.pin) ? r.pin : null,
  };
}

/** Refuses a bad port or PIN the operator typed, with a message the settings page can show. Blank or null PIN means none. */
export function validateRemoteViewPatch(patch) {
  if ('port' in patch && !isPort(patch.port)) {
    throw new Error(`The port must be a number from ${REMOTE_PORT_MIN} to ${REMOTE_PORT_MAX}.`);
  }
  if ('pin' in patch && patch.pin !== null && patch.pin !== '' && !REMOTE_PIN_PATTERN.test(patch.pin)) {
    throw new Error('The PIN must be 4 to 8 digits.');
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

/**
 * The live screen as a phone sees it. `screen` says what the projector is doing: `off` (the projector output is
 * closed), `idle`, `blackout`, or `live` (text on screen). `title` and `next` come from the Service Queue, so the
 * singers see what is coming even when the projector is off. Nothing else in the app is included.
 */
export function remoteViewSnapshot(state, now = Date.now()) {
  const current = state.queueCursor >= 0 ? state.queue[state.queueCursor] : null;
  const next = state.queue[state.queueCursor + 1] ?? null;
  const base = { screen: 'off', title: current?.label ?? '', next: next?.label ?? null, position: null, lines: [], updatedAt: now };
  if (!state.outputs.projector) return base;

  const frame = state.projector.live;
  if (frame.kind === 'idle') return { ...base, screen: 'idle' };
  if (frame.kind === 'blackout') return { ...base, screen: 'blackout' };

  const shown = presentFrame(frame, state.welcome);
  return { ...base, screen: 'live', title: current?.label ?? shown.title, position: shown.position, lines: shown.lines };
}

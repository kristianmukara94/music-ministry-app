// Rosary presentation options and the editor's slide-fit gauge. Pure: no DOM, no storage, so the deck,
// the Settings page and the tests share the same rules.

import { SEQUENCE_DEFAULTS } from './rosary-logic.js';

/**
 * How the rosary is presented. `beadTracker` adds a line such as "2nd Joyful Mystery · Hail Mary 4 of 10" to the projector.
 * `fatima`, `litany` and `stMichael` put those prayers in the deck. `backgroundId` is the Media Library item put behind the
 * rosary when it goes live, or null for none. The defaults keep the deck as it was before these options existed.
 */
export const PRESENTATION_DEFAULTS = Object.freeze({
  beadTracker: false,
  ...SEQUENCE_DEFAULTS,
  backgroundId: null,
});

const BOOLEAN_KEYS = ['beadTracker', 'fatima', 'litany', 'stMichael'];

/** A clean options object from anything (a stored value, a hand-edited file). Unknown or wrong-typed values take the default. */
export function sanitizePresentation(raw) {
  const out = { ...PRESENTATION_DEFAULTS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const key of BOOLEAN_KEYS) if (typeof raw[key] === 'boolean') out[key] = raw[key];
  if (Number.isInteger(raw.backgroundId) && raw.backgroundId > 0) out.backgroundId = raw.backgroundId;
  return out;
}

/**
 * Characters on one projected line of rosary text at its full size. The projector draws a prayer at up to 4.5% of the slide
 * width in a column 84% wide. The serif face averages about 0.41 em a character, so a full line holds about 45 characters
 * (measured on the projector preview: the Creed's first line is 49).
 */
export const FIT_CHARS_PER_LINE = 45;

/** Lines past this make the projector shrink the text, which reads poorly from the back of the church. */
export const FIT_MAX_LINES = 4;

/** Lines the text wraps to, word by word, at `charsPerLine`. Each line break in the text starts a new line. */
export function wrappedLineCount(text, charsPerLine = FIT_CHARS_PER_LINE) {
  const width = Math.max(1, Math.floor(charsPerLine));
  let lines = 0;
  for (const paragraph of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    let used = 0;
    lines += 1;
    for (const word of words) {
      // A word longer than a line starts its own line and is broken across as many lines as it needs.
      if (word.length > width) {
        if (used > 0) lines += 1;
        lines += Math.ceil(word.length / width) - 1;
        used = word.length % width || width;
        continue;
      }
      const next = used === 0 ? word.length : used + 1 + word.length;
      if (next > width) {
        lines += 1;
        used = word.length;
      } else {
        used = next;
      }
    }
  }
  return lines;
}

/**
 * The gauge under a text box: how long the text is against what fits on one slide, and how many lines it wraps to.
 * `fits` is false once it runs past `maxLines`, the point where the projector starts shrinking the type.
 */
export function slideFit(text, { charsPerLine = FIT_CHARS_PER_LINE, maxLines = FIT_MAX_LINES } = {}) {
  const value = String(text ?? '').trim();
  const lines = wrappedLineCount(value, charsPerLine);
  return { chars: value.length, capacity: Math.floor(charsPerLine) * maxLines, lines, maxLines, fits: lines <= maxLines };
}

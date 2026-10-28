// Operator notes and projectable prayers, shared by the main process (validation) and the renderer.
import { sanitizeTextStyle } from './text-style.js';
import { stampSplit } from './prayer-split.js';

/**
 * Where a note is shown. `operator` never leaves the operator's screens. `full` is a full-screen slide and
 * `lower` is a lower-third banner. Only the last two can be staged, taken live, or pushed to the queue.
 */
export const NOTE_DISPLAYS = ['operator', 'full', 'lower'];

export const NOTE_CATEGORIES = [
  'Mass Intention',
  'Oratio Imperata',
  'Special Intercession',
  'Novena',
  'Community Prayer',
  'Presider Note',
  'Liturgical Cue',
  'Choir / Booth Prompt',
];

export const MAX_NOTE_TITLE = 200;
export const MAX_NOTE_BODY = 4000;

/** Checks one note and returns the clean fields. Throws with a message the operator can act on. */
export function cleanNote(input = {}) {
  const title = String(input.title ?? '').trim();
  if (!title || title.length > MAX_NOTE_TITLE) throw new Error(`Title must be 1 to ${MAX_NOTE_TITLE} characters.`);
  const category = String(input.category ?? '');
  if (!NOTE_CATEGORIES.includes(category)) throw new Error('Choose a category for this note.');
  const display = String(input.display ?? '');
  if (!NOTE_DISPLAYS.includes(display)) throw new Error('Choose where this note is shown.');
  const body = String(input.body ?? '');
  if (body.length > MAX_NOTE_BODY) throw new Error(`The body must be at most ${MAX_NOTE_BODY} characters.`);
  // A split is checked against the body it was placed in, so a stored break never points past the text.
  return { title, category, body, display, style: sanitizeTextStyle(input.style), split: stampSplit(input.split, body) };
}

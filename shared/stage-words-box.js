// Where the Output Preview Editor's text box sits over the slide's own words while the operator types on the stage (StageWordsEditor in
// src/golive/console/SlideEditorModal.tsx). The box takes the words' exact place, type and wrapping, so clicking the preview never moves a
// line: a slide drawn on three lines stays on the same three lines while it is typed on.

/**
 * The box's left edge and width, in pixels from the monitor's left, from the span the slide's words take (`left` to `right`).
 *
 * - Whole lines (`whole`: a lyric page drawn unwrapped, `white-space: pre`): a little room is added past the widest line, on the side the
 *   text grows to, so a line the slide draws whole never wraps in the box as it is typed.
 * - Wrapped words (a prayer, or a lyric enlarged past its whole-line size): nothing is added, so every line breaks where the slide breaks it.
 *
 * Either way an empty slide still gets a box about six letters wide to type in, and the box never leaves the monitor, nor its room across
 * (`minLeft` to `maxRight`, see stageWordsBounds) when one is given.
 */
export function stageWordsBox({ left, right, fontSize, align, whole, monitorWidth, minLeft = 0, maxRight = monitorWidth }) {
  const span = Math.max(0, right - left);
  const room = Math.max(0, fontSize * 6 - span);
  const slack = whole ? Math.max(fontSize * 0.6, room) : room;
  let from = left;
  let to = right;
  if (align === 'left') to += slack;
  else if (align === 'right') from -= slack;
  else {
    from -= slack / 2;
    to += slack / 2;
  }
  from = Math.max(0, minLeft, from);
  to = Math.min(monitorWidth, maxRight, to);
  return { left: from, width: Math.max(0, to - from) };
}

/**
 * How far the box's gold outline reaches past its edges, in pixels: none, as the editor draws it inset (inside the box). The room the box is kept
 * in leaves this much clear on every side, so an outline drawn outside the box would be passed here.
 */
export const STAGE_WORDS_RING_PX = 0;

/**
 * The room the box may take on a monitor `monitorWidth` x `monitorHeight`, in pixels from its top-left, ring included: inside Title Safe (90%,
 * 5% clear on every side), or 1.5% to 98.5% across for edge-to-edge (MAX) lyrics, and above `floor` (the top of the slide's footer or page
 * count) when that is higher than Title Safe's bottom.
 */
export function stageWordsBounds({ monitorWidth, monitorHeight, edge = false, floor = Infinity, ring = STAGE_WORDS_RING_PX }) {
  const side = monitorWidth * (edge ? 0.015 : 0.05);
  return {
    top: monitorHeight * 0.05 + ring,
    bottom: Math.min(monitorHeight * 0.95, floor) - ring,
    left: side + ring,
    right: monitorWidth - side - ring,
  };
}

/**
 * The box's top and height, in pixels from the monitor's top, from the rows the slide's words take (`top` to `bottom`, one line `pitch` at
 * least), kept inside `bounds` (stageWordsBounds): never above Title Safe's top, never past the footer. Words drawn inside the room keep their
 * exact place, so the box never moves a line. `maxHeight` is how far the box may grow as lines are typed; past it the box scrolls, so it never
 * runs over the footer or off the slide.
 */
export function stageWordsRows({ top, bottom, pitch, bounds }) {
  const room = Math.max(0, bounds.bottom - bounds.top);
  const line = Math.min(Math.max(0, pitch), room);
  const at = Math.min(Math.max(top, bounds.top), bounds.bottom - line);
  const maxHeight = Math.max(0, bounds.bottom - at);
  return { top: at, height: Math.min(Math.max(line, bottom - at), maxHeight), maxHeight };
}

/** How the box wraps its words: never for whole lines, else as the slide does, with the spaces the operator types kept. */
export const stageWordsWhiteSpace = (slideWhiteSpace) => (slideWhiteSpace === 'pre' || slideWhiteSpace === 'nowrap' ? 'pre' : 'pre-wrap');

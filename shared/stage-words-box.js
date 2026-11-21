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
 * Either way an empty slide still gets a box about six letters wide to type in, and the box never leaves the monitor.
 */
export function stageWordsBox({ left, right, fontSize, align, whole, monitorWidth }) {
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
  from = Math.max(0, from);
  to = Math.min(monitorWidth, to);
  return { left: from, width: Math.max(0, to - from) };
}

/** How the box wraps its words: never for whole lines, else as the slide does, with the spaces the operator types kept. */
export const stageWordsWhiteSpace = (slideWhiteSpace) => (slideWhiteSpace === 'pre' || slideWhiteSpace === 'nowrap' ? 'pre' : 'pre-wrap');

// How slide text wraps, for every screen that draws it: the live preview, the projector, the lineup slide, the Library preview and the
// Notes & Prayers full-screen view. One rule: a word that is wider than a line gets a break opportunity inside it, every line's worth of
// characters, so the browser breaks it there (and only there, when it has to). Every other word stays whole and breaks at a space, as
// before. The break opportunity is a zero-width space, so nothing visible changes and the text itself is not changed.

/** A zero-width space: a break opportunity that is not drawn. */
export const SOFT_BREAK = '​';

/**
 * How many characters fit on a line of a slide, at a font size. `widthShare` is the share of the stage the text column takes, `fontPx` the
 * body size in pixels on the 1920 stage. A character is counted at 0.65em, wider than the average face, so a line that fits here fits on
 * the screen.
 */
export function charsPerLine(widthShare, fontPx, stageWidth = 1920) {
  return Math.max(1, Math.floor((stageWidth * widthShare) / (fontPx * 0.65)));
}

/**
 * One line of slide text as it is drawn: each word wider than `chars` gets a soft break after every `chars` characters. Words that fit
 * are returned unchanged. Only the break opportunities are added; no character is added, removed or moved.
 */
export function slideLine(line, chars) {
  return String(line)
    .split(' ')
    .map((word) => {
      if (word.length <= chars) return word;
      return word.replace(new RegExp(`(.{${chars}})(?=.)`, 'g'), (_m, part) => `${part}${SOFT_BREAK}`);
    })
    .join(' ');
}

/** A whole slide text, line by line, as it is drawn. The line breaks of the text are kept. */
export function slideText(text, chars) {
  return String(text)
    .split('\n')
    .map((line) => slideLine(line, chars))
    .join('\n');
}

// The width of the lineup prayer face, measured in the app's own build: Cormorant Garamond at weight 600, 96px, in the Chromium that Electron runs.
// Each printable ASCII character's advance width in em, from code 32 (space) to 126 (~). The fit uses these, so a line is counted as it is drawn.
// Kerning is left out: summed per character, a line is about 0.2% wider than the browser draws it, so the fit errs toward more lines.

/** Advance width in em of each printable ASCII character, in code order from 32 (space) to 126 (~). */
export const ADVANCE_EM = [
    0.234,  0.258,  0.295,  0.526,  0.418,  0.574,  0.709,  0.147,  0.309,  0.309,  0.448,  0.398,
    0.222,  0.323,  0.204,  0.348,  0.477,  0.332,  0.402,  0.392,  0.454,  0.409,  0.465,  0.429,
    0.489,  0.465,  0.204,  0.229,  0.407,  0.468,  0.407,  0.336,  0.726,  0.711,  0.582,  0.683,
      0.7,  0.547,  0.518,  0.725,  0.762,  0.339,  0.333,  0.653,  0.541,   0.85,  0.732,  0.766,
    0.549,  0.766,  0.689,  0.507,   0.64,  0.701,  0.662,  0.918,  0.649,  0.616,  0.602,  0.274,
    0.348,  0.274,  0.392,  0.398,  0.213,   0.42,  0.514,   0.42,  0.511,  0.414,  0.305,  0.449,
    0.505,  0.266,  0.261,  0.491,  0.265,  0.772,  0.523,  0.486,  0.512,  0.497,  0.374,  0.337,
    0.337,  0.501,  0.438,   0.68,   0.44,   0.43,  0.405,  0.289,  0.168,  0.283,  0.443,
];

/** The width of a character the table does not hold, in em: a little wider than the face's average. */
const FALLBACK_EM = 0.5;

/** The width of a text in em, as the lineup face draws it (no kerning). A line break is not part of the width. */
export function textWidthEm(text) {
  let total = 0;
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    total += code >= 32 && code <= 126 ? ADVANCE_EM[code - 32] : FALLBACK_EM;
  }
  return total;
}

/**
 * How many lines one line of text takes in a box `maxEm` wide, wrapped as the browser wraps it: words are kept whole and break at a
 * space; a word wider than the box is cut where the line runs out. A blank line is one line.
 */
export function wrappedLineCount(line, maxEm) {
  const space = textWidthEm(' ');
  let lines = 1;
  let used = 0;
  for (const word of String(line).split(' ').filter(Boolean)) {
    const width = textWidthEm(word);
    const gap = used > 0 ? space : 0;
    if (used + gap + width <= maxEm) {
      used += gap + width;
      continue;
    }
    if (used > 0) {
      lines += 1;
      used = 0;
    }
    if (width <= maxEm) {
      used = width;
      continue;
    }
    for (const ch of word) {
      const chWidth = textWidthEm(ch);
      if (used + chWidth > maxEm) {
        lines += 1;
        used = 0;
      }
      used += chWidth;
    }
  }
  return lines;
}

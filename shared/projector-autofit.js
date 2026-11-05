// Keeping projected text clear of the slide's edges and badges, as rules the projector, the operator's previews and the tests share.
//
// Two parts:
//   - the step-down: text is drawn at its set size and, when it overflows its safe box, tried at fixed smaller steps (3.5rem → 3.0 → 2.5 → 2.0
//     → 1.75rem, as shares of the set size) with tighter line spacing, until it fits;
//   - the split: a slide with more words than the projector can show at a readable size is cut into parts before it is staged, so every
//     window that draws it (the projector, the mirror, the previews) has the same slides and the same count. Measuring in one window and
//     splitting there would leave the others out of step, so the split works on the words, not on a measurement.

/** The sizes tried, as shares of the size the text is set for: 3.5, 3.0, 2.5, 2.0 and 1.75rem when it is set at 3.5rem. */
export const FIT_STEPS = Object.freeze([1, 3 / 3.5, 2.5 / 3.5, 2 / 3.5, 1.75 / 3.5]);
/** Line spacing at each step: the set spacing for the first two, then tighter ("leading-tight") as the text shrinks. */
export const FIT_LEADING = Object.freeze([null, null, 1.15, 1.12, 1.1]);

/**
 * The first step at which the text fits, given `fits(scale, leading)` that draws it at that share of its size and answers whether it is clear of
 * the box. Returns { index, scale, leading, overflow }: `overflow` is true when it does not fit even at the smallest step (it is then drawn at
 * that step and clipped inside the box, and the operator is told).
 */
export function pickFitStep(fits, steps = FIT_STEPS, leading = FIT_LEADING) {
  for (let i = 0; i < steps.length; i++) {
    if (fits(steps[i], leading[i] ?? null)) return { index: i, scale: steps[i], leading: leading[i] ?? null, overflow: false };
  }
  const last = steps.length - 1;
  return { index: last, scale: steps[last], leading: leading[last] ?? null, overflow: true };
}

/**
 * The safe box inside the slide, as shares of its height and width: clear of the title at the top left (and its slot name), the page count
 * and the operator's badges at the bottom, and the sides. On a 1080-line screen the top is 97px and the bottom 97px, more than the 56px and
 * 64px asked for, and as shares they keep the same room in the small preview windows. A lower third on air takes more off the bottom (see
 * ProjectorView's clearance), and the box shrinks with it.
 */
export const SAFE_AREA = Object.freeze({ top: 0.09, bottom: 0.09, side: 0.06 });

/**
 * How much one projected slide may hold before it is split: about what fits at the 2.0rem step, so split text is still easy to read. Lines are
 * counted as the screen wraps them, at about `charsPerLine` characters to a row at that step, so eight long lines that would wrap to twelve rows
 * are split too.
 */
export const SPLIT_LIMITS = Object.freeze({ maxChars: 260, maxLines: 8, charsPerLine: 64 });

const textLength = (lines) => lines.reduce((n, line) => n + line.text.length, 0);

/** How many screen rows a line of text takes when wrapped between words at `width` characters. An empty line still takes one. */
export function wrappedRows(text, width = SPLIT_LIMITS.charsPerLine) {
  let rows = 1;
  let used = 0;
  for (const word of String(text).split(/s+/).filter(Boolean)) {
    if (used > 0 && used + 1 + word.length <= width) used += 1 + word.length;
    else {
      if (used > 0) rows += 1;
      // A word wider than a row runs over as many rows as it needs.
      rows += Math.ceil(word.length / width) - 1;
      used = word.length % width || width;
    }
  }
  return rows;
}

const rowsOf = (lines, width) => lines.reduce((n, line) => n + wrappedRows(line.text, width), 0);

/** Cuts a long line into pieces of at most `maxChars`: at sentence ends first, then at commas and semicolons, then between words. */
export function splitLongLine(line, maxChars) {
  if (line.text.length <= maxChars) return [line];
  const pieces = [];
  const pack = (parts, joiner) => {
    let current = '';
    for (const part of parts) {
      const next = current ? `${current}${joiner}${part}` : part;
      if (next.length <= maxChars) current = next;
      else {
        if (current) pieces.push(current);
        current = part;
      }
    }
    if (current) pieces.push(current);
  };
  // Sentences, then clauses; a clause still too long is cut between words.
  const clauses = line.text.split(/(?<=[.!?;:])\s+|(?<=,)\s+/).flatMap((clause) => {
    if (clause.length <= maxChars) return [clause];
    const words = [];
    let current = '';
    for (const word of clause.split(/\s+/)) {
      const next = current ? `${current} ${word}` : word;
      if (next.length <= maxChars || !current) current = next;
      else {
        words.push(current);
        current = word;
      }
    }
    if (current) words.push(current);
    return words;
  });
  pack(clauses, ' ');
  return pieces.map((text) => ({ ...line, text }));
}

/**
 * One slide's lines as one or more slides, each within `maxChars` and `maxLines`. Parts are balanced (two halves rather than a full slide and
 * a line), and lines are never reordered. A slide within the limits comes back as it was.
 */
export function splitSlide(lines, { maxChars, maxLines, charsPerLine = SPLIT_LIMITS.charsPerLine } = SPLIT_LIMITS) {
  if (textLength(lines) <= maxChars && rowsOf(lines, charsPerLine) <= maxLines) return [lines];
  // A piece is never more rows than a slide holds, so every part can fit.
  const pieces = lines.flatMap((line) => splitLongLine(line, Math.min(maxChars, maxLines * charsPerLine)));
  const total = textLength(pieces);
  const parts = Math.max(Math.ceil(total / maxChars), Math.ceil(rowsOf(pieces, charsPerLine) / maxLines), 1);
  const target = Math.ceil(total / parts);
  const out = [];
  let current = [];
  let chars = 0;
  let rows = 0;
  for (const piece of pieces) {
    const pieceRows = wrappedRows(piece.text, charsPerLine);
    const over = current.length > 0 && (chars + piece.text.length > maxChars || rows + pieceRows > maxLines || chars >= target);
    if (over) {
      out.push(current);
      current = [];
      chars = 0;
      rows = 0;
    }
    current.push(piece);
    chars += piece.text.length;
    rows += pieceRows;
  }
  if (current.length > 0) out.push(current);
  return out;
}

/**
 * A deck's slides split for the projector, with the label each slide shows. A slide cut into parts shows its part: "Sanctus (1/2)",
 * "Sanctus (2/2)". Returns { slides, labels }; `labels` is null when nothing was split, so an ordinary deck keeps its plain title.
 */
export function splitDeck(title, slides, limits = SPLIT_LIMITS) {
  const outSlides = [];
  const labels = [];
  let split = false;
  for (const lines of slides) {
    const parts = splitSlide(lines, limits);
    if (parts.length > 1) split = true;
    parts.forEach((part, i) => {
      outSlides.push(part);
      labels.push(parts.length > 1 ? `${title} (${i + 1}/${parts.length})` : title);
    });
  }
  return { slides: outSlides, labels: split ? labels : null };
}

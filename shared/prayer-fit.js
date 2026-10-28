// The prayer fit check: how much prayer text fits one slide, at a fixed stage size. The lineup's prayer slides and the
// full-screen prayers (prayer-screen.js) use this one check, so a page that fits in one place fits in the other.

/*
 * The prayer fit check. A prayer page is measured at a fixed stage size so every machine gives the same answer. The lineup's
 * prayer slide (PwSlideFace) sets its text at 5% of the stage width, in a box 88% wide and 70% of the height, at a 1.25 line
 * height. The fit is described by a geometry, so the full-screen display can use the same check with its own numbers.
 */
export const PRAYER_STAGE = { width: 1920, height: 1080 };

/** A fit: how many characters a line holds, how tall a line is, the gap between paragraphs, and the tallest text allowed. */
export function prayerFit({ widthPx, fontPx, charWidthEm = 0.6, lineHeight, gapPx = 0, maxHeightPx }) {
  return { charsPerLine: Math.floor(widthPx / (fontPx * charWidthEm)), lineHeightPx: fontPx * lineHeight, gapPx, maxHeightPx };
}

/** The lineup's prayer slide. The character width is assumed to be 0.6em, wider than the serif face's average. */
// The line height every lineup slide uses: prayers and song lyrics, on the slide and in the fit. Set in one place, so the drawn lines and the
// fit agree. It is taller than the font's own ink, so neighbouring lines never touch.
export const LINEUP_LINE_HEIGHT = 1.25;
export const LINEUP_PRAYER_FIT = prayerFit({
  widthPx: PRAYER_STAGE.width * 0.88,
  fontPx: PRAYER_STAGE.width * 0.05,
  lineHeight: LINEUP_LINE_HEIGHT,
  maxHeightPx: PRAYER_STAGE.height * 0.7,
});
export const PRAYER_FIT_CHARS = LINEUP_PRAYER_FIT.charsPerLine;
export const PRAYER_FIT_LINES = Math.floor(LINEUP_PRAYER_FIT.maxHeightPx / LINEUP_PRAYER_FIT.lineHeightPx);

/** The visual lines a text line takes at the given length: whole words where they fit, a word broken only when it is longer than a line. */
export function visualLinesOf(line, charsPerLine = PRAYER_FIT_CHARS) {
  const out = [];
  let current = '';
  for (let word of line.split(' ').filter(Boolean)) {
    while (word.length > charsPerLine) {
      if (current) out.push(current);
      current = '';
      out.push(word.slice(0, charsPerLine));
      word = word.slice(charsPerLine);
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length <= charsPerLine) current = next;
    else {
      out.push(current);
      current = word;
    }
  }
  if (current) out.push(current);
  return out.length || 1;
}

/** How tall a page of text is on the stage: its lines, once wrapped, plus the gaps between its paragraphs. */
export function prayerTextHeight(text, fit = LINEUP_PRAYER_FIT) {
  const lines = String(text).split('\n');
  const visual = lines.reduce((n, line) => n + visualLinesOf(line, fit.charsPerLine), 0);
  return visual * fit.lineHeightPx + (lines.length - 1) * fit.gapPx;
}

/** Whether a page of prayer text fits the slide described by `fit` (the lineup's slide by default). */
export function fitsPrayerSlide(text, fit = LINEUP_PRAYER_FIT) {
  return prayerTextHeight(text, fit) <= fit.maxHeightPx;
}

/**
 * Cuts one over-long line into pieces that each fit a slide, at word boundaries. The pieces are the line's own words in order,
 * joined with the spaces they had, so no text is lost or repeated.
 */
function breakLine(line, fit) {
  if (fitsPrayerSlide(line, fit)) return [{ text: line, alone: false }];
  // A word too long for a whole slide is cut into slide-sized pieces. Each piece fills a slide on its own, so no space is added inside
  // the word. A word that fits a slide stays whole and wraps on the slide as usual.
  const maxLines = Math.floor(fit.maxHeightPx / fit.lineHeightPx);
  const slideChars = maxLines * fit.charsPerLine;
  const items = [];
  for (const word of line.split(' ')) {
    let rest = word;
    while (rest.length > slideChars) {
      items.push({ text: rest.slice(0, slideChars), alone: true });
      rest = rest.slice(slideChars);
    }
    items.push({ text: rest, alone: false });
  }
  const pieces = [];
  let words = [];
  const flush = () => {
    if (words.length) pieces.push({ text: words.join(' '), alone: false });
    words = [];
  };
  for (const item of items) {
    if (item.alone) {
      flush();
      pieces.push(item);
      continue;
    }
    if (words.length && !fitsPrayerSlide([...words, item.text].join(' '), fit)) flush();
    words.push(item.text);
  }
  flush();
  return pieces;
}

/**
 * Splits prayer text into slides that each fit the slide described by `fit`, without changing the text. Each blank-line
 * paragraph starts a new slide as it always has. Lines are packed into a slide while they fit; a line too long for any slide
 * is broken at word boundaries.
 */
export function prayerPages(text, fit = LINEUP_PRAYER_FIT) {
  const pages = [];
  for (const block of String(text).split(/\n\s*\n/)) {
    let page = [];
    const flush = () => {
      if (page.length) pages.push(page.join('\n'));
      page = [];
    };
    for (const raw of block.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim())) {
      for (const piece of breakLine(raw, fit)) {
        // A slide-sized piece of a long word is a slide of its own.
        if (piece.alone) {
          flush();
          page.push(piece.text);
          flush();
          continue;
        }
        if (!fitsPrayerSlide([...page, piece.text].join('\n'), fit)) flush();
        page.push(piece.text);
      }
    }
    flush();
  }
  return pages;
}


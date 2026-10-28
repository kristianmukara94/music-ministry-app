// A prayer shown full screen (Notes & Prayers). The fit uses the same check as the lineup's prayer slides (pw.js), with the
// numbers of the projector's full-screen text: a headline over the body, at the 1920 x 1080 slide. Nothing here changes the saved
// text. A split is only where the operator put it, or where the fit check puts it.

import { wrappedLineCount } from './prayer-metrics.js';
import { manualParts, normalizeSplit } from './prayer-split.js';
import { prayerSlidesFor } from './prayer-slides.js';
import { blockTops } from './text-area.js';

export { manualParts, normalizeSplit };

export const SCREEN = { width: 1920, height: 1080 };

/** The projector's default body size on the slide: 3.6% of the width (ProjectorView's default text size), in pixels. */
export const DEFAULT_BODY_PX = 69;
/** Text never shrinks below this, in pixels. */
export const FLOOR_PX = 28;

// The projector's full-screen layout (HeadedText in ProjectorView): the headline is 1.3 times the body, the text column is 86%
// of the width, the body fills 80% of the height with the headline above it, and lines sit 2.2% of the height apart.
// The body's widths are the measured widths of the lineup face (prayer-metrics.js), the same as the split uses.
const HEADLINE_RATIO = 1.3;
const TEXT_WIDTH_SHARE = 0.86;
const TEXT_HEIGHT_SHARE = 0.8;
const BODY_LINE_HEIGHT = 1.25;
const HEADLINE_LINE_HEIGHT = 1.1;
const PARAGRAPH_GAP_SHARE = 0.022;
const HEADLINE_GAP_SHARE = 0.03;

/** The size a prayer is shown at before any fitting: the operator's chosen size, or the projector's default. */
export function chosenPx(style) {
  return style?.fontSize ?? DEFAULT_BODY_PX;
}

/** The fit of body text at `bodyPx`, under the headline `title`: the column, the line and gap sizes, and the height left once the headline is placed. */
export function screenFit(bodyPx, title) {
  const headPx = bodyPx * HEADLINE_RATIO;
  const widthPx = SCREEN.width * TEXT_WIDTH_SHARE;
  const headLines = wrappedLineCount(String(title ?? '').trim() || ' ', widthPx / headPx);
  const headBlock = headLines * headPx * HEADLINE_LINE_HEIGHT + SCREEN.height * HEADLINE_GAP_SHARE;
  return {
    widthPx,
    bodyPx,
    lineHeightPx: bodyPx * BODY_LINE_HEIGHT,
    gapPx: SCREEN.height * PARAGRAPH_GAP_SHARE,
    maxHeightPx: SCREEN.height * TEXT_HEIGHT_SHARE - headBlock,
  };
}

/** The height body text takes on the screen: its lines, wrapped as the lineup face wraps them, and a gap between each source line. */
function bodyHeightPx(text, fit) {
  const maxEm = fit.widthPx / fit.bodyPx;
  const lines = String(text).split('\n');
  const visual = lines.reduce((n, line) => n + wrappedLineCount(line, maxEm), 0);
  return visual * fit.lineHeightPx + (lines.length - 1) * fit.gapPx;
}

/** Whether a page of body text, under the headline, fits the screen at `bodyPx`. */
export function fitsScreen(text, title, bodyPx) {
  const fit = screenFit(bodyPx, title);
  return bodyHeightPx(text, fit) <= fit.maxHeightPx;
}

/** The largest size, from `chosenPx` down to FLOOR_PX, at which the text fits the screen. Text that fits at no size gets the floor. */
export function fittedPx(text, title, chosen) {
  for (let px = Math.floor(chosen); px > FLOOR_PX; px -= 1) {
    if (fitsScreen(text, title, px)) return px;
  }
  return FLOOR_PX;
}

/**
 * The split after the operator places or removes a break after line `k`. Breaks placed by hand are hard boundaries; a section a break
 * leaves too long for one slide is split by the automatic rule when it is shown, so no change is refused. Removing the last break gives
 * no split, so the whole prayer uses the automatic split again.
 */
export function placeBreak(body, split, k) {
  const current = normalizeSplit(split, body);
  const at = current?.mode === 'manual' ? current.at : [];
  const next = at.includes(k) ? at.filter((x) => x !== k) : [...at, k].sort((a, b) => a - b);
  return { split: next.length ? normalizeSplit({ mode: 'manual', at: next }, body) : null };
}

/**
 * How the panel describes a prayer's split: the breaks placed by hand, and the slides the automatic rule adds beyond them. `mode` is
 * 'auto' (no breaks by hand), 'manual', or 'stale' (the breaks were made for text that has since changed, so the automatic split is shown).
 */
export function splitSummaryOf(note) {
  const result = prayerSlidesFor(note.body ?? '', normalizeSplit(note.split, note.body ?? ''));
  return { mode: result.mode, slides: result.pages.length, manualBreaks: result.manualBreaks, automaticSlides: result.automaticSlides };
}

/** The slides a prayer is shown as, each with the size it is drawn at: `{ text, fontPx }`. A prayer with no split is one slide. */
/**
 * The slides a prayer is shown as in Notes & Prayers, each with the size it is drawn at: `{ text, fontPx }`. This is the same split the lineup,
 * the live preview and the projector show (see shared/prayer-slides.js), so every surface has the same number of slides and the same breaks.
 */
export function screenPagesOf(note) {
  const pages = prayerSlidesFor(note.body ?? '', normalizeSplit(note.split, note.body ?? '')).pages;
  // The block the screen draws is the headline and the body together, so the shared top and the short-slide rule use that height.
  const tops = blockTops(pages.map((p) => screenBlockHeightPx(p.text, note.title, p.fontPx)));
  return pages.map((p, i) => ({ text: p.text, fontPx: p.fontPx, top: tops[i].top, centred: tops[i].centred }));
}

/** The height the headline and the body take on the screen, in pixels: the block the top and the centring are set from. */
function screenBlockHeightPx(text, title, bodyPx) {
  const fit = screenFit(bodyPx, title);
  return SCREEN.height * TEXT_HEIGHT_SHARE - fit.maxHeightPx + bodyHeightPx(text, fit);
}

/** The height the text takes on the screen at `bodyPx`, for the checks and tests. */
export function screenTextHeight(text, title, bodyPx) {
  return bodyHeightPx(text, screenFit(bodyPx, title));
}

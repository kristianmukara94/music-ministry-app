// Fitting slide text to its box: the largest font size, between a ceiling and a floor, at which the text fits. Pure, so the tests run it.

/**
 * The largest whole-pixel size from `minPx` to `maxPx` at which `fits(px)` is true, found by halving the range. When even `minPx` does not
 * fit, `minPx` comes back: the text stays legible, and the box clips what is left. `fits` is called about log2(maxPx - minPx) times.
 */
export function fitFontSize(maxPx, minPx, fits) {
  const max = Math.floor(maxPx);
  const min = Math.min(max, Math.ceil(minPx));
  if (max <= 0) return 0;
  if (fits(max)) return max;
  let lo = min;
  let hi = max - 1;
  let best = min;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/** A title over a body may take at most this many lines and this share of the slide's room. Past either it shrinks, and the body keeps the rest. */
export const TITLE_MAX_LINES = 2;
export const TITLE_MAX_SHARE = 0.25;

/** Whether a title of `heightPx`, set at `fontPx` with `leading` as its line spacing, is within its two lines and its share of `roomPx`. */
export function titleFits(heightPx, fontPx, leading, roomPx) {
  return heightPx <= roomPx * TITLE_MAX_SHARE + 1 && heightPx <= fontPx * leading * TITLE_MAX_LINES + 1;
}

/** Line spacing for a stanza: open for a short chorus, tighter as lines are added, so a long verse does not grow tall from spacing alone. */
export function lineHeightFor(lineCount) {
  if (lineCount <= 2) return 1.25;
  if (lineCount <= 4) return 1.2;
  if (lineCount <= 6) return 1.18;
  return 1.15;
}

/** How many lines a text shows, counting a blank line as one. */
export const lineCountOf = (text) => String(text ?? '').split('\n').length;

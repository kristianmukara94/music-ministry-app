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

/**
 * The smallest size a lyric line is kept whole at, as a share of the slide's width: 24px on a 1920 slide. A song's lines are drawn unwrapped
 * (`white-space: pre`) and the stanza is sized to its widest line; only a line so long that it would have to go below this is allowed to wrap.
 */
export const MIN_READABLE_CQW = 1.25;

/**
 * The size a lyric stanza is drawn at with every one of its lines whole: the largest from `ceilingPx` (the operator's size, or the MAX
 * ceiling) down to `readablePx` at which `fits(px)` holds, where `fits` checks both the widest line against the width and the stacked lines
 * against the height. So the size is the least of the set size, the width fit and the height fit. Null when even `readablePx` does not fit:
 * the caller then asks `wrapNeeded` whether wrapping would help.
 */
export function fitWholeLines(ceilingPx, readablePx, fits) {
  if (!(ceilingPx > 0)) return null;
  if (fits(ceilingPx)) return ceilingPx;
  const px = fitFontSize(ceilingPx, Math.min(ceilingPx, readablePx), fits);
  return fits(px) ? px : null;
}

/**
 * Whether a stanza that did not fit whole should be allowed to wrap: only when its widest line, at the readable size, is still wider than the
 * room. A stanza that failed for its height (many lines) stays unwrapped, since wrapping would only make it taller.
 */
export function wrapNeeded(widestLineAtReadablePx, roomWidthPx) {
  return widestLineAtReadablePx > roomWidthPx;
}

/** How much larger wrapping must draw an enlarged stanza before its lines are let wrap: anything less keeps the lines whole. */
export const GROW_WRAP_GAIN = 1.15;

/**
 * Whether a stanza the operator asked to draw larger than its layout (A+ above 100%, or MAX) wraps its lines rather than keeping them whole.
 * Whole lines cap the size at the one where the widest line fills the width, so a long line already filling it at 100% would never grow: the
 * size asked for would be shrunk straight back. So when the whole lines fall short of the size asked for (`requestedPx`, the operator's size
 * or the MAX ceiling), the lines wrap if that draws the stanza at least GROW_WRAP_GAIN times larger (`wrappedPx`, fitted to the same room)
 * than whole (`wholePx`). At 100% and below nothing is asked to grow, so every slide keeps the lines it was laid out with.
 */
export function growByWrapping({ requestedPx, wholePx, wrappedPx }) {
  if (!(requestedPx > 0) || !(wholePx > 0) || !(wrappedPx > 0)) return false;
  if (wholePx >= requestedPx * 0.98) return false;
  return wrappedPx >= wholePx * GROW_WRAP_GAIN;
}

/**
 * The stanza as it is drawn and the size it is drawn at, with the synthetic `measure(text, px)` the tests use and the same rule the projector
 * window runs on the real text: every line whole at the largest size that fits (widest line by width, all lines by height); past the readable
 * size, the long lines are balanced into even lines (no word alone on the last) and the whole is fitted again, down to `floorPx`.
 */
export function layoutLyricLines(text, { width, height, ceilingPx, readablePx, floorPx = readablePx, leading, measure }) {
  const source = String(text ?? '').split('\n');
  const widest = (lines, px) => Math.max(0, ...lines.map((line) => measure(line, px)));
  const fitsLines = (lines) => (px) => widest(lines, px) <= width && lines.length * px * leading <= height;
  const whole = fitWholeLines(ceilingPx, readablePx, fitsLines(source));
  if (whole != null) return { px: whole, lines: source, wrapped: false };
  if (!wrapNeeded(widest(source, readablePx), width)) return { px: Math.min(ceilingPx, readablePx), lines: source, wrapped: false };
  let lines = source;
  const fits = (px) => {
    lines = balanceProjectorLines(text, width, (s) => measure(s, px)).split('\n');
    return fitsLines(lines)(px);
  };
  const px = fitFontSize(ceilingPx, Math.min(ceilingPx, floorPx), fits);
  fits(px);
  return { px, lines, wrapped: true };
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

/**
 * Short words a projected line should not end on: articles, conjunctions and prepositions in English, Tagalog and Cebuano. A break after one
 * leaves it hanging at the end of a line, cut off from the word it belongs to.
 */
export const WEAK_LINE_ENDS = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'to', 'of', 'for', 'ng', 'sa', 'ug', 'na', 'ang', 'mga']);

/** A word that closes a clause: ends in . , ; : ? ! or a dash, perhaps followed by a closing quote or bracket. A good place to break. */
const CLAUSE_END = /[.,;:?!—–](["'”’)\]]*)$/;

// The weights of the line-break choice. A line's distance from the even share is measured as a share of the width and squared, so these are
// in the same units: a weak word at a line end costs about as much as being a word and a half off balance on a six-word line, a clause break
// earns about a word's worth, and a lone word on a line costs more than any imbalance short of a full line.
const WEAK_END_COST = 0.06;
const CLAUSE_END_BONUS = 0.04;
const LONE_WORD_COST = 0.25;

const bareWord = (word) => word.toLowerCase().replace(/[^\p{L}]/gu, '');

/**
 * One line of slide text broken into balanced lines, each at most `maxWidth` wide as `measure` measures it. A line that fits is returned
 * whole. Otherwise it takes exactly as many lines as the browser's own wrap would (so the slide is no taller, and the fit that sized it still
 * holds), but the words are shared out evenly: seven words come out as four and three, not six and one. Among even splits it prefers to break
 * after a clause (a comma, a full stop, a dash) and avoids leaving a short word such as "the", "and", "ng" or "sa" at a line's end.
 *
 * A line with a word wider than `maxWidth` on its own is returned whole: the browser breaks that word where text-wrap.js allows it.
 */
export function balanceLine(line, maxWidth, measure) {
  const text = String(line ?? '');
  if (!(maxWidth > 0) || measure(text) <= maxWidth) return [text];
  const words = text.trim().split(/ +/);
  const n = words.length;
  if (n < 2) return [text];
  const widths = words.map((w) => measure(w));
  if (widths.some((w) => w > maxWidth)) return [text];
  const space = measure(' ');
  const prefix = [0];
  for (const w of widths) prefix.push(prefix[prefix.length - 1] + w);
  const span = (a, b) => prefix[b] - prefix[a] + space * (b - a - 1);

  // How many lines the browser would use: fill each line greedily.
  let count = 1;
  for (let i = 1, run = widths[0]; i < n; i += 1) {
    if (run + space + widths[i] <= maxWidth) run += space + widths[i];
    else (count += 1), (run = widths[i]);
  }
  if (count === 1) return [text];

  const share = span(0, n) / count;
  const cost = (a, b, last) => {
    const width = span(a, b);
    if (width > maxWidth) return Infinity;
    let c = ((width - share) / maxWidth) ** 2;
    if (b - a === 1 && n > count) c += LONE_WORD_COST;
    if (!last) {
      const end = words[b - 1];
      if (CLAUSE_END.test(end)) c -= CLAUSE_END_BONUS;
      else if (WEAK_LINE_ENDS.has(bareWord(end))) c += WEAK_END_COST;
    }
    return c;
  };

  // best[j][i]: the lowest cost of setting the first i words on j lines; from[j][i] is where the j-th line starts.
  const best = Array.from({ length: count + 1 }, () => new Array(n + 1).fill(Infinity));
  const from = Array.from({ length: count + 1 }, () => new Array(n + 1).fill(-1));
  best[0][0] = 0;
  for (let j = 1; j <= count; j += 1) {
    for (let i = j; i <= n - (count - j); i += 1) {
      for (let a = j - 1; a < i; a += 1) {
        if (best[j - 1][a] === Infinity) continue;
        const c = best[j - 1][a] + cost(a, i, j === count);
        if (c < best[j][i]) (best[j][i] = c), (from[j][i] = a);
      }
    }
  }
  if (best[count][n] === Infinity) return [text];
  const lines = [];
  for (let j = count, i = n; j > 0; j -= 1) {
    const a = from[j][i];
    lines.unshift(words.slice(a, i).join(' '));
    i = a;
  }
  return lines;
}

/**
 * A whole slide text with every line that is too wide balanced (see balanceLine). The text's own line breaks are kept, blank lines included;
 * the added breaks are newlines, so the slide draws them with `white-space: pre-line` or as separate lines.
 */
export function balanceProjectorLines(text, maxWidth, measure) {
  return String(text ?? '')
    .split('\n')
    .map((line) => balanceLine(line, maxWidth, measure).join('\n'))
    .join('\n');
}

/**
 * The text case modes the operator can pick for slide text: as typed, all capitals, or all small letters. The Live Quick Controls set it for
 * the projector (the projector setting `textCase`), and the planners keep their own choice for their lineups, drawers and printed lineups.
 */
export const TEXT_CASES = ['original', 'uppercase', 'lowercase'];

/** A mode as one of TEXT_CASES; anything else is 'original'. */
export function textCaseOf(mode) {
  return TEXT_CASES.includes(mode) ? mode : 'original';
}

/**
 * `text` in the case `mode` asks for. 'original' (or an unknown mode) gives it back as it is. Only letters change, so line breaks and spacing
 * hold. A null or undefined text is an empty string.
 */
export function applyTextCase(text, mode) {
  const s = text == null ? '' : String(text);
  const m = textCaseOf(mode);
  if (m === 'uppercase') return s.toLocaleUpperCase();
  if (m === 'lowercase') return s.toLocaleLowerCase();
  return s;
}

/**
 * Whether a text case picked in a Planner (Aa / AA / aa) should also become the projector's case: only while nothing is on air, that is while
 * the projector shows nothing, black or the welcome screen. Going live then starts in the case the operator was just reading the lineup in,
 * with no mismatch. Once a service is on air the projector's case changes only from the live controls, so a planner choice never restyles the
 * congregation's screen mid-service.
 */
export function plannerCaseReachesProjector(liveFrameKind) {
  return liveFrameKind == null || ['idle', 'black', 'blackout', 'welcome'].includes(liveFrameKind);
}

/**
 * A Praise & Worship slide with its words in `mode`: the title card's label and subtitle, and a lyric or prayer page's text. The Go Live
 * console's CURRENT SLIDE and NEXT SLIDE previews draw it, as the projector does, so the operator sees the congregation's case 1:1.
 */
export function applyPwSlideTextCase(slide, mode) {
  const m = textCaseOf(mode);
  return m === 'original' ? slide : caseSlide(slide, m);
}

function caseSlide(slide, mode) {
  if (!slide || typeof slide !== 'object') return slide;
  if (slide.kind === 'title') return { ...slide, label: applyTextCase(slide.label, mode), subtitle: applyTextCase(slide.subtitle, mode) };
  if (slide.kind === 'lyrics') return { ...slide, text: applyTextCase(slide.text, mode), hymnTitle: applyTextCase(slide.hymnTitle, mode) };
  if (slide.kind === 'prayer') return { ...slide, text: applyTextCase(slide.text, mode) };
  return slide;
}

/**
 * A projector frame with the words the congregation reads in `mode`: a text slide's title, heading and text; a song's title and lines; a
 * reading's or passage's lines; a psalm's response and pages; a Praise & Worship slide. Pictures, media and the other frames are unchanged.
 * 'original' gives back the same frame, so nothing re-renders. The projector applies it before it fits and balances the text, so the fit and
 * the line breaks are measured on the letters actually drawn.
 */
export function applyFrameTextCase(frame, mode) {
  const m = textCaseOf(mode);
  if (m === 'original' || !frame || typeof frame !== 'object') return frame;
  const c = (s) => (s == null ? s : applyTextCase(s, m));
  switch (frame.kind) {
    case 'text':
      return { ...frame, title: c(frame.title), headline: c(frame.headline), text: c(frame.text) };
    case 'lyrics':
      return { ...frame, title: c(frame.title), text: c(frame.text) };
    case 'deck':
      return {
        ...frame,
        title: c(frame.title),
        slides: Array.isArray(frame.slides) ? frame.slides.map((lines) => (Array.isArray(lines) ? lines.map((line) => ({ ...line, text: c(line.text) })) : lines)) : frame.slides,
      };
    case 'psalm':
      return { ...frame, title: c(frame.title), response: c(frame.response), pages: Array.isArray(frame.pages) ? frame.pages.map(c) : frame.pages };
    case 'pw':
      return { ...frame, segmentName: c(frame.segmentName), footer: c(frame.footer), slide: caseSlide(frame.slide, m) };
    default:
      return frame;
  }
}

/**
 * Edge-to-edge (the projector setting `edgeToEdge`, the Go Live MAX pill): how a song's stanza is laid out when it should fill the slide. Every
 * length is a share of the slide's width (cqw), or of its height for `padYcqh` on the projector's own stage.
 * - `padXcqw` / `padYcqh`: the thin clearance kept at the slide's edges, in place of the usual 6% inset.
 * - `ceilingCqw`: the size the fit starts from. It is larger than any stanza can be drawn at, so the fit always ends at the largest size that
 *   fits the room (a one-line chorus is limited by the width, a six-line verse by the height), never at a fixed size.
 * - `leading`: tighter line spacing, so a large stanza has no wasted gaps between lines.
 * - `heightShare`: the share of the room's height the text may take (the normal fit keeps 90%).
 * - `footerClearCqw`: kept free at the bottom of a Praise & Worship slide when its song title footer or page count is shown, so the text never
 *   meets them; `headerClearCqw` likewise at the top when its label is shown.
 * - `lowerThirdClearCqh` / `lowerThirdClearCqw`: kept free at the bottom while a lower third (or a note or alert banner) is on screen, the same
 *   18% of the height the projector clears for other text, so the band never covers the last line.
 */
// Edge-to-edge goes thin only at the sides (1.5% to 98.5% across): at the top and the bottom it keeps Title Safe's 5% (padYcqh on a Holy Mass
// slide, safeYcqw = 5% of the 56.25cqw height on a Praise & Worship face), so the words never reach the slide's top or bottom edge.
export const EDGE_TO_EDGE = Object.freeze({ padXcqw: 1.5, padYcqh: 5, safeYcqw: 2.8125, ceilingCqw: 22, leading: 1.12, heightShare: 0.98, footerClearCqw: 6.6, headerClearCqw: 6.6, lowerThirdClearCqh: 18, lowerThirdClearCqw: 10.2 });

/**
 * The box a Praise & Worship lyric is fitted in when edge-to-edge is on, as offsets from the slide's edges in cqw: thin at the sides, Title Safe
 * at the top and the bottom, with room kept for the label at the top and the footer at the bottom only when they are shown.
 */
export function edgeToEdgeBox({ header = false, footer = false, lowerThird = false } = {}) {
  const edge = EDGE_TO_EDGE.padXcqw;
  const safe = EDGE_TO_EDGE.safeYcqw;
  const bottom = Math.max(safe, footer ? EDGE_TO_EDGE.footerClearCqw : 0, lowerThird ? EDGE_TO_EDGE.lowerThirdClearCqw : 0);
  return { left: edge, right: edge, top: Math.max(safe, header ? EDGE_TO_EDGE.headerClearCqw : 0), bottom };
}

/** A lower third with its words in `mode`: the tag and both lines. 'original' gives back the same value. */
export function applyLowerThirdCase(value, mode) {
  const m = textCaseOf(mode);
  if (m === 'original' || !value || typeof value !== 'object') return value;
  const out = { ...value };
  for (const key of ['tag', 'line1', 'line2']) if (typeof out[key] === 'string') out[key] = applyTextCase(out[key], m);
  return out;
}

/**
 * The box a Praise & Worship title card's words (icon, title, gold rule, subtitle) are fitted in, as offsets from the slide's edges in cqw. The
 * slide is 100cqw wide and 56.25cqw tall. Title Safe (90%) keeps 2.8125cqw clear at the top and bottom and 5cqw at the sides; the segment name
 * and the footer with its page count sit just inside it, each 1.6cqw text from 2.813cqw off the edge, so they end about 4.8cqw in. The box starts
 * below the one and ends above the other, so a title fitted to it never reaches the rule's neighbours or the slide's edge.
 */
export const TITLE_CARD_BOX = Object.freeze({ topCqw: 6, bottomCqw: 6.6, sideCqw: 8 });

// One split for a prayer, used by every surface that shows it: the Notes & Prayers preview and full-screen view, the lineup, the live preview
// and the projector. A manual split is used exactly as it was placed. Otherwise the prayer is split at sentence ends, into slides of
// close length, and every slide of the prayer uses the same font size, with its own text block centred in the text area. The lyrics are not part of this split.

import { LINEUP_LINE_HEIGHT, PRAYER_STAGE } from './prayer-fit.js';
import { wrappedLineCount } from './prayer-metrics.js';
import { PRAYER_BAND_RESERVE, PRAYER_TOP, blockTops, textAreaPx } from './text-area.js';
import { manualParts, splitFingerprint } from './prayer-split.js';

export { PRAYER_BAND_RESERVE, PRAYER_TOP };

const W = PRAYER_STAGE.width;
const H = PRAYER_STAGE.height;

/** The largest and the smallest size a prayer is drawn at, in pixels on the 1920 stage. */
export const PRAYER_MAX_PX = Math.round(W * 0.05);
export const PRAYER_FLOOR_PX = 28;

/**
 * The share of the stage the prayer text is drawn across. The narrowest surface sets it: the full-screen text column is 86% of the width,
 * the lineup's text box is 88%, so a line that fits the 86% column fits every surface.
 */
export const PRAYER_WIDTH_SHARE = 0.86;

/** A small margin on the width, so a line the split counts as fitting is never wider than the text box. */
const SAFETY_SHARE = 0.02;

/** The box the text of a prayer slide must fit: the shared text area (see shared/text-area.js). */
export function prayerBoxPx() {
  return textAreaPx();
}

/** The width a line of prayer text may take at a size, in em: the text box less the safety margin. */
const maxEmAt = (px) => (W * PRAYER_WIDTH_SHARE * (1 - SAFETY_SHARE)) / px;

/** The lines a text takes on the stage at a size, each paragraph wrapped as the lineup face draws it. A blank line is a line. */
function linesOf(text, px) {
  const maxEm = maxEmAt(px);
  return String(text).split('\n').reduce((n, line) => n + wrappedLineCount(line, maxEm), 0);
}

/** The height a prayer's text takes on the stage at a size, in pixels: its lines at the lineup's line height. */
const heightOf = (text, px) => linesOf(text, px) * px * LINEUP_LINE_HEIGHT;

export function prayerBlockHeightPx(text, px) {
  return heightOf(text, px);
}

const fits = (text, px) => heightOf(text, px) <= prayerBoxPx().height;

/** The sentences of one line: each ends at a full stop, question or exclamation mark, semicolon or colon, or at the end of the line. */
const SENTENCE = /[^.!?;:]+(?:[.!?;:]+|$)/g;
function sentencesOf(line) {
  return (line.match(SENTENCE) || []).map((s) => s.trim()).filter(Boolean);
}

/**
 * The units a prayer is split from: its sentences, in order. Each unit carries the text that joins it to the one before: a space inside a
 * line, a line break at the start of a line, a blank line between paragraphs.
 */
export function unitsOf(text) {
  const units = [];
  String(text)
    .split(/\n\s*\n/)
    .forEach((paragraph, p) => {
      paragraph
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .forEach((line, l) => {
          sentencesOf(line).forEach((sentence, s) => {
            let joiner = ' ';
            if (s === 0) joiner = l === 0 && p > 0 ? '\n\n' : '\n';
            if (units.length === 0) joiner = '';
            units.push({ text: sentence, joiner });
          });
        });
    });
  return units;
}

/** The text of units `[from, to)`, joined as they were. */
function textOf(units, from, to) {
  return units.slice(from, to).reduce((acc, u, k) => acc + (k === 0 ? '' : u.joiner) + u.text, '');
}

/** The longest prefix of a word that fits a slide alone. */
function longestPrefix(word, px) {
  for (let n = word.length; n > 1; n -= 1) if (fits(word.slice(0, n), px)) return n;
  return 1;
}

/**
 * A sentence too long for a whole slide, broken at a clause (after a comma) first, then at a word, and only a word too long for a slide is
 * broken inside. Returns pieces `{ text, glue }`; a glued piece continues the word before it with no space.
 */
function breakSentence(sentence, px) {
  // The clauses, and the words of any clause too long for a slide, are the units; a word too long for a slide is cut into glued pieces.
  const units = [];
  sentence.split(/(?<=,)s+/).forEach((clause, ci) => {
    if (fits(clause, px)) {
      units.push({ text: clause, joiner: ci === 0 ? '' : ' ' });
      return;
    }
    clause.split(' ').forEach((word, wi) => {
      const joiner = ci === 0 && wi === 0 ? '' : ' ';
      if (fits(word, px)) {
        units.push({ text: word, joiner });
        return;
      }
      let rest = word;
      let first = true;
      while (rest) {
        const n = longestPrefix(rest, px);
        units.push({ text: rest.slice(0, n), joiner: first ? joiner : '' });
        rest = rest.slice(n);
        first = false;
      }
    });
  });
  // The pieces are balanced, as the prayer is: no short first piece.
  return balancedSplit(units, px).map((text) => ({ text, glue: false }));
}

/** The units at a size: a sentence too long for a slide becomes its pieces. */
function unitsAt(units, px) {
  const out = [];
  for (const unit of units) {
    if (fits(unit.text, px)) {
      out.push(unit);
      continue;
    }
    breakSentence(unit.text, px).forEach((piece, i) => out.push({ text: piece.text, joiner: i === 0 ? unit.joiner : piece.glue ? '' : ' ' }));
  }
  return out;
}

/**
 * The most balanced way to split the units into the fewest slides at a size: every slide holds whole units, and the tallest slide is as short
 * as it can be. Returns the slides' texts.
 */
function balancedSplit(units, px) {
  const n = units.length;
  if (n === 0) return [''];
  const max = prayerBoxPx().height;
  const height = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(Infinity));
  const h = (i, j) => {
    if (height[i][j] === Infinity) height[i][j] = heightOf(textOf(units, i, j), px);
    return height[i][j];
  };

  // The fewest slides: fill each slide as far as it fits.
  let count = 0;
  for (let i = 0; i < n; ) {
    let j = i + 1;
    while (j < n && h(i, j + 1) <= max) j += 1;
    count += 1;
    i = j;
  }

  // Of the splits into that many slides, the one whose tallest slide is shortest.
  let prev = new Array(n + 1).fill(Infinity);
  prev[0] = 0;
  const cuts = [];
  for (let c = 1; c <= count; c += 1) {
    const cur = new Array(n + 1).fill(Infinity);
    const cut = new Array(n + 1).fill(-1);
    for (let j = 1; j <= n; j += 1) {
      for (let i = 0; i < j; i += 1) {
        if (prev[i] === Infinity) continue;
        const hh = h(i, j);
        if (hh > max) continue;
        const candidate = Math.max(prev[i], hh);
        if (candidate < cur[j]) {
          cur[j] = candidate;
          cut[j] = i;
        }
      }
    }
    cuts.push(cut);
    prev = cur;
  }
  if (prev[n] === Infinity) return [textOf(units, 0, n)];

  const ranges = [];
  let j = n;
  for (let c = count; c >= 1; c -= 1) {
    const i = cuts[c - 1][j];
    ranges.unshift([i, j]);
    j = i;
  }
  return ranges.map(([a, b]) => textOf(units, a, b));
}

const cache = new Map();
const CACHE_LIMIT = 200;

/**
 * The slides of a prayer: `{ mode, fontPx, pages, tooLong }`. `pages` is `[{ text, fontPx }]`, every page at the same size. `mode` is 'manual'
 * when the operator's split is used, 'auto' for the sentence split, 'stale' when a manual split was made for text that has since changed (so
 * the automatic split is used, and the caller says so), and 'none' for an empty prayer. `split` is the saved split, or null.
 */
export function prayerSlidesFor(text, split) {
  const body = String(text ?? '');
  const key = `${body}\u0001${JSON.stringify(split ?? null)}`;
  if (cache.has(key)) return cache.get(key);
  const result = compute(body, split);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}

/** The sentence split of one text at full size: each slide holds whole sentences, and the slides are balanced. */
function autoSplit(text) {
  return balancedSplit(unitsAt(unitsOf(text), PRAYER_MAX_PX), PRAYER_MAX_PX);
}

/**
 * The top of each slide of one group (a prayer's slides), as `[{ top, centred }]`: normal slides share one top, a short slide is centred
 * in the text area. The rule is shared with the song lyrics (see shared/text-area.js).
 */
export function pageTops(texts, px = PRAYER_MAX_PX) {
  return blockTops(texts.map((t) => heightOf(t, px)));
}

/**
 * The slides of one prayer text. The operator's breaks are hard boundaries: each section between two of them is one part, used as placed.
 * A part too long for one slide at full size is split again by the automatic rule, inside that part, so the operator's breaks stay where
 * they are. With no breaks, the whole prayer is one part, which is the automatic split. Returns the slides and the two counts the panel
 * shows: the breaks placed by hand, and the slides the automatic rule added beyond the sections.
 */
function compute(body, split) {
  if (!body.trim()) {
    return { mode: 'none', fontPx: PRAYER_MAX_PX, pages: [{ text: '', fontPx: PRAYER_MAX_PX, ...pageTops([''])[0] }], tooLong: false, manualBreaks: 0, automaticSlides: 1 };
  }
  let mode = 'auto';
  let texts;
  let manualBreaks = 0;
  let automaticSlides = null;
  if (split?.mode === 'manual' && split.of === splitFingerprint(body) && split.at.length > 0) {
    mode = 'manual';
    manualBreaks = split.at.length;
    const parts = manualParts(body, split.at);
    const pieces = parts.map((part) => (fits(part, PRAYER_MAX_PX) ? [part] : autoSplit(part)));
    texts = pieces.flat();
    automaticSlides = texts.length - parts.length;
  } else {
    if (split?.mode === 'manual' && split.at.length > 0) mode = 'stale';
    texts = autoSplit(body);
  }
  const tops = pageTops(texts);
  return {
    mode,
    fontPx: PRAYER_MAX_PX,
    pages: texts.map((text, i) => ({ text, fontPx: PRAYER_MAX_PX, ...tops[i] })),
    tooLong: texts.some((t) => !fits(t, PRAYER_MAX_PX)),
    manualBreaks,
    automaticSlides: automaticSlides ?? texts.length,
  };
}


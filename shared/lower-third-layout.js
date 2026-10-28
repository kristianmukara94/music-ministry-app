// The Praise & Worship lower third: one layout for the live preview, the projector, the livestream lower-third preview and the lineup, so they
// match. The band sits at the bottom of the frame, on the margins the slide text uses. It adapts to the lyrics: it takes the room the lyrics
// leave free below their last line, and shrinks, down to a minimum size, to fit it. The lyrics themselves never change size.

import { charsPerLine, slideText } from './text-wrap.js';
import { visualLinesOf } from './prayer-fit.js';

export const STAGE_W = 1920;
export const STAGE_H = 1080;

/** The lyric size on a lineup slide: 5% of the stage width, in pixels on the 1920 stage. The lyrics are always drawn at this size. */
export const LYRIC_PX = 96;

/**
 * The band in full size, in percentages of the frame. `left` is the side margin the lyrics use (6% of the width); `bottom` is the footer
 * line the slide uses (7% of the height). `width` is the share of the frame the band's text column takes, the same column the lyrics use.
 */
export const LOWER_THIRD_BAND = {
  left: 6,
  bottom: 7,
  width: 88,
  titlePx: Math.round(LYRIC_PX * 0.75), // 72: the title at full size
  tagPx: 22,
};

/**
 * The smallest band, for legibility: the title no smaller than 40px and the composer no smaller than 24px on the 1920 stage. A page that
 * leaves room for less than this is split, rather than drawing the band smaller.
 */
export const LOWER_THIRD_MIN = { titlePx: 40, composerPx: 24, tagPx: 22 };

/** The gap between the bottom of the lyrics and the top of the band, in pixels on the 1920 stage. */
export const LYRIC_BAND_GAP_PX = 22;

/** The band's line heights and paddings, in pixels on the 1920 stage. They set its height, so they are fixed here, not by the browser. */
export const BAND_LINE = { title: 1.1, composer: 1.2, tag: 1.2 };
export const BAND_PAD = { cardY: 16, tagY: 6, composerGap: 4 };

/** The composer's size for a title size: about half the title, and never below the minimum composer size. */
export function composerFor(titlePx) {
  return Math.max(LOWER_THIRD_MIN.composerPx, Math.round(titlePx * 0.53));
}

/** The title's text, wrapped to the band's width at a size, as it is drawn. Words wider than a line break inside, by the shared rule. */
export function bandTitleChars(titlePx = LOWER_THIRD_BAND.titlePx) {
  return charsPerLine(LOWER_THIRD_BAND.width / 100, titlePx);
}

/** The composer's characters per line in the band at a size. */
export function bandComposerChars(composerPx = composerFor(LOWER_THIRD_BAND.titlePx)) {
  return charsPerLine(LOWER_THIRD_BAND.width / 100, composerPx);
}

/** The number of lines a text takes in the band, counting its own line breaks and the wrap at the band's width. */
function linesOf(text, chars) {
  return String(text ?? '')
    .split('\n')
    .reduce((n, line) => n + visualLinesOf(line, chars), 0);
}

/**
 * The height of the band at a title size, in pixels on the 1920 stage: the tag, the card's padding, the title's lines and the composer's
 * lines. The title and composer wrap at their own sizes, so a long title is taller.
 */
export function bandHeightPx(value, titlePx = LOWER_THIRD_BAND.titlePx) {
  const composerPx = composerFor(titlePx);
  const titleLines = linesOf(value.line1, bandTitleChars(titlePx));
  const tag = value.tag ? BAND_LINE.tag * LOWER_THIRD_MIN.tagPx + 2 * BAND_PAD.tagY : 0;
  const composer = value.line2 ? BAND_PAD.composerGap + linesOf(value.line2, bandComposerChars(composerPx)) * composerPx * BAND_LINE.composer : 0;
  return tag + 2 * BAND_PAD.cardY + titleLines * titlePx * BAND_LINE.title + composer;
}

/**
 * The largest band that fits in `availablePx` of height: the full size if it fits, otherwise the largest title size, down to the minimum,
 * that does. Returns `{ titlePx, composerPx, heightPx }`, or null when even the minimum band does not fit.
 */
export function fitBand(value, availablePx) {
  for (let titlePx = LOWER_THIRD_BAND.titlePx; titlePx >= LOWER_THIRD_MIN.titlePx; titlePx -= 1) {
    const heightPx = bandHeightPx(value, titlePx);
    if (heightPx <= availablePx) return { titlePx, composerPx: composerFor(titlePx), heightPx };
  }
  return null;
}

// Where the lyrics and the prayer text sit on a lineup slide, and how the lower third fits beside them. The lyrics are centred in the frame and
// drawn at one size, whether the lower third is on or off. The lower third adapts: it takes the room below the last line. A page is split
// only when even the smallest band does not fit beside it, and the split is the same rule prayers use. Nothing here changes a font size.

import { LOWER_THIRD_BAND, LOWER_THIRD_MIN, LYRIC_BAND_GAP_PX, LYRIC_PX, STAGE_H, STAGE_W, bandHeightPx, fitBand } from './lower-third-layout.js';
import { LINEUP_LINE_HEIGHT, prayerFit, prayerPages, prayerTextHeight } from './prayer-fit.js';
import { PRAYER_MAX_PX, prayerBlockHeightPx } from './prayer-slides.js';
import { blockTopShare, textAreaShare } from './text-area.js';

/** Lyrics and prayer text are centred in the shared text area (see shared/text-area.js), as a share of the height. */
export const TEXT_CENTRE = textAreaShare().centre;

/**
 * The lineup text column: 88% of the width, at the lineup line height. `maxHeightPx` is the tallest block the fit allows. `scale` is the
 * operator's size scale: the text is measured at its scaled size, so a larger scale holds fewer lines on a page and splits sooner.
 */
export function lineupFitAt(fontPx = LYRIC_PX, maxHeightPx = STAGE_H * 0.7, scale = 1) {
  return prayerFit({ widthPx: STAGE_W * 0.88, fontPx: fontPx * scale, lineHeight: LINEUP_LINE_HEIGHT, maxHeightPx });
}

/** The height a page's text takes on the stage, in pixels, at its size. */
export function blockHeightPx(text, fontPx = LYRIC_PX) {
  return prayerTextHeight(text, lineupFitAt(fontPx));
}

/** The pixel row where the page's text ends, when its block is centred in the text area as every surface draws it. */
export function blockBottomPx(text, fontPx = LYRIC_PX) {
  return TEXT_CENTRE * STAGE_H + prayerBlockHeightPx(text, fontPx) / 2;
}

/** The room below a text that ends at `bottomPx`, for the band: from the gap under the text to the band's bottom margin. */
export function roomBelowPx(bottomPx) {
  return STAGE_H - (LOWER_THIRD_BAND.bottom / 100) * STAGE_H - (bottomPx + LYRIC_BAND_GAP_PX);
}

/** The band that fits beside a page at its size, or null when even the smallest band does not fit. */
export function bandBeside(text, fontPx, value) {
  return fitBand(value, roomBelowPx(blockBottomPx(text, fontPx)));
}

/** The tallest block a page may have so that the smallest band still fits beside it. */
export function maxBlockPx(value) {
  const minBand = bandHeightPx(value, LOWER_THIRD_MIN.titlePx);
  const bottomMargin = (LOWER_THIRD_BAND.bottom / 100) * STAGE_H;
  return 2 * (STAGE_H / 2 - bottomMargin - LYRIC_BAND_GAP_PX - minBand);
}

/**
 * The pages of a stanza or prayer, each with its size, adjusted for the band. Without a band, the pages are unchanged. With one, a page whose
 * text would leave too little room for even the smallest band is split again, at its own size, so each part leaves room. The text keeps its
 * size: only the lines on each slide change.
 */
export function fitPagesToBand(pages, value, scale = 1) {
  if (!value) return pages;
  const limit = maxBlockPx(value);
  const out = [];
  for (const page of pages) {
    const fontPx = page.fontPx ?? LYRIC_PX;
    if (prayerTextHeight(page.text, lineupFitAt(fontPx, undefined, scale)) <= limit) {
      out.push(page);
      continue;
    }
    for (const text of prayerPages(page.text, lineupFitAt(fontPx, limit, scale))) out.push({ ...page, text, fontPx });
  }
  return out;
}

/** The pages of one stanza, as text, with the band taken into account and the operator's size scale applied. */
export function lyricPagesFor(text, value, scale = 1) {
  return fitPagesToBand(prayerPages(text, lineupFitAt(LYRIC_PX, undefined, scale)).map((t) => ({ text: t })), value, scale).map((p) => p.text);
}

/**
 * The lyric (or prayer) text's bottom, as a share of the frame height, for the frame on screen. Null when no lyric or prayer text is on
 * screen. Every surface that draws the band asks this, so they all place the band the same way.
 */
export function lyricBottomOf(frame) {
  if (!frame || frame.kind !== 'pw') return null;
  const slide = frame.slide;
  if (slide.kind !== 'lyrics' && slide.kind !== 'prayer') return null;
  if (slide.kind === 'prayer' && slide.placeholder) return null;
  // The text block is centred in the text area, starting at the slide's own top, so the band sits below its real bottom.
  const height = prayerBlockHeightPx(slide.text, slide.fontPx ?? PRAYER_MAX_PX);
  const top = slide.top ?? blockTopShare(height);
  return top + height / STAGE_H;
}

/** The tallest the band may be with no text on screen, as a share of the frame's height. */
export const MAX_BAND_SHARE = 0.32;

/**
 * The band's sizes beside the text above it: `lyricBottomShare` is that text's bottom as a share of the height, or null for no text. With no
 * text, the band is at full size. Returns `{ titlePx, composerPx }`.
 */
export function bandSizesBelow(value, lyricBottomShare) {
  if (lyricBottomShare == null) {
    // With no text on screen the band is at full size, unless that would make it tall: a long title shrinks, down to the minimum, to stay
    // within MAX_BAND_SHARE of the frame, so it never fills the screen.
    const fit = fitBand(value, MAX_BAND_SHARE * STAGE_H);
    return fit ? { titlePx: fit.titlePx, composerPx: fit.composerPx } : { titlePx: LOWER_THIRD_MIN.titlePx, composerPx: LOWER_THIRD_MIN.composerPx };
  }
  const fit = fitBand(value, roomBelowPx(lyricBottomShare * STAGE_H));
  if (fit) return { titlePx: fit.titlePx, composerPx: fit.composerPx };
  return { titlePx: LOWER_THIRD_MIN.titlePx, composerPx: LOWER_THIRD_MIN.composerPx };
}

/** A slide's identity across a band change: the same stanza (or prayer) and the same part of it. Black steps have none. */
export function slideGroup(slide) {
  if (!slide) return null;
  if (slide.kind === 'lyrics') return `song|${slide.hymnId}|${slide.position}`;
  if (slide.kind === 'prayer') return `prayer|${slide.label}`;
  return null;
}

/**
 * The index, among the given steps, of the slide that shows the same stanza or prayer, and the part of it nearest to the one given. Used
 * when the band is turned on or off, so the operator stays on the same place. Null when the stanza is not there.
 */
export function findSlideIndex(slides, slide) {
  const group = slideGroup(slide);
  if (group === null) return null;
  const part = slide.part ?? 0;
  let best = null;
  slides.forEach((s, index) => {
    if (!s || slideGroup(s) !== group) return;
    const distance = Math.abs((s.part ?? 0) - part);
    if (best === null || distance < best.distance) best = { index, distance };
  });
  return best ? best.index : null;
}

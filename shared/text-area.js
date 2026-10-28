// The text area: where prayer and lyric text sits on a 1920 x 1080 slide, on every surface. One rule: the area starts 15% down the stage, ends
// above the room kept for the lower third's smallest band, and the text block is centred in it, so each slide's own block is centred (a short
// slide too). The lineup, the live preview, the projector and the Notes & Prayers view all read these values.

import { PRAYER_STAGE } from './prayer-fit.js';
import { LOWER_THIRD_BAND, LYRIC_BAND_GAP_PX } from './lower-third-layout.js';

const W = PRAYER_STAGE.width;
const H = PRAYER_STAGE.height;

/** Where the text area starts, as a share of the height. */
export const PRAYER_TOP = 0.15;

/** The share of the height kept free at the bottom for the lower third's smallest band. The text never sits in it. */
export const PRAYER_BAND_RESERVE = 0.2;

/** The text area in pixels on the 1920 stage: its top, its bottom, its height, and its centre. */
export function textAreaPx() {
  const top = PRAYER_TOP * H;
  const bottom = H * (1 - LOWER_THIRD_BAND.bottom / 100) - H * PRAYER_BAND_RESERVE - LYRIC_BAND_GAP_PX;
  return { top, bottom, height: bottom - top, centre: (top + bottom) / 2 };
}

/** The text area as shares of the stage: `top`, `height` and `centre`, each a share of the height. */
export function textAreaShare() {
  const area = textAreaPx();
  return { top: area.top / H, height: area.height / H, centre: area.centre / H };
}

/** The CSS for the text area: `top` and `height` as percentages of the slide, for a box that holds the text block. */
export function textAreaStyle() {
  const share = textAreaShare();
  return { top: `${share.top * 100}%`, height: `${share.height * 100}%` };
}

/** Where a block of text of `heightPx` starts, as a share of the height, when it is centred in the text area. */
export function blockTopShare(heightPx) {
  return (textAreaPx().centre - heightPx / 2) / H;
}

/**
 * A slide counts as short when its text block is less than this share of the tallest block in its group (a prayer, or one song's
 * stanzas). Short slides are centred vertically in the text area; the others start at the group's shared top.
 */
export const SHORT_BLOCK_SHARE = 0.75;

/**
 * The top of each slide in a group, from the heights of their text blocks (in pixels on the stage). Normal slides share one top: the top
 * at which the tallest block is centred. A short slide is centred in the text area on its own. Returns `[{ top, centred }]`, in order.
 */
export function blockTops(heightsPx) {
  const tallest = Math.max(0, ...heightsPx);
  const shared = blockTopShare(tallest);
  return heightsPx.map((h) => (h < SHORT_BLOCK_SHARE * tallest ? { top: blockTopShare(h), centred: true } : { top: shared, centred: false }));
}

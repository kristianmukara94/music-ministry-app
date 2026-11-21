/** Where prayer and lyric text sits on a 1920 x 1080 slide: one rule, used by every surface. */
export const PRAYER_TOP: number;
export const PRAYER_BAND_RESERVE: number;

/** The text area in pixels on the 1920 stage: its top, bottom, height and centre. */
export function textAreaPx(): { top: number; bottom: number; height: number; centre: number };
/** The text area as shares of the stage's height. */
export function textAreaShare(): { top: number; height: number; centre: number };
/** The CSS for the text area: `top` and `height` as percentages of the slide. */
export function textAreaStyle(): { top: string; height: string };
/** Title Safe's top inset, as a share of the height. */
export const TITLE_SAFE_TOP: number;
/** The tallest block pagination lays out on a page, as a share of the height. */
export const TALLEST_BLOCK_SHARE: number;
/** The highest a block may start, as a share of the height: where the tallest paginated page is centred. Always below Title Safe. */
export const TEXT_TOP_MIN: number;
/** Where a block of text of `heightPx` starts, as a share of the height, when it is centred in the text area: never above TEXT_TOP_MIN. */
export function blockTopShare(heightPx: number): number;
/** A slide counts as short when its block is less than this share of the tallest block in its group. */
export const SHORT_BLOCK_SHARE: number;
/** The top of each slide in a group, from the heights of their blocks: normal slides share one top, a short slide is centred on its own. */
export function blockTops(heightsPx: number[]): { top: number; centred: boolean }[];

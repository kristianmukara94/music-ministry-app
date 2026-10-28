export const STAGE_W: number;
export const STAGE_H: number;
export const LYRIC_PX: number;
export const LOWER_THIRD_BAND: { left: number; bottom: number; width: number; titlePx: number; tagPx: number };
export const LOWER_THIRD_MIN: { titlePx: number; composerPx: number; tagPx: number };
export const LYRIC_BAND_GAP_PX: number;
export const BAND_LINE: { title: number; composer: number; tag: number };
export const BAND_PAD: { cardY: number; tagY: number; composerGap: number };
export interface BandValue { line1: string; line2?: string | null; tag?: string | null }
export function composerFor(titlePx: number): number;
export function bandTitleChars(titlePx?: number): number;
export function bandComposerChars(composerPx?: number): number;
export function bandHeightPx(value: BandValue, titlePx?: number): number;
export function fitBand(value: BandValue, availablePx: number): { titlePx: number; composerPx: number; heightPx: number } | null;

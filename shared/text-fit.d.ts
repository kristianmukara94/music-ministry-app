export function fitFontSize(maxPx: number, minPx: number, fits: (px: number) => boolean): number;
export const TITLE_MAX_LINES: number;
export const TITLE_MAX_SHARE: number;
export function titleFits(heightPx: number, fontPx: number, leading: number, roomPx: number): boolean;
export function lineHeightFor(lineCount: number): number;
export function lineCountOf(text: string): number;

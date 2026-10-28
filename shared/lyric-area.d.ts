export const TEXT_CENTRE: number;
export function lineupFitAt(fontPx?: number, maxHeightPx?: number): import('./prayer-fit.js').PrayerFit;
export function blockHeightPx(text: string, fontPx?: number): number;
export function blockBottomPx(text: string, fontPx?: number): number;
export function roomBelowPx(bottomPx: number): number;
export function bandBeside(text: string, fontPx: number, value: import('./lower-third-layout.js').BandValue): ReturnType<typeof import('./lower-third-layout.js').fitBand>;
export function maxBlockPx(value: import('./lower-third-layout.js').BandValue): number;
export interface Page { text: string; fontPx?: number; [key: string]: unknown }
export function fitPagesToBand<T extends Page>(pages: T[], value: import('./lower-third-layout.js').BandValue | null): T[];
export function lyricPagesFor(text: string, value: import('./lower-third-layout.js').BandValue | null): string[];
export function lyricBottomOf(frame: unknown): number | null;
export function bandSizesBelow(value: import('./lower-third-layout.js').BandValue, lyricBottomShare: number | null): { titlePx: number; composerPx: number };
export function slideGroup(slide: unknown): string | null;
export function findSlideIndex(slides: (unknown | null)[], slide: { kind: string; part?: number; [key: string]: unknown }): number | null;

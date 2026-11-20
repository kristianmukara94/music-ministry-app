export function fitFontSize(maxPx: number, minPx: number, fits: (px: number) => boolean): number;
export const MIN_READABLE_CQW: number;
export function fitWholeLines(ceilingPx: number, readablePx: number, fits: (px: number) => boolean): number | null;
export function wrapNeeded(widestLineAtReadablePx: number, roomWidthPx: number): boolean;
export function layoutLyricLines(
  text: string,
  options: { width: number; height: number; ceilingPx: number; readablePx: number; floorPx?: number; leading: number; measure: (text: string, px: number) => number },
): { px: number; lines: string[]; wrapped: boolean };
export const TITLE_MAX_LINES: number;
export const TITLE_MAX_SHARE: number;
export function titleFits(heightPx: number, fontPx: number, leading: number, roomPx: number): boolean;
export function lineHeightFor(lineCount: number): number;
export function lineCountOf(text: string): number;
export const WEAK_LINE_ENDS: Set<string>;
export function balanceLine(line: string, maxWidth: number, measure: (text: string) => number): string[];
export function balanceProjectorLines(text: string, maxWidth: number, measure: (text: string) => number): string;
export type TextCase = 'original' | 'uppercase' | 'lowercase';
export const TEXT_CASES: readonly TextCase[];
export function textCaseOf(mode: unknown): TextCase;
export function applyTextCase(text: string | null | undefined, mode: TextCase | string | null | undefined): string;
export function applyFrameTextCase<F>(frame: F, mode: TextCase | string | null | undefined): F;
export function applyLowerThirdCase<L>(value: L, mode: TextCase | string | null | undefined): L;
export function applyPwSlideTextCase<S>(slide: S, mode: TextCase | string | null | undefined): S;
export const EDGE_TO_EDGE: Readonly<{ padXcqw: number; padYcqh: number; ceilingCqw: number; leading: number; heightShare: number; footerClearCqw: number; headerClearCqw: number; lowerThirdClearCqh: number; lowerThirdClearCqw: number }>;
export function edgeToEdgeBox(options?: { header?: boolean; footer?: boolean; lowerThird?: boolean }): { left: number; right: number; top: number; bottom: number };
export function plannerCaseReachesProjector(liveFrameKind: string | null | undefined): boolean;

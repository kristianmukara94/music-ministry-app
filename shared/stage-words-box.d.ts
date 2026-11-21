export function stageWordsBox(at: { left: number; right: number; fontSize: number; align: string; whole: boolean; monitorWidth: number; minLeft?: number; maxRight?: number }): { left: number; width: number };
export const STAGE_WORDS_RING_PX: number;
export interface StageWordsBounds { top: number; bottom: number; left: number; right: number }
/** The room the inline box may take on the monitor, ring included: Title Safe (or 1.5%–98.5% across for MAX lyrics), above the footer. */
export function stageWordsBounds(at: { monitorWidth: number; monitorHeight: number; edge?: boolean; floor?: number; ring?: number }): StageWordsBounds;
/** The inline box's top, height and the most it may grow to, kept inside the bounds. */
export function stageWordsRows(at: { top: number; bottom: number; pitch: number; bounds: StageWordsBounds }): { top: number; height: number; maxHeight: number };
export function stageWordsWhiteSpace(slideWhiteSpace: string): 'pre' | 'pre-wrap';

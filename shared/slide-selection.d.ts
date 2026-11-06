export function without(set: Set<number>, ids: number[]): Set<number>;
export function toggled(set: Set<number>, id: number): Set<number>;
export function clickSelection(current: Set<number>, order: number[], anchor: number | null, target: number, shift: boolean): Set<number>;
export type SelectionKey = 'selectAll' | 'clear' | 'delete';
export function selectionKey(
  e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean },
  selected: number,
): SelectionKey | null;
export const SLIDE_DRAG_TYPE: string;
export function dragSlideIds(id: number, checked: Set<number>, order: number[]): number[];
export function parseDragSlideIds(raw: string | null | undefined): number[];
export type GridColumns = 3 | 4 | 6;
export const GRID_COLUMNS: GridColumns[];
export const DEFAULT_GRID_COLUMNS: GridColumns;
export function parseGridColumns(raw: string | null | undefined): GridColumns;

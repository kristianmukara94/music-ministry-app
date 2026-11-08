import type { MassSlot } from './mass-slots.js';

export interface PictureDeck {
  key: string;
  folderId: number | null;
  title: string;
  slideIds: number[];
  /** A deck slice (see deckSlice): it starts on picture `at` (0-based) of its folder's `of`, and runs to the end. */
  from?: { at: number; of: number };
}

export interface FlowRow {
  module: 'announcements' | 'notes';
  sourceId: string;
  label: string;
}

export type MassFlowTarget = { kind: 'slot'; slot: string } | { kind: 'after'; index: number };

interface PlanRow {
  block: string;
  module: string;
  sourceId: string;
  label: string;
  slot?: string | null;
}

export function decksOf(slides: { slideId: number | null; folderId: number | null; title: string }[], folderName?: (id: number | null) => string | null | undefined): PictureDeck[];
export function deckSlice(
  slide: { slideId: number; folderId: number | null; title: string },
  slides: { slideId: number | null; folderId: number | null; title: string }[],
  folderName?: (id: number | null) => string | null | undefined,
): PictureDeck;
export function announcementSource(sourceId: string | number | null | undefined): { slideId: number; alone: boolean; from: boolean } | null;
export function deckRow(deck: PictureDeck): FlowRow;
export function flowRowsOf(payload: (PictureDeck | FlowRow)[]): FlowRow[];
export function newFlowRows<R extends { module: string; sourceId: string }>(items: { module: string; sourceId: string }[], rows: R[]): { rows: R[]; duplicates: R[] };
export function massLineup(rows: { block: string; slot?: string | null }[]): ({ index: number } | { slot: MassSlot })[];
export function massOrderReset<T extends { module: string; slot?: string | null }>(items: T[]): { items: T[]; removed: number };
export function deckThumb(row: { module: string; sourceId: string } | null | undefined): string | null;
export function textSlidePages(text: string, limits?: { maxChars: number; maxLines: number }): string[];
export function massInsertAt(items: PlanRow[], target: MassFlowTarget): { at: number; block: string } | null;
export function cursorAfterInsert(cursor: number, at: number, count: number): number;
export function insertIntoMassFlow<T extends PlanRow>(items: T[], rows: { module: string; sourceId: string; label: string }[], target: MassFlowTarget, cursor?: number): { items: (T | PlanRow)[]; cursor: number; at: number } | null;
export function replaceSlotInMassFlow<T extends PlanRow>(
  items: T[],
  rows: { module: string; sourceId: string; label: string }[],
  slot: string,
  cursor?: number,
): { items: (T | PlanRow)[]; cursor: number; at: number; replaced: T | null; replacedCurrent: boolean } | null;
export function removeFromMassFlow<T extends { stale?: boolean }>(items: T[], index: number, cursor?: number): { items: T[]; cursor: number; removed: T; removedCurrent: boolean } | null;
export function followCursor(before: { module: string; sourceId: string }[], next: { module: string; sourceId: string }[], cursor: number): number;

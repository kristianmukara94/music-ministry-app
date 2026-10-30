import type { PwSegment } from './pw.js';

/** What a dragged Library item carries. `id` is a hymn id, a note id, or for scripture `'title'` or a reading type. */
export interface LibraryDrag {
  type: 'song' | 'prayer' | 'scripture';
  id: number | string;
  title: string;
}

/** What a Library drag carries: one tab's items, in the order they are attached. */
export interface LibraryDragBatch {
  type: LibraryDrag['type'];
  items: { id: number | string; title: string }[];
}

export type AttachResult =
  | { patch: Partial<PwSegment>; mode: 'added' | 'chained' }
  | { refused: 'type' | 'present' | 'full' };

export interface AttachCounts {
  added: number;
  chained: number;
  present: number;
  /** Refused because the card does not take the item or is full. */
  left: number;
}

/** Null when the payload is not a Library drag. Accepts `{ type, items }` or the single `{ type, id, title }`. */
export function parseDrag(raw: unknown): LibraryDragBatch | null;
export function attachItems(segment: PwSegment, batch: LibraryDragBatch): { segment: PwSegment } & AttachCounts;
export function attachItem(segment: PwSegment, drag: LibraryDrag): AttachResult;
export function attachMany(segment: PwSegment, drags: LibraryDrag[]): { segment: PwSegment } & AttachCounts;
export function describeAttach(segmentName: string, type: LibraryDrag['type'], counts: AttachCounts): string;

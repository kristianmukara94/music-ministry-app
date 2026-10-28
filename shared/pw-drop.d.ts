import type { PwSegment } from './pw.js';

export type SongDropResult =
  | { patch: Pick<PwSegment, 'type' | 'content' | 'arrangement'> }
  | { refused: 'type' | 'full' | 'present' };

export function songDrop(segment: PwSegment, hymnId: number): SongDropResult;

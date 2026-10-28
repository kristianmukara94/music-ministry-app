/** Null when the song is deleted; the library returns `deletedAt` with it. */
export function hymnAfterChange<T>(hymn: T | null): T | null;
export function withHymn<T>(cache: Record<number, T>, id: number, hymn: T | null): Record<number, T>;
export function usesHymn(segments: { content: { kind: string; hymnIds?: number[] } }[], id: number): boolean;
export function overlayLyricsItems<T extends { module: string; sourceId: string; label: string; stale?: boolean; deleted?: boolean }>(
  items: T[],
  now: Record<number, { title?: string; deleted: boolean }>,
): T[];

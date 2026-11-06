export function foldText(value: unknown): string;

export function filterSetlist<T extends { title: string; composer?: string | null }>(entries: T[] | null | undefined, query: string): { entry: T; index: number }[];

export function parseKey(key: unknown): { pitch: number; minor: boolean } | null;

export function transposeKey(key: unknown, semitones: number): string | null;

export const MAX_TRANSPOSE: number;

export function clampTranspose(semitones: unknown): number;

export function transposeLabel(semitones: unknown): string;

export function transposeId(setlistId: number | null, hymnId: number): string;

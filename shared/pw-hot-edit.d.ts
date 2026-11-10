import type { PwSlide } from './pw';

type Step = { kind: 'slide'; slide: PwSlide; index?: number; total?: number } | { kind: 'black' } | { kind: string; slide?: PwSlide };
type LyricSlide = Extract<PwSlide, { kind: 'lyrics' }>;

export function lyricAt(steps: readonly Step[], index: number): LyricSlide | null;
export function occurrenceOf(steps: readonly Step[], index: number): number;
export function arrangementWithInsert<A extends Record<string, string[]>>(arrangement: A, hymnId: number, afterSectionId: string, occurrence: number, newSectionId: string | number): A;
export function arrangementWithout(
  arrangement: Record<string, string[]> | null | undefined,
  hymn: { id: number; stanzas: readonly { id: number | string }[] },
  sectionId: string | number,
  occurrence: number,
): Record<string, string[]> | null;
export function pagesWithout<T>(pages: readonly T[], index: number): T[] | null;
export function slideAfterDelete(at: number, remaining: number): number;
export function findStanzaStep(steps: readonly Step[], hymnId: number, sectionId: string | number, from?: number): number | null;
export function splitAtMidpoint(text: string): [string, string] | null;
export function arrangementWithSplit<A extends Record<string, string[]>>(arrangement: A, hymnId: number, firstId: string | number, secondId: string | number): A;

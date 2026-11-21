import type { PwSlide, PwSlideOrigin } from './pw';

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


/** Where a card's text goes: its first item, a chained item, a new chained item at `at`, or a new first item on a title card. */
export type CardTextTarget = { kind: 'head' } | { kind: 'chain'; index: number } | { kind: 'newChain'; at: number } | { kind: 'newHead' };
export interface CardSlidePlan {
  edit: { kind: 'title'; text: string } | { kind: 'page'; target: CardTextTarget; pages: string[]; page: number } | null;
  add: { target: CardTextTarget; pages: string[]; at: number };
}
export function itemPages(steps: readonly Step[], origins: readonly PwSlideOrigin[], item: PwSlideOrigin['item']): string[];
export function cardSlidePlan(steps: readonly Step[], origins: readonly PwSlideOrigin[], index: number, segment: { name: string; content: { kind: string } }): CardSlidePlan | null;
export function liveStepAfterDelete(at: { shown: number; start: number; removed: number; slides: number }): number | null;
export type CardSave = { target: CardTextTarget; pages: string[]; showPage: number | null };
export function cardEditSave(plan: CardSlidePlan | null, text: string, at: { onScreen: boolean }): { rename: string } | CardSave | null;
export function cardAddSave(plan: CardSlidePlan, text: string): CardSave;

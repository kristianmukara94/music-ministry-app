export const NBSP: string;
export interface StubLimits {
  maxChars: number;
  maxWords: number;
  mergedMaxChars: number;
}
export const PROSE_STUB: Readonly<StubLimits>;
export interface ProseUnit {
  text: string;
  joiner: '\n' | ' ';
}
export function proseChars(text: string): number;
export function verseLine(number: number | string, text: string): string;
export function bindVerseNumber(line: string): string;
export function isStub(text: string, limits?: StubLimits): boolean;
export function proseSentences(line: string): string[];
export function proseClauses(sentence: string): string[];
export function proseUnits(section: string, fits: (text: string) => boolean): ProseUnit[];
export function packProse(units: ProseUnit[], fits: (text: string) => boolean): string[];
export function mergeTrailingStub(pages: string[], options?: { source?: string; fits?: (text: string) => boolean; limits?: StubLimits }): string[];
export function paginateProse(section: string, fits: (text: string) => boolean, options?: { mergeStub?: boolean }): string[];

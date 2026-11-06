export type DeckSource = 'ann' | 'wb';
export type DeckView = string;

export interface DeckItem {
  key: string;
  source: DeckSource;
  id: number;
  folderId: number | null;
  title: string;
  /** Lower-cased title, text and notes, for the search. */
  search: string;
}

export type DeckDestination = { store: 'ann'; folderId: number } | { store: 'wb'; folderId: number | null };

export const WHITEBOARD_POWERPOINT_FOLDER: string;
export function isSystemFolder(name: string | null | undefined): boolean;
export function itemKey(source: DeckSource, id: number): string;
export function parseItemKey(key: string): { source: DeckSource; id: number } | null;
export function parseDeckView(view: DeckView): { store: 'all' | DeckSource; folder: number | null | undefined };
export function buildDeckItems(
  ann: { id: number; folderId: number; name: string; text?: string | null; headline?: string | null; notes?: string | null }[],
  wb: { id: number; folderId: number | null; title: string; content?: string; slideId?: number | null; notes?: string | null }[],
): DeckItem[];
export function itemsInView(items: DeckItem[], view: DeckView): DeckItem[];
export function searchItems(items: DeckItem[], query: string): DeckItem[];
export function destinationFor(view: DeckView, fallback: DeckDestination | null, annFolderIds: number[], wbFolderIds: number[]): DeckDestination;
export function existingView(view: DeckView, annFolderIds: number[], wbFolderIds: number[]): DeckView;
export function canReorder(view: DeckView, query: string): boolean;
export function stepIndex(index: number, length: number, delta: number, loop: boolean): number;
export function splitKeys(keys: Iterable<string>): { ann: number[]; wb: number[] };
export function clickKeySelection(current: Set<string>, order: string[], anchor: string | null, target: string, shift: boolean): Set<string>;
export function moveKey(list: string[], fromKey: string, toKey: string): string[];

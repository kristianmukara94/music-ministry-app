export type DeckPresetId = 'loop' | 'sermon';
export interface DeckPlayback {
  interval: number;
  loop: boolean;
  showCount: boolean;
}
export const DECK_PRESETS: Record<DeckPresetId, { autoplay: boolean; playback: Partial<DeckPlayback>; notesOpen: boolean | null }>;
export function applyPreset<T extends DeckPlayback>(id: DeckPresetId, current: T): T;
export function activePreset(playback: DeckPlayback, playing: boolean): DeckPresetId | null;
export const NOTES_SIZES: string[];
export const DEFAULT_NOTES_SIZE: number;
export function parseNotesSize(raw: string | number | null | undefined): number;
export function dragItemKeys(key: string, checked: Set<string>, order: string[]): string[];
export const ANN_SLIDE_DRAG_TYPE: string;

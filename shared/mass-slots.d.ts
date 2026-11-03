export type SlotBlock = 'introductory' | 'word' | 'eucharist' | 'communion' | 'concluding';

export interface MassSlot {
  id: string;
  number: number;
  block: SlotBlock;
  name: string;
  kind: 'song' | 'text';
  /** The song category the Hymn Library is filtered by for this slot. */
  songCategory?: string;
  /** The Mass Order text that matches the slot. */
  massOrderId?: string;
  /** The opening words of a spoken slot's own text, offered as a one-click fill. */
  presets?: string[];
}

export interface MassSection {
  block: SlotBlock;
  number: number;
  name: string;
}

/** The part of a plan item the slot rules use. */
export interface SlotItem {
  block: SlotBlock;
  slot?: string | null;
}

export const MASS_SLOTS: MassSlot[];
export const MASS_SECTIONS: MassSection[];
export const SLOT_IDS: string[];
export const BUILT_IN_TEMPLATES: { id: string; fills: { slot: string; module: string; sourceId: string }[] }[];

export function slotById(id: string | null | undefined): MassSlot | null;
export function isSlotId(id: unknown): id is string;
export function slotsOfBlock(block: SlotBlock): MassSlot[];
export function indexOfSlot(items: readonly SlotItem[], slotId: string): number;
export function filledIn(items: readonly SlotItem[], block: SlotBlock): { filled: number; total: number };
export function placeInSlot<T extends SlotItem>(items: T[], slotId: string, item: Omit<T, 'block' | 'slot'> & Partial<Pick<T, 'block' | 'slot'>>): T[];
export function clearSlot<T extends SlotItem>(items: T[], slotId: string): T[];
export function moveToSlot<T extends SlotItem>(items: T[], index: number, slotId: string): T[];
export function additionalIn(items: readonly SlotItem[], block: SlotBlock): number[];
export function slotNumberOf(id: string | null | undefined): number | null;
export function slotIdOfNumber(n: unknown): string | null;

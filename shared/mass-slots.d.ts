export type SlotBlock = 'introductory' | 'word' | 'eucharist' | 'communion' | 'concluding';

export interface MassSlot {
  id: string;
  /** The website's number for the slot: 1 to 17 for the first slots, 18 to 28 for the ones added after. Never changes. */
  number: number;
  /** The slot's place in the Mass, 1 to 28: the number the operator sees. */
  position: number;
  /** The slot's key in the Philippine Mass flow (PHILIPPINE_MASS_FLOW in shared/mass-language.js), such as 'ENTRANCE_HYMN'. */
  type: string;
  block: SlotBlock;
  /** The English name. slotLabel in shared/mass-language.js gives it in a Mass language. */
  name: string;
  kind: 'song' | 'text' | 'reading';
  /** The song category the Hymn Library is filtered by for this slot. */
  songCategory?: string;
  /** The Mass Order text that matches the slot. */
  massOrderId?: string;
  /** The opening words of a spoken slot's own text, offered as a one-click fill. */
  presets?: string[];
  /** Filled from the Lectionary for the plan's date. */
  isReading?: boolean;
  /** Said on Sundays and solemnities. */
  sundayOnly?: boolean;
  /** A part a Mass may leave out. */
  optional?: boolean;
}

export interface MassSection {
  id: 'introductory_rites' | 'liturgy_of_the_word' | 'liturgy_of_the_eucharist' | 'concluding_rites';
  /** The section's first block. */
  block: SlotBlock;
  /** The plan blocks the section holds, in order. */
  blocks: SlotBlock[];
  number: number;
  name: string;
}

/** The part of a plan item the slot rules use. */
export interface SlotItem {
  block: SlotBlock;
  slot?: string | null;
}

export const MASS_SLOTS: MassSlot[];
export const MASS_BLOCKS: SlotBlock[];
export const MASS_SECTIONS: MassSection[];
export const SLOT_IDS: string[];
export const SLOT_COUNT: number;
export const BUILT_IN_TEMPLATES: { id: string; fills: { slot: string; module: string; sourceId: string }[] }[];

export function slotById(id: string | null | undefined): MassSlot | null;
export function isSlotId(id: unknown): id is string;
export function slotsOfBlock(block: SlotBlock): MassSlot[];
export function sectionOfBlock(block: string): MassSection | null;
export function slotsOfSection(sectionId: string): MassSlot[];
export function indexOfSlot(items: readonly SlotItem[], slotId: string): number;
export function filledIn(items: readonly SlotItem[], block: SlotBlock): { filled: number; total: number };
export function filledInSection(items: readonly SlotItem[], sectionId: string): { filled: number; total: number };
export function placeInSlot<T extends SlotItem>(items: T[], slotId: string, item: Omit<T, 'block' | 'slot'> & Partial<Pick<T, 'block' | 'slot'>>): T[];
export function clearSlot<T extends SlotItem>(items: T[], slotId: string): T[];
export function moveToSlot<T extends SlotItem>(items: T[], index: number, slotId: string): T[];
export function additionalIn(items: readonly SlotItem[], block: SlotBlock): number[];
export function slotNumberOf(id: string | null | undefined): number | null;
export function slotIdOfNumber(n: unknown): string | null;

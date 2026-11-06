export interface KeyedChip {
  index: number;
  label: string;
  /** False for a chip with no number key: a title card or a black step. */
  hotkey?: boolean;
}

export const CHIP_HOTKEYS: number;
export function subIndexChip(chip: string, part?: number, parts?: number): string;
export function hotkeyChips<C extends KeyedChip>(groups: { chips: C[] }[]): C[];
export function chipForKey(groups: { chips: KeyedChip[] }[], key: string, activeIndex: number): number | null;

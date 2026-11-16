import type { MassSlot } from './mass-slots.js';

export function songSlotFor(items: readonly { slot?: string | null }[], categories: readonly string[] | undefined, slots?: readonly MassSlot[]): MassSlot | null;

import type { TextCase } from './text-fit.js';

export type PrintLayout = 'double' | 'single';
export const PRINT_LAYOUTS: readonly PrintLayout[];
export const DEFAULT_PRINT_LAYOUT: PrintLayout;
export function printLayoutOf(value: unknown): PrintLayout;
export function copiesFor(layout: unknown): 1 | 2;

export type PaperSize = 'A4' | 'Letter' | 'Legal';
export const PAPER_SIZES: readonly PaperSize[];
export const DEFAULT_PAPER_SIZE: PaperSize;
export const PAPER_MM: Readonly<Record<PaperSize, { width: number; height: number }>>;
export function paperSizeOf(value: unknown): PaperSize;

/** The song's key as it prints, or null when none was set (null, "", "None", "-", "N/A" …). */
export function songKeyLabel(key: unknown): string | null;

export interface PrintItem {
  kind: 'song' | 'prayer' | 'reading' | 'other';
  title: string;
  /** Songs only, and only when a key was set. */
  key: string | null;
}

export interface PrintEntry {
  /** The slot's place in the Holy Mass, or the card's number in the Lineup ("01"). Empty for an additional Holy Mass item. */
  number: string;
  /** The slot's or the card's name. */
  name: string;
  /** The icon the row prints with. */
  kind: PrintItem['kind'];
  /** The card's runtime in minutes (Praise & Worship), or null. */
  minutes: number | null;
  /** A song or prayer slot with nothing chosen yet: it prints a line to write one in by hand. */
  writeIn?: boolean;
  items: PrintItem[];
}

export interface PrintSection {
  heading: string;
  minutes: number | null;
  entries: PrintEntry[];
}

export interface PrintLineup {
  type: 'mass' | 'pw';
  title: string;
  subtitle: string;
  /** The whole lineup's runtime in minutes, or null when it has none. */
  minutes: number | null;
  sections: PrintSection[];
}

export function massPrintLineup(
  items: readonly { block: string; module: string; sourceId: string; label: string; slot?: string | null }[],
  options?: { title?: string; subtitle?: string; lang?: string; songKey?: (item: { module: string; sourceId: string }) => unknown },
): PrintLineup;

export function pwPrintLineup(
  session: { groups?: { key: string; name: string }[]; segments: { group: string; name: string; content: unknown }[] } | null | undefined,
  options?: {
    title?: string;
    subtitle?: string;
    hymns?: Readonly<Record<number, { title: string; musicalKey?: string | null; key?: string | null } | undefined>>;
    noteTitle?: (id: number) => string | null | undefined;
    labels?: { pictures?: string; prayer?: string };
  },
): PrintLineup;

export function casePrintLineup(lineup: PrintLineup, mode: TextCase | string): PrintLineup;

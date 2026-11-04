import type { Frame } from './live.js';

export interface StageRow {
  module: string;
  sourceId: string;
  label: string;
  stale?: boolean;
  slot?: string | null;
}
export type StageAction = { type: 'queue/cursor'; index: number } | { type: 'projector/stage'; frame: Frame };

export function textResponseFrame(slotName: string, text: string): Frame;
export function textRowActions(row: StageRow | null | undefined, index: number, slotName: string): StageAction[] | null;
export function canStageRow(row: StageRow | null | undefined): boolean;
export function activeRowIndex(state: { queuePlanId: number | null; queueCursor: number }, planId: number | null): number | null;

export interface StageHymn {
  id: number;
  title: string;
  style?: unknown;
  deletedAt?: string | null;
  stanzas: { stanzaType: string; lyricsText: string }[];
}
export function lyricsStanzaFrame(hymn: StageHymn, index: number): Frame | null;
export function songTitleFrame(hymn: StageHymn & { composer?: string | null }, slotName?: string | null): Extract<Frame, { kind: 'pw' }>;
export function songRowActions(row: StageRow | null | undefined, index: number, hymn: StageHymn | null | undefined): StageAction[] | null;
export function mirrorSource<P extends { paused: boolean; staged: Frame; live: Frame }>(projector: P, options?: { mirror?: boolean; peek?: boolean }): Frame;

export const SHOW_STAGED_UI: Readonly<{ stagePeek: true; previewOpen: true }>;
export function frameKey(frame: Frame | null | undefined): string;
export function previewBadge(state: { projectorOn: boolean; paused: boolean; stagePeek: boolean }): { id: 'staged' | 'off' | 'paused' | 'live'; label: string };

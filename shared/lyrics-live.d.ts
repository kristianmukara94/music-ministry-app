import type { Frame, LiveAction, LiveState } from './live';

/** Where a song sits in the setlist it was sent from. 0-based. */
export interface SetlistPlace {
  id: number;
  index: number;
  count: number;
}

interface StanzaSource {
  id: number;
  title: string;
  style?: unknown;
  stanzas: { stanzaType: string; lyricsText: string }[];
}

export function setlistStanzaFrame(hymn: StanzaSource, stanzaIndex: number, setlist?: SetlistPlace | null): Frame | null;

export function presentSongStanzaActions(args: { hymn: StanzaSource; stanzaIndex: number; setlist?: SetlistPlace | null }): LiveAction[] | null;

export function firstSungStanza(stanzas: { lyricsText: string }[] | null | undefined): number;

export interface LyricsOnAir {
  hymnId: number;
  stanzaIndex: number;
  stanzaCount: number;
  setlistId: number | null;
  songIndex: number | null;
  songCount: number | null;
  /** True when the stanza is held behind a blackout. */
  blackout: boolean;
}

export function lyricsOnAir(projector: LiveState['projector'] | null | undefined): LyricsOnAir | null;

export function setlistOnAir(projector: LiveState['projector'] | null | undefined, setlistId: number | null): boolean;

export function goLiveOffActions(projector: LiveState['projector'] | null | undefined): LiveAction[];

export function lyricsPositionLabel(projector: LiveState['projector'] | null | undefined): string | null;

export function goLiveNowActions(args: { hymn: StanzaSource; band?: unknown; bandStageOnly?: boolean }): LiveAction[] | null;

export function goLiveNowCutsRun(projector: LiveState['projector'] | null | undefined): boolean;

export type SectionKind = 'Verse' | 'Chorus' | 'Bridge' | 'Outro' | 'Tag';

export function sectionChip(stanzaType: string): { label: string; kind: SectionKind };

export const SECONDS_PER_STANZA: number;

export function estimateSongSeconds(stanzaCount: number | null | undefined): number;

export function formatDuration(seconds: number): string;

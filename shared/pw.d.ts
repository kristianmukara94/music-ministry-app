export type PwType = 'prayer' | 'song' | 'scripture';
export const PW_TYPES: readonly PwType[];
export const PRAYER_PLACEHOLDER: string;
export const GOSPEL_ACCLAMATION: string;
export const MAX_SONGS: number;
export const MAX_CHAIN: number;
export const MAX_SEGMENTS: number;

/** An item chained after a card's first item. `minutes` is its share of the card's runtime. */
export type PwChainItem = { kind: 'prayer'; noteId: number; minutes: number } | { kind: 'lectionary'; readingType: string; minutes: number };

/**
 * A card's content. Its first item is the kind: a song card has none, a prayer card has a note (or none yet), a title card is the title
 * slide, and a lectionary card is a reading. Every card also holds its songs in `hymnIds` and its chain of prayers and readings in `more`.
 */
export type PwContent = (
  /** `maxSongs` is the card's own song limit, kept at or above the songs it holds. `category` is a hymn category that fits it without a tag. */
  | { kind: 'song'; maxSongs: number; category: string | null }
  /** A projectable note from Notes & Prayers. Null shows the placeholder slide. */
  | { kind: 'prayer'; noteId: number | null }
  | { kind: 'title' }
  /** Read from the lectionary on the session date. Falls back to a title slide. */
  | { kind: 'lectionary'; readingType: string }
) & {
  /** The card's songs, in sung order. Any card can hold songs. */
  hymnIds: number[];
  /** The items chained after the first item, in order. */
  more?: PwChainItem[];
};

export interface PwCues {
  /** Show the segment and song on the lower third when the segment starts. */
  lowerThird: boolean;
  /** Start on a title slide before the first line. */
  titleFirst: boolean;
  /** Fade to black when the segment ends. */
  fadeOut: boolean;
}

export const DEFAULT_CUES: PwCues;

export interface PwGroup {
  key: string;
  name: string;
}

export interface PwSegment {
  /** Database id. Absent on a segment not saved yet. */
  id?: number;
  key: string;
  group: string;
  name: string;
  type: PwType;
  minutes: number;
  leader: string;
  content: PwContent;
  /** Per hymn id, the stanza ids in sung order. Repeats are allowed. */
  arrangement: Record<string, string[]>;
  cues: PwCues;
  /** Operator notes. Never projected. */
  notes: string;
  /** Set when loading: assigned content was deleted from its library since the session was saved. */
  stale?: boolean;
  /** A song this segment uses was deleted but can still be undone. It is also stale while it is deleted. */
  deleted?: boolean;
}

export interface PwTemplateSegment {
  key: string;
  group: string;
  name: string;
  type: PwType;
  /** Every type the slot may hold. Omitted means only `type`. */
  types?: PwType[];
  minutes: number;
  content: PwContent;
  leader?: string;
  arrangement?: Record<string, string[]>;
  cues?: Partial<PwCues>;
}

export interface PwTemplateData {
  name: string;
  groups: PwGroup[];
  segments: PwTemplateSegment[];
}

export const DEFAULT_TEMPLATE: PwTemplateData;

export type PwStatus = 'ready' | 'auto' | 'needs_song' | 'needs_prayer' | 'missing';

/** A hymn as the planner loads it, with its stanzas. */
export interface PwHymn {
  id: number;
  title: string;
  category?: string;
  stanzas: { id: number; stanzaType: string; lyricsText: string }[];
}

export interface PwHymnTag {
  hymnId: number;
  segmentKey: string;
}

/** A prayer as the planner loads it: its text, its saved split and its alignment. */
export interface PwResolvedPrayer {
  title: string;
  body: string;
  align?: 'left' | 'center' | 'right';
  split?: { mode: 'auto'; of?: string } | { mode: 'manual'; at: number[]; of?: string } | null;
}

export interface PwResolved {
  hymns?: PwHymn[];
  /** The prayer's saved split from Notes & Prayers, if any. */
  prayer?: PwResolvedPrayer | null;
  reading?: { citation: string; rawText: string } | null;
  /** One entry per chained item, in the same order as the card's chain. */
  more?: { prayer?: PwResolvedPrayer | null; reading?: { citation: string; rawText: string } | null }[];
}

export type PwSlide =
  | { kind: 'title'; label: string; subtitle: string }
  | { kind: 'lyrics'; label: string; chip: string; text: string; hymnId: number; hymnTitle: string; sectionId: string; position?: number; stanzaCount?: number; part?: number; parts?: number; fontPx?: number; top?: number; centred?: boolean; align?: 'left' | 'center' | 'right' }
  | { kind: 'prayer'; label: string; text: string; placeholder?: boolean; fontPx?: number; notice?: 'stale' | 'too-long'; part?: number; parts?: number; top?: number; centred?: boolean; align?: 'left' | 'center' | 'right' };

export interface PwPosition {
  segment: number;
  slide: number;
}

export function segmentFromTemplate(t: PwTemplateSegment): PwSegment;
export function segmentStatus(segment: PwSegment): PwStatus;
export function readiness(segments: PwSegment[]): { ready: number; total: number; missingSongs: number };
export function chainOf(segment: PwSegment): PwChainItem[];
/** The songs on a card, in sung order. */
export function songsOf(segment: PwSegment): number[];
/** The card's own minutes plus each chained item's minutes. */
export function runtimeOf(segment: PwSegment): number;
export function totalMinutes(segments: { minutes: number }[]): number;
export function primaryOf(segment: PwSegment): PwChainItem | null;
export function chainAccepts(segment: PwSegment, item: PwChainItem): boolean;
export function holdsItem(segment: PwSegment, item: PwChainItem): boolean;
/** Null when the card refuses the item: wrong kind, already in the card, or full. */
export function chainAssignment(segment: PwSegment, item: PwChainItem): Pick<PwSegment, 'content'> | null;
export function withChain(segment: PwSegment, more: PwChainItem[]): Pick<PwSegment, 'content'>;
export function shiftItem<T>(list: T[], index: number, delta: 1 | -1): T[];
/** Null when the song cannot move (off either end, or the card holds no songs). */
export function moveSong(segment: PwSegment, index: number, delta: 1 | -1): Pick<PwSegment, 'content'> | null;
/** Null when the song is not on the card. The song's arrangement is dropped with it. */
export function removeSong(segment: PwSegment, hymnId: number): Pick<PwSegment, 'content' | 'arrangement'> | null;
export function moveItem<T>(list: T[], from: number, to: number): T[];
export function reorderSong(segment: PwSegment, from: number, to: number): Pick<PwSegment, 'content'> | null;
export function reorderChainItem(segment: PwSegment, from: number, to: number): Pick<PwSegment, 'content'> | null;
export function moveChainItem(segment: PwSegment, index: number, delta: 1 | -1): Pick<PwSegment, 'content'> | null;
export function removeChainItem(segment: PwSegment, index: number): Pick<PwSegment, 'content'> | null;
export function newLineupCard(card: { key: string; name: string; type: PwType; minutes?: number }): PwSegment;
export function addLineupCard(segments: PwSegment[], groups: PwGroup[], after: number, card: PwSegment): { segments: PwSegment[]; index: number };
export function removeLineupCard(segments: PwSegment[], groups: PwGroup[], index: number): { segments: PwSegment[]; index: number };
export function groupMinutes(segments: PwSegment[], groupKey: string): number;
export function formatRunTime(minutes: number): string;
export function fitsSegment(hymn: { id: number; category?: string }, segment: PwSegment, tags: PwHymnTag[]): boolean;
export function typesFor(segment: PwSegment): PwType[];
export function acceptsTab(segment: PwSegment, tab: PwType): boolean;
export function songAssignment(segment: PwSegment, hymnId: number, replacing: number | null): Pick<PwSegment, 'type' | 'content' | 'arrangement'> | null;
export function scriptureAssignment(segment: PwSegment, content: PwContent): Pick<PwSegment, 'type' | 'content' | 'arrangement'> | null;
export function sectionChip(stanzaType: string): string;
export function sectionOrder(hymn: PwHymn, arrangement: Record<string, string[]> | undefined): string[];
export function pagesOf(text: string, maxLines?: number): string[];
export const PRAYER_STAGE: { width: number; height: number };
/** How many characters a prayer line holds on the slide, and how many lines a slide holds. */
export const PRAYER_FIT_CHARS: number;
export const PRAYER_FIT_LINES: number;
export function fitsPrayerSlide(text: string): boolean;
export function prayerPages(text: string): string[];
/** `band` is the lower third on screen, if any: the lyric and prayer pages leave room for it. */
export function slidesFor(segment: PwSegment, resolved?: PwResolved, options?: { band?: import('./live.js').LowerThird | null; scale?: number }): PwSlide[];
export function step(counts: number[], pos: PwPosition, delta: 1 | -1): PwPosition | null;
export function visibleSlideIndexes(count: number, liveIndex: number | null | undefined): number[];
export function livePosition(segments: PwSegment[], pw: { segmentKey: string | null; slide: number } | null): PwPosition | null;
export function groupOrdered(segments: PwSegment[], groups: PwGroup[]): PwSegment[];
export function moveSegment(segments: PwSegment[], groups: PwGroup[], from: number, group: string, slot: number): PwSegment[];
export function nudgeSegment(segments: PwSegment[], groups: PwGroup[], index: number, delta: 1 | -1): { segments: PwSegment[]; index: number };

/** One line of a file, with what Word says about it. */
export interface SourceLine {
  text: string;
  /** A Word heading (Heading 1 to 6). */
  heading?: boolean;
  /** Bold all through. */
  bold?: boolean;
}

/** One stanza of a song on the review screen. */
export interface ParsedStanza {
  key: string;
  /** "Verse 1", "Chorus", "Bridge", "Tag" or "Outro". */
  type: string;
  text: string;
}

/** Why a song was split where it was. */
export type SplitRule = 'tag' | 'heading' | 'number' | 'bold' | 'caps' | 'start' | 'delimiter' | 'blank' | 'single' | 'manual';

/** One song found in a file. */
export interface ParsedSong {
  key: string;
  title: string;
  stanzas: ParsedStanza[];
  /** The text of the file this song came from, for checking against. */
  source: string;
  rule: SplitRule;
}

export type SplitMode = 'auto' | 'blank' | 'delimiter';

export interface ParsingOptions {
  mode?: SplitMode;
  /** For `delimiter`: the line that separates songs. Empty means any separator line ("---", "***", "==="). */
  delimiter?: string;
}

export type SplitMethod = 'titles' | 'delimiter' | 'blank' | 'single';

export type SongIssueCode = 'noStanzas' | 'tooManyStanzas' | 'titleTooLong' | 'emptyTitle' | 'emptyStanza' | 'duplicate';

/** Something to look at before a song is imported. A warning lets it be imported; an error does not. */
export interface SongIssue {
  level: 'warning' | 'error';
  code: SongIssueCode;
}

export const MAX_BATCH_FILE_BYTES: number;
export const BATCH_FILE_TYPES: readonly string[];
export const MAX_BATCH_SONGS: number;
export const MAX_SONG_TITLE: number;
export const STANZA_KINDS: readonly string[];

export function linesFromText(raw: string): SourceLine[];
export function linesFromDocxHtml(html: string): SourceLine[];
export function titleRule(lines: SourceLine[], i: number, options?: { caps?: boolean }): SplitRule | null;
export function titleText(line: string): string;
export function stanzasFromLines(lines: SourceLine[]): { type: string; text: string }[];
export function newKey(prefix?: string): string;
export function splitSongs(lines: SourceLine[], options?: ParsingOptions): { songs: ParsedSong[]; method: SplitMethod };
export function effectiveTitle(song: Pick<ParsedSong, 'title' | 'stanzas'>): string;
export function songIssues(song: Pick<ParsedSong, 'title' | 'stanzas'>, existing?: Set<string>): SongIssue[];
export function songToTagged(song: Pick<ParsedSong, 'stanzas'>): string;
export function splitSongAt(song: ParsedSong, at: number): ParsedSong[];
export function mergeSongs(first: ParsedSong, second: ParsedSong): ParsedSong;
export function nextVerseLabel(stanzas: Pick<ParsedStanza, 'type'>[]): string;

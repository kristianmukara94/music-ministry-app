/** One text item from pdf.js. Only items with a `str` carry text. */
export interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
  transform?: number[];
}

/**
 * Lyric text from pdf.js items, one line per visual line, with a blank line between verses. Marked-content items have no
 * text and are skipped, so the page's content items can be passed as they are.
 */
export function lyricTextFromItems(items: ReadonlyArray<PdfTextItem | { type?: string }>): string;

/** Normalised line endings, no trailing spaces, and at most one blank line in a row. */
export function cleanLyricText(raw: string): string;

/** True for a line that describes the song (credits, copyright, tune), not a line to sing. */
export function isMetadataLine(line: string): boolean;

export interface SongSheet {
  /** The title, or '' when the sheet has none. */
  title: string;
  /** The lyrics with the title and the credit lines removed. */
  raw: string;
}

/** Takes a song sheet apart into its title and its lyrics. */
export function splitSongSheet(raw: string): SongSheet;

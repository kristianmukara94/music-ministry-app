/** One paragraph of a Word document, with what Word says about it. */
export interface DocxParagraph {
  /** The text; a line break inside the paragraph is "\n" and a tab three spaces. */
  text: string;
  /** Bold all through. */
  bold: boolean;
  /** Underlined all through. */
  underline: boolean;
  /** Set in a Heading or Title style. */
  heading: boolean;
}

export type DocxLanguage = 'EN' | 'TL' | 'CEB';
export type CaseMode = 'preserve' | 'sentence';
export type SectionKind = 'Verse' | 'Chorus' | 'Bridge' | 'Coda' | 'Tag' | 'Ending';

/** One section of a song: its label ("Verse 1", "Chorus", "Coda"), its lines as typed, and how many times it is sung where it stands. */
export interface DocxSection {
  label: string;
  kind: SectionKind;
  lines: string[];
  /** From a //: … :// repeat or a multiplier on the whole stanza: sung this many times on the same slide. 1 when not repeated. */
  repeat: number;
}

/** One song found in a lineup document. */
export interface DocxSong {
  key: string;
  title: string;
  language: DocxLanguage;
  /** Every language with a real share of the words, when the song mixes them; empty when it is in one language. */
  languages: DocxLanguage[];
  sections: DocxSection[];
  /** Section labels in the order they are sung. A label may appear many times. */
  arrangement: string[];
  /** Cues in the file that could not be read, or asked for a section the song does not have. */
  warnings: string[];
  /** The operator's own slide deck from the slides preview. Null or absent to follow the arrangement as parsed. */
  deck?: DeckSlide[] | null;
  duplicate: {
    /** The key of an earlier song in the same file with the same title, or null. */
    inFile: string | null;
    /** The id of a library song with the same title, or null. */
    existingId: number | null;
  };
}

export interface LineupResult {
  songs: DocxSong[];
  /** Most of the document is typed in capitals. */
  allCaps: boolean;
  /** How titles were found: from bold or heading paragraphs, or from the shape of the lines. */
  titleMode: 'emphasis' | 'text';
}

export interface LineupOptions {
  normalizeCase?: CaseMode;
  existing?: { id: number; title: string }[];
}

export interface SlideLimits {
  minLines?: number;
  maxLines?: number;
  maxChars?: number;
}

/** One slide of a deck: which section it comes from and which of that section's slides it is. `id` is unique within the deck. */
export interface DeckSlide {
  id: string;
  label: string;
  chunk: number;
  /** The part chosen on the slide's card: a stored stanza type, or '' for a continuation of the slide before it. */
  part?: string;
}

export interface DocxSlide {
  /** The deck entry the slide comes from. */
  id: string;
  /** The section label the slide comes from. */
  label: string;
  /** Which of that section's slides this is, from 0. */
  chunk: number;
  /** The part chosen on the slide's card, when one was: a stored stanza type, or '' for a continuation. */
  part?: string;
  /** The stanza type the hymn library stores: Verse n, Chorus, Bridge, Tag or Outro. A continuation carries the type of the slide before it. */
  type: string;
  text: string;
  /** True when the slide carries on the slide before it, with no label of its own. */
  continuation: boolean;
}

export type DocxIssueCode = 'noTitle' | 'noSlides' | 'tooManySlides' | 'inLibrary' | 'inFile' | 'cues';
export interface DocxIssue {
  level: 'error' | 'warning';
  code: DocxIssueCode;
}

export const SLIDE_MIN_LINES: number;
export const SLIDE_MAX_LINES: number;
export const LINE_MAX_CHARS: number;
export const MAX_DOCX_SONGS: number;
export const MAX_DOCX_BYTES: number;
export const MAX_TITLE_CHARS: number;

export function paragraphsFromDocumentXml(xml: string): DocxParagraph[];
export function readDocxParagraphs(data: ArrayBuffer | Uint8Array): Promise<DocxParagraph[]>;
export function parseDocxSongs(data: ArrayBuffer | Uint8Array, options?: LineupOptions): Promise<LineupResult>;
export function paragraphsFromText(text: string): DocxParagraph[];
export function parseTextSongs(text: string, options?: LineupOptions): LineupResult;
export function parseLineup(paragraphs: DocxParagraph[], options?: LineupOptions): LineupResult;
export function parseSongBody(paragraphs: Pick<DocxParagraph, 'text'>[]): { sections: DocxSection[]; arrangement: string[]; warnings: string[] };

export function normalizeSpacing(text: string): string;
export function isMostlyUpperCase(texts: string | string[]): boolean;
export function toSentenceCase(line: string): string;
export function toTitleCase(title: string): string;
export function applyCase(line: string, mode?: CaseMode): string;
export function applyTitleCase(title: string, mode?: CaseMode): string;

export function romanToInt(s: string): number | null;
export function parseLyricLine(line: string): { text: string; mult: number; open: boolean; close: boolean };
export function classifyLine(
  line: string,
):
  | { kind: 'blank' }
  | { kind: 'cue'; text: string }
  | { kind: 'marker'; section: SectionKind; n: number | null; text: string }
  | { kind: 'verse'; n: number | null; text: string }
  | { kind: 'lyric'; text: string };
export function parseFlowDirective(text: string, context?: { labels?: string[]; arrangement?: string[] }): { steps: string[]; missing: string[]; unknown: string[] };

export function breakLongLine(line: string, maxChars?: number): string[];
export function chunkSlides(lines: string[] | string, limits?: SlideLimits): string[];

export function detectLanguage(text: string): { language: DocxLanguage; scores: Record<DocxLanguage, number>; mixed: DocxLanguage[] };
export function normalizeTitle(title: string): string;
export function flagDuplicates<T extends { key: string; title: string }>(songs: T[], existing?: { id: number; title: string }[]): (T & { duplicate: DocxSong['duplicate'] })[];

export function songSortKey(title: string): string;
export function sortSongsAlphabetically<T extends { title: string }>(songs: T[]): T[];

export function storedStanzaType(label: string, labels?: string[]): string;
type SlideOptions = SlideLimits & { caseMode?: CaseMode };
type DeckSong = Pick<DocxSong, 'sections' | 'arrangement' | 'deck'>;
export function defaultDeck(song: Pick<DocxSong, 'sections' | 'arrangement'>, options?: SlideOptions): DeckSlide[];
export function songDeck(song: DeckSong, options?: SlideOptions): DeckSlide[];
export function sameDeck(a: DeckSlide[] | null | undefined, b: DeckSlide[] | null | undefined): boolean;
export function appendSection(deck: DeckSlide[], song: Pick<DocxSong, 'sections'>, label: string, options?: SlideOptions): DeckSlide[];
export function duplicateSlide(deck: DeckSlide[], index: number): DeckSlide[];
export function removeSlide(deck: DeckSlide[], index: number): DeckSlide[];
export function setDeckSlidePart(deck: DeckSlide[], index: number, part: string): DeckSlide[];
export function reorderPreviewSlides<T>(slides: T[], fromIndex: number, toIndex: number): T[];
export function deckSlides(song: Pick<DocxSong, 'sections'>, deck: DeckSlide[], options?: SlideOptions): DocxSlide[];
export function songSlides(song: DeckSong, options?: SlideOptions): DocxSlide[];
export function songToTaggedLyrics(song: DeckSong, options?: SlideOptions): string;
export function docxSongIssues(song: Pick<DocxSong, 'title' | 'sections' | 'arrangement' | 'deck' | 'duplicate' | 'warnings'>, options?: SlideOptions): DocxIssue[];

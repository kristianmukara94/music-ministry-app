import type { SourceLine } from '../../shared/song-batch.js';
import type { TextStyle } from '../../shared/text-style';
import type { PrimaryCategory } from '../../shared/song-taxonomy.js';
export type { PrimaryCategory };
export type HymnCategory = 'Entrance' | 'Offertory' | 'Communion' | 'Recessional' | 'General';
export type HymnLanguage = 'EN' | 'TL' | 'CEB';

/** A hymn in the recycle bin: deleted, and kept for undo until the 30 days are up. */
export interface DeletedHymn {
  id: number;
  title: string;
  deletedAt: string;
}

export interface HymnSummary {
  id: number;
  title: string;
  composer: string;
  /** The musical key as written, such as C, Bb or F#m. Empty when not set. */
  musicalKey: string;
  /** The song category for the Mass, from the operator's list. Empty when none is set. */
  songCategory: string;
  /** Where the song is used: General (everywhere), Mass, or Praise & Worship. */
  primaryCategory: PrimaryCategory;
  category: HymnCategory;
  language: HymnLanguage;
  stanzaCount: number;
}

export interface Stanza {
  id: number;
  stanzaType: string;
  lyricsText: string;
  order: number;
}

export interface Hymn {
  id: number;
  title: string;
  composer: string;
  category: HymnCategory;
  language: HymnLanguage;
  musicalKey: string;
  /** The song category for the Mass, from the operator's list. Empty when none is set. */
  songCategory: string;
  primaryCategory: PrimaryCategory;
  /** How the song is set on the projector. Null keeps the default look. */
  style: TextStyle | null;
  stanzas: Stanza[];
  /** Set while the song is in Recently deleted. Null or missing for a song in the library. */
  deletedAt?: string | null;
}

export interface HymnFilter {
  /** Only songs for this scope and the General ones. General, or nothing, shows every song. */
  primaryCategory?: PrimaryCategory;
  /** Only songs in this song category (as the list spells it). */
  songCategory?: string;
  search?: string;
  category?: HymnCategory | '';
  language?: HymnLanguage | '';
}

export interface NewHymn {
  title: string;
  composer: string;
  /** The Mass slot the Praise & Worship lineup matches. Left out, it follows the scope and song category. */
  category?: HymnCategory;
  language: HymnLanguage;
  musicalKey: string;
  /** Must be on the song category list, or empty. */
  songCategory?: string;
  /** Left out, the song is saved as General. */
  primaryCategory?: PrimaryCategory;
  raw: string;
}

export interface Setlist {
  id: number;
  date: string;
  name: string;
}

export interface SetlistEntry {
  position: number;
  hymnId: number;
  /** The hymn was deleted but can still be undone. The setlist keeps it, marked. */
  deleted?: boolean;
  title: string;
  composer: string;
  category: HymnCategory;
  language: HymnLanguage;
}

/** A lyrics file read in the main process. Nothing is saved until the operator saves the hymn. */
/** A file of many songs, read as lines for the batch import. */
export interface BatchFile {
  fileName: string;
  size: number;
  lines: SourceLine[];
}

/** One song's result from a batch save. */
export type BatchSaveResult = { id: number; title: string; error?: undefined } | { error: string; id?: undefined; title?: undefined };

export interface LyricsImport {
  fileName: string;
  title: string;
  raw: string;
}

/** One song category for the Mass, as the operator named it. */
export interface SongCategory {
  id: number;
  name: string;
  position: number;
}

export interface LyricsApi {
  /** Calls the handler with a song's id after that song changes, in any window. Returns a function that stops listening. */
  onChanged(handler: (id: number) => void): () => void;
  listHymns(filter: HymnFilter): Promise<HymnSummary[]>;
  getHymn(id: number): Promise<Hymn | null>;
  createHymn(input: NewHymn): Promise<{ id: number; warnings: string[] }>;
  /** Saves several songs, each on its own: one result per song, in order, with its new id or the reason it was not saved. */
  createHymns(inputs: NewHymn[]): Promise<BatchSaveResult[]>;
  /** Updates the details and replaces the stanzas with a fresh parse of `input.raw`. */
  editHymn(id: number, input: NewHymn): Promise<{ id: number; warnings: string[] }>;
  /** Replaces only the words (tagged lyrics), keeping the song's details and filing as they are, even with no song category. */
  editLyrics(id: number, raw: string): Promise<{ id: number; warnings: string[] }>;
  /**
   * Splits stanza `index` into two that follow each other under its label. The first keeps the stanza's id; saved lineups that sing the song in
   * their own order get the second straight after it.
   */
  splitStanza(id: number, index: number, parts: [string, string]): Promise<{ id: number; warnings: string[]; firstId: number | null; secondId: number | null; lineupsChanged: number }>;
  deleteHymn(id: number): Promise<boolean>;
  /** Hymns deleted in the last 30 days, newest first. */
  listDeletedHymns(): Promise<DeletedHymn[]>;
  /** Puts a deleted hymn back, with the same id. Returns false if it is not in the recycle bin. */
  undoDeleteHymn(id: number): Promise<boolean>;
  listSetlists(): Promise<Setlist[]>;
  createSetlist(input: { name: string; date: string }): Promise<Setlist>;
  deleteSetlist(id: number): Promise<boolean>;
  getSetlist(id: number): Promise<SetlistEntry[]>;
  /** Replaces the setlist's order with these hymn ids, in sequence. */
  saveSetlist(id: number, hymnIds: number[]): Promise<number>;
  /** Saves how this song is set on the projector. Null returns it to the default look. */
  setStyle(id: number, style: TextStyle | null): Promise<TextStyle | null>;
  /** Opens the file dialog in the main process and reads the chosen file. Null when the operator cancels. */
  importFile(): Promise<LyricsImport | null>;
  /** Opens the file picker for a Word or text file of many songs. Resolves to the file's path, or null when the operator cancels. */
  pickBatchFile(): Promise<string | null>;
  /** Reads a Word or text file of many songs, as lines. Refuses a file of the wrong type, too large, empty or damaged, with the reason. */
  readBatchFile(filePath: string): Promise<BatchFile>;
  /** The song categories, in the order the operator set. */
  listSongCategories(): Promise<SongCategory[]>;
  /** Adds a category. Names are 1 to 40 characters and must not repeat (letter case does not count). */
  createSongCategory(input: { name: string }): Promise<SongCategory>;
  /** Renames a category, and the hymns that use it. */
  renameSongCategory(id: number, input: { name: string }): Promise<SongCategory>;
  /** Removes a category. Hymns that used it keep their text. */
  deleteSongCategory(id: number): Promise<boolean>;
}

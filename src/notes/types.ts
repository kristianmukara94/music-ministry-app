import type { TextStyle } from '../../shared/text-style';
import type { PrayerSplit } from '../../shared/prayer-screen';

/** `operator` is private. `full` is a full-screen slide and `lower` is a lower-third banner. */
export type NoteDisplay = 'operator' | 'full' | 'lower';

export interface Note {
  id: number;
  title: string;
  category: string;
  body: string;
  display: NoteDisplay;
  style: TextStyle | null;
  /** Where a full-screen prayer is split into slides. Null shows the whole prayer as one slide. */
  split: PrayerSplit | null;
  /** The Holy Mass slot the note was made for in Go Live (a slot id), or null. It labels the note; the plan's row is what plays it. */
  slot: string | null;
  /**
   * Set on a copy Go Live made of an item's words for one plan (`mass:<plan id>`) or one lineup card (`pw:<lineup id>:<card key>`). Null on
   * every Liturgical Content Hub entry. Copies are left out of the Hub and the pickers. Missing from an older main process: treat as null.
   */
  copyOwner?: string | null;
  /**
   * Set when the body is a sealed Mass intention this laptop cannot show: `locked` (no parish passphrase entered here) or `damaged` (it
   * failed its integrity check). The body is then empty and the note cannot be saved until it is unlocked.
   */
  sealed?: 'locked' | 'damaged' | null;
}

export interface NoteInput {
  id?: number;
  title: string;
  category: string;
  body: string;
  display: NoteDisplay;
  style: TextStyle | null;
  /** Omitted or null: the prayer is one slide. */
  split?: PrayerSplit | null;
  /** Omitted: the note keeps the slot it has. Null unlinks it. */
  slot?: string | null;
}

/** A note was saved or deleted, in this window or another. */
export interface NoteChange {
  id: number;
  removed: boolean;
}

export interface NotesApi {
  list(): Promise<Note[]>;
  get(id: number): Promise<Note | null>;
  save(input: NoteInput): Promise<Note>;
  /**
   * Saves Go Live's own copy for `owner`: a new copy without `input.id`, otherwise that copy, and only when it has this owner. The main process
   * refuses anything else, so Edit / Add / Delete slide on air can never change a Liturgical Content Hub entry.
   */
  saveCopy(input: NoteInput, owner: string): Promise<Note>;
  remove(id: number): Promise<boolean>;
  /** Calls back after every save and delete, in every window. Returns the unsubscribe. */
  onChanged(callback: (change: NoteChange) => void): () => void;
}

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
}

export interface NotesApi {
  list(): Promise<Note[]>;
  get(id: number): Promise<Note | null>;
  save(input: NoteInput): Promise<Note>;
  remove(id: number): Promise<boolean>;
}

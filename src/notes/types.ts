import type { TextStyle } from '../../shared/text-style';

/** `operator` is private. `full` is a full-screen slide and `lower` is a lower-third banner. */
export type NoteDisplay = 'operator' | 'full' | 'lower';

export interface Note {
  id: number;
  title: string;
  category: string;
  body: string;
  display: NoteDisplay;
  style: TextStyle | null;
}

export interface NoteInput {
  id?: number;
  title: string;
  category: string;
  body: string;
  display: NoteDisplay;
  style: TextStyle | null;
}

export interface NotesApi {
  list(): Promise<Note[]>;
  get(id: number): Promise<Note | null>;
  save(input: NoteInput): Promise<Note>;
  remove(id: number): Promise<boolean>;
}

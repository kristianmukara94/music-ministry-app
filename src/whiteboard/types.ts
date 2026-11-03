import type { WhiteboardDesign, WhiteboardTextBox } from '../../shared/whiteboard';
import type { ImportProgress } from '../../shared/import-progress';

export type { ImportProgress } from '../../shared/import-progress';

export type { WhiteboardDesign, WhiteboardTextBox, WhiteboardVerse } from '../../shared/whiteboard';

/** A slide in the Whiteboard library. Its design is what the slide looks like on the projector. */
export interface WhiteboardSlide {
  id: number;
  title: string;
  content: string;
  design: WhiteboardDesign;
  /** Set for a PowerPoint slide: the picture of the slide as PowerPoint draws it. Such a slide is shown as that picture. */
  image: string | null;
  /** The Announcements image slide behind `image`. This is what a Mass plan and the Service Queue refer to. */
  slideId: number | null;
  /** The slide's speaker notes, for the operator only. */
  notes: string | null;
  /** The PowerPoint picture this slide was before it was edited, when it can still be brought back. Null otherwise. */
  originalImage: string | null;
  /**
   * A PowerPoint slide taken apart for editing: its background drawn without its words, and its words as text boxes in their places.
   * Null for other slides, and for PowerPoint slides imported before this existed.
   */
  layers: { background: string; boxes: WhiteboardTextBox[] } | null;
  /** The folder the slide is in. Null for Unfiled. */
  folderId: number | null;
}

/** A Whiteboard folder, with how many slides it holds. */
export interface WhiteboardFolder {
  id: number;
  name: string;
  count: number;
}

/** What the editor sends. An `id` updates that slide; no `id` creates one. */
export interface WhiteboardSlideInput {
  id?: number;
  title: string;
  content: string;
  design: WhiteboardDesign;
  /** The folder a new slide goes into. Absent or null means Unfiled. An existing slide keeps its folder. */
  folderId?: number | null;
}

export interface WhiteboardApi {
  list(): Promise<WhiteboardSlide[]>;
  /** One slide, or null when it no longer exists. */
  get(id: number): Promise<WhiteboardSlide | null>;
  /** Changes a PowerPoint slide into an editable slide, in place, with the text and design given. Its picture is kept so it can be brought back. */
  makeEditable(id: number, input: WhiteboardSlideInput): Promise<WhiteboardSlide>;
  /** Turns an edited PowerPoint slide back into its picture. Resolves to the restored slide. */
  restorePicture(id: number): Promise<WhiteboardSlide>;
  /** The PowerPoint file a slide came from and its number there, when its words can be read again from that file. Null otherwise. */
  pptxSource(id: number): Promise<{ file: string; slideNo: number } | null>;
  /**
   * Asks for the PowerPoint file a slide came from and takes its slides apart, so their words become text boxes (every slide from that file
   * gets them). Resolves to the slide, or null if the picker was cancelled.
   */
  layersFromFile(id: number): Promise<WhiteboardSlide | null>;
  /** Opens the slide in its own editor window (or brings the open one forward). Resolves false when this app cannot open windows. */
  openEditor(id: number): Promise<boolean>;
  /** Calls back after any window changes a Whiteboard slide or folder. Returns the function that stops listening. */
  onChanged(callback: () => void): () => void;
  /** The editor window is closing: the callback must write any change still waiting and then call `editorFlushed`. */
  onEditorFlush(callback: () => void): () => void;
  editorFlushed(): void;
  /** Closes this editor window. Any change still waiting is saved first. */
  closeEditor(): void;
  save(input: WhiteboardSlideInput): Promise<WhiteboardSlide>;
  remove(id: number): Promise<boolean>;
  /** Deletes several slides at once. Resolves to how many were removed. */
  removeMany(ids: number[]): Promise<number>;
  /** Changes only a slide's title, including a PowerPoint slide's. Resolves to the updated slide. */
  rename(id: number, title: string): Promise<WhiteboardSlide>;
  reorder(ids: number[]): Promise<boolean>;
  folders(): Promise<WhiteboardFolder[]>;
  createFolder(name: string): Promise<WhiteboardFolder>;
  renameFolder(id: number, name: string): Promise<boolean>;
  /** Removes the folder. Its slides are kept and become Unfiled. Resolves to how many were kept. */
  deleteFolder(id: number): Promise<number>;
  /** Moves slides into a folder, or to Unfiled when `folderId` is null. Resolves to how many moved. */
  move(ids: number[], folderId: number | null): Promise<number>;
  /** Opens the file picker and imports the chosen PowerPoint files into the folder. Resolves to the number of slides added, or null if cancelled. */
  importPowerPoint(folderId?: number | null): Promise<number | null>;
  /** Hears how far a PowerPoint import has got, as it goes on. Returns the function that stops listening. */
  onImportProgress(callback: (progress: ImportProgress) => void): () => void;
}

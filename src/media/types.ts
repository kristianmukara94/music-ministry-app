import type { MediaEditSettings } from '../../shared/media-editor.js';

export type MediaType = 'image' | 'video' | 'audio';

/** The drag type a media card carries. Its payload is JSON: { id, label }. The Mass Queue drawer accepts it. */
export const MEDIA_DRAG = 'application/x-apcc-media';

export interface MediaAsset {
  id: number;
  filename: string;
  mediaType: MediaType;
  /** Full-size file: `apcc-media://media/<id>`. */
  src: string;
  /** Still for the tile: `apcc-media://thumb/<id>`, or null if no thumbnail could be made. */
  thumbSrc: string | null;
  uploadedAt: string;
  /** The library folder the item is filed in, or null when unfiled. */
  folderId: number | null;
  /** Saved Media Studio edits, normalised. An item never edited carries the neutral settings. */
  edit: MediaEditSettings;
  /** True when `edit` changes what is drawn or played (hasActiveMediaEdits). */
  edited: boolean;
}

/** A library folder. Built-in folders (the liturgical seasons, Praise & Worship, Off-Plan Media) cannot be deleted. */
export interface MediaFolder {
  id: number;
  name: string;
  builtin: boolean;
}

export interface MediaImportResult {
  imported: number;
  /** File names that were skipped or only partly processed, for the operator to review. */
  failed: string[];
  /** A note for the operator, such as the .mkv conversion tip. Null when there is nothing to say. */
  notice?: string | null;
}

export interface MediaApi {
  list(): Promise<MediaAsset[]>;
  /** Opens the file picker. Resolves to 0 imported if cancelled. `folderId` files the new items in that folder. */
  importMedia(folderId?: number | null): Promise<MediaImportResult>;
  /** Imports files dropped from the desktop, optionally into a folder. */
  importFiles(files: File[], folderId?: number | null): Promise<MediaImportResult>;
  deleteMedia(id: number): Promise<boolean>;
  /** Changes the label shown for an item. The file on disk keeps its name. */
  rename(id: number, name: string): Promise<boolean>;
  /** Opens the folder holding the file, with the file selected. */
  reveal(id: number): Promise<boolean>;
  folders(): Promise<MediaFolder[]>;
  /** Resolves to the new folder's id. */
  createFolder(name: string): Promise<number>;
  deleteFolder(id: number): Promise<boolean>;
  /** Files an item in a folder; null unfiles it. Only the folder link changes. */
  moveToFolder(id: number, folderId: number | null): Promise<boolean>;
  /** Stores non-destructive edits on the item. A staged or live showing of it updates at once. Resolves to the updated item. */
  saveEditSettings(id: number, settings: MediaEditSettings): Promise<MediaAsset>;
  /** Replaces the library card's thumbnail with a PNG or JPEG (a poster frame). Resolves to the updated item. */
  updateThumbnail(id: number, bytes: Uint8Array): Promise<MediaAsset>;
  /** Saves a baked PNG or JPEG as a new still in the same folder; the original is untouched. Resolves to the new item. */
  saveEditedCopy(id: number, bytes: Uint8Array, name?: string): Promise<MediaAsset>;
  /** Subscribes to background events from the main process. Returns the function that stops listening. */
  onEvent(callback: (event: { kind: 'changed' | 'remux-failed'; name?: string }) => void): () => void;
}

/** Thumbnail job sent to the hidden `thumbnailer` window. */
export interface ThumbnailJob {
  jobId: string;
  src: string;
  /**
   * 'video' takes a frame one second in; 'image' draws a still (used for WebP, which the native decoder cannot read);
   * 'poster' draws the dark stand-in for a video whose frame cannot be read.
   */
  kind: 'video' | 'image' | 'poster';
}

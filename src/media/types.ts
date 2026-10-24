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
  /** Opens the file picker. Resolves to 0 imported if cancelled. */
  importMedia(): Promise<MediaImportResult>;
  deleteMedia(id: number): Promise<boolean>;
  /** Changes the label shown for an item. The file on disk keeps its name. */
  rename(id: number, name: string): Promise<boolean>;
  /** Opens the folder holding the file, with the file selected. */
  reveal(id: number): Promise<boolean>;
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

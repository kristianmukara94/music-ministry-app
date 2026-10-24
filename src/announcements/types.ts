import type { TextStyle } from '../../shared/text-style';

export type SlideType = 'image' | 'text';

export interface AnnouncementFolder {
  id: number;
  name: string;
  createdAt: string;
  count: number;
}

export interface AnnouncementSlide {
  id: number;
  folderId: number;
  slideType: SlideType;
  name: string;
  /** Position within its folder; the order the operator arranged them in. */
  order: number;
  /** Image slides: `apcc-media://slide/<id>`. Text slides: null. */
  src: string | null;
  /** Text slides: the body text for this page. Image slides: null. */
  text: string | null;
  /** Document and PowerPoint slides: the headline, shown large above the body. Null for manual text slides. */
  headline: string | null;
  /** Text slides: typography and background. Null keeps the projector's default look. */
  style: TextStyle | null;
  /** Text slides with a background: `apcc-media://bg/<file>`. */
  bgSrc: string | null;
  /** Text slides imported from a PowerPoint notes page. Null when the slide has none. Never shown on the projector. */
  notes: string | null;
}

/** What an import added, and the files it skipped with the reason for each. */
export interface ImportResult {
  imported: number;
  failed: { name: string; reason: string }[];
}

export interface AnnouncementApi {
  folders(): Promise<{ folders: AnnouncementFolder[]; total: number }>;
  /** `null` returns every slide across all folders ("All Slides"). */
  slides(folderId: number | null): Promise<AnnouncementSlide[]>;
  createFolder(name: string): Promise<AnnouncementFolder>;
  renameFolder(id: number, name: string): Promise<boolean>;
  deleteFolder(id: number): Promise<boolean>;
  /** Opens the file picker. Resolves to null if cancelled. Accepts images, PDF, DOCX, TXT, PPTX. */
  importSlides(folderId: number, lang: string): Promise<ImportResult | null>;
  /** Imports files dropped on a deck, by their file system paths. */
  importPaths(folderId: number, paths: string[]): Promise<ImportResult>;
  /** Persists a new order for every slide in the folder. */
  reorder(folderId: number, slideIds: number[]): Promise<number>;
  deleteSlide(id: number): Promise<boolean>;
  /** Opens the background picker. Resolves to the stored file name, or null if cancelled. */
  pickBackground(lang: string): Promise<string | null>;
  discardBackground(name: string): Promise<boolean>;
  createTextSlides(folderId: number, pages: string[], backgroundName: string | null, style: TextStyle | null): Promise<number>;
}

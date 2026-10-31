import type { WhiteboardDesign } from '../../shared/whiteboard';

export type { WhiteboardDesign, WhiteboardVerse } from '../../shared/whiteboard';

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
}

/** What the editor sends. An `id` updates that slide; no `id` creates one. */
export interface WhiteboardSlideInput {
  id?: number;
  title: string;
  content: string;
  design: WhiteboardDesign;
}

export interface WhiteboardApi {
  list(): Promise<WhiteboardSlide[]>;
  save(input: WhiteboardSlideInput): Promise<WhiteboardSlide>;
  remove(id: number): Promise<boolean>;
  reorder(ids: number[]): Promise<boolean>;
  /** Opens the file picker and imports the chosen PowerPoint files. Resolves to the number of slides added. */
  importPowerPoint(): Promise<number | null>;
}

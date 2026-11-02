import { bridge } from '../live/bridge';
import { dispatch } from '../live/store';
import { addToQueue } from '../planner/plan-api';
import type { Frame } from '../../shared/live.js';
import type { WhiteboardFolder, WhiteboardSlide } from './types';

/**
 * A PowerPoint slide's deck: the pictures in its folder, in Whiteboard order, so Next, Previous and a phone move through that folder's
 * slides and no others. Absent for a lone picture or a text slide.
 */
function deckFor(slide: WhiteboardSlide, all: WhiteboardSlide[]) {
  const pictures = all.filter((s) => s.image && s.folderId === slide.folderId);
  const index = pictures.findIndex((s) => s.id === slide.id);
  if (pictures.length < 2 || index < 0) return undefined;
  return { slides: pictures.map((s) => ({ title: s.title, src: s.image as string, ...(s.notes ? { notes: s.notes } : {}) })), index };
}

/** The projector frame for a Whiteboard slide: its picture for a PowerPoint slide, otherwise its design. */
export function frameForWhiteboardSlide(slide: WhiteboardSlide, all: WhiteboardSlide[]): Frame {
  if (!slide.image) return { kind: 'whiteboard', slide: { title: slide.title, content: slide.content, design: slide.design } };
  return { kind: 'image', title: slide.title, src: slide.image, notes: slide.notes ?? undefined, deck: deckFor(slide, all) };
}

/** Puts a Whiteboard slide on the projector straight away. Nothing else on the projector is changed except what it replaces. */
export function projectWhiteboardSlide(slide: WhiteboardSlide, all: WhiteboardSlide[]) {
  dispatch({ type: 'projector/stage', frame: frameForWhiteboardSlide(slide, all) });
  dispatch({ type: 'projector/take' });
}

/** Adds a PowerPoint slide to the Mass Queue, in the Word block, the same as the Whiteboard's own button. */
export async function addWhiteboardPictureToQueue(slide: WhiteboardSlide): Promise<void> {
  if (slide.slideId == null) return;
  await addToQueue([{ block: 'word', module: 'announcements', sourceId: String(slide.slideId), label: slide.title }]);
}

/** Lists the Whiteboard's folders, in order, with how many slides each holds. */
export function listWhiteboardFolders(): Promise<WhiteboardFolder[]> {
  return bridge.whiteboard.folders();
}

/** Lists the Whiteboard's slides, in order. */
export function listWhiteboardSlides(): Promise<WhiteboardSlide[]> {
  return bridge.whiteboard.list();
}

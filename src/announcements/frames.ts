import type { Frame } from '../../shared/live.js';
import type { AnnouncementSlide } from './types';

/** The pictures in `list` that sit in the slide's folder, so Next, Previous and a phone can move through them. Absent for a lone picture. */
function deckOf(s: AnnouncementSlide, list: AnnouncementSlide[]) {
  const pictures = list.filter((x) => x.slideType === 'image' && x.src && x.folderId === s.folderId);
  const index = pictures.findIndex((x) => x.id === s.id);
  if (pictures.length < 2 || index < 0) return undefined;
  return { slides: pictures.map((x) => ({ title: x.name, src: x.src as string, ...(x.notes ? { notes: x.notes } : {}) })), index };
}

/** The projector frame for an Announcements slide: a picture (with the pictures around it), or a text slide. */
export function announcementFrame(s: AnnouncementSlide, list: AnnouncementSlide[] = []): Frame {
  return s.slideType === 'image' && s.src
    ? { kind: 'image', title: s.name, src: s.src, notes: s.notes ?? undefined, deck: deckOf(s, list) }
    : { kind: 'text', title: s.name, headline: s.headline ?? undefined, text: s.text ?? '', bg: s.bgSrc, notes: s.notes ?? undefined, style: s.style };
}

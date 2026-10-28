// What dropping a song from the Song List onto a lineup slot does. It uses the same rules as click-to-add (acceptsTab and
// songAssignment in pw.js), so a drop and an Add always agree. Nothing here changes the template.
import { acceptsTab, songAssignment } from './pw.js';

/**
 * The result of dropping hymn `hymnId` on `segment`: `{ patch }` to apply to the segment, or `{ refused }` with
 * 'type' (the slot does not take songs), 'full' (the slot is at its limit) or 'present' (the song is already in the slot).
 * A refused drop changes nothing.
 */
export function songDrop(segment, hymnId) {
  if (!acceptsTab(segment, 'song')) return { refused: 'type' };
  const c = segment.content;
  if (c.kind === 'song' && c.hymnIds.includes(hymnId)) return { refused: 'present' };
  if (c.kind === 'song' && c.maxSongs > 1 && c.hymnIds.length >= c.maxSongs) return { refused: 'full' };
  return { patch: songAssignment(segment, hymnId, null) };
}

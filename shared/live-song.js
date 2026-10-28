// What the projector shows for a song or prayer that is live when it is edited. Plain JS with no React, so the operator console and the
// tests share the rules. Nothing here changes the style of a live slide: a style change never alters what is on screen.

/**
 * Where the operator's place in a song goes once the song has been edited. The place is a stanza position (0-based), because an edit
 * gives every stanza a new id. A song with fewer stanzas moves to its last stanza, and the operator is told it moved. Otherwise the
 * place stays the same.
 */
export function stanzaTarget(position, count, newCount) {
  if (newCount <= 0) return null;
  if (newCount < count) return { position: newCount - 1, moved: true };
  return { position: Math.min(position, newCount - 1), moved: false };
}

/**
 * The live lyrics frame after its song was edited, or null when nothing on screen changes. `frame.song` says which song and stanza
 * position it shows. `hymn` is the song as it is now. A deleted song (or one with no stanzas) also gives null: the slide stays on
 * screen, and the caller warns the operator. The result keeps the frame's style, and reports `changed` only when its text or title
 * changed, so a style-only change is a no-op.
 */
export function lyricsFrameAfterEdit(frame, hymn) {
  if (!frame || frame.kind !== 'lyrics' || !frame.song || !hymn) return null;
  if (hymn.deletedAt || hymn.id !== frame.song.hymnId) return null;
  const target = stanzaTarget(frame.song.position, frame.song.count, hymn.stanzas.length);
  if (!target) return null;
  const stanza = hymn.stanzas[target.position];
  const next = {
    ...frame,
    title: hymn.title,
    label: stanza.stanzaType,
    text: stanza.lyricsText,
    song: { hymnId: hymn.id, position: target.position, count: hymn.stanzas.length },
  };
  const changed = next.text !== frame.text || next.title !== frame.title || next.label !== frame.label;
  return { frame: next, moved: target.moved, changed };
}

/**
 * Where a live song sits in a Praise & Worship session's steps, after the song was edited: the index of the step that shows the
 * target stanza of the song, the one nearest the current step. Null when the stanza is no longer in the arrangement.
 */
export function findLyricsStep(steps, hymnId, position, currentIndex) {
  let best = null;
  steps.forEach((s, index) => {
    if (s.kind !== 'lyrics' || s.hymnId !== hymnId || s.position !== position) return;
    if (best === null || Math.abs(index - currentIndex) < Math.abs(best - currentIndex)) best = index;
  });
  return best;
}

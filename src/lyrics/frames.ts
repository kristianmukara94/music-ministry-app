import type { Frame } from '../../shared/live.js';
import type { Hymn } from './types';

/** The projector frame for one stanza of a hymn, or null when there is no such stanza. */
export function stanzaFrame(hymn: Hymn, index: number): Frame | null {
  const stanza = hymn.stanzas[index];
  // The song and the stanza's position let the projector follow an edit to this song while it is live.
  return stanza
    ? { kind: 'lyrics', title: hymn.title, label: stanza.stanzaType, text: stanza.lyricsText, style: hymn.style, key: `song:${hymn.id}`, song: { hymnId: hymn.id, position: index, count: hymn.stanzas.length } }
    : null;
}

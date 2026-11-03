import type { Frame } from '../../shared/live.js';
import { lyricsStanzaFrame } from '../../shared/stage-plan-row.js';
import type { Hymn } from './types';

/** The projector frame for one stanza of a hymn, or null when there is no such stanza. */
export function stanzaFrame(hymn: Hymn, index: number): Frame | null {
  return lyricsStanzaFrame(hymn as Parameters<typeof lyricsStanzaFrame>[0], index);
}

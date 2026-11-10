import type { Hymn, Stanza } from '../lyrics/types';
import { bridge } from './bridge';

/**
 * Song edits made on air: Edit slide, Add slide, Auto-split and Smart Break on a song's stanza, in the Holy Mass console, the Praise & Worship
 * console, Quick Live and the "Text cut off" split dialog. They are kept here, in this window's memory, for this run of the app only, and are
 * NEVER written to Song Lyrics: the song in the library stays exactly as it was, and the next run plays it as stored.
 *
 * Go Live reads songs through `liveLyrics` instead of `bridge.lyrics`, so it sees the edited words; Song Lyrics itself reads the bridge and
 * shows the stored song. A stanza added here has a negative id, so it can never be taken for a stored stanza; a lineup order that lists one
 * drops it once the app restarts (sectionOrder ignores unknown ids).
 */

const edited = new Map<number, Hymn>();
const listeners = new Set<(id: number) => void>();
let nextStanzaId = -1;

/** A stanza for setLiveStanzas: one the song has (its id), or a new one (no id). */
export type LiveStanza = Pick<Stanza, 'stanzaType' | 'lyricsText'> & { id?: number };

export const liveLyrics = {
  /** The song as Go Live plays it: the stored song, with this run's on-air edits. A song deleted from the library comes back deleted. */
  async getHymn(id: number): Promise<Hymn | null> {
    const own = edited.get(id);
    const stored = await bridge.lyrics.getHymn(id);
    if (!own || !stored || stored.deletedAt) return stored;
    // The words are this run's; the title and look follow the library.
    return { ...stored, stanzas: own.stanzas };
  },

  /** Calls `handler` with a song's id when it changes: an edit in Song Lyrics (any window), or an on-air edit made in this window. */
  onChanged(handler: (id: number) => void): () => void {
    listeners.add(handler);
    const off = bridge.lyrics.onChanged(handler);
    return () => {
      listeners.delete(handler);
      off();
    };
  },
};

/**
 * Replaces the song's stanzas for this run, on air only. Each stanza keeps its id; a new one gets a fresh negative id. Resolves to the song as
 * Go Live now plays it. Song Lyrics is not written.
 */
export async function setLiveStanzas(hymn: Hymn, stanzas: LiveStanza[]): Promise<Hymn> {
  const next: Hymn = {
    ...hymn,
    stanzas: stanzas.map((s, i) => ({ id: s.id ?? nextStanzaId--, stanzaType: s.stanzaType, lyricsText: s.lyricsText, order: i + 1 })),
  };
  edited.set(hymn.id, next);
  for (const listener of [...listeners]) {
    try {
      listener(hymn.id);
    } catch (err) {
      console.error('A live song listener failed:', err);
    }
  }
  return (await liveLyrics.getHymn(hymn.id)) ?? next;
}

/** Whether the song has on-air edits in this run (they are not in Song Lyrics). */
export const hasLiveEdits = (hymnId: number): boolean => edited.has(hymnId);

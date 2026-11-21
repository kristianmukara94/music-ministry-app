import type { Hymn, Stanza } from '../lyrics/types';
import { resolveSongSlides, type SongSlide, type SongSlides } from '../../shared/song-slides.js';
import { bridge } from './bridge';

/**
 * Songs as Go Live plays them, and the song edits made on air: Edit slide, Add slide, Delete slide, Auto-split and Smart Break, in the Holy Mass
 * console, the Praise & Worship console, Quick Live and the "Text cut off" split dialog.
 *
 * A song's words in Song Lyrics are NEVER written here. What an operator leaves a song's slides in is saved beside them, as the song's default
 * slide arrangement (`saveSongDefault`, hymns.default_slides_json; see shared/song-slides.js), and every later use of the song plays exactly
 * those slides: a new lineup, a Holy Mass plan, Quick-Live, and the next run of the app. Rewriting the words in Song Lyrics drops the
 * arrangement, and Reset Default Layout (`resetSongDefault`) clears it; the song is then paged automatically again.
 *
 * Between an edit and its save, the edit is kept in this window's memory (`setLiveStanzas`), so the console shows it at once; a failed save
 * leaves it there for this run. Go Live reads songs through `liveLyrics` instead of `bridge.lyrics`, so it sees both; Song Lyrics itself reads
 * the bridge and shows the stored words. A stanza added on air has a negative id, so it can never be taken for a stored stanza.
 */

const edited = new Map<number, Hymn>();
const listeners = new Set<(id: number) => void>();
let nextStanzaId = -1;

/** A stanza for setLiveStanzas: one the song has (its id), or a new one (no id). */
export type LiveStanza = Pick<Stanza, 'stanzaType' | 'lyricsText' | 'pages' | 'look' | 'notes'> & { id?: number };

const notify = (id: number) => {
  for (const listener of [...listeners]) {
    try {
      listener(id);
    } catch (err) {
      console.error('A live song listener failed:', err);
    }
  }
};

export const liveLyrics = {
  /**
   * The song as Go Live plays it: the stored song, as its default slide arrangement lays it out (when it has one that fits its words), with
   * this run's unsaved on-air edits over it. A song deleted from the library comes back deleted.
   */
  async getHymn(id: number): Promise<Hymn | null> {
    const stored = await bridge.lyrics.getHymn(id);
    if (!stored) return stored;
    const resolved = resolveSongSlides(stored) as Hymn;
    const own = edited.get(id);
    if (!own || stored.deletedAt) return resolved;
    // The words are this run's; the title and look follow the library.
    return { ...resolved, stanzas: own.stanzas };
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
 * Replaces the song's stanzas in this window at once, on air. Each stanza keeps its id; a new one gets a fresh negative id. Resolves to the
 * song as Go Live now plays it. Song Lyrics is not written; `saveSongDefault` then keeps the slides for every later use of the song.
 */
export async function setLiveStanzas(hymn: Hymn, stanzas: LiveStanza[]): Promise<Hymn> {
  const next: Hymn = {
    ...hymn,
    // A stanza edited on air keeps its slides exactly as typed (`pages`); see Stanza.pages.
    stanzas: stanzas.map((s, i) => ({
      id: s.id ?? nextStanzaId--,
      stanzaType: s.stanzaType,
      lyricsText: s.lyricsText,
      order: i + 1,
      ...(s.pages?.length ? { pages: [...s.pages] } : {}),
      ...(s.look ? { look: s.look } : {}),
      ...(s.notes ? { notes: s.notes } : {}),
    })),
  };
  edited.set(hymn.id, next);
  notify(hymn.id);
  return (await liveLyrics.getHymn(hymn.id)) ?? next;
}

/**
 * Saves `slides` as the song's default slide arrangement, so every later use of the song (and the next run of the app) plays exactly them. Once
 * saved, the song is read back from the arrangement and this run's unsaved edits to it are let go: the console now plays what a restart would.
 * Resolves to the arrangement saved. Song Lyrics' words are not written.
 */
export async function saveSongDefault(hymnId: number, slides: SongSlide[]): Promise<SongSlides | null> {
  const saved = await bridge.lyrics.saveDefaultSlides(hymnId, slides);
  edited.delete(hymnId);
  notify(hymnId);
  return saved;
}

/** Reset Default Layout: clears the song's default slide arrangement (and this run's unsaved edits), so it is paged automatically again. */
export async function resetSongDefault(hymnId: number): Promise<void> {
  await bridge.lyrics.saveDefaultSlides(hymnId, null);
  edited.delete(hymnId);
  notify(hymnId);
}

/** Whether the song has on-air edits in this run that are not saved as its default. */
export const hasLiveEdits = (hymnId: number): boolean => edited.has(hymnId);

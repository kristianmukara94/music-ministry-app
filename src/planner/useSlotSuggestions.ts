import { useEffect, useState } from 'react';
import { bridge } from '../live/bridge';
import type { MassSlot } from '../../shared/mass-slots.js';
import type { PickedItem } from './MassItemSelect';

/** How many songs a card offers as chips. More are one click away in the picker. */
export const CHIPS_PER_SLOT = 3;

/**
 * The songs each Holy Mass slot offers as quick-select chips: the Holy Mass songs (the Mass scope, and General songs, which show everywhere)
 * filed under that slot's own song category, in title order. A slot with no song category, or none filed under it, has none. One request is
 * made for each category rather than for each slot, and again when a song changes in Song Lyrics.
 */
export function useSlotSuggestions(slots: MassSlot[]): Record<string, PickedItem[]> {
  const [byCategory, setByCategory] = useState<Record<string, PickedItem[]>>({});
  const [revision, setRevision] = useState(0);
  const categories = [...new Set(slots.map((s) => s.songCategory).filter((c): c is string => Boolean(c)))].sort();
  const key = categories.join('|');

  useEffect(() => bridge.lyrics.onChanged(() => setRevision((n) => n + 1)), []);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      categories.map(async (category) => {
        try {
          const songs = await bridge.lyrics.listHymns({ primaryCategory: 'MASS', songCategory: category });
          return [category, songs.slice(0, CHIPS_PER_SLOT).map((h): PickedItem => ({ module: 'lyrics', sourceId: String(h.id), label: h.title }))] as const;
        } catch {
          return [category, []] as const;
        }
      }),
    ).then((pairs) => !cancelled && setByCategory(Object.fromEntries(pairs)));
    return () => {
      cancelled = true;
    };
  }, [key, revision]);

  return Object.fromEntries(slots.map((slot) => [slot.id, (slot.songCategory && byCategory[slot.songCategory]) || []]));
}

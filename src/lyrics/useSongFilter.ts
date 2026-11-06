import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bridge } from '../live/bridge';
import { EMPTY_CATEGORY_FILTER, categoryModeLookup, suggestedFor, type CategoryFilterState, type PrimaryCategory } from './songTaxonomy';
import type { HymnFilter, HymnLanguage, HymnSummary, SongCategory } from './types';

const SEARCH_DELAY_MS = 150;

/** What a dropdown holds for 'every category'. It means the same as no category. */
export const ALL_CATEGORIES = 'ALL';

export interface SongFilterState extends CategoryFilterState {
  query: string;
  language: HymnLanguage | '';
}

export interface UseSongFilterOptions {
  /** Starts the filter on a scope. Praise & Worship's Library starts on General, which shows every song. */
  initial?: Partial<SongFilterState>;
  /** Changes when the library does (a song was saved, a category was edited), so the list and the category names are read again. */
  refreshKey?: unknown;
}

/**
 * The song library's search and filter. The scope limits the list in the database, not in the page: Mass shows Mass and General songs and
 * leaves Praise & Worship out, Praise & Worship does the reverse, and General shows everything. Typing is debounced, and a slow answer to an
 * old search never replaces a newer one.
 */
export function useSongFilter({ initial, refreshKey }: UseSongFilterOptions = {}) {
  const [state, setState] = useState<SongFilterState>({ ...EMPTY_CATEGORY_FILTER, query: '', language: '', ...initial });
  const [hymns, setHymns] = useState<HymnSummary[]>([]);
  const [categories, setCategories] = useState<SongCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  // The category names, for the dropdown.
  useEffect(() => {
    let cancelled = false;
    bridge.lyrics
      .listSongCategories()
      .then((list) => !cancelled && setCategories(list))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [refreshKey, reloads]);

  const request = useMemo<HymnFilter>(
    () => ({
      search: state.query,
      primaryCategory: state.scope,
      // One category is an exact match on that category; 'ALL', blank or nothing is no limit.
      songCategory: state.songCategory.trim() && state.songCategory !== ALL_CATEGORIES ? state.songCategory.trim() : undefined,
      language: state.language,
    }),
    [state.query, state.scope, state.songCategory, state.language],
  );

  // Typing waits a moment so a word is not searched letter by letter. A dropdown is a deliberate choice, so it searches at once. The old list
  // stays on screen until the new one arrives, so the list never goes blank between two searches.
  const lastSearch = useRef(request.search);
  useEffect(() => {
    let cancelled = false;
    const typing = lastSearch.current !== request.search;
    lastSearch.current = request.search;
    const timer = window.setTimeout(() => {
      bridge.lyrics
        .listHymns(request)
        .then((rows) => {
          if (cancelled) return;
          setHymns(rows);
          setError(null);
        })
        .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    }, typing ? SEARCH_DELAY_MS : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [request, refreshKey, reloads]);

  const setQuery = useCallback((query: string) => setState((s) => ({ ...s, query })), []);
  const setLanguage = useCallback((language: HymnLanguage | '') => setState((s) => ({ ...s, language })), []);
  const setSongCategory = useCallback((songCategory: string) => setState((s) => ({ ...s, songCategory })), []);
  /** Changes the scope. A song category that does not belong under the new scope is dropped, so the list is never empty for want of a reset. */
  // The check reads each category's stored target mode, so a Praise & Worship category the operator added is dropped on moving to Holy Mass.
  const modes = useMemo(() => categoryModeLookup(categories), [categories]);
  const setScope = useCallback(
    (scope: PrimaryCategory) =>
      setState((s) => ({ ...s, scope, songCategory: s.songCategory && !suggestedFor(scope, s.songCategory, modes) ? '' : s.songCategory })),
    [modes],
  );
  /** Clears the filters (scope, song category, language) and leaves the typed search as it is. */
  const clearFilters = useCallback(() => setState((s) => ({ ...s, ...EMPTY_CATEGORY_FILTER, language: '' })), []);
  const reset = useCallback(() => setState((s) => ({ ...s, ...EMPTY_CATEGORY_FILTER, query: '', language: '' })), []);
  /** Reads the list again now, for after a song was saved. */
  const reload = useCallback(() => setReloads((n) => n + 1), []);

  /** Whether a song category or a language is limiting the list, which is when Clear filters is offered. */
  const narrowed = state.songCategory !== '' || state.language !== '' || state.scope !== EMPTY_CATEGORY_FILTER.scope;
  const filtered = state.scope !== EMPTY_CATEGORY_FILTER.scope || state.songCategory !== '' || state.language !== '' || state.query.trim() !== '';

  return { ...state, hymns, categories, error, filtered, narrowed, clearFilters, setQuery, setLanguage, setScope, setSongCategory, reset, reload };
}

export type SongFilter = ReturnType<typeof useSongFilter>;

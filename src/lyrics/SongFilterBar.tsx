import { FilterX } from 'lucide-react';
import { LANGUAGES } from '../../shared/lyrics-parser.js';
import { CategorySelectGroup } from './CategorySelectGroup';
import type { LyT } from './strings';
import type { SongFilter } from './useSongFilter';
import type { HymnLanguage } from './types';

const PILL =
  'h-7 min-w-10 rounded-full border px-3 font-mono text-[11px] font-bold tracking-wider transition focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none';

/**
 * The library's filter bar: scope and song category (the category list is grouped by scope), the language, a live count of the songs shown,
 * and Clear filters, which appears while a scope, category or language is limiting the list. A chosen category shows only the songs filed
 * under exactly that category. The search box above it is left alone by Clear filters.
 */
export function SongFilterBar({ filter, t }: { filter: SongFilter; t: LyT }) {
  const count = filter.hymns.length;
  return (
    <div className="flex flex-col gap-2">
      <CategorySelectGroup
        t={t}
        mode="filter"
        compact
        idPrefix="lyr-filter"
        scope={filter.scope}
        onScope={filter.setScope}
        songCategory={filter.songCategory}
        onSongCategory={filter.setSongCategory}
        categories={filter.categories}
      />
      {/* Language pills: one press filters to that language, and All lifts it. The full name is the tooltip and the accessible name. */}
      <div role="radiogroup" aria-label={t('fieldLanguage')} className="flex items-center gap-1.5">
        {(['', ...LANGUAGES] as (HymnLanguage | '')[]).map((l) => {
          const on = filter.language === l;
          const name = l ? t(`lang_${l}` as 'lang_EN') : t('allLanguages');
          return (
            <button
              key={l || 'all'}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={name}
              title={name}
              onClick={() => filter.setLanguage(l)}
              className={`${PILL} ${on ? 'border-accent bg-accent text-on-accent shadow-sm' : 'border-fg/15 bg-panel-2 text-fg/75 hover:border-accent/60 hover:text-fg'}`}
            >
              {l || t('allLanguagesShort')}
            </button>
          );
        })}
      </div>
      <div className="flex min-h-7 items-center justify-between gap-2">
        <span
          role="status"
          aria-live="polite"
          className="inline-flex items-center rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-xs font-bold text-accent tabular-nums"
        >
          {filter.songCategory ? t('categoryCount', { n: count, name: filter.songCategory }) : t('hymnCount', { n: count })}
        </span>
        {filter.narrowed && (
          <button
            type="button"
            onClick={filter.clearFilters}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-fg/15 px-2 text-xs font-semibold text-fg/80 transition hover:border-accent hover:text-accent"
          >
            <FilterX size={13} aria-hidden />
            {t('clearFilters')}
          </button>
        )}
      </div>
    </div>
  );
}

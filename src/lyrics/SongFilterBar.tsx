import { FilterX } from 'lucide-react';
import { LANGUAGES } from '../../shared/lyrics-parser.js';
import { CategorySelectGroup } from './CategorySelectGroup';
import type { LyT } from './strings';
import type { SongFilter } from './useSongFilter';
import type { HymnLanguage } from './types';

const SELECT = 'h-9 w-full rounded-md border border-fg/15 bg-panel-2 px-2 text-xs text-fg outline-none focus:border-accent';

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
        names={filter.categories.map((c) => c.name)}
      />
      <select value={filter.language} onChange={(e) => filter.setLanguage(e.target.value as HymnLanguage | '')} className={SELECT} aria-label={t('fieldLanguage')}>
        <option value="">{t('allLanguages')}</option>
        {LANGUAGES.map((l: string) => (
          <option key={l} value={l}>
            {t(`lang_${l}` as 'lang_EN')}
          </option>
        ))}
      </select>
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

import { useMemo } from 'react';
import { Tag } from 'lucide-react';
import type { LyKey } from '../../shared/lyrics-i18n.js';
import type { LyT } from './strings';
import { PRIMARY_OPTIONS, SCOPE_HINT_KEY, categoryModeLookup, groupCategories, homeScopeOfCategory, type PrimaryCategory } from './songTaxonomy';
import type { SongCategory } from './types';

const FIELD =
  'w-full rounded-lg border border-line-strong bg-surface-2 px-3 text-fg outline-none placeholder:text-faint focus:border-accent focus:ring-1 focus:ring-accent/40';
const CAPTION = 'flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase';

/** The heading a category group gets in a filter: its scope's name, and All for the categories that suit every scope. */
const GROUP_LABEL: Record<PrimaryCategory, LyKey> = { MASS: 'scope_MASS', PRAISE_AND_WORSHIP: 'scope_PRAISE_AND_WORSHIP', GENERAL: 'targetMode_ALL' };

interface Props {
  t: LyT;
  scope: PrimaryCategory;
  onScope: (scope: PrimaryCategory) => void;
  songCategory: string;
  onSongCategory: (name: string) => void;
  /** The operator's category list, with each category's target mode (Holy Mass, Praise & Worship or All). */
  categories: readonly Pick<SongCategory, 'name' | 'targetMode'>[];
  /** 'form' picks a song's own categories (a category is required). 'filter' narrows a list (an empty category means all). */
  mode: 'form' | 'filter';
  /** Form only: marks the category field as missing. */
  invalid?: boolean;
  /** Form only: adds the required star to the category caption. */
  required?: boolean;
  /** A prefix that keeps the field ids unique when two groups are on one page. */
  idPrefix: string;
  /** Hides the song category dropdown, for a place with room for the scope only. */
  scopeOnly?: boolean;
  /** Compact: smaller controls and no captions or notes, for a filter bar. */
  compact?: boolean;
}

/**
 * Two dropdowns for the two tiers of a song's category. The scope (General, Mass, Praise & Worship) comes first; the song category's dropdown
 * then offers only the categories whose target mode fits that scope: a Holy Mass scope shows Holy Mass and All categories, Praise & Worship
 * shows Praise & Worship and All, and General shows every category. The song's own category stays selectable even when it is for another
 * scope (shown under "Other categories"), so editing the song's other details never drops it.
 */
export function CategorySelectGroup({ t, scope, onScope, songCategory, onSongCategory, categories, mode, invalid, required, idPrefix, scopeOnly, compact }: Props) {
  const modes = useMemo(() => categoryModeLookup(categories), [categories]);
  const names = useMemo(() => categories.map((c) => c.name), [categories]);
  // A category the song already has but the list no longer holds stays selectable too.
  const all = songCategory && !names.includes(songCategory) ? [songCategory, ...names] : names;
  const { suggested } = groupCategories(all, scope, modes);
  const outsideScope = Boolean(songCategory) && !suggested.includes(songCategory);
  const size = compact ? 'h-9 text-xs' : 'h-10 text-sm';
  const scopeLabel = t(PRIMARY_OPTIONS.find((o) => o.value === scope)!.labelKey);
  const scopeId = `${idPrefix}-scope`;
  const categoryId = `${idPrefix}-category`;
  // A filter lists each offered category once, under the scope it belongs to: Holy Mass, Praise & Worship, then All (the chosen scope's own
  // group first when one is chosen). A form lists the ones that suit the chosen scope in one group.
  const ownFirst = (value: PrimaryCategory) => Number(scope !== 'GENERAL' && value === scope);
  const byScope = [...PRIMARY_OPTIONS]
    .sort((a, b) => ownFirst(b.value) - ownFirst(a.value) || Number(a.value === 'GENERAL') - Number(b.value === 'GENERAL'))
    .map((o) => ({ value: o.value, labelKey: GROUP_LABEL[o.value], names: suggested.filter((name) => homeScopeOfCategory(name, modes) === o.value) }))
    .filter((g) => g.names.length > 0);

  const otherGroup = outsideScope && (
    <optgroup label={t('otherCategories')}>
      <option value={songCategory}>{songCategory}</option>
    </optgroup>
  );

  return (
    <div className={`grid gap-3 ${scopeOnly ? 'grid-cols-1' : compact ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'}`}>
      <div className="flex min-w-0 flex-col gap-1.5">
        {!compact && (
          <label htmlFor={scopeId} className={CAPTION}>
            {t('scopeField')}
          </label>
        )}
        <select id={scopeId} value={scope} onChange={(e) => onScope(e.target.value as PrimaryCategory)} aria-label={t('scopeField')} className={`${FIELD} ${size}`}>
          {PRIMARY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {mode === 'filter' && o.value === 'GENERAL' ? t('scopeAllSongs') : t(o.labelKey)}
            </option>
          ))}
        </select>
        {!compact && <p className="text-[11px] text-muted">{t(SCOPE_HINT_KEY[scope])}</p>}
      </div>

      {!scopeOnly && (
        <div className="flex min-w-0 flex-col gap-1.5">
          {!compact && (
            <label htmlFor={categoryId} className={CAPTION}>
              {t('songCategoryField')} {mode === 'form' && required && <span className="text-danger" aria-hidden>*</span>}
            </label>
          )}
          <select
            id={categoryId}
            value={songCategory}
            onChange={(e) => onSongCategory(e.target.value)}
            aria-label={t('songCategoryField')}
            aria-invalid={invalid || undefined}
            className={`${FIELD} ${size} ${invalid ? '!border-danger' : ''}`}
          >
            <option value="">{mode === 'filter' ? t('allCategories') : t('songCategoryNone')}</option>
            {mode === 'filter' ? (
              byScope.map((g) => (
                <optgroup key={g.value} label={t(g.labelKey)}>
                  {g.names.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </optgroup>
              ))
            ) : (
              suggested.length > 0 && (
                <optgroup label={scope === 'GENERAL' ? t('songCategoryField') : t('suggestedFor', { scope: scopeLabel })}>
                  {suggested.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </optgroup>
              )
            )}
            {otherGroup}
          </select>
          {!compact && songCategory && (
            <p className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] font-bold text-accent">
                <Tag size={11} aria-hidden />
                {songCategory}
              </span>
              {outsideScope && <span className="text-[11px] text-muted">{t('otherCategories')}</span>}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

import { Tag } from 'lucide-react';
import type { LyT } from './strings';
import { PRIMARY_OPTIONS, SCOPE_HINT_KEY, groupCategories, homeScopeOfCategory, type PrimaryCategory } from './songTaxonomy';

const FIELD =
  'w-full rounded-lg border border-fg/15 bg-panel-2 px-3 text-fg outline-none placeholder:text-fg/40 focus:border-accent focus:ring-1 focus:ring-accent/40';
const CAPTION = 'flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-fg/60 uppercase';

interface Props {
  t: LyT;
  scope: PrimaryCategory;
  onScope: (scope: PrimaryCategory) => void;
  songCategory: string;
  onSongCategory: (name: string) => void;
  /** Every category name on the operator's list. */
  names: string[];
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
 * Two dropdowns for the two tiers of a song's category. The scope (General, Mass, Praise & Worship) comes first; the song category's
 * dropdown then lists the categories suggested for that scope in the first group and the rest in a second, so nothing is hidden and a
 * song can still carry a category from another scope. The chosen category shows as a badge, with a note when the scope does not suggest it.
 */
export function CategorySelectGroup({ t, scope, onScope, songCategory, onSongCategory, names, mode, invalid, required, idPrefix, scopeOnly, compact }: Props) {
  // A category the song already has but the list no longer holds stays selectable, so editing the song's other details never drops it.
  const all = songCategory && !names.includes(songCategory) ? [songCategory, ...names] : names;
  const { suggested, other } = groupCategories(all, scope);
  const size = compact ? 'h-9 text-xs' : 'h-10 text-sm';
  const scopeLabel = t(PRIMARY_OPTIONS.find((o) => o.value === scope)!.labelKey);
  const scopeId = `${idPrefix}-scope`;
  const categoryId = `${idPrefix}-category`;
  // A filter lists every category once, under the scope it belongs to, with that scope's name as the heading. A form lists the ones that suit
  // the chosen scope first.
  const byScope = PRIMARY_OPTIONS.map((o) => ({ ...o, names: all.filter((name) => homeScopeOfCategory(name) === o.value) })).filter((g) => g.names.length > 0);
  const outsideScope = Boolean(songCategory) && scope !== 'GENERAL' && !suggested.includes(songCategory);

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
              <>
                {suggested.length > 0 && (
                  <optgroup label={scope === 'GENERAL' ? t('songCategoryField') : t('suggestedFor', { scope: scopeLabel })}>
                    {suggested.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {other.length > 0 && (
                  <optgroup label={t('otherCategories')}>
                    {other.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </>
            )}
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

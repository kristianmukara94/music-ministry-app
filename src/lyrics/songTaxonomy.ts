// The song taxonomy as the pages use it: the primary scopes, the themes and Mass parts with their suggested scopes, and the filter's shape.
// The rules live in shared/song-taxonomy.js, which the main process uses too, so the list and the database filter cannot disagree.
import {
  CATEGORY_TARGET_MODES,
  DEFAULT_PRIMARY,
  DEFAULT_TARGET_MODE,
  MASS_PART_NAMES,
  PRIMARY_CATEGORIES,
  THEME_CATEGORIES,
  THEME_NAMES,
  categoryModeLookup,
  groupCategories,
  homeScopeOfCategory,
  isPrimaryCategory,
  normalizePrimary,
  scopesOfCategory,
  songShownIn,
  suggestedFor,
  type CategoryModes,
} from '../../shared/song-taxonomy.js';
import type { LyKey } from '../../shared/lyrics-i18n.js';
import type { CategoryTargetMode, PrimaryCategory } from './types';

export type { CategoryModes, CategoryTargetMode, PrimaryCategory };
export {
  CATEGORY_TARGET_MODES,
  DEFAULT_PRIMARY,
  DEFAULT_TARGET_MODE,
  MASS_PART_NAMES,
  PRIMARY_CATEGORIES,
  THEME_CATEGORIES,
  THEME_NAMES,
  categoryModeLookup,
  groupCategories,
  homeScopeOfCategory,
  isPrimaryCategory,
  normalizePrimary,
  scopesOfCategory,
  songShownIn,
  suggestedFor,
};

/** The target modes as segmented-control options, in the order the editor shows them, with the label key each is shown under. */
export const TARGET_MODE_OPTIONS: { value: CategoryTargetMode; labelKey: LyKey }[] = CATEGORY_TARGET_MODES.map((value: CategoryTargetMode) => ({
  value,
  labelKey: `targetMode_${value}` as LyKey,
}));

/** What the category part of a filter holds: the scope, and one song category inside it ('' for every category). */
export interface CategoryFilterState {
  scope: PrimaryCategory;
  songCategory: string;
}

/** The filter that shows every song. */
export const EMPTY_CATEGORY_FILTER: CategoryFilterState = { scope: DEFAULT_PRIMARY, songCategory: '' };

/** The scopes as dropdown options, with the label key each is shown under. */
export const PRIMARY_OPTIONS: { value: PrimaryCategory; labelKey: LyKey }[] = PRIMARY_CATEGORIES.map((value: PrimaryCategory) => ({
  value,
  labelKey: `scope_${value}` as LyKey,
}));

/** The line under a scope picker that says what the scope leaves out. */
export const SCOPE_HINT_KEY: Record<PrimaryCategory, LyKey> = {
  GENERAL: 'scopeHintGeneral',
  MASS: 'scopeHintMass',
  PRAISE_AND_WORSHIP: 'scopeHintPw',
};

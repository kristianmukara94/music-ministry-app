export type PrimaryCategory = 'GENERAL' | 'MASS' | 'PRAISE_AND_WORSHIP';

export const PRIMARY_CATEGORIES: PrimaryCategory[];
export const DEFAULT_PRIMARY: PrimaryCategory;
export const PRIMARY_LABELS_EN: Record<PrimaryCategory, string>;
export const THEME_CATEGORIES: { name: string; scopes: PrimaryCategory[] }[];
export const THEME_NAMES: string[];
export const MASS_PART_NAMES: string[];
export function isPrimaryCategory(value: unknown): value is PrimaryCategory;
export function normalizePrimary(value: unknown, fallback?: PrimaryCategory): PrimaryCategory;

/** Where a song category is used: the Holy Mass, Praise & Worship, or all (both). */
export type CategoryTargetMode = 'HOLY_MASS' | 'PRAISE_AND_WORSHIP' | 'ALL';
/** Category name (lower case) to its stored target mode, as categoryModeLookup builds it. */
export type CategoryModes = ReadonlyMap<string, CategoryTargetMode>;
export const CATEGORY_TARGET_MODES: CategoryTargetMode[];
export const DEFAULT_TARGET_MODE: CategoryTargetMode;
export const DEFAULT_TARGET_MODES: { name: string; targetMode: CategoryTargetMode }[];
export function isCategoryTargetMode(value: unknown): value is CategoryTargetMode;
export function normalizeTargetMode(value: unknown, fallback?: CategoryTargetMode): CategoryTargetMode;
export function scopesOfTargetMode(mode: CategoryTargetMode): PrimaryCategory[];
export function defaultTargetModeOf(name: string): CategoryTargetMode;
export function categoryModeLookup(categories: readonly { name: string; targetMode?: unknown }[] | null | undefined): Map<string, CategoryTargetMode>;

export function scopesOfCategory(name: string, modes?: CategoryModes): PrimaryCategory[];
export function homeScopeOfCategory(name: string, modes?: CategoryModes): PrimaryCategory;
export function suggestedFor(scope: PrimaryCategory, name: string, modes?: CategoryModes): boolean;
export function groupCategories(names: string[], scope: PrimaryCategory, modes?: CategoryModes): { suggested: string[]; other: string[] };
export function scopesShownBy(filterScope: PrimaryCategory): PrimaryCategory[] | null;
export function songShownIn(filterScope: PrimaryCategory, songScope: unknown): boolean;

export type MassSlot = 'Entrance' | 'Offertory' | 'Communion' | 'Recessional';
export const MASS_SLOTS: MassSlot[];
export function deriveLegacyMassSlot(scope: PrimaryCategory, songCategory: string): MassSlot | null;
export function legacyCategoryFor(scope: PrimaryCategory, songCategory: string): MassSlot | 'General';
export function scopeForLegacy(category: unknown, songCategory: unknown): PrimaryCategory;

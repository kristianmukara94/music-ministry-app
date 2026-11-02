export type PrimaryCategory = 'GENERAL' | 'MASS' | 'PRAISE_AND_WORSHIP';

export const PRIMARY_CATEGORIES: PrimaryCategory[];
export const DEFAULT_PRIMARY: PrimaryCategory;
export const PRIMARY_LABELS_EN: Record<PrimaryCategory, string>;
export const THEME_CATEGORIES: { name: string; scopes: PrimaryCategory[] }[];
export const THEME_NAMES: string[];
export const MASS_PART_NAMES: string[];
export function isPrimaryCategory(value: unknown): value is PrimaryCategory;
export function normalizePrimary(value: unknown, fallback?: PrimaryCategory): PrimaryCategory;
export function scopesOfCategory(name: string): PrimaryCategory[];
export function homeScopeOfCategory(name: string): PrimaryCategory;
export function suggestedFor(scope: PrimaryCategory, name: string): boolean;
export function groupCategories(names: string[], scope: PrimaryCategory): { suggested: string[]; other: string[] };
export function scopesShownBy(filterScope: PrimaryCategory): PrimaryCategory[] | null;
export function songShownIn(filterScope: PrimaryCategory, songScope: unknown): boolean;

export type MassSlot = 'Entrance' | 'Offertory' | 'Communion' | 'Recessional';
export const MASS_SLOTS: MassSlot[];
export function deriveLegacyMassSlot(scope: PrimaryCategory, songCategory: string): MassSlot | null;
export function legacyCategoryFor(scope: PrimaryCategory, songCategory: string): MassSlot | 'General';
export function scopeForLegacy(category: unknown, songCategory: unknown): PrimaryCategory;

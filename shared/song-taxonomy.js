// How songs are sorted: a primary scope (where the song is used) and a song category inside it (its theme, or the part of the Mass it sings).
// Pure: no Electron or browser imports, so the main process, the pages and the tests share one list.
//
//   Scope           Meaning
//   GENERAL         Usable anywhere. A General song shows under every scope.
//   MASS            Sung at Mass.
//   PRAISE_AND_WORSHIP   Sung in a Praise & Worship service.
//
// A song category is a name from the operator's list (Song categories). The names below are the ones the app ships with, each with the
// scopes it is suggested for. A name the operator adds is suggested everywhere.
import { SONG_CATEGORY_NAMES } from './mass-flow.js';

export const PRIMARY_CATEGORIES = ['GENERAL', 'MASS', 'PRAISE_AND_WORSHIP'];

/** The scope a song has when none was chosen, and the filter that shows every song. */
export const DEFAULT_PRIMARY = 'GENERAL';

/** The scopes' names in English. The pages use the translated ones (lyrics-i18n); the main process and the tests use these. */
export const PRIMARY_LABELS_EN = { GENERAL: 'General', MASS: 'Holy Mass', PRAISE_AND_WORSHIP: 'Praise & Worship' };

/** The themes that ship with the app, with the scopes each is suggested for. */
export const THEME_CATEGORIES = [
  { name: 'Joyful Song', scopes: ['PRAISE_AND_WORSHIP'] },
  { name: 'Worship Song', scopes: ['PRAISE_AND_WORSHIP'] },
  { name: 'Repentance Song', scopes: ['PRAISE_AND_WORSHIP', 'MASS'] },
  { name: 'Thanksgiving Song', scopes: ['PRAISE_AND_WORSHIP', 'MASS'] },
  { name: 'Healing Song', scopes: ['PRAISE_AND_WORSHIP'] },
  { name: 'Offertory Song', scopes: ['MASS'] },
  { name: 'Marian Song', scopes: ['MASS'] },
];

/** The names of the shipped themes, in the order they are seeded. */
export const THEME_NAMES = THEME_CATEGORIES.map((c) => c.name);

/** The parts of the Mass a song can be sung for (Entrance Procession, Gloria, Communion Procession …). They belong to the Mass. */
export const MASS_PART_NAMES = SONG_CATEGORY_NAMES;

const SCOPES_OF = new Map([
  ...THEME_CATEGORIES.map((c) => [c.name.toLowerCase(), c.scopes]),
  ...MASS_PART_NAMES.map((name) => [name.toLowerCase(), ['MASS']]),
]);

export const isPrimaryCategory = (value) => PRIMARY_CATEGORIES.includes(value);

/** A scope from stored or typed text, or the default when it is not one. */
export const normalizePrimary = (value, fallback = DEFAULT_PRIMARY) => (isPrimaryCategory(value) ? value : fallback);

/** The scopes a song category is suggested for. A name the app does not ship (one the operator added) suits every scope. */
export function scopesOfCategory(name) {
  return SCOPES_OF.get(String(name ?? '').trim().toLowerCase()) ?? PRIMARY_CATEGORIES;
}

/**
 * The one scope a song category is listed under in a grouped dropdown: the first scope it is suggested for. A category the app does not ship
 * (one the operator added) is listed under General.
 */
export function homeScopeOfCategory(name) {
  const scopes = SCOPES_OF.get(String(name ?? '').trim().toLowerCase());
  return scopes ? scopes[0] : 'GENERAL';
}

/** Whether a song category is suggested under a scope. General suggests every category. */
export function suggestedFor(scope, name) {
  return scope === 'GENERAL' || scopesOfCategory(name).includes(scope);
}

/**
 * Splits category names for a scope's dropdown: the ones suggested for it first, in the list's order, then the rest. Nothing is dropped, so
 * a song can still be given a category from another scope, and a song that already has one keeps showing it.
 */
export function groupCategories(names, scope) {
  const suggested = [];
  const other = [];
  for (const name of names) (suggestedFor(scope, name) ? suggested : other).push(name);
  return { suggested, other };
}

/**
 * The stored scopes a filter lets through, or null for no limit. Mass shows Mass and General songs and leaves Praise & Worship out;
 * Praise & Worship shows its own and General and leaves Mass out; General shows everything.
 */
export function scopesShownBy(filterScope) {
  return filterScope === 'MASS' || filterScope === 'PRAISE_AND_WORSHIP' ? [filterScope, 'GENERAL'] : null;
}

/** Whether a song with this stored scope shows under a filter scope. The database filter and the pages follow this one rule. */
export function songShownIn(filterScope, songScope) {
  const shown = scopesShownBy(filterScope);
  return shown === null || shown.includes(normalizePrimary(songScope));
}

// ── The legacy Mass slot ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// A hymn also keeps its older `category` (Entrance, Offertory, Communion, Recessional, General). The Praise & Worship lineup reads it to
// tell which song fits a slot. The song form no longer asks for it: it follows from the scope and the song category, by the table below.

/** The legacy values that name a Mass slot. 'General' is the value for a song with none. */
export const MASS_SLOTS = ['Entrance', 'Offertory', 'Communion', 'Recessional'];

/** The song categories that stand for a Mass slot, by lower-case name. */
const SLOT_OF_CATEGORY = new Map([
  ['entrance procession', 'Entrance'],
  ['entrance', 'Entrance'],
  ['preparation of the gifts', 'Offertory'],
  ['offertory song', 'Offertory'],
  ['offertory', 'Offertory'],
  ['communion procession', 'Communion'],
  ['communion', 'Communion'],
  ['recessional', 'Recessional'],
]);

/**
 * The Mass slot a song fits, from its scope and song category, or null when it fits none. A Praise & Worship song fits none: its
 * lineup slots are matched by the operator's tags. General songs are read like Mass ones, since they are sung at Mass too.
 */
export function deriveLegacyMassSlot(scope, songCategory) {
  if (scope === 'PRAISE_AND_WORSHIP') return null;
  return SLOT_OF_CATEGORY.get(String(songCategory ?? '').trim().toLowerCase()) ?? null;
}

/** The value kept in the legacy `category` column: the derived Mass slot, or 'General' when there is none. */
export const legacyCategoryFor = (scope, songCategory) => deriveLegacyMassSlot(scope, songCategory) ?? 'General';

/**
 * The scope for a song from a file or a library that has none: Mass when it has a Mass slot or a Mass part as its category, else
 * General. The database migration applies the same rule to the library that was there before scopes.
 */
export function scopeForLegacy(category, songCategory) {
  const slot = MASS_SLOTS.includes(category);
  const part = MASS_PART_NAMES.some((name) => name.toLowerCase() === String(songCategory ?? '').trim().toLowerCase());
  return slot || part ? 'MASS' : 'GENERAL';
}

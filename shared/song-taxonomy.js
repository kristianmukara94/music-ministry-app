// How songs are sorted: a primary scope (where the song is used) and a song category inside it (its theme, or the part of the Mass it sings).
// Pure: no Electron or browser imports, so the main process, the pages and the tests share one list.
//
//   Scope           Meaning
//   GENERAL         Usable anywhere. A General song shows under every scope.
//   MASS            Sung at Mass.
//   PRAISE_AND_WORSHIP   Sung in a Praise & Worship service.
//
// A song category is a name from the operator's list (Song categories). The names below are the ones the app ships with, each with the
// scopes it is suggested for. Every category on the operator's list also stores a target mode (see below), which wins over these defaults.
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

// ── A category's target mode ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Each category on the operator's list says where it is used: the Holy Mass, Praise & Worship, or All (both). It is stored with the
// category (song_categories.target_mode), so a category the operator adds can belong to Praise & Worship as surely as a shipped one.
// The helpers below take the operator's list as an optional `modes` lookup (categoryModeLookup); a name the lookup does not hold falls back
// to the shipped defaults above.

export const CATEGORY_TARGET_MODES = ['HOLY_MASS', 'PRAISE_AND_WORSHIP', 'ALL'];

/** The target mode a category gets when none was chosen. */
export const DEFAULT_TARGET_MODE = 'ALL';

export const isCategoryTargetMode = (value) => CATEGORY_TARGET_MODES.includes(value);

/** A target mode from stored or typed text, or the default when it is not one. */
export const normalizeTargetMode = (value, fallback = DEFAULT_TARGET_MODE) => (isCategoryTargetMode(value) ? value : fallback);

/** The song scopes a target mode suits. All suits every scope. */
export function scopesOfTargetMode(mode) {
  if (mode === 'HOLY_MASS') return ['MASS'];
  if (mode === 'PRAISE_AND_WORSHIP') return ['PRAISE_AND_WORSHIP'];
  return PRIMARY_CATEGORIES;
}

/**
 * The target mode a shipped category starts with: Holy Mass or Praise & Worship when it suits only one of them, All when it suits both. A name
 * the app does not ship is All. The migration fills the stored column with this, so no shipped category moves when the column appears.
 */
export function defaultTargetModeOf(name) {
  const scopes = SCOPES_OF.get(String(name ?? '').trim().toLowerCase());
  if (!scopes) return DEFAULT_TARGET_MODE;
  const mass = scopes.includes('MASS');
  const pw = scopes.includes('PRAISE_AND_WORSHIP');
  return mass && !pw ? 'HOLY_MASS' : pw && !mass ? 'PRAISE_AND_WORSHIP' : 'ALL';
}

/** Every shipped category name with the target mode it starts with. */
export const DEFAULT_TARGET_MODES = [...THEME_NAMES, ...MASS_PART_NAMES].map((name) => ({ name, targetMode: defaultTargetModeOf(name) }));

/** A lookup from category name (any letter case) to its stored target mode, built from the operator's list ({ name, targetMode }[]). */
export function categoryModeLookup(categories) {
  const map = new Map();
  for (const c of categories ?? []) if (c && typeof c.name === 'string') map.set(c.name.trim().toLowerCase(), normalizeTargetMode(c.targetMode));
  return map;
}

const storedModeOf = (name, modes) => modes?.get(String(name ?? '').trim().toLowerCase()) ?? null;

/**
 * The scopes a song category is suggested for: its stored target mode's scopes when `modes` holds it, else the shipped ones. A name neither
 * knows suits every scope.
 */
export function scopesOfCategory(name, modes) {
  const stored = storedModeOf(name, modes);
  if (stored) return scopesOfTargetMode(stored);
  return SCOPES_OF.get(String(name ?? '').trim().toLowerCase()) ?? PRIMARY_CATEGORIES;
}

/**
 * The one scope a song category is listed under in a grouped dropdown. With a stored target mode: Mass, Praise & Worship, or General for All.
 * Without one: the first scope it is suggested for, and General for a name the app does not ship.
 */
export function homeScopeOfCategory(name, modes) {
  const stored = storedModeOf(name, modes);
  if (stored) return stored === 'HOLY_MASS' ? 'MASS' : stored === 'PRAISE_AND_WORSHIP' ? 'PRAISE_AND_WORSHIP' : 'GENERAL';
  const scopes = SCOPES_OF.get(String(name ?? '').trim().toLowerCase());
  return scopes ? scopes[0] : 'GENERAL';
}

/** Whether a song category is suggested under a scope. General suggests every category. */
export function suggestedFor(scope, name, modes) {
  return scope === 'GENERAL' || scopesOfCategory(name, modes).includes(scope);
}

/**
 * Splits category names for a scope's dropdown: the ones suggested for it first, in the list's order, then the rest. Nothing is dropped here;
 * the dropdown decides which of the rest it still shows (a song's own category, so editing it never loses it).
 */
export function groupCategories(names, scope, modes) {
  const suggested = [];
  const other = [];
  for (const name of names) (suggestedFor(scope, name, modes) ? suggested : other).push(name);
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

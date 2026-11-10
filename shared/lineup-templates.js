// The default lineups and the song picker's categories, in one place for the church laptop, the website and the server.
//
// The laptop builds its Praise & Worship template from PW_LINEUP (shared/pw.js) and the website builds its Praise & Worship editor from
// the same list, so a plan made on either side has the same twelve slots, under the same keys, in the same three groups. MASS_LINEUP
// states the four parts of the Holy Mass by slot number; the slots themselves are in shared/mass-slots.js, and a test keeps the two in step.
//
// The website cannot load the laptop's files, so web/js/lineup-templates.js is a copy of this file, byte for byte, and a test keeps
// the two equal. For that reason this file imports nothing. Change this one, then copy it over the other.
//
// Pure data and rules: no Electron, no browser and no network, so the tests run in Node.

// ---- Service types ----
// A plan is a Holy Mass plan or a Praise & Worship plan. A song's scope says which it is sung in; a General song is sung in both.

export const GENERAL_SCOPE = 'GENERAL';

/** `id` is what the website and the song API call the service type, `planKind` the plan's kind, `scope` the song scope it shows. */
export const SERVICE_TYPES = [
  { id: 'mass', planKind: 'mass', scope: 'MASS', label: 'Holy Mass', allLabel: 'All Holy Mass' },
  { id: 'praise_worship', planKind: 'pw', scope: 'PRAISE_AND_WORSHIP', label: 'Praise & Worship', allLabel: 'All Praise & Worship' },
];

export const serviceTypeOf = (id) => SERVICE_TYPES.find((type) => type.id === id) ?? null;

/** The service type a plan's song picker opens on. A plan with no kind is a Holy Mass plan, the editor it opens in. */
export const serviceTypeOfPlanKind = (kind) => (kind === 'pw' ? 'praise_worship' : 'mass');

/** The song scopes a service type shows: its own and General, the rule the laptop's library follows (shared/song-taxonomy.js). */
export function scopesOfServiceType(id) {
  const type = serviceTypeOf(id);
  return type ? [type.scope, GENERAL_SCOPE] : null;
}

// ---- The Praise & Worship lineup ----
// `type` is what the slot holds first: a prayer, a song, or scripture (a title slide, or a reading from the lectionary when `readingType`
// is set). `types` lists every type a slot may hold when that is more than its own. `pickerCategory` is the song category the song picker
// opens on for the slot. `legacyCategory` is the older hymn category the laptop's lineup matches a song by.

export const PW_LINEUP = {
  name: 'Praise & Worship Night',
  groups: [
    { key: 'opening', name: 'Opening' },
    { key: 'praise', name: 'Praise & Worship' },
    { key: 'word', name: 'Word & Offering' },
  ],
  segments: [
    { key: 'prayer_authority', group: 'opening', name: 'Prayer to Take Authority', type: 'prayer', minutes: 3 },
    { key: 'consecration_mary', group: 'opening', name: 'Consecration to Mary, Our Lady of Nazareth', type: 'prayer', minutes: 3 },
    { key: 'marian_song', group: 'opening', name: 'Marian Song', type: 'song', minutes: 5, maxSongs: 1, pickerCategory: 'marian' },
    { key: 'bible_enthronement', group: 'opening', name: 'Bible Enthronement', type: 'scripture', types: ['scripture', 'song'], minutes: 4 },
    { key: 'joyful_song', group: 'praise', name: 'Joyful Song', type: 'song', minutes: 8, maxSongs: 1, pickerCategory: 'joyful' },
    { key: 'worship', group: 'praise', name: 'Worship', type: 'song', minutes: 15, maxSongs: 3, pickerCategory: 'worship' },
    { key: 'repentance', group: 'praise', name: 'Repentance', type: 'song', minutes: 8, maxSongs: 1, pickerCategory: 'repentance' },
    { key: 'holy_spirit', group: 'praise', name: 'Holy Spirit', type: 'song', minutes: 8, maxSongs: 1, pickerCategory: 'holy_spirit' },
    { key: 'gospel_acclamation', group: 'word', name: 'Gospel Acclamation', type: 'scripture', types: ['scripture', 'song'], minutes: 3, readingType: 'Gospel Acclamation' },
    { key: 'offertory', group: 'word', name: 'Offertory', type: 'song', minutes: 6, maxSongs: 1, pickerCategory: 'offertory', legacyCategory: 'Offertory' },
    { key: 'thanksgiving', group: 'word', name: 'Thanksgiving', type: 'song', minutes: 6, maxSongs: 1, pickerCategory: 'thanksgiving' },
    { key: 'finale', group: 'word', name: 'Finale', type: 'song', minutes: 5, maxSongs: 1, pickerCategory: 'finale' },
  ],
};

export const PW_SEGMENT_KEYS = PW_LINEUP.segments.map((segment) => segment.key);

// ---- The Holy Mass lineup ----
// The four parts of the Mass, each with its slots in Mass order, by the slot number a saved plan and the website use (1 to 28).

export const MASS_LINEUP = [
  { number: 1, name: 'Introductory Rites', slots: [1, 2, 3, 18, 19] },
  { number: 2, name: 'Liturgy of the Word', slots: [20, 4, 21, 5, 22, 23, 24, 6] },
  { number: 3, name: 'Liturgy of the Eucharist', slots: [7, 8, 9, 10, 13, 11, 12, 25, 14, 15, 16, 26] },
  { number: 4, name: 'Concluding Rites', slots: [27, 28, 17] },
];

// ---- The song picker's categories ----
// Under each service type the picker offers these categories. `names` are the song category names, in lower case, that a category
// takes in: the names the laptop ships with (shared/mass-flow.js and shared/song-taxonomy.js) and the plain names an operator is likely
// to add. A song whose category is in none of them is still offered: its own category is added after these (pickerPillsFor).

export const ALL_CATEGORIES = 'all';

export const PICKER_CATEGORIES = {
  mass: [
    { id: 'entrance', label: 'Entrance', names: ['entrance procession', 'entrance', 'entrance hymn', 'entrance song'] },
    { id: 'kyrie', label: 'Kyrie', names: ['kyrie', 'lord, have mercy', 'lord have mercy'] },
    { id: 'gloria', label: 'Gloria', names: ['gloria', 'glory to god'] },
    { id: 'psalm', label: 'Psalm', names: ['responsorial psalm', 'psalm'] },
    { id: 'gospel_acclamation', label: 'Gospel Acclamation', names: ['gospel acclamation', 'alleluia'] },
    { id: 'offertory', label: 'Offertory', names: ['preparation of the gifts', 'offertory', 'offertory song'] },
    { id: 'sanctus', label: 'Sanctus', names: ['holy, holy, holy', 'holy holy holy', 'sanctus'] },
    { id: 'memorial_acclamation', label: 'Anamnesis / Acclamation', names: ['memorial acclamation', 'anamnesis', 'mystery of faith'] },
    { id: 'amen', label: 'Amen', names: ['great amen', 'amen'] },
    { id: 'our_father', label: 'Our Father', names: ['our father', "the lord's prayer", "lord's prayer"] },
    { id: 'agnus_dei', label: 'Agnus Dei', names: ['lamb of god', 'agnus dei'] },
    { id: 'communion', label: 'Communion', names: ['communion procession', 'communion', 'communion hymn', 'communion song'] },
    { id: 'thanksgiving', label: 'Thanksgiving', names: ['thanksgiving', 'thanksgiving song'] },
    { id: 'recessional', label: 'Recessional', names: ['recessional', 'recessional hymn', 'recessional song'] },
  ],
  praise_worship: [
    { id: 'joyful', label: 'Joyful / Fast Praise', names: ['joyful song', 'joyful', 'fast praise', 'praise song', 'praise'] },
    { id: 'worship', label: 'Worship / Slow Worship', names: ['worship song', 'worship', 'slow worship'] },
    { id: 'repentance', label: 'Repentance', names: ['repentance song', 'repentance'] },
    { id: 'holy_spirit', label: 'Holy Spirit', names: ['holy spirit song', 'holy spirit'] },
    { id: 'marian', label: 'Marian', names: ['marian song', 'marian'] },
    { id: 'offertory', label: 'Offertory', names: ['offertory song', 'offertory', 'preparation of the gifts'] },
    { id: 'thanksgiving', label: 'Thanksgiving', names: ['thanksgiving song', 'thanksgiving', 'communion song', 'communion'] },
    { id: 'finale', label: 'Finale', names: ['finale song', 'finale', 'closing song', 'closing', 'recessional'] },
  ],
};

const lower = (value) => String(value ?? '').trim().toLowerCase();

/** A service type's picker categories, in the order the picker shows them. */
export const pickerCategoriesOf = (serviceType) => PICKER_CATEGORIES[serviceType] ?? [];

/** One picker category by id, or null. */
export const pickerCategoryOf = (serviceType, id) => pickerCategoriesOf(serviceType).find((category) => category.id === id) ?? null;

/** The picker category a song category name belongs to under a service type, or null when it belongs to none. */
export function pickerCategoryForName(serviceType, name) {
  const wanted = lower(name);
  if (!wanted) return null;
  return pickerCategoriesOf(serviceType).find((category) => category.names.includes(wanted))?.id ?? null;
}

/** Whether a song is offered under a service type: its scope is that type's, or General. A song with no scope is General. */
export function songInServiceType(song, serviceType) {
  const scopes = scopesOfServiceType(serviceType);
  return scopes === null || scopes.includes(song?.scope || GENERAL_SCOPE);
}

/**
 * Whether a song is in a picker category. `categoryId` is a picker category's id, 'all' (or nothing) for every song, or a song category's
 * own name for one the picker has no category for.
 */
export function songInPickerCategory(song, serviceType, categoryId) {
  if (!categoryId || categoryId === ALL_CATEGORIES) return true;
  const category = pickerCategoryOf(serviceType, categoryId);
  return category ? category.names.includes(lower(song?.category)) : lower(song?.category) === lower(categoryId);
}

/**
 * What a song list is narrowed to for a service type and a category, as lower-case values a database can match: `scopes` (the song
 * scopes, or null for no limit) and `names` (the song category names, or null for no limit). Null when the service type is not one.
 */
export function pickerFilterOf(serviceType, categoryId) {
  if (serviceType !== undefined && serviceType !== null && serviceType !== '' && !serviceTypeOf(serviceType)) return null;
  const scopes = scopesOfServiceType(serviceType);
  if (!categoryId || categoryId === ALL_CATEGORIES) return { scopes, names: null };
  const category = pickerCategoryOf(serviceType, categoryId);
  return { scopes, names: category ? [...category.names] : [lower(categoryId)] };
}

/** The songs the picker lists: the service type's, in one category, with the search matched against the title. */
export function filterPickerSongs(songs, { serviceType, category = ALL_CATEGORIES, query = '' } = {}) {
  const needle = lower(query);
  return songs.filter(
    (song) => songInServiceType(song, serviceType) && songInPickerCategory(song, serviceType, category) && (!needle || lower(song.title).includes(needle)),
  );
}

/**
 * The category buttons the picker shows for a service type, each with how many songs it would list for the search: All first, then the
 * picker's categories, then the church's own song categories that fit none of them, by name. A General song filed under the other service's
 * category (an Entrance hymn, seen from Praise & Worship) gets no button here: it is under All, and under its own button in the other tab.
 */
export function pickerPillsFor(songs, serviceType, { query = '' } = {}) {
  const type = serviceTypeOf(serviceType);
  const inType = filterPickerSongs(songs, { serviceType, query });
  const count = (id) => inType.filter((song) => songInPickerCategory(song, serviceType, id)).length;
  const defined = pickerCategoriesOf(serviceType);
  const covered = new Set(Object.values(PICKER_CATEGORIES).flatMap((categories) => categories.flatMap((category) => category.names)));
  const own = new Map();
  for (const song of songs) {
    if (!songInServiceType(song, serviceType)) continue;
    const name = String(song.category ?? '').trim();
    if (name && !covered.has(lower(name)) && !own.has(lower(name))) own.set(lower(name), name);
  }
  const extras = [...own.values()].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  return [
    { id: ALL_CATEGORIES, label: type?.allLabel ?? 'All songs', count: inType.length },
    ...defined.map((category) => ({ id: category.id, label: category.label, count: count(category.id) })),
    ...extras.map((name) => ({ id: name, label: name, count: count(name) })),
  ];
}

/** The label of a category button: a picker category's, the All label, or a song category's own name. */
export function pickerCategoryLabel(serviceType, categoryId) {
  if (!categoryId || categoryId === ALL_CATEGORIES) return serviceTypeOf(serviceType)?.allLabel ?? 'All songs';
  return pickerCategoryOf(serviceType, categoryId)?.label ?? String(categoryId);
}

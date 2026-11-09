// The Songs page's rules: the search, the scope, language and category filters, the counts, the sort orders, how many plans use a song, and
// the synced line. Pure, with no page and no network in them, so the tests run in Node. The songs come from the server (songs-list), which
// returns only the signed-in church's songs that are not removed.
import { parseKey } from './song-keys.js';
import { planTiming } from './plan-model.js';

export const LANGUAGES = ['English', 'Tagalog', 'Cebuano'];

/** The scope tabs. A song the laptop has filed as General appears under All Scopes only. */
export const SCOPES = [
  { value: 'All', label: 'All Scopes' },
  { value: 'MASS', label: 'Holy Mass' },
  { value: 'PRAISE_AND_WORSHIP', label: 'Praise & Worship' },
];

/** A song's scope as it reads on the page. */
export const scopeLabel = (scope) => SCOPES.find((s) => s.value === scope)?.label ?? 'General';

const LANGUAGE_BADGES = {
  English: { code: 'EN', tone: 'en' },
  Tagalog: { code: 'TL', tone: 'tl' },
  Cebuano: { code: 'CEB', tone: 'ceb' },
};

/** A language's short code and colour, or null for a language the page has no badge for. */
export const languageBadge = (language) => LANGUAGE_BADGES[language] ?? null;

/** The categories the church's songs use, sorted, with empty ones left out. */
export function categoriesOf(songs) {
  return [...new Set(songs.map((s) => s.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** The songs that match the search (title only), the scope, the language and the category. A search with spaces matches the whole phrase. */
export function filterSongs(songs, { q = '', scope = 'All', language = 'All', category = 'All' } = {}) {
  const needle = q.trim().toLowerCase();
  return songs.filter((s) =>
    (scope === 'All' || s.scope === scope)
    && (language === 'All' || s.language === language)
    && (category === 'All' || s.category === category)
    && (!needle || s.title.toLowerCase().includes(needle)));
}

/** The category chips a scope offers: only the categories its own songs use. */
export const categoriesInScope = (songs, scope = 'All') => categoriesOf(filterSongs(songs, { scope }));

/** How many songs each category chip would list, following the search, the language and the scope. */
export function countsFor(songs, { q = '', language = 'All', scope = 'All' } = {}) {
  const base = filterSongs(songs, { q, language, scope });
  const counts = { All: base.length };
  for (const category of categoriesInScope(songs, scope)) counts[category] = base.filter((s) => s.category === category).length;
  return counts;
}

/** How many songs each scope tab would list, following the search and the language. */
export function scopeCounts(songs, { q = '', language = 'All' } = {}) {
  return Object.fromEntries(SCOPES.map(({ value }) => [value, filterSongs(songs, { q, language, scope: value }).length]));
}

const LETTERS = 'ABCDEFG';
const NO_KEY = Number.MAX_SAFE_INTEGER;

/** Where a key falls from A to G: Ab, A, A#, Bb and so on, a major key before its minor. A song with no readable key goes last. */
export function keyRank(key) {
  const parsed = parseKey(key);
  if (!parsed) return NO_KEY;
  const text = String(key).trim();
  const mark = text.slice(1).trimStart()[0];
  const accidental = mark === '#' || mark === '♯' ? 2 : mark === 'b' || mark === '♭' ? 0 : 1;
  return LETTERS.indexOf(text[0].toUpperCase()) * 6 + accidental * 2 + (parsed.minor ? 1 : 0);
}

const byTitle = (a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }) || String(a.id).localeCompare(String(b.id));
export const DEFAULT_SONG_SORT = 'title-asc';

/** A sorted copy of the songs. `usedIn(song)` is how many plans use a song. An order this does not know is A to Z. */
export function sortSongs(songs, order = DEFAULT_SONG_SORT, usedIn = () => 0) {
  const compare = {
    'key-asc': (a, b) => keyRank(a.key) - keyRank(b.key) || byTitle(a, b),
    'used-desc': (a, b) => usedIn(b) - usedIn(a) || byTitle(a, b),
  }[order] ?? byTitle;
  return [...songs].sort(compare);
}

/**
 * The plans still to be sung: those dated today or later, soonest first. There is no draft state on a plan, so this is what "active" means on the
 * Songs page, for the counters, the drawer and Add to plan alike. The server's list has already left deleted plans out.
 */
export function activePlans(plans, today) {
  return plans
    .filter((plan) => planTiming(plan.liturgical_date, today) === 'upcoming')
    .sort((a, b) => a.liturgical_date.localeCompare(b.liturgical_date) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

/** Each song's id with the plans from `plans` that use it, in the order of `plans`. A plan not in `plans` is left out. */
export function plansBySong(usage, plans) {
  const order = new Map(plans.map((plan, index) => [plan.id, index]));
  return new Map(Object.entries(usage).map(([songId, planIds]) => [
    songId,
    planIds.filter((id) => order.has(id)).sort((a, b) => order.get(a) - order.get(b)).map((id) => plans[order.get(id)]),
  ]));
}

/** The counter on a song's row. */
export const usedLabel = (count) => `Used in ${count} plan${count === 1 ? '' : 's'}`;

/** The synced line: the server's last song update, shown in this computer's own time. Never a fixed string. */
export function syncedText(lastUpdatedAt) {
  if (!lastUpdatedAt) return 'No songs synced yet';
  const when = new Date(lastUpdatedAt);
  if (Number.isNaN(when.getTime())) return 'No songs synced yet';
  return `Synced ${when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
}

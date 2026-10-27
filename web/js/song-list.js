// The Songs page's rules: the search, the language and category filters, the category counts, and the synced line. Pure, with no page
// and no network in them, so the tests run in Node. The songs come from the server (songs-list), which returns only the signed-in
// church's songs that are not removed.

export const LANGUAGES = ['English', 'Tagalog', 'Cebuano'];

/** The categories the church's songs use, sorted, with empty ones left out. */
export function categoriesOf(songs) {
  return [...new Set(songs.map((s) => s.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** The songs that match the search (title only), the language and the category. A search with spaces matches the whole phrase. */
export function filterSongs(songs, { q = '', language = 'All', category = 'All' } = {}) {
  const needle = q.trim().toLowerCase();
  return songs.filter((s) =>
    (language === 'All' || s.language === language)
    && (category === 'All' || s.category === category)
    && (!needle || s.title.toLowerCase().includes(needle)));
}

/** How many songs each category chip would list, following the search and the language, as the page always has. */
export function countsFor(songs, { q = '', language = 'All' } = {}) {
  const base = filterSongs(songs, { q, language });
  const counts = { All: base.length };
  for (const category of categoriesOf(songs)) counts[category] = base.filter((s) => s.category === category).length;
  return counts;
}

/** The synced line: the server's last song update, shown in this computer's own time. Never a fixed string. */
export function syncedText(lastUpdatedAt) {
  if (!lastUpdatedAt) return 'No songs synced yet';
  const when = new Date(lastUpdatedAt);
  if (Number.isNaN(when.getTime())) return 'No songs synced yet';
  return `Synced ${when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
}

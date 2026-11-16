// Marking a search term inside a line of text, for the Library's lyrics preview. Plain JS, so the tests run it under node.

/**
 * `text` cut into parts, each `{ text, match }`, where `match` marks every place the search `query` occurs (letter case aside). The
 * Library search matches the whole phrase typed, so the whole phrase is marked, not its words one by one. A blank query marks nothing.
 * Joining the parts' text always gives back `text` unchanged.
 */
export function highlightParts(text, query) {
  const source = String(text ?? '');
  const term = String(query ?? '').trim();
  if (!term || !source) return source ? [{ text: source, match: false }] : [];
  const lower = source.toLowerCase();
  const needle = term.toLowerCase();
  const parts = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) {
    if (at > from) parts.push({ text: source.slice(from, at), match: false });
    parts.push({ text: source.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
  if (from < source.length) parts.push({ text: source.slice(from), match: false });
  return parts;
}

// A prayer's saved split, and the slides a prayer shows in the lineup. The split is saved with the prayer in Notes & Prayers.
// It records a fingerprint of the text it was made for, so a split made for text that has since changed is not used.


/**
 * A prayer's split: null (one slide), `{ mode: 'auto' }` (the fit check places the breaks), or `{ mode: 'manual', at }` where `at`
 * lists the lines a break follows, counted from 0. `of` is the fingerprint of the text the split was made for.
 * Anything out of range is dropped, so a stored split never points past the text.
 */
export function normalizeSplit(split, body) {
  if (!split || typeof split !== 'object') return null;
  const of = typeof split.of === 'string' ? { of: split.of } : {};
  if (split.mode === 'auto') return { mode: 'auto', ...of };
  if (split.mode !== 'manual') return null;
  const lastBreak = String(body ?? '').split('\n').length - 2;
  const at = [...new Set((Array.isArray(split.at) ? split.at : []).map(Number))]
    .filter((k) => Number.isInteger(k) && k >= 0 && k <= lastBreak)
    .sort((a, b) => a - b);
  return { mode: 'manual', at, ...of };
}

/** The slides a manual split makes: the lines between the breaks, in order. Blank lines at a part's edges are dropped; a part with no text is dropped. */
export function manualParts(body, at) {
  const lines = String(body ?? '').split('\n');
  const cuts = [-1, ...at, lines.length - 1];
  const parts = [];
  for (let i = 0; i < cuts.length - 1; i += 1) {
    const part = lines.slice(cuts[i] + 1, cuts[i + 1] + 1);
    while (part.length && !part[0].trim()) part.shift();
    while (part.length && !part[part.length - 1].trim()) part.pop();
    if (part.length) parts.push(part.join('\n'));
  }
  return parts;
}

/** A short fingerprint (FNV-1a, 32 bits) of a prayer's text. The same text always gives the same fingerprint. */
export function splitFingerprint(body) {
  let hash = 0x811c9dc5;
  for (const ch of String(body ?? '')) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * The split as it is stored: the fingerprint of the text is added when the split is new (it has none yet). A split that already
 * carries a fingerprint keeps it, so a split made for older text stays out of date when the text changes.
 */
export function stampSplit(split, body) {
  const normalized = normalizeSplit(split, body);
  if (!normalized) return null;
  return normalized.of ? normalized : { ...normalized, of: splitFingerprint(body) };
}

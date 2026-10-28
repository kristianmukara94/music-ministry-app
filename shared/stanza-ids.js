// Keeps a song's stanza ids when the song is edited. A Praise & Worship arrangement names its stanzas by id, so an id must follow its
// stanza through an edit. Only a stanza with no counterpart gets a new id, and only a stanza the edit removed loses its id.

/**
 * The id each new stanza keeps, in the new order: `oldStanzas` and `newStanzas` are the song's stanzas before and after the edit, each
 * `{ id, lyricsText }` in song order. Returns one id per new stanza, or null for a stanza that is new. Three passes, in order:
 * 1. a stanza whose text is unchanged, at the same position, keeps its id;
 * 2. a stanza whose text is unchanged, but has moved, keeps the id of the nearest matching stanza;
 * 3. a stanza whose text was edited keeps the id of the stanza at its position, if that one is still unmatched.
 */
export function matchStanzaIds(oldStanzas, newStanzas) {
  const result = newStanzas.map(() => null);
  const claimed = new Set();
  const claim = (i, o) => {
    result[i] = o.id;
    claimed.add(o.id);
  };

  newStanzas.forEach((s, i) => {
    const o = oldStanzas[i];
    if (o && !claimed.has(o.id) && o.lyricsText === s.lyricsText) claim(i, o);
  });

  newStanzas.forEach((s, i) => {
    if (result[i] !== null) return;
    let best = null;
    oldStanzas.forEach((o, j) => {
      if (claimed.has(o.id) || o.lyricsText !== s.lyricsText) return;
      if (best === null || Math.abs(j - i) < Math.abs(best.j - i)) best = { o, j };
    });
    if (best) claim(i, best.o);
  });

  newStanzas.forEach((_s, i) => {
    if (result[i] !== null) return;
    const o = oldStanzas[i];
    if (o && !claimed.has(o.id)) claim(i, o);
  });

  return result;
}

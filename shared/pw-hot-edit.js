// Editing the Praise & Worship lineup's songs while the lineup is on air. A lineup slide is one page of one stanza (its `sectionId` is the
// stanza's id), and a card may sing its song's stanzas in its own order (the arrangement). These rules find the stanza behind a slide, place a
// new stanza in the card's order, and find the new stanza's slide once the deck is rebuilt. Pure, so the tests run them under Node.

/** The lyric slide at `index` in a segment's steps, or null for a title card, a prayer, a reading or the end-of-segment black. */
export function lyricAt(steps, index) {
  const step = steps[index];
  return step?.kind === 'slide' && step.slide.kind === 'lyrics' ? step.slide : null;
}

/**
 * Which time this slide's stanza is sung, counting from 1, among the song's appearances of that stanza up to and including this slide. A
 * chorus sung three times is the 1st, 2nd or 3rd. Only a stanza's first page counts, so a stanza split over two pages counts once.
 */
export function occurrenceOf(steps, index) {
  const here = lyricAt(steps, index);
  if (!here) return 0;
  let n = 0;
  for (let i = 0; i <= index; i += 1) {
    const s = lyricAt(steps, i);
    if (s && s.hymnId === here.hymnId && s.sectionId === here.sectionId && (s.part ?? 0) === 0) n += 1;
  }
  // A slide that is the second page of its stanza still belongs to the appearance that began before it.
  return Math.max(1, n);
}

/**
 * The card's arrangement with a new stanza placed straight after this appearance of `afterSectionId`. A card that sings the song in its
 * stored order has no arrangement for it: the new stanza already sits after this one in the song, so nothing changes, and the same object
 * comes back.
 */
export function arrangementWithInsert(arrangement, hymnId, afterSectionId, occurrence, newSectionId) {
  const key = String(hymnId);
  const order = arrangement?.[key];
  if (!Array.isArray(order) || order.length === 0) return arrangement;
  let seen = 0;
  let at = -1;
  for (let i = 0; i < order.length; i += 1) {
    if (order[i] !== String(afterSectionId)) continue;
    seen += 1;
    if (seen === occurrence) {
      at = i;
      break;
    }
  }
  // An appearance the order no longer has (it was changed meanwhile) puts the new stanza at the end, so it is never lost.
  const next = at < 0 ? [...order, String(newSectionId)] : [...order.slice(0, at + 1), String(newSectionId), ...order.slice(at + 1)];
  return { ...arrangement, [key]: next };
}

/**
 * The card's arrangement with this appearance of a stanza taken out, for Delete slide on a song's slide. Only the card's order changes: the
 * song keeps the stanza. A card that sings the song in its stored order gets an order of its own, the stored one without this appearance.
 * Null when the stanza is not in the order, or when it is the song's last one on the card (an empty order would mean "sing them all").
 */
export function arrangementWithout(arrangement, hymn, sectionId, occurrence) {
  const ids = hymn.stanzas.map((s) => String(s.id));
  const own = arrangement?.[String(hymn.id)];
  const listed = Array.isArray(own) ? own.filter((id) => ids.includes(id)) : [];
  const order = listed.length ? listed : ids;
  let seen = 0;
  const at = order.findIndex((id) => id === String(sectionId) && ++seen === Math.max(1, occurrence));
  if (at < 0 || order.length <= 1) return null;
  return { ...(arrangement ?? {}), [String(hymn.id)]: [...order.slice(0, at), ...order.slice(at + 1)] };
}

/** `pages` without page `index`. Null when there is no such page, or it is the only one: an item keeps at least one slide. */
export function pagesWithout(pages, index) {
  if (pages.length <= 1 || index < 0 || index >= pages.length) return null;
  return pages.filter((_, i) => i !== index);
}

/**
 * The slide to show once the slides from `at` were taken out and `remaining` slides are left: the one that moved up into `at` (the next
 * slide), or the new last slide when the last one went.
 */
export function slideAfterDelete(at, remaining) {
  if (remaining <= 0) return 0;
  return Math.max(0, Math.min(at, remaining - 1));
}

/** The step of a stanza's first page, searching from `from` onward, or null when it is not in the deck. */
export function findStanzaStep(steps, hymnId, sectionId, from = 0) {
  for (let i = Math.max(0, from); i < steps.length; i += 1) {
    const s = lyricAt(steps, i);
    if (s && s.hymnId === hymnId && s.sectionId === String(sectionId) && (s.part ?? 0) === 0) return i;
  }
  return null;
}

/**
 * A stanza's words cut into two halves of about the same length, for a stanza too long for one slide. A blank line near the middle is the
 * cut when there is one (it is where the stanza already breaks); otherwise the cut is at the middle line, with the extra line in the first
 * half. Null when there are fewer than two lines of words, which cannot be split.
 */
export function splitAtMidpoint(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const words = lines.filter((l) => l.trim()).length;
  if (words < 2) return null;
  const middle = lines.length / 2;
  // The blank line nearest the middle, when it leaves words on both sides.
  let blank = -1;
  lines.forEach((l, i) => {
    if (l.trim() || i === 0 || i === lines.length - 1) return;
    if (blank < 0 || Math.abs(i - middle) < Math.abs(blank - middle)) blank = i;
  });
  const clean = (part) => part.join('\n').replace(/^\s*\n|\n\s*$/g, '').trim();
  if (blank > 0 && Math.abs(blank - middle) <= lines.length / 4) return [clean(lines.slice(0, blank)), clean(lines.slice(blank + 1))];
  const cut = Math.ceil(lines.length / 2);
  return [clean(lines.slice(0, cut)), clean(lines.slice(cut))];
}

/**
 * A card's arrangement after one of its song's stanzas was split in two: the second half's id follows every appearance of the first half's.
 * The same object comes back when the card does not list that stanza, so nothing is saved for it.
 */
export function arrangementWithSplit(arrangement, hymnId, firstId, secondId) {
  const key = String(hymnId);
  const order = arrangement?.[key];
  if (!Array.isArray(order) || !order.includes(String(firstId))) return arrangement;
  return { ...arrangement, [key]: order.flatMap((id) => (id === String(firstId) ? [id, String(secondId)] : [id])) };
}

// The song data the planners keep after it is loaded, and how a change to a song updates it. Plain JS with no React, so the
// Praise & Worship store, the Mass planner and the tests all run the same rules.

/** The song to keep after a change: the fresh hymn, or nothing when it is deleted or gone from the library. */
export function hymnAfterChange(hymn) {
  return hymn && !hymn.deletedAt ? hymn : null;
}

/** A new cache with one song replaced, or removed when it is no longer in the library. The old cache is not changed. */
export function withHymn(cache, id, hymn) {
  const next = { ...cache };
  if (hymn) next[id] = hymn;
  else delete next[id];
  return next;
}

/** Whether any song slot in the lineup uses this song. */
export function usesHymn(segments, id) {
  return segments.some((s) => (s.content.hymnIds ?? []).includes(id));
}

/**
 * A Mass plan's rows as they should read now. A lyrics row shows the song's title and deleted state from the library, not the
 * title saved with the plan. The saved plan is not changed. Other rows, and a song not yet read from the library, keep what they have.
 */
export function overlayLyricsItems(items, now) {
  return items.map((item) => {
    if (item.module !== 'lyrics') return item;
    const fresh = now[Number(item.sourceId)];
    if (!fresh) return item;
    return { ...item, label: fresh.title ?? item.label, stale: item.stale || fresh.deleted, deleted: item.deleted || fresh.deleted };
  });
}

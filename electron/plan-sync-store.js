// The laptop's side of plan sync: reads the plans waiting to be sent, and writes what the server sent back. The decisions (what
// wins, what waits, what is sent) live in plan-sync.js; this file only reads and writes.
//
// Each plan carries two stamps. server_updated_at is the server's version the plan was last in step with. synced_updated_at is the
// laptop's updated_at at that point. A plan is dirty when updated_at has moved on from synced_updated_at.
//
// Writes that come from the server run with the transfer import guard on, so the touch triggers do not count them as laptop edits.
// A plan is held only when a server item has a value the laptop cannot map at all (today: a reading whose name it does not know, or
// a song the laptop does not have). A held plan is not sent, because a send would drop the item. Every held item is counted.
import { DEFAULT_TEMPLATE } from '../shared/pw.js';
import { MASS_PARTS, MASS_STEP_PARTS } from '../shared/mass-parts.js';
import {
  massEntries, massBody, mergeEntries, praiseBody, praiseEntries, PRAISE_READING_TYPES, READING_TYPES, WEB_NOTE_PREFIX,
} from './plan-sync-map.js';

const GUARD = 'transfer_import_guard';
const CURSOR = 'plans_cursor';
const LAPTOP_BLOCKS = ['introductory', 'word', 'eucharist', 'communion', 'concluding'];
const SEGMENT_TYPE = { song: 'song', reading: 'scripture', rite: 'prayer' };
const DEFAULT_GROUP_NAMES = Object.fromEntries(DEFAULT_TEMPLATE.groups.map((g) => [g.key, g.name]));
const DEFAULT_SEGMENT_NAMES = Object.fromEntries(DEFAULT_TEMPLATE.segments.map((s) => [s.key, s.name]));
export const HOLD_MESSAGE = 'Some items in this plan cannot be shown on this laptop yet, so the plan is not sent.';

const holdKey = (uuid) => `hold:${uuid}`;

/**
 * The laptop item for a Mass item from the web, or null when there is none. The rules, in order:
 * a song from the church list is a song; a reading is a reading when its name is known; a Mass part step with no song is that part;
 * any other typed text or note is kept as a web note, so it is not lost.
 */
export function massRowFrom(item, date, hymnByUuid) {
  if (item.kind === 'song' && item.songId) {
    const hymn = hymnByUuid(item.songId);
    return hymn && LAPTOP_BLOCKS.includes(item.group) ? { block: item.group, module: 'lyrics', sourceId: String(hymn.id), label: hymn.title } : null;
  }
  if (!LAPTOP_BLOCKS.includes(item.group)) return null;
  if (item.kind === 'reading') {
    return READING_TYPES.includes(item.text) ? { block: item.group, module: 'lectionary', sourceId: `${date}|${item.text}`, label: item.text } : null;
  }
  // A part step with a note keeps the note as its label. The web step key still says which part it is, so no part name is added,
  // and the label does not change each time it goes round.
  const part = MASS_STEP_PARTS[item.key];
  const note = typeof item.note === 'string' ? item.note.trim() : '';
  if (part && !note) return { block: item.group, module: 'mass_order', sourceId: part, label: MASS_PARTS[part] };
  const text = note || (typeof item.text === 'string' ? item.text.trim() : '');
  return text ? { block: item.group, module: 'custom', sourceId: `${WEB_NOTE_PREFIX}${item.key}`, label: text } : null;
}

/** Whether a laptop row already is this Mass item, so the row is kept as it is rather than rewritten. */
export function sameMassRow(row, item, date, hymnByUuid) {
  const fresh = massRowFrom(item, date, hymnByUuid);
  if (!fresh || fresh.block !== row.block || fresh.module !== row.module || fresh.sourceId !== row.sourceId) return false;
  return row.module !== 'custom' || fresh.label === row.label;
}

/** The praise segment's laptop fields for a new praise item from the server, or null when there is none to make. */
export function praiseRowFrom(item, hymnByUuid) {
  if (item.kind === 'song') return !item.songId || hymnByUuid(item.songId) ? { id: null } : null;
  if (item.kind === 'reading') return !item.text || PRAISE_READING_TYPES.includes(item.text) ? { id: null } : null;
  // A prayer is a prayer segment with no note chosen, which the web also makes.
  return { id: null };
}

export function createPlanSyncStore(db) {
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);

  /** Runs a write with the touch triggers off, in one transaction. */
  const quiet = (work) =>
    db.transaction(() => {
      run(`INSERT INTO ${GUARD} (active) VALUES (1)`);
      try {
        return work();
      } finally {
        run(`DELETE FROM ${GUARD}`);
      }
    })();

  const hymnUuidOf = (id) => one('SELECT uuid FROM hymns WHERE id = ?', Number(id))?.uuid ?? null;
  const hymnByUuid = (uuid) => one('SELECT id, title FROM hymns WHERE uuid = ?', uuid) ?? null;

  const massRows = (planId) =>
    all(`SELECT liturgical_block AS block, source_module AS module, source_id AS sourceId, label, display_order AS "order"
         FROM mass_plan_items WHERE plan_id = ? ORDER BY display_order`, planId);

  const segmentRows = (sessionId) =>
    all(`SELECT id, segment_key AS key, group_key AS "group", name, type, minutes, leader, content_ref AS contentRef,
           arrangement, cues, notes, display_order AS "order"
         FROM pw_segments WHERE session_id = ? ORDER BY display_order`, sessionId).map((r) => ({ ...r, content: parseJson(r.contentRef) }));

  function planByUuid(uuid) {
    const cols = 'id, name, liturgical_date AS date, uuid, updated_at, server_updated_at, synced_updated_at';
    const mass = one(`SELECT ${cols} FROM mass_plans WHERE uuid = ?`, uuid);
    if (mass) return { ...mass, kind: 'mass' };
    const praise = one(`SELECT ${cols} FROM pw_sessions WHERE uuid = ?`, uuid);
    return praise ? { ...praise, kind: 'praise' } : null;
  }

  // ---- What the engine reads ----

  /** The plans whose laptop copy has changed since the last sync. Only plans with a uuid are synced. */
  function dirtyPlans() {
    const uuids = [
      ...all('SELECT uuid FROM mass_plans WHERE uuid IS NOT NULL AND (synced_updated_at IS NULL OR synced_updated_at <> updated_at)'),
      ...all('SELECT uuid FROM pw_sessions WHERE uuid IS NOT NULL AND (synced_updated_at IS NULL OR synced_updated_at <> updated_at)'),
    ];
    return uuids.map((r) => planByUuid(r.uuid));
  }

  /** The body the server takes for a plan. Throws MapRefused if a plan has something that cannot be sent. */
  function payloadFor(plan) {
    const head = { id: plan.uuid, name: plan.name, date: plan.date };
    if (plan.kind === 'mass') return { ...head, kind: 'mass', items: massBody(massEntries(massRows(plan.id), hymnUuidOf)).items };
    return { ...head, kind: 'pw', items: praiseBody(praiseEntries(segmentRows(plan.id), hymnUuidOf)).items };
  }

  const cursor = () => one('SELECT value FROM sync_state WHERE key = ?', CURSOR)?.value ?? null;
  const setCursor = (value) => run('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', CURSOR, value);

  const tombstones = () => all('SELECT uuid, plan_kind AS kind FROM sync_tombstones');
  const hasTombstone = (uuid) => one('SELECT 1 AS found FROM sync_tombstones WHERE uuid = ?', uuid) !== undefined;
  const clearTombstone = (uuid) => run('DELETE FROM sync_tombstones WHERE uuid = ?', uuid);

  const holdOf = (uuid) => one('SELECT value FROM sync_state WHERE key = ?', holdKey(uuid))?.value ?? null;
  const setHold = (uuid, count) => run('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', holdKey(uuid), `${count}`);
  const clearHold = (uuid) => run('DELETE FROM sync_state WHERE key = ?', holdKey(uuid));
  const holdCount = () => one("SELECT COUNT(*) AS n FROM sync_state WHERE key LIKE 'hold:%'").n;

  // ---- What the engine writes ----

  /** Records that a plan is in step with the server: its server version, and the laptop stamp it was sent or applied with. */
  function markSynced(uuid, serverUpdatedAt, stamp) {
    quiet(() => {
      run('UPDATE mass_plans SET server_updated_at = ?, synced_updated_at = ? WHERE uuid = ?', serverUpdatedAt, stamp, uuid);
      run('UPDATE pw_sessions SET server_updated_at = ?, synced_updated_at = ? WHERE uuid = ?', serverUpdatedAt, stamp, uuid);
    });
  }

  /** A laptop edit is newer than the server's: keep it, and remember the server version it must be sent against. */
  function setServerStamp(uuid, serverUpdatedAt) {
    quiet(() => {
      run('UPDATE mass_plans SET server_updated_at = ? WHERE uuid = ?', serverUpdatedAt, uuid);
      run('UPDATE pw_sessions SET server_updated_at = ? WHERE uuid = ?', serverUpdatedAt, uuid);
    });
  }

  /** Removes a plan the server has deleted. No tombstone: the delete came from the server. */
  function removeByUuid(uuid) {
    quiet(() => {
      const plan = planByUuid(uuid);
      if (plan?.kind === 'mass') run('DELETE FROM mass_plans WHERE id = ?', plan.id);
      if (plan?.kind === 'praise') run('DELETE FROM pw_sessions WHERE id = ?', plan.id);
      clearHold(uuid);
    });
  }

  /**
   * Writes the server's version of a plan: creates it, or overwrites the laptop copy. Returns how many of its items could not be
   * placed. A plan with any is held until a later server version places them all.
   */
  function applyServer(serverPlan) {
    const unresolved = quiet(() => (serverPlan.kind === 'mass' ? applyMass(serverPlan) : applyPraise(serverPlan)));
    if (unresolved > 0) setHold(serverPlan.id, unresolved);
    else clearHold(serverPlan.id);
    return { unresolved };
  }

  // ---- Mass plans ----

  function applyMass(sp) {
    const local = planByUuid(sp.id);
    if (local && local.kind !== 'mass') throw new Error('plan kind mismatch');
    let id;
    if (local) {
      id = local.id;
      run('UPDATE mass_plans SET name = ?, liturgical_date = ?, updated_at = ? WHERE id = ?', sp.name, sp.date, sp.updatedAt, id);
    } else {
      id = Number(run('INSERT INTO mass_plans (name, liturgical_date, uuid, updated_at) VALUES (?, ?, ?, ?)', sp.name, sp.date, sp.id, sp.updatedAt).lastInsertRowid);
    }
    const localEntries = massEntries(massRows(id), hymnUuidOf);
    const byKey = new Map(localEntries.map((e) => [e.key, e]));
    const resolve = (item) => {
      const kept = byKey.get(item.key);
      if (kept && sameMassRow(kept.row, item, sp.date, hymnByUuid)) return kept.row;
      return massRowFrom(item, sp.date, hymnByUuid);
    };
    const { entries, unresolved } = mergeEntries(localEntries, sp.items, resolve);
    run('DELETE FROM mass_plan_items WHERE plan_id = ?', id);
    entries.forEach((e, i) => {
      run(
        'INSERT INTO mass_plan_items (plan_id, liturgical_block, source_module, source_id, label, display_order) VALUES (?, ?, ?, ?, ?, ?)',
        id, e.row.block, e.row.module, e.row.sourceId, e.row.label, i + 1,
      );
    });
    run('UPDATE mass_plans SET server_updated_at = ?, synced_updated_at = ? WHERE id = ?', sp.updatedAt, sp.updatedAt, id);
    return unresolved.length;
  }

  // ---- Praise & Worship plans ----

  /** A praise item matches a kept segment when it is the same kind of thing: a song, a reading, a title, or a prayer. */
  function praiseItemFits(row, item) {
    if (item.kind === 'song') return row.content?.kind === 'song' && (!item.songId || hymnByUuid(item.songId) !== null);
    if (item.kind === 'reading') return row.content?.kind === 'lectionary' || row.content?.kind === 'title';
    return row.type === 'prayer';
  }

  /** The segment's content as the server's items describe it. Local content is kept where the server says nothing new. */
  function contentFor(row, items) {
    const first = items[0];
    if (first.kind === 'song') {
      const hymnIds = items.map((i) => (i.songId ? hymnByUuid(i.songId)?.id : null)).filter((id) => id !== null && id !== undefined);
      const local = row?.content?.kind === 'song' ? row.content : {};
      return { kind: 'song', hymnIds, maxSongs: Math.max(local.maxSongs ?? 1, hymnIds.length, 1), category: local.category ?? null };
    }
    if (first.kind === 'reading') return first.text ? { kind: 'lectionary', readingType: first.text } : { kind: 'title' };
    return row?.content ?? { kind: 'prayer', noteId: null };
  }

  /** A new segment's name: the template's name for its key when there is one, so a web prayer reads as the web names it. */
  function nameFor(row, items) {
    if (row?.id) return row.name;
    const first = items[0];
    const templated = DEFAULT_SEGMENT_NAMES[first.key];
    if (templated) return templated;
    if (first.kind === 'song') return (first.songId && hymnByUuid(first.songId)?.title) || 'Song';
    if (first.kind === 'reading') return first.text || 'Scripture';
    return 'Prayer';
  }

  /** Adds any group the server's items use that the session does not have yet, with its default name. */
  function groupsWith(current, items) {
    const groups = [...current];
    for (const item of items) {
      if (!groups.some((g) => g.key === item.group)) groups.push({ key: item.group, name: DEFAULT_GROUP_NAMES[item.group] ?? item.group });
    }
    return groups;
  }

  function applyPraise(sp) {
    const local = planByUuid(sp.id);
    if (local && local.kind !== 'praise') throw new Error('plan kind mismatch');
    let id;
    if (local) {
      id = local.id;
      const current = JSON.parse(one('SELECT groups FROM pw_sessions WHERE id = ?', id).groups);
      run('UPDATE pw_sessions SET name = ?, liturgical_date = ?, groups = ?, updated_at = ? WHERE id = ?',
        sp.name, sp.date, JSON.stringify(groupsWith(current, sp.items)), sp.updatedAt, id);
    } else {
      id = Number(run('INSERT INTO pw_sessions (name, liturgical_date, groups, uuid, updated_at) VALUES (?, ?, ?, ?, ?)',
        sp.name, sp.date, JSON.stringify(groupsWith([], sp.items)), sp.id, sp.updatedAt).lastInsertRowid);
    }
    const localEntries = praiseEntries(segmentRows(id), hymnUuidOf);
    const byKey = new Map(localEntries.map((e) => [e.key, e]));
    const resolve = (item) => {
      const kept = byKey.get(item.key);
      if (kept && praiseItemFits(kept.row, item)) return kept.row;
      return praiseRowFrom(item, hymnByUuid);
    };
    const { entries, unresolved } = mergeEntries(localEntries, sp.items, resolve);
    // A segment that several server items point at (a segment with several songs) is written once, with all its songs.
    const bySegment = new Map();
    for (const e of entries) {
      if (!bySegment.has(e.row)) bySegment.set(e.row, { row: e.row, items: [] });
      if (e.synced) bySegment.get(e.row).items.push(e.item);
    }
    run('DELETE FROM pw_segments WHERE session_id = ?', id);
    let order = 0;
    for (const { row, items } of bySegment.values()) {
      order += 1;
      const owned = Boolean(row.id);
      const kept = items.length === 0;
      const values = kept
        ? { key: row.key, group: row.group, name: row.name, type: row.type, minutes: row.minutes, content: row.content,
            leader: row.leader, arrangement: row.arrangement, cues: row.cues, notes: row.notes }
        : { key: owned ? row.key : items[0].key,
            group: items[0].group,
            name: owned ? row.name : nameFor(row, items),
            type: SEGMENT_TYPE[items[0].kind],
            minutes: items[0].minutes ?? 0,
            content: contentFor(row, items),
            leader: owned ? row.leader : '',
            arrangement: owned ? row.arrangement : '{}',
            cues: owned ? row.cues : '{}',
            // Notes are local-only. A segment the laptop already has keeps its own notes, and a web note never overwrites them.
            // A segment new to the laptop starts with the web's note, which then stays here and is not sent back.
            notes: owned ? row.notes : (items[0].note ?? '') };
      run(
        `INSERT INTO pw_segments (session_id, display_order, segment_key, group_key, name, type, minutes, leader, content_ref, arrangement, cues, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, order, values.key, values.group, values.name, values.type, values.minutes, values.leader,
        JSON.stringify(values.content), values.arrangement, values.cues, values.notes,
      );
    }
    run('UPDATE pw_sessions SET server_updated_at = ?, synced_updated_at = ? WHERE id = ?', sp.updatedAt, sp.updatedAt, id);
    return unresolved.length;
  }

  return {
    planByUuid, dirtyPlans, payloadFor, cursor, setCursor, tombstones, hasTombstone, clearTombstone,
    holdOf, clearHold, holdCount, hold: setHold, markSynced, setServerStamp, removeByUuid, applyServer,
  };
}

function parseJson(text) {
  try {
    const parsed = JSON.parse(text ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

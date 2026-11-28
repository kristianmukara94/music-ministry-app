// The laptop's side of plan sync: reads the plans waiting to be sent, and writes what the server sent back. The decisions (what
// wins, what waits, what is sent) live in plan-sync.js; this file only reads and writes.
//
// Each plan carries two stamps. server_updated_at is the server's version the plan was last in step with. synced_updated_at is the
// laptop's updated_at at that point. A plan is dirty when updated_at has moved on from synced_updated_at.
//
// Writes that come from the server run with the transfer import guard on, so the touch triggers do not count them as laptop edits.
// A plan is held only when a server item has a value the laptop cannot map at all (today: a song the laptop does not have). A held plan
// is not sent, because a send would drop the item. Every held item is counted. A reading's words never hold a plan.
import crypto from 'node:crypto';
import { DEFAULT_TEMPLATE, splitCardBase } from '../shared/pw.js';
import { slotIdOfNumber } from '../shared/mass-slots.js';
import { MASS_PARTS, MASS_STEP_PARTS } from '../shared/mass-parts.js';
import { parseWebReference, sourceIdOf } from '../shared/bible-web-ref.js';
import { resolveBookCode } from '../shared/bible-ref.js';

/** The Holy Mass Order part a prayer title names, by the laptop's own name for the part. */
const PART_BY_LABEL = new Map(Object.entries(MASS_PARTS).map(([part, label]) => [label, part]));
import { noteSource } from '../shared/notes.js';
import { normalizeMassLanguage, normalizeMassTime } from '../shared/mass-schedule.js';
import {
  MapRefused, massEntries, massBody, mergeEntries, praiseBody, praiseEntries, READING_TYPES, WEB_NOTE_PREFIX, WEB_REFERENCE_PREFIX,
} from './plan-sync-map.js';
import { createWebHubNotes } from './web-hub-notes.js';
import { isPrayerItem, praiseCard } from './pw-prayer-sync.js';
import { prayerTitleKey, webPrayerOf } from '../shared/pw-web-prayers.js';
import { appearanceToSend, hasAppearanceColumn, pulledAppearance } from './plan-appearance-sync.js';

const GUARD = 'transfer_import_guard';
const CURSOR = 'plans_cursor';
const LAPTOP_BLOCKS = ['introductory', 'word', 'eucharist', 'communion', 'concluding'];
const DEFAULT_GROUP_NAMES = Object.fromEntries(DEFAULT_TEMPLATE.groups.map((g) => [g.key, g.name]));
const MAX_SEGMENT_NAME = 80;
const DEFAULT_SEGMENT_NAMES = Object.fromEntries(DEFAULT_TEMPLATE.segments.map((s) => [s.key, s.name]));
const DEFAULT_SEGMENT_CONTENT = Object.fromEntries(DEFAULT_TEMPLATE.segments.map((s) => [s.key, s.content]));
export const HOLD_MESSAGE = 'Some items in this plan cannot be shown on this laptop yet, so the plan is not sent.';

const holdKey = (uuid) => `hold:${uuid}`;
// What the website last held for each card of a Praise & Worship plan (see pw-prayer-sync.js): { read, cards: { <segment key>: memory } }.
// `read` says this plan has been read from the website by a version that assigns prayers.
const prayerKey = (uuid) => `pwcards:${uuid}`;

/** True for a real YYYY-MM-DD date. Compared back to the text, the same check the server makes, because 2026-02-31 would roll over to March. */
const isCalendarDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/**
 * The laptop item for a Mass item from the web, or null when there is none. The rules, in order:
 * a song from the church list is a song; a Content Hub entry the laptop has brought in is that note; a reading is a reading when its name is known, and
 * otherwise its reference is kept as words, whatever they are; a Mass part step with no song is that part; any other typed text or note is kept as a web note.
 * `noteIdOf(entryId)` finds the note brought in for a Content Hub entry.
 */
export function massRowFrom(item, date, hymnByUuid, noteIdOf = () => null, bibleSourceOf = () => null) {
  if (item.kind === 'song' && item.songId) {
    const hymn = hymnByUuid(item.songId);
    return hymn && LAPTOP_BLOCKS.includes(item.group) ? { block: item.group, module: 'lyrics', sourceId: String(hymn.id), label: hymn.title } : null;
  }
  if (!LAPTOP_BLOCKS.includes(item.group)) return null;
  const hubNote = item.contentHubId ? noteIdOf(item.contentHubId) : null;
  if (hubNote !== null) return { block: item.group, module: 'notes', sourceId: String(hubNote), label: item.title || item.text || 'Content Hub entry' };
  const typed = typeof item.text === 'string' ? item.text.trim() : '';
  // A prayer typed on the web by title. One that is a Holy Mass Order part is that part, shown from the laptop's own text; any other is kept as its title.
  if (item.contentType === 'prayer' && typed) {
    const part = PART_BY_LABEL.get(typed);
    if (part) return { block: item.group, module: 'mass_order', sourceId: part, label: MASS_PARTS[part] };
    return { block: item.group, module: 'custom', sourceId: `${WEB_REFERENCE_PREFIX}${item.key}`, label: typed };
  }
  if (item.kind === 'reading') {
    if (READING_TYPES.includes(item.text)) return { block: item.group, module: 'lectionary', sourceId: `${date}|${item.text}`, label: item.text };
    // A Scripture reference the web typed or built: the passage in the laptop's own Bible when it has it (its text then comes from there), else its words.
    const passage = item.contentType === 'scripture' && typed ? bibleSourceOf(typed) : null;
    if (passage) return { block: item.group, module: 'bible', sourceId: passage, label: typed };
    const label = String(item.text ?? '').trim() || String(item.note ?? '').trim() || 'Reading';
    return { block: item.group, module: 'custom', sourceId: `${WEB_REFERENCE_PREFIX}${item.key}`, label };
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
export function sameMassRow(row, item, date, hymnByUuid, noteIdOf = () => null, bibleSourceOf = () => null) {
  const fresh = massRowFrom(item, date, hymnByUuid, noteIdOf, bibleSourceOf);
  if (!fresh || fresh.block !== row.block || fresh.module !== row.module) return false;
  // A row that plays only some of a note's slides is still that note, so the operator's choice of slides stays.
  if (fresh.module === 'notes') return noteSource(row.sourceId)?.id === Number(fresh.sourceId);
  if (fresh.sourceId !== row.sourceId) return false;
  return row.module !== 'custom' || fresh.label === row.label;
}

/**
 * The segment a praise item belongs to. The website records the step on each item (slotId). An item without one says it in its key: a
 * segment's songs are numbered after the segment's key ("worship.1", "worship.2"), on the laptop and on the website alike.
 */
export function praiseSegmentKeyOf(item) {
  if (typeof item.slotId === 'string' && item.slotId !== '') return item.slotId;
  return String(item.key).replace(/(\.\d+)+$/, '');
}

/** The praise segment's laptop fields for a new praise item from the server, or null when there is none to make. */
export function praiseRowFrom(item, hymnByUuid) {
  if (item.kind === 'song') return !item.songId || hymnByUuid(item.songId) ? { id: null } : null;
  // A reading always has a place: one whose name the laptop does not know is a titled slot, named after its reference.
  if (item.kind === 'reading') return { id: null };
  // A prayer is a prayer segment with no note chosen, which the web also makes.
  return { id: null };
}

export function createPlanSyncStore(db, { onNoteChanged = () => {}, onPraiseChanged = () => {} } = {}) {
  const webHub = createWebHubNotes(db, { onChanged: onNoteChanged });
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

  // Whether this database keeps Holy Mass schedules (MASS_SCHEDULE_MIGRATIONS). A test database built from part of the migration list may not.
  const hasSchedule = one("SELECT COUNT(*) AS n FROM pragma_table_info('mass_plans') WHERE name IN ('mass_time', 'mass_language')").n === 2;
  const scheduleOf = (id) =>
    hasSchedule ? one("SELECT COALESCE(mass_time, '') AS massTime, COALESCE(mass_language, '') AS massLanguage FROM mass_plans WHERE id = ?", id) : null;

  // Whether each plan table keeps Plan Appearance (PLAN_APPEARANCE_MIGRATIONS). The look rides with the plan, both ways.
  const hasLook = { mass_plans: hasAppearanceColumn(db, 'mass_plans'), pw_sessions: hasAppearanceColumn(db, 'pw_sessions') };
  const lookOf = (table, id) => (hasLook[table] ? one(`SELECT appearance_json AS json FROM ${table} WHERE id = ?`, id)?.json ?? null : null);
  // A database with no Media Library table holds no pictures, so a pulled picture falls back to its colour.
  const hasMedia = (mediaId) => {
    try {
      return Boolean(one('SELECT 1 AS n FROM media_assets WHERE id = ?', Number(mediaId)));
    } catch {
      return false;
    }
  };
  /** Stores a pulled plan's look. Leaves the column alone for an older server or a plan the website never gave a look. */
  const applyLook = (table, id, incoming) => {
    if (!hasLook[table]) return;
    const next = pulledAppearance(incoming, lookOf(table, id), hasMedia);
    if (next !== undefined) run(`UPDATE ${table} SET appearance_json = ? WHERE id = ?`, next, id);
  };

  const hymnUuidOf = (id) => one('SELECT uuid FROM hymns WHERE id = ?', Number(id))?.uuid ?? null;
  const hymnByUuid = (uuid) => one('SELECT id, title FROM hymns WHERE uuid = ?', uuid) ?? null;
  // The laptop's own Bible row for a Scripture reference from the web, or null when the reference is not a passage this laptop's Bible has. The book is
  // found by its code in the translation, then the verses are checked to exist. Only the reference is looked up: no verse text is read or sent.
  const bibleSourceOf = (text) => {
    const ref = parseWebReference(text);
    const code = ref ? resolveBookCode(ref.book) : null;
    if (!ref || !code) return null;
    const translationId = ref.translationId ?? 'WEB';
    try {
      const book = one('SELECT name FROM bible_books WHERE translation_id = ? AND code = ?', translationId, code);
      if (!book) return null;
      const has = one(
        `SELECT 1 AS found FROM bible_verses v JOIN bible_books b ON b.translation_id = v.translation_id AND b.book_number = v.book_number
         WHERE v.translation_id = ? AND b.code = ? AND v.chapter = ? AND v.verse BETWEEN ? AND ? LIMIT 1`,
        translationId, code, ref.chapter, ref.from, ref.to,
      );
      return has ? sourceIdOf(ref, translationId, book.name) : null;
    } catch {
      return null;
    }
  };

  const massRows = (planId) =>
    all(`SELECT liturgical_block AS block, source_module AS module, source_id AS sourceId, label, display_order AS "order", slot
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

  const cardMemory = (uuid) => parseJson(one('SELECT value FROM sync_state WHERE key = ?', prayerKey(uuid))?.value);
  const setCardMemory = (uuid, memory) => run('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', prayerKey(uuid), JSON.stringify(memory));
  const clearCardMemory = (uuid) => run('DELETE FROM sync_state WHERE key = ?', prayerKey(uuid));
  // What the plan being sent now will leave on the website, kept once the website accepts it (markSynced).
  const sending = new Map();

  /**
   * The title the website knows a prayer note by, or null for a note of the laptop's own, whose title never leaves it. It is the title the
   * website sent when the note was assigned, else a title the website sent for this plan or has in its catalog (so Go Live's copy of a
   * prayer, or the parish's own note of a catalog prayer, goes by it).
   */
  function prayerTitles(uuid) {
    const pairs = Object.values(cardMemory(uuid).cards ?? {}).flatMap((card) => card.prayers ?? []);
    return (noteId) => {
      if (noteId === null || noteId === undefined) return null;
      const assigned = pairs.find(([, id]) => id === noteId);
      if (assigned) return assigned[0];
      const note = one('SELECT title FROM notes WHERE id = ?', Number(noteId));
      if (!note) return null;
      const seen = pairs.find(([title]) => prayerTitleKey(title) === prayerTitleKey(note.title));
      return seen?.[0] ?? webPrayerOf(note.title)?.title ?? null;
    };
  }

  /** What the website holds for each card once these entries are accepted. */
  function sentCards(uuid, entries, titleOf) {
    const before = cardMemory(uuid).cards ?? {};
    const cards = {};
    for (const e of entries.filter((x) => x.synced)) {
      const card = (cards[e.row.key] ??= { prayers: [], songs: [], bareHead: false });
      if (isPrayerItem(e.item)) {
        const content = e.row.content ?? {};
        const noteId = [content.noteId, ...(content.more ?? []).map((m) => m.noteId)].find((id) => id != null && titleOf(id) === e.item.text) ?? null;
        card.prayers.push([e.item.text, noteId]);
      } else if (e.row.type === 'prayer' && e.item.kind === 'rite' && e.key === e.row.key) card.bareHead = true;
      if (e.item.songId) card.songs.push(e.item.songId);
    }
    for (const [key, { bareHead, ...card }] of Object.entries(cards)) {
      // A first prayer sent with no title (the laptop's own, or taken off here) leaves the website's title where it is.
      const first = before[key]?.prayers?.[0];
      if (bareHead && first && !card.prayers.some(([title]) => title === first[0])) card.prayers.unshift([first[0], null]);
      cards[key] = card;
    }
    return cards;
  }

  /** The body the server takes for a plan. Throws MapRefused if a plan has something that cannot be sent. */
  function payloadFor(plan) {
    // A missing name has a plain default. A date has none, because a guess would move the plan to the wrong day, so such a plan stays here.
    if (!isCalendarDate(plan.date)) throw new MapRefused('This plan has no valid date. Open it and choose a date, and it will be sent.');
    const name = String(plan.name ?? '').replace(/\0/g, '').trim().slice(0, 120).trim() || 'Untitled Plan';
    const head = { id: plan.uuid, name, date: plan.date };
    if (plan.kind === 'mass') {
      // The Holy Mass time and language ride with the plan, so the website lists the day's Holy Masses as the laptop does. A server from before
      // schedules ignores them.
      const schedule = scheduleOf(plan.id);
      const items = massBody(massEntries(massRows(plan.id), hymnUuidOf, (noteId) => webHub.entryIdOf(plan.uuid, noteId))).items;
      const look = appearanceToSend(lookOf('mass_plans', plan.id), hasLook.mass_plans);
      return { ...head, kind: 'mass', ...(schedule ? { massTime: normalizeMassTime(schedule.massTime), massLanguage: normalizeMassLanguage(schedule.massLanguage) } : {}), ...(look ? { appearance: look } : {}), items };
    }
    const look = appearanceToSend(lookOf('pw_sessions', plan.id), hasLook.pw_sessions);
    const titleOf = prayerTitles(plan.uuid);
    const entries = praiseEntries(segmentRows(plan.id), hymnUuidOf, titleOf, (noteId) => webHub.entryIdOf(plan.uuid, noteId));
    sending.set(plan.uuid, sentCards(plan.uuid, entries, titleOf));
    return { ...head, kind: 'pw', ...(look ? { appearance: look } : {}), items: praiseBody(entries).items };
  }

  const cursor = () => one('SELECT value FROM sync_state WHERE key = ?', CURSOR)?.value ?? null;
  // A null cursor starts the next pull from the beginning (Force Push Plans).
  const setCursor = (value) =>
    value === null || value === undefined ? run('DELETE FROM sync_state WHERE key = ?', CURSOR) : run('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', CURSOR, value);

  const tombstones = () => all('SELECT uuid, plan_kind AS kind FROM sync_tombstones');
  const hasTombstone = (uuid) => one('SELECT 1 AS found FROM sync_tombstones WHERE uuid = ?', uuid) !== undefined;
  const clearTombstone = (uuid) => run('DELETE FROM sync_tombstones WHERE uuid = ?', uuid);

  const holdOf = (uuid) => one('SELECT value FROM sync_state WHERE key = ?', holdKey(uuid))?.value ?? null;
  const setHold = (uuid, count) => run('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', holdKey(uuid), `${count}`);
  const clearHold = (uuid) => run('DELETE FROM sync_state WHERE key = ?', holdKey(uuid));
  const holdCount = () => one("SELECT COUNT(*) AS n FROM sync_state WHERE key LIKE 'hold:%'").n;

  /**
   * The Praise & Worship plans to read from the website once more: pulled by a version that left a website prayer unassigned (an empty prayer
   * card, or a further item kept as a card of its own), never read since, and with no laptop edits waiting. A plan that still has a card of its
   * own for a further item ("worship.2", which no save accepted) is read once more by this version, which puts the item on its step's card.
   */
  function unreadPrayerPlans() {
    return all('SELECT id, uuid FROM pw_sessions WHERE uuid IS NOT NULL AND server_updated_at IS NOT NULL AND synced_updated_at = updated_at')
      .filter(({ id, uuid }) => {
        const memory = cardMemory(uuid);
        const rows = segmentRows(id);
        const split = rows.some((r) => splitCardBase(r.key) !== null);
        if (!memory.read) return split || rows.some((r) => r.type === 'prayer' && (r.content.noteId ?? null) === null);
        return split && memory.splitRead !== true;
      })
      .map((r) => r.uuid);
  }

  /** The held plans it is safe to read from the website again: those with no laptop edits waiting, which a fresh copy would replace. */
  function heldPlans() {
    return all("SELECT key FROM sync_state WHERE key LIKE 'hold:%'")
      .map((row) => row.key.slice('hold:'.length))
      .filter((uuid) => {
        const plan = planByUuid(uuid);
        return plan && plan.synced_updated_at === plan.updated_at;
      });
  }

  /** Brings a pulled plan's Content Hub entries in as notes. Never throws, so a bad entry cannot stop a sync. */
  const ingestHub = (serverPlan) => webHub.ingest(serverPlan.id, serverPlan.contentHubItems);

  // ---- What the engine writes ----

  /** Records that a plan is in step with the server: its server version, and the laptop stamp it was sent or applied with. */
  function markSynced(uuid, serverUpdatedAt, stamp) {
    quiet(() => {
      if (sending.has(uuid)) setCardMemory(uuid, { ...cardMemory(uuid), cards: sending.get(uuid) });
      sending.delete(uuid);
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
      clearCardMemory(uuid);
    });
  }

  /**
   * Writes the server's version of a plan: creates it, or overwrites the laptop copy. Returns how many of its items could not be
   * placed. A plan with any is held until a later server version places them all.
   */
  function applyServer(serverPlan) {
    sending.delete(serverPlan.id);
    ingestHub(serverPlan);
    const unresolved = quiet(() => (serverPlan.kind === 'mass' ? applyMass(serverPlan) : applyPraise(serverPlan)));
    if (unresolved > 0) setHold(serverPlan.id, unresolved);
    else clearHold(serverPlan.id);
    // After the commit, so a window that reads the lineup now reads what was written. One still holding the old copy would save over it.
    if (serverPlan.kind !== 'mass') {
      try {
        onPraiseChanged(planByUuid(serverPlan.id).id);
      } catch (err) {
        console.error(`[plan-sync] step=announce name=${err?.name ?? 'Error'}`);
      }
    }
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
    const hubEntryOf = (noteId) => webHub.entryIdOf(sp.id, noteId);
    const noteIdOf = (entryId) => webHub.noteIdOf(sp.id, entryId);
    const localEntries = massEntries(massRows(id), hymnUuidOf, hubEntryOf);
    const byKey = new Map(localEntries.map((e) => [e.key, e]));
    // The slot an item fills comes from the website when it names one, and otherwise stays as the laptop had it: the website's own editor
    // rebuilds the steps it shows without a slot, and a server from before slots sends none at all.
    const resolve = (item) => {
      const kept = byKey.get(item.key);
      const row = kept && sameMassRow(kept.row, item, sp.date, hymnByUuid, noteIdOf, bibleSourceOf) ? kept.row : massRowFrom(item, sp.date, hymnByUuid, noteIdOf, bibleSourceOf);
      if (!row) return null;
      const slot = slotIdOfNumber(item.slot) ?? kept?.row.slot ?? null;
      return { ...row, slot };
    };
    const { entries, unresolved } = mergeEntries(localEntries, sp.items, resolve);
    run('DELETE FROM mass_plan_items WHERE plan_id = ?', id);
    // A slot holds one item. Should two arrive for one slot (two laptops filling it), the first keeps it and the other is an additional item.
    const taken = new Set();
    entries.forEach((e, i) => {
      const slot = e.row.slot && !taken.has(e.row.slot) ? e.row.slot : null;
      if (slot) taken.add(slot);
      run(
        'INSERT INTO mass_plan_items (plan_id, liturgical_block, source_module, source_id, label, display_order, slot) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id, e.row.block, e.row.module, e.row.sourceId, e.row.label, i + 1, slot,
      );
    });
    // A server that keeps schedules always sends massLanguage on a Holy Mass plan ('' for none), so its absence means an older server, and the
    // laptop's own time and language stay.
    if (hasSchedule && typeof sp.massLanguage === 'string') {
      run('UPDATE mass_plans SET mass_time = ?, mass_language = ? WHERE id = ?', normalizeMassTime(sp.massTime), normalizeMassLanguage(sp.massLanguage), id);
    }
    applyLook('mass_plans', id, sp.appearance);
    run('UPDATE mass_plans SET server_updated_at = ?, synced_updated_at = ? WHERE id = ?', sp.updatedAt, sp.updatedAt, id);
    return unresolved.length;
  }

  // ---- Praise & Worship plans ----

  /** The card's type and content from the server's items, merged with what the laptop's card holds, and what to remember of the website's side. */
  function cardFor(row, items, planUuid, memory) {
    return praiseCard({
      row,
      items,
      memory,
      deps: {
        titleOf: prayerTitles(planUuid),
        noteFor: webHub.noteForPrayer,
        hubNoteFor: (entryId) => {
          const noteId = webHub.noteIdOf(planUuid, entryId);
          return noteId !== null && webHub.projectable(noteId) ? noteId : null;
        },
        noteExists: webHub.projectable,
        hubEntryOf: (noteId) => webHub.entryIdOf(planUuid, noteId),
        songIdOf: (uuid) => hymnByUuid(uuid)?.id ?? null,
        songUuidOf: hymnUuidOf,
        template: DEFAULT_SEGMENT_CONTENT[row.key ?? items[0].key],
      },
    });
  }

  /** An existing card keeps the laptop's name, except a card of the web's own making (no template name), which follows the web when it is renamed there. */
  function renamedBy(row, items) {
    const first = items[0];
    const title = typeof first.title === 'string' && !first.contentHubId ? first.title.trim().slice(0, MAX_SEGMENT_NAME) : '';
    return title && !DEFAULT_SEGMENT_NAMES[row.key] ? title : row.name;
  }

  /** A new segment's name: the template's name for its key when there is one, so a web prayer reads as the web names it. */
  function nameFor(row, items) {
    if (row?.id) return row.name;
    const first = items[0];
    const templated = DEFAULT_SEGMENT_NAMES[row?.key ?? first.key];
    if (templated) return templated;
    // A segment added on the web is named on its first item (title), whatever it holds.
    const named = typeof first.title === 'string' ? first.title.trim().slice(0, MAX_SEGMENT_NAME) : '';
    if (named) return named;
    if (first.kind === 'song') return (first.songId && hymnByUuid(first.songId)?.title) || 'Song';
    if (first.kind === 'reading') return first.text || 'Scripture';
    return first.text || 'Prayer';
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
    const rows = segmentRows(id);
    const localEntries = praiseEntries(rows, hymnUuidOf, prayerTitles(sp.id), (noteId) => webHub.entryIdOf(sp.id, noteId));
    const byKey = new Map(localEntries.map((e) => [e.key, e]));
    const bySegmentKey = new Map(rows.map((r) => [r.key, r]));
    // One new segment for each segment key the server's items name, so the songs and prayers of one step arrive as one card.
    const newSegments = new Map();
    const firstOf = new Map();
    for (const item of [...sp.items].sort((a, b) => a.order - b.order)) {
      const segmentKey = praiseSegmentKeyOf(item);
      if (!firstOf.has(segmentKey)) firstOf.set(segmentKey, item.key);
    }
    const resolve = (item) => {
      const fresh = praiseRowFrom(item, hymnByUuid);
      if (!fresh) return null;
      // Everything on a step belongs to the step's card: its first item, its songs and prayers, and any further reading, typed words or Content
      // Hub entry, which the card chains (pw-prayer-sync.js). The website gives a step's first item the step's own key and numbers the rest
      // ("worship", "worship.2"), and the laptop numbers songs from 1 ("worship.1"), so the step decides, not the key. A card of an older pull
      // made for one further item ("worship.2") is not reused: the item goes on its step's card and the old card goes.
      const segmentKey = praiseSegmentKeyOf(item);
      const own = firstOf.get(segmentKey) === item.key ? byKey.get(item.key)?.row : null;
      const home = bySegmentKey.get(segmentKey) ?? (own && !splitCardBase(own.key) ? own : null);
      if (home) return home;
      if (!newSegments.has(segmentKey)) newSegments.set(segmentKey, { id: null, key: segmentKey });
      return newSegments.get(segmentKey);
    };
    const { entries, unresolved } = mergeEntries(localEntries, sp.items, resolve);
    // A segment that several server items point at (a segment with several songs) is written once, with all its songs.
    const bySegment = new Map();
    for (const e of entries) {
      if (!bySegment.has(e.row)) bySegment.set(e.row, { row: e.row, items: [] });
      if (e.synced) bySegment.get(e.row).items.push(e.item);
    }
    // Worked out before the cards are rewritten, while the memory still says what the website held last time.
    const before = cardMemory(sp.id).cards ?? {};
    const cards = {};
    run('DELETE FROM pw_segments WHERE session_id = ?', id);
    let order = 0;
    for (const { row, items } of bySegment.values()) {
      order += 1;
      const owned = Boolean(row.id);
      const kept = items.length === 0;
      const cardKey = row.key ?? items[0].key;
      const card = kept ? null : cardFor(row, items, sp.id, before[cardKey] ?? null);
      if (card) cards[cardKey] = card.memory;
      else if (before[cardKey]) cards[cardKey] = before[cardKey];
      const values = kept
        ? { key: row.key, group: row.group, name: row.name, type: row.type, minutes: row.minutes, content: row.content,
            leader: row.leader, arrangement: row.arrangement, cues: row.cues, notes: row.notes }
        : { key: cardKey,
            group: items[0].group,
            name: owned ? renamedBy(row, items) : nameFor(row, items),
            type: card.type,
            minutes: items[0].minutes ?? 0,
            content: card.content,
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
    setCardMemory(sp.id, { read: true, splitRead: true, cards });
    applyLook('pw_sessions', id, sp.appearance);
    run('UPDATE pw_sessions SET server_updated_at = ?, synced_updated_at = ? WHERE id = ?', sp.updatedAt, sp.updatedAt, id);
    return unresolved.length;
  }

  // ---- Recovery: what the Cloud sync screen's Retry, Force Push and a new link need ----

  /** A plan's title, date, type and Holy Mass schedule, for the Failed Plans list on this laptop's screen. Null when it is gone. */
  function describe(uuid) {
    const plan = planByUuid(uuid);
    if (!plan) return null;
    const schedule = plan.kind === 'mass' ? scheduleOf(plan.id) : null;
    return {
      title: String(plan.name ?? '').trim() || 'Untitled Plan',
      date: plan.date ?? null,
      kind: plan.kind === 'praise' ? 'pw' : 'mass',
      massTime: schedule ? normalizeMassTime(schedule.massTime) : '',
      massLanguage: schedule ? normalizeMassLanguage(schedule.massLanguage) : '',
    };
  }

  /** The website has no copy of this plan for this church: the next send creates it, rather than pushing over a version that is not there. */
  function forgetServerStamp(uuid) {
    quiet(() => {
      run('UPDATE mass_plans SET server_updated_at = NULL WHERE uuid = ?', uuid);
      run('UPDATE pw_sessions SET server_updated_at = NULL WHERE uuid = ?', uuid);
    });
  }

  /**
   * Gives a plan a new id, for a plan whose id another church's website already holds. The id is otherwise fixed (transfer.js's
   * `<table>_uuid_fixed` trigger), so the trigger is set aside for this one update and put back exactly as it was, in one transaction.
   * Website Content Hub links named after the old id become ordinary laptop notes: the new plan on the website has no such entries.
   * Returns the new id.
   */
  function rekey(uuid) {
    const plan = planByUuid(uuid);
    if (!plan) throw new Error('No such plan.');
    const table = plan.kind === 'mass' ? 'mass_plans' : 'pw_sessions';
    const fresh = crypto.randomUUID();
    const triggerSql = one("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?", `${table}_uuid_fixed`)?.sql ?? null;
    const hasWebHub = one("SELECT COUNT(*) AS n FROM pragma_table_info('notes') WHERE name = 'web_hub_key'").n === 1;
    quiet(() => {
      if (triggerSql) db.exec(`DROP TRIGGER ${table}_uuid_fixed`);
      try {
        run(`UPDATE ${table} SET uuid = ?, server_updated_at = NULL, synced_updated_at = NULL WHERE id = ?`, fresh, plan.id);
      } finally {
        if (triggerSql) db.exec(triggerSql);
      }
      run('UPDATE sync_state SET key = ? WHERE key = ?', prayerKey(fresh), prayerKey(uuid));
      if (hasWebHub) run("UPDATE notes SET web_hub_key = NULL, web_hub_hash = NULL WHERE web_hub_key LIKE ? ESCAPE '\\'", `${uuid.replace(/[%_\\]/g, '\\$&')}:%`);
      clearHold(uuid);
    });
    return fresh;
  }

  /** Marks every plan as changed here, so the next run sends each one (Force Push Plans). Website versions already known are kept. */
  function markAllDirty() {
    quiet(() => {
      run('UPDATE mass_plans SET synced_updated_at = NULL WHERE uuid IS NOT NULL');
      run('UPDATE pw_sessions SET synced_updated_at = NULL WHERE uuid IS NOT NULL');
    });
  }

  /** Forgets everything learned from a website: versions, the pull cursor and holds. For a laptop just linked, perhaps to another church. */
  function resetSyncState() {
    quiet(() => {
      run('UPDATE mass_plans SET server_updated_at = NULL, synced_updated_at = NULL');
      run('UPDATE pw_sessions SET server_updated_at = NULL, synced_updated_at = NULL');
      run("DELETE FROM sync_state WHERE key = ? OR key LIKE 'hold:%'", CURSOR);
    });
  }

  return {
    planByUuid, dirtyPlans, payloadFor, cursor, setCursor, tombstones, hasTombstone, clearTombstone,
    holdOf, clearHold, holdCount, heldPlans, unreadPrayerPlans, hold: setHold, markSynced, setServerStamp, removeByUuid, applyServer, ingestHub,
    describe, forgetServerStamp, rekey, markAllDirty, resetSyncState,
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

// Content Hub entries typed on the website, kept on the laptop as ordinary notes. The notes table is the laptop's Content Hub, so an entry brought in here
// is listed in the Hub and plays through Go Live's projector and lower third like any other note. No electron import: the tests run under plain Node.
//
// An entry's id is only unique within its plan (a copied plan keeps its ids), so a note is linked by "<plan uuid>:<entry id>". The link also records a
// hash of what the website last sent, so a pull that brings nothing new leaves an operator's own edits alone.
import crypto from 'node:crypto';
import { ANNOUNCEMENT_CATEGORIES, MASS_FLOW_CATEGORIES, MAX_NOTE_TITLE, OPERATOR_CATEGORIES, PRAYER_CATEGORIES, cleanNote } from '../shared/notes.js';
import { prayerTitleKey, prayerTitleKeys, webPrayerOf } from '../shared/pw-web-prayers.js';
import { isSealed } from './db-crypto.js';

export const WEB_HUB_MIGRATIONS = [
  `
  ALTER TABLE notes ADD COLUMN web_hub_key TEXT;
  ALTER TABLE notes ADD COLUMN web_hub_hash TEXT;
  CREATE UNIQUE INDEX idx_notes_web_hub ON notes (web_hub_key) WHERE web_hub_key IS NOT NULL;
  `,
];

// Holy Mass intentions are the parish's sealed category. One from the website lands as an ordinary prayer, never in that category, so this file never has to seal.
const SEALED_CATEGORY = 'Mass Intention';
const OF_TYPE = {
  prayer: { categories: [...PRAYER_CATEGORIES, ...MASS_FLOW_CATEGORIES].filter((c) => c !== SEALED_CATEGORY), fallback: 'Community Prayer', display: 'full' },
  scripture: { categories: [], fallback: 'Scripture Reading', display: 'full' },
  announcement: { categories: ANNOUNCEMENT_CATEGORIES, fallback: 'Pastoral Notice', display: 'full' },
  note: { categories: OPERATOR_CATEGORIES, fallback: 'Liturgical Cue', display: 'operator' },
};

/** A website entry as a note's fields. A note the website calls a General Note stays private to the booth. Throws if the entry cannot be a note. */
export function webHubNote(entry) {
  const shape = OF_TYPE[entry?.type];
  if (!shape) throw new Error('Unknown Content Hub type.');
  return cleanNote({
    title: entry.title,
    category: shape.categories.includes(entry.category) ? entry.category : shape.fallback,
    body: entry.text ?? '',
    display: shape.display,
  });
}

const hashOf = (entry) => crypto.createHash('sha256').update(JSON.stringify([entry.type, entry.title, entry.category ?? '', entry.text ?? ''])).digest('hex');

export function createWebHubNotes(db, { onChanged = () => {} } = {}) {
  const keyOf = (planUuid, entryId) => `${planUuid}:${entryId}`;

  /** The note holding a plan's entry, or null. */
  const noteIdOf = (planUuid, entryId) => db.prepare('SELECT id FROM notes WHERE web_hub_key = ?').get(keyOf(planUuid, entryId))?.id ?? null;

  /** The plan's entry a note holds, or null. A note brought in for another plan is not this plan's entry. */
  function entryIdOf(planUuid, noteId) {
    const key = db.prepare('SELECT web_hub_key AS key FROM notes WHERE id = ?').get(Number(noteId))?.key;
    const prefix = `${planUuid}:`;
    return key?.startsWith(prefix) ? key.slice(prefix.length) : null;
  }

  /** Whether a note can be put on the screen. A private booth note cannot sit in a Praise & Worship prayer slot. */
  const projectable = (noteId) => {
    const display = db.prepare('SELECT display FROM notes WHERE id = ?').get(Number(noteId))?.display;
    return display === 'full' || display === 'lower';
  };

  function upsertOne(planUuid, entry) {
    const hash = hashOf(entry);
    const key = keyOf(planUuid, entry.id);
    const row = db.prepare('SELECT id, body, category, web_hub_hash AS hash FROM notes WHERE web_hub_key = ?').get(key);
    if (row && row.hash === hash) return null;
    const note = webHubNote(entry);
    if (!row) {
      const { lastInsertRowid } = db.prepare('INSERT INTO notes (title, category, body, display, web_hub_key, web_hub_hash) VALUES (?, ?, ?, ?, ?, ?)').run(note.title, note.category, note.body, note.display, key, hash);
      return Number(lastInsertRowid);
    }
    // An operator who moved the note into the sealed category has taken it over. It is left as it is.
    if (row.category === SEALED_CATEGORY || isSealed(row.body)) return null;
    // Where it is shown and how it looks are the operator's. New words drop slide breaks made for the old ones.
    db.prepare(`UPDATE notes SET title = ?, category = ?, body = ?, web_hub_hash = ?, split = CASE WHEN body = ? THEN split ELSE NULL END, updated_at = datetime('now') WHERE id = ?`)
      .run(note.title, note.category, note.body, hash, note.body, row.id);
    return row.id;
  }

  /**
   * Brings a plan's entries in. Each one stands alone, and this never throws: a bad entry is counted, its slot keeps the title, and the plan still syncs. The
   * count names no content. Entries removed on the website stay in the Hub, as the operator's library.
   */
  function ingest(planUuid, entries) {
    const result = { changed: 0, failed: 0 };
    if (!Array.isArray(entries)) return result;
    for (const entry of entries) {
      try {
        const id = upsertOne(planUuid, entry);
        if (id !== null) {
          result.changed += 1;
          onChanged({ id, removed: false });
        }
      } catch (err) {
        result.failed += 1;
        console.error(`[plan-sync] step=hub name=${err?.name ?? 'Error'}`);
      }
    }
    return result;
  }

  /** The parish's approved wording of a catalog prayer the laptop's Rosary also holds, or ''. Wording not marked approved is never used. */
  function approvedWords(title) {
    const key = webPrayerOf(title)?.rosary;
    if (!key) return '';
    try {
      const row = db.prepare('SELECT * FROM rosary_prayers WHERE key = ?').get(key);
      const language = ['en', 'ceb', 'tl'].find((l) => row?.[`approved_${l}`] === 1 && row[`text_${l}`]?.trim());
      return language ? row[`text_${language}`] : '';
    } catch {
      return '';
    }
  }

  /**
   * The note a prayer the website named by its title is shown from, on a Praise & Worship card. The parish's own projectable Hub entry of that
   * title is used when there is one (one with words before an empty one). Otherwise one note is made for the title, the same one for every
   * plan: it holds the parish's approved Rosary wording when there is one, and no words otherwise, so its slide asks for the approved text
   * until the operator types it in. Private notes, Go Live copies and Mass intentions are never used. Null when no note can be had; never
   * throws, so one prayer cannot stop a plan's sync.
   */
  function noteForPrayer(title) {
    try {
      const clean = String(title ?? '').trim().slice(0, MAX_NOTE_TITLE).trim();
      if (!clean) return null;
      const names = prayerTitleKeys(clean);
      const rank = (row) => [names.indexOf(prayerTitleKey(row.title)), row.body.trim() ? 0 : 1, row.id];
      const [found] = db
        .prepare("SELECT id, title, body FROM notes WHERE copy_owner IS NULL AND display IN ('full', 'lower') AND category <> ?")
        .all(SEALED_CATEGORY)
        .filter((row) => names.includes(prayerTitleKey(row.title)))
        .sort((a, b) => {
          const [x, y] = [rank(a), rank(b)];
          return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
        });
      if (found) return Number(found.id);
      // The note made for this title before, if the operator has since given it another name.
      const key = `prayer:${names[0]}`;
      const made = db.prepare('SELECT id FROM notes WHERE web_hub_key = ?').get(key);
      if (made && projectable(made.id)) return Number(made.id);
      const note = cleanNote({ title: clean, category: 'Community Prayer', body: approvedWords(clean), display: 'full' });
      const { lastInsertRowid } = db
        .prepare('INSERT INTO notes (title, category, body, display, web_hub_key) VALUES (?, ?, ?, ?, ?)')
        .run(note.title, note.category, note.body, note.display, made ? null : key);
      const id = Number(lastInsertRowid);
      onChanged({ id, removed: false });
      return id;
    } catch (err) {
      console.error(`[plan-sync] step=prayer name=${err?.name ?? 'Error'}`);
      return null;
    }
  }

  return { ingest, noteIdOf, entryIdOf, projectable, noteForPrayer };
}

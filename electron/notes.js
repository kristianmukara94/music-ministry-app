import { ipcMain } from 'electron';
import { cleanNote } from '../shared/notes.js';
import { parseTextStyle } from '../shared/text-style.js';
import { normalizeSplit } from '../shared/prayer-screen.js';
import { DecryptionError, isSealed } from './db-crypto.js';
import { immediateTransaction } from './db-vault.js';

/**
 * Notes and prayers. One table holds both: `display` decides whether a note is private (`operator`) or
 * projectable (`full` or `lower`). The text is written by the operator and never shipped with the app.
 */
export const PRAYER_NOTES_MIGRATIONS = [
  `
  CREATE TABLE notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    category    TEXT NOT NULL,
    body        TEXT NOT NULL DEFAULT '',
    display     TEXT NOT NULL CHECK (display IN ('operator', 'full', 'lower')),
    style       TEXT,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_notes_display ON notes (display);
  `,
];

/** Where a prayer is split into slides, as JSON. Added after the table existed, so it is its own migration. */
export const PRAYER_NOTES_SPLIT_MIGRATIONS = ['ALTER TABLE notes ADD COLUMN split TEXT'];

/**
 * The Holy Mass slot a note was made for (a slot id from shared/mass-slots.js), set when it is written in Go Live's Order of Holy Mass. NULL for
 * a note with no slot. It only labels the note: where the note plays is the plan's row, which says the same slot.
 */
export const NOTES_SLOT_MIGRATIONS = ['ALTER TABLE notes ADD COLUMN slot TEXT'];

/**
 * Who a Go Live copy belongs to: `mass:<plan id>` or `pw:<lineup id>:<card key>`. NULL for every Liturgical Content Hub entry. Go Live's Edit
 * slide on air, Add slide and Delete slide write only through saveCopy, which makes a new copy or changes one with the same owner, so a live
 * service can never change or remove a Hub entry. The Hub and the pickers leave copies out.
 */
export const NOTES_COPY_MIGRATIONS = ['ALTER TABLE notes ADD COLUMN copy_owner TEXT'];

const SELECT = 'SELECT id, title, category, body, display, style, split, slot, copy_owner FROM notes';

/**
 * The category whose body is sealed when the parish turns Mass intention privacy on (electron/db-vault.js). Only the body: the title is
 * copied into plan item labels, which sync to the web planner, so sealing it here would protect nothing.
 */
export const SEALED_NOTE_CATEGORY = 'Mass Intention';
const BODY_AAD = 'notes.body';
export const NOTE_SEALED_FIELDS = [{ table: 'notes', column: 'body', aad: BODY_AAD, plainWhere: `category = '${SEALED_NOTE_CATEGORY}'` }];

function parseSplit(json, body) {
  try {
    return normalizeSplit(JSON.parse(json), body);
  } catch {
    return null;
  }
}

/**
 * A row as the screen sees it. A sealed body is opened with `cipher`. Without the key the note comes back with no text and `sealed:
 * 'locked'`. A body that fails its integrity check comes back the same way with `sealed: 'damaged'`, and its text is never shown.
 */
function toNote(row, cipher) {
  let body = row.body;
  let sealed = null;
  if (isSealed(body)) {
    if (!cipher) {
      body = '';
      sealed = 'locked';
    } else {
      try {
        body = cipher.open(row.body, BODY_AAD);
      } catch (err) {
        if (!(err instanceof DecryptionError)) throw err;
        console.error(`[notes] Note ${row.id}: its sealed text failed the integrity check and is not shown.`);
        body = '';
        sealed = 'damaged';
      }
    }
  }
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    body,
    display: row.display,
    style: parseTextStyle(row.style),
    split: sealed ? null : parseSplit(row.split, body),
    slot: row.slot ?? null,
    copyOwner: row.copy_owner ?? null,
    sealed,
  };
}

/**
 * Notes data access. Pure: takes a database handle, so it can be tested without Electron. With `vault` (electron/db-vault.js) and privacy
 * turned on, the body of a Mass Intention note is sealed before it is written and opened when it is read.
 */
export function createNotesService(db, { vault = null } = {}) {
  const list = db.prepare(`${SELECT} ORDER BY title COLLATE NOCASE`);
  const get = db.prepare(`${SELECT} WHERE id = ?`);
  const insert = db.prepare(`
    INSERT INTO notes (title, category, body, display, style, split, slot)
    VALUES (@title, @category, @body, @display, @style, @split, @slot)`);
  // A save that does not say the slot (the Notes & Prayers editor) keeps the one the note has.
  const update = db.prepare(`
    UPDATE notes SET title = @title, category = @category, body = @body, display = @display,
      style = @style, split = @split, slot = CASE WHEN @keepSlot = 1 THEN slot ELSE @slot END, updated_at = datetime('now')
    WHERE id = @id`);
  const insertCopy = db.prepare(`
    INSERT INTO notes (title, category, body, display, style, split, slot, copy_owner)
    VALUES (@title, @category, @body, @display, @style, @split, @slot, @owner)`);
  // Only a copy with this owner: a Hub entry (owner NULL) or another plan's copy never matches, so it is never written here.
  const updateCopy = db.prepare(`
    UPDATE notes SET title = @title, category = @category, body = @body, display = @display,
      style = @style, split = @split, slot = CASE WHEN @keepSlot = 1 THEN slot ELSE @slot END, updated_at = datetime('now')
    WHERE id = @id AND copy_owner = @owner`);
  const remove = db.prepare('DELETE FROM notes WHERE id = ?');
  const storedBody = db.prepare('SELECT body FROM notes WHERE id = ?');

  /** The style and split are stored as JSON text, or NULL when there is none. */
  const bind = (note, cipher) => ({
    title: note.title,
    category: note.category,
    body: cipher && note.category === SEALED_NOTE_CATEGORY ? cipher.seal(note.body, BODY_AAD) : note.body,
    display: note.display,
    style: note.style ? JSON.stringify(note.style) : null,
    split: note.split ? JSON.stringify(note.split) : null,
    slot: note.slot ?? null,
  });

  /** The cipher for a read: null when privacy is off or this laptop is locked. */
  const readCipher = () => vault?.readCipher() ?? null;

  /**
   * The cipher for a write. Throws VaultLockedError when this laptop is locked and the save would write a Mass intention or replace one it
   * cannot read, so a locked laptop never writes intention text in the clear and never overwrites a sealed note with an empty body.
   */
  const writeCipher = (note, id) => {
    if (!vault?.configured()) return null;
    const stored = id == null ? null : storedBody.get(id);
    const needsKey = note.category === SEALED_NOTE_CATEGORY || isSealed(stored?.body);
    return needsKey ? vault.cipher() : vault.readCipher();
  };

  return {
    list: () => {
      const cipher = readCipher();
      return list.all().map((row) => toNote(row, cipher));
    },

    get: (id) => {
      const row = get.get(Number(id));
      return row ? toNote(row, readCipher()) : null;
    },

    save(input = {}) {
      const note = cleanNote(input);
      // One immediate transaction: the key is checked and the row written while this laptop holds the write lock, so a passphrase changed
      // on another laptop in between cannot leave a body sealed with the old key.
      return immediateTransaction(db, () => {
        if (input.id == null) {
          const cipher = writeCipher(note, null);
          const { lastInsertRowid } = insert.run(bind(note, cipher));
          return toNote(get.get(Number(lastInsertRowid)), cipher ?? readCipher());
        }
        const id = Number(input.id);
        const cipher = writeCipher(note, id);
        if (update.run({ ...bind(note, cipher), keepSlot: note.slot === undefined ? 1 : 0, id }).changes === 0) throw new Error('That note no longer exists.');
        return toNote(get.get(id), cipher ?? readCipher());
      });
    },

    /**
     * Saves Go Live's own copy for `owner` (see NOTES_COPY_MIGRATIONS): a new copy when `input.id` is unset, otherwise that copy, only when it
     * has this owner. Throws for any other note, so a Hub entry, the Lectionary's words or another plan's copy are never changed from here.
     */
    saveCopy(input = {}, owner) {
      const key = typeof owner === 'string' ? owner.trim() : '';
      if (!key || key.length > 200) throw new Error('A Go Live copy needs the plan or card it belongs to.');
      const note = cleanNote(input);
      return immediateTransaction(db, () => {
        if (input.id == null) {
          const cipher = writeCipher(note, null);
          const { lastInsertRowid } = insertCopy.run({ ...bind(note, cipher), owner: key });
          return toNote(get.get(Number(lastInsertRowid)), cipher ?? readCipher());
        }
        const id = Number(input.id);
        const cipher = writeCipher(note, id);
        const changed = updateCopy.run({ ...bind(note, cipher), keepSlot: note.slot === undefined ? 1 : 0, id, owner: key }).changes;
        if (changed === 0) throw new Error('Go Live only changes its own copy of an item, and that copy is not this plan’s.');
        return toNote(get.get(id), cipher ?? readCipher());
      });
    },

    remove: (id) => remove.run(Number(id)).changes > 0,
  };
}

/**
 * Registers the `notes:*` IPC channels. Called once from the main process. `onChanged({ id, removed })` runs after every save and delete, so
 * the main process can tell every window (Notes & Prayers, Go Live's Order of Holy Mass) to read the notes again.
 */
export function setupNotes(db, { vault = null, onChanged = () => {} } = {}) {
  const service = createNotesService(db, { vault });
  const changed = (id, removed) => {
    try {
      onChanged({ id: Number(id), removed });
    } catch (err) {
      console.error('Telling the windows a note changed failed:', err);
    }
  };
  ipcMain.handle('notes:list', () => service.list());
  ipcMain.handle('notes:get', (_event, id) => service.get(id));
  ipcMain.handle('notes:save', (_event, input) => {
    const saved = service.save(input);
    changed(saved.id, false);
    return saved;
  });
  ipcMain.handle('notes:saveCopy', (_event, input, owner) => {
    const saved = service.saveCopy(input, owner);
    changed(saved.id, false);
    return saved;
  });
  ipcMain.handle('notes:delete', (_event, id) => {
    const gone = service.remove(id);
    if (gone) changed(id, true);
    return gone;
  });
  return service;
}

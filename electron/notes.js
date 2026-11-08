import { ipcMain } from 'electron';
import { cleanNote } from '../shared/notes.js';
import { parseTextStyle } from '../shared/text-style.js';
import { normalizeSplit } from '../shared/prayer-screen.js';

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

const SELECT = 'SELECT id, title, category, body, display, style, split, slot FROM notes';

function parseSplit(json, body) {
  try {
    return normalizeSplit(JSON.parse(json), body);
  } catch {
    return null;
  }
}

function toNote(row) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    body: row.body,
    display: row.display,
    style: parseTextStyle(row.style),
    split: parseSplit(row.split, row.body),
    slot: row.slot ?? null,
  };
}

/** Notes data access. Pure: takes a database handle, so it can be tested without Electron. */
export function createNotesService(db) {
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
  const remove = db.prepare('DELETE FROM notes WHERE id = ?');

  /** The style and split are stored as JSON text, or NULL when there is none. */
  const bind = (note) => ({
    title: note.title,
    category: note.category,
    body: note.body,
    display: note.display,
    style: note.style ? JSON.stringify(note.style) : null,
    split: note.split ? JSON.stringify(note.split) : null,
    slot: note.slot ?? null,
  });

  return {
    list: () => list.all().map(toNote),

    get: (id) => {
      const row = get.get(Number(id));
      return row ? toNote(row) : null;
    },

    save(input = {}) {
      const note = cleanNote(input);
      if (input.id == null) {
        const { lastInsertRowid } = insert.run(bind(note));
        return toNote(get.get(Number(lastInsertRowid)));
      }
      const id = Number(input.id);
      if (update.run({ ...bind(note), keepSlot: note.slot === undefined ? 1 : 0, id }).changes === 0) throw new Error('That note no longer exists.');
      return toNote(get.get(id));
    },

    remove: (id) => remove.run(Number(id)).changes > 0,
  };
}

/**
 * Registers the `notes:*` IPC channels. Called once from the main process. `onChanged({ id, removed })` runs after every save and delete, so
 * the main process can tell every window (Notes & Prayers, Go Live's Order of Holy Mass) to read the notes again.
 */
export function setupNotes(db, { onChanged = () => {} } = {}) {
  const service = createNotesService(db);
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
  ipcMain.handle('notes:delete', (_event, id) => {
    const gone = service.remove(id);
    if (gone) changed(id, true);
    return gone;
  });
  return service;
}

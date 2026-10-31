import { BrowserWindow, dialog, ipcMain } from 'electron';
import { cleanSlide, sanitizeSlideDesign, SLIDE_DESIGN_DEFAULTS } from '../shared/whiteboard.js';
import { MEDIA_SCHEME } from './protocol.js';

/** The Announcements folder that holds the pictures of imported PowerPoint slides. */
export const POWERPOINT_FOLDER = 'Whiteboard PowerPoint';

/** Whiteboard slides: one table, in the order the operator arranges them. The design is stored as JSON text. */
export const WHITEBOARD_MIGRATIONS = [
  `
  CREATE TABLE whiteboard_slides (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL DEFAULT '',
    design      TEXT NOT NULL DEFAULT '{}',
    position    INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_whiteboard_position ON whiteboard_slides (position);
  `,
];

/**
 * A PowerPoint slide on the Whiteboard points at the picture of that slide, which lives in Announcements as an image slide. That
 * is what lets it go live, join a Mass plan, and show on the projector exactly as PowerPoint draws it. NULL for text slides.
 */
export const WHITEBOARD_POWERPOINT_MIGRATIONS = [`ALTER TABLE whiteboard_slides ADD COLUMN slide_id INTEGER;`];

// A picture slide whose Announcements image was deleted is left out, rather than shown empty.
const SELECT = `
  SELECT w.id, w.title, w.content, w.design, w.slide_id AS slideId, a.notes AS notes
  FROM whiteboard_slides w
  LEFT JOIN announcement_slides a ON a.id = w.slide_id
  WHERE (w.slide_id IS NULL OR a.id IS NOT NULL)`;

function toSlide(row) {
  let design = null;
  try {
    design = JSON.parse(row.design);
  } catch {
    design = null;
  }
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    design: sanitizeSlideDesign(design ?? SLIDE_DESIGN_DEFAULTS),
    slideId: row.slideId ?? null,
    image: row.slideId == null ? null : `${MEDIA_SCHEME}://slide/${row.slideId}`,
    notes: row.notes ?? null,
  };
}

/** Whiteboard data access. Pure: takes a database handle, so the rules can be tested without Electron. */
export function createWhiteboardService(db, deps = {}) {
  const { showOpenDialog, importDeck } = deps;
  const list = db.prepare(`${SELECT} ORDER BY w.position, w.id`);
  const get = db.prepare(`${SELECT} AND w.id = ?`);
  const nextPosition = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS next FROM whiteboard_slides');
  const insert = db.prepare('INSERT INTO whiteboard_slides (title, content, design, position, slide_id) VALUES (?, ?, ?, ?, ?)');
  const update = db.prepare("UPDATE whiteboard_slides SET title = ?, content = ?, design = ?, updated_at = datetime('now') WHERE id = ?");
  const remove = db.prepare('DELETE FROM whiteboard_slides WHERE id = ?');
  const setPosition = db.prepare('UPDATE whiteboard_slides SET position = ? WHERE id = ?');

  const insertSlide = (slide) => {
    const { lastInsertRowid } = insert.run(slide.title, slide.content, JSON.stringify(slide.design), nextPosition.get().next, slide.slideId ?? null);
    return Number(lastInsertRowid);
  };

  return {
    list: () => list.all().map(toSlide),

    get: (id) => {
      const row = get.get(Number(id));
      return row ? toSlide(row) : null;
    },

    save(input = {}) {
      const slide = cleanSlide(input);
      if (input.id == null) {
        return toSlide(get.get(insertSlide(slide)));
      }
      const id = Number(input.id);
      if (update.run(slide.title, slide.content, JSON.stringify(slide.design), id).changes === 0) {
        throw new Error('That slide no longer exists.');
      }
      return toSlide(get.get(id));
    },

    remove: (id) => remove.run(Number(id)).changes > 0,

    /** Sets the order from the ids as given, first to last. */
    reorder(ids) {
      db.transaction(() => ids.forEach((id, i) => setPosition.run(i + 1, Number(id))))();
      return true;
    },

    /**
     * Each visible slide of a PowerPoint becomes a picture of that slide, exactly as PowerPoint draws it: layout, images, fonts and
     * speaker notes all come through. Hidden slides are skipped. Importing the same file again replaces its earlier slides.
     */
    async importFile(file) {
      const pictures = await importDeck(file);
      db.transaction(() => {
        for (const picture of pictures) insertSlide({ title: picture.name, content: '', design: SLIDE_DESIGN_DEFAULTS, slideId: picture.id });
      })();
      return pictures.length;
    },

    /** Opens the file picker and imports every .pptx or .ppt chosen. Resolves to the number of slides added, or null if the picker was cancelled. */
    async importPowerPoint(win) {
      const picked = await showOpenDialog(win, { title: 'Import PowerPoint', properties: ['openFile', 'multiSelections'], filters: [{ name: 'PowerPoint', extensions: ['pptx', 'ppt'] }] });
      if (picked.canceled) return null;
      let total = 0;
      for (const file of picked.filePaths) total += await this.importFile(file);
      return total;
    },
  };
}

/**
 * Imports a PowerPoint through Announcements into its own folder and returns the new picture slides, in slide order. A file
 * imported before has its old slides replaced there, and the Whiteboard leaves out the cards that pointed at them.
 */
async function importDeckAsPictures(announcements, file) {
  const existing = announcements.listFolders().folders.find((f) => f.name.toLowerCase() === POWERPOINT_FOLDER.toLowerCase());
  const folder = existing ?? announcements.createFolder(POWERPOINT_FOLDER);
  const before = new Set(announcements.listSlides(folder.id).map((s) => s.id));
  const { failed } = await announcements.importPaths(folder.id, [file]);
  if (failed.length > 0) throw new Error(failed[0].reason);
  return announcements.listSlides(folder.id).filter((s) => s.slideType === 'image' && !before.has(s.id));
}

/** Registers the `whiteboard:*` IPC channels. Called once from the main process. */
export function setupWhiteboard(db, announcements) {
  const service = createWhiteboardService(db, {
    showOpenDialog: (win, options) => (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)),
    importDeck: (file) => importDeckAsPictures(announcements, file),
  });
  const handle = (channel, fn) => ipcMain.handle(`whiteboard:${channel}`, (event, ...args) => fn(BrowserWindow.fromWebContents(event.sender), ...args));
  handle('list', () => service.list());
  handle('save', (_win, input) => service.save(input));
  handle('delete', (_win, id) => service.remove(id));
  handle('reorder', (_win, ids) => service.reorder(Array.isArray(ids) ? ids : []));
  handle('importPowerPoint', (win) => service.importPowerPoint(win));
  return service;
}

import { BrowserWindow, dialog, ipcMain } from 'electron';
import { cleanSlide, sanitizeSlideDesign, SLIDE_DESIGN_DEFAULTS } from '../shared/whiteboard.js';
import { readPptxSlides } from './documents.js';

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

const SELECT = 'SELECT id, title, content, design FROM whiteboard_slides';

function toSlide(row) {
  let design = null;
  try {
    design = JSON.parse(row.design);
  } catch {
    design = null;
  }
  return { id: row.id, title: row.title, content: row.content, design: sanitizeSlideDesign(design ?? SLIDE_DESIGN_DEFAULTS) };
}

/** Whiteboard data access. Pure: takes a database handle, so the rules can be tested without Electron. */
export function createWhiteboardService(db, deps = {}) {
  const { showOpenDialog, readSlides = readPptxSlides } = deps;
  const list = db.prepare(`${SELECT} ORDER BY position, id`);
  const get = db.prepare(`${SELECT} WHERE id = ?`);
  const nextPosition = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS next FROM whiteboard_slides');
  const insert = db.prepare('INSERT INTO whiteboard_slides (title, content, design, position) VALUES (?, ?, ?, ?)');
  const update = db.prepare("UPDATE whiteboard_slides SET title = ?, content = ?, design = ?, updated_at = datetime('now') WHERE id = ?");
  const remove = db.prepare('DELETE FROM whiteboard_slides WHERE id = ?');
  const setPosition = db.prepare('UPDATE whiteboard_slides SET position = ? WHERE id = ?');

  const insertSlide = (slide) => {
    const { lastInsertRowid } = insert.run(slide.title, slide.content, JSON.stringify(slide.design), nextPosition.get().next);
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
     * Each visible slide of a PowerPoint becomes a slide here: its title, and its text as bullets. Hidden slides are
     * skipped. The PowerPoint's images and layout are not kept: this is for editable text.
     */
    async importFile(file) {
      const slides = await readSlides(file);
      let imported = 0;
      slides.forEach((slide, i) => {
        if (slide.hidden) return;
        const title = (slide.title || '').trim() || `Slide ${i + 1}`;
        const content = (slide.paragraphs ?? []).map((p) => `- ${p}`).join('\n');
        insertSlide(cleanSlide({ title, content, design: SLIDE_DESIGN_DEFAULTS }));
        imported += 1;
      });
      return imported;
    },

    /** Opens the file picker and imports every .pptx chosen. Resolves to the number of slides added. */
    async importPowerPoint(win) {
      const picked = await showOpenDialog(win, { title: 'Import PowerPoint', properties: ['openFile', 'multiSelections'], filters: [{ name: 'PowerPoint', extensions: ['pptx'] }] });
      if (picked.canceled) return 0;
      let total = 0;
      for (const file of picked.filePaths) total += await this.importFile(file);
      return total;
    },
  };
}

/** Registers the `whiteboard:*` IPC channels. Called once from the main process. */
export function setupWhiteboard(db) {
  const service = createWhiteboardService(db, {
    showOpenDialog: (win, options) => (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)),
  });
  const handle = (channel, fn) => ipcMain.handle(`whiteboard:${channel}`, (event, ...args) => fn(BrowserWindow.fromWebContents(event.sender), ...args));
  handle('list', () => service.list());
  handle('save', (_win, input) => service.save(input));
  handle('delete', (_win, id) => service.remove(id));
  handle('reorder', (_win, ids) => service.reorder(Array.isArray(ids) ? ids : []));
  handle('importPowerPoint', (win) => service.importPowerPoint(win));
  return service;
}

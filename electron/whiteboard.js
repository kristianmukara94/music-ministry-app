import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { getAssetRoot, relPath, resolveAsset } from './assets.js';
import { cleanSlide, sanitizeSlideDesign, sanitizeTextBox, MAX_TEXT_BOXES, SLIDE_DESIGN_DEFAULTS } from '../shared/whiteboard.js';
import { MEDIA_SCHEME, registerMediaRoute } from './protocol.js';
import { readPptxSlides } from './documents.js';
import { renderLayers } from './pptx-render.js';
import { createImportReporter, sendToWindow } from './powerpoint-importer.js';
import { WHITEBOARD_POWERPOINT_FOLDER } from '../shared/deck-items.js';

/** The Announcements folder that holds the pictures of imported PowerPoint slides. */
export const POWERPOINT_FOLDER = WHITEBOARD_POWERPOINT_FOLDER;

/** The longest a Whiteboard folder's name may be. */
export const MAX_FOLDER_NAME = 60;

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

/**
 * Folders for Whiteboard slides. A slide with no folder (NULL) is Unfiled, which is where every slide made before folders existed stays.
 * Deleting a folder never deletes its slides: they become Unfiled.
 */
export const WHITEBOARD_FOLDER_MIGRATIONS = [
  `
  CREATE TABLE whiteboard_folders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  ALTER TABLE whiteboard_slides ADD COLUMN folder_id INTEGER;
  CREATE INDEX idx_whiteboard_folder ON whiteboard_slides (folder_id);
  `,
];

/**
 * A PowerPoint slide that was changed into an editable slide remembers its picture here, so it can be turned back. NULL for every other slide.
 */
export const WHITEBOARD_RESTORE_MIGRATIONS = [`ALTER TABLE whiteboard_slides ADD COLUMN original_slide_id INTEGER;`];

/**
 * A PowerPoint slide taken apart for editing, as JSON: `{ background, boxes }`, where `background` is the file name of the slide drawn
 * without its words (in the asset folder's `whiteboard` folder) and `boxes` are its words as text boxes. NULL when the slide could not be
 * taken apart, or was imported before this existed.
 */
export const WHITEBOARD_LAYER_MIGRATIONS = [`ALTER TABLE whiteboard_slides ADD COLUMN layers TEXT;`];

/**
 * Speaker notes for a slide made here (a designed slide, or a PowerPoint slide changed into one). A PowerPoint picture keeps its notes on
 * its Announcements image instead. NULL means none were written; '' means they were cleared on purpose, so an edited PowerPoint slide no
 * longer falls back to its picture's notes.
 */
export const WHITEBOARD_NOTES_MIGRATIONS = [`ALTER TABLE whiteboard_slides ADD COLUMN notes TEXT;`];

/** The asset folder that holds the backgrounds of PowerPoint slides taken apart for editing. Each file is named by a UUID. */
export const LAYER_FOLDER = 'whiteboard';
const LAYER_FILE = /^[0-9a-f-]{36}\.jpg$/;
const LAYER_IN_TEXT = /[0-9a-f-]{36}\.jpg/g;

/** A slide's number in its deck, from the name the import gave it ("Deck - Slide 3"). */
const slideNoOf = (name) => Number(/ - Slide (\d+)$/.exec(String(name ?? ''))?.[1]) || null;

function parseLayers(raw) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || !LAYER_FILE.test(String(value.background))) return null;
    const boxes = Array.isArray(value.boxes) ? value.boxes.slice(0, MAX_TEXT_BOXES).map(sanitizeTextBox) : [];
    return { background: `${MEDIA_SCHEME}://wb/${value.background}`, boxes };
  } catch {
    return null;
  }
}

// A picture slide whose Announcements image was deleted is left out, rather than shown empty.
const VISIBLE = '(w.slide_id IS NULL OR a.id IS NOT NULL)';
const SELECT = `
  SELECT w.id, w.title, w.content, w.design, w.slide_id AS slideId, w.folder_id AS folderId, CASE WHEN w.slide_id IS NOT NULL THEN a.notes ELSE COALESCE(w.notes, o.notes) END AS notes, o.id AS originalFound, w.layers AS layers
  FROM whiteboard_slides w
  LEFT JOIN announcement_slides a ON a.id = w.slide_id
  LEFT JOIN announcement_slides o ON o.id = w.original_slide_id
  WHERE ${VISIBLE}`;

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
    folderId: row.folderId ?? null,
    image: row.slideId == null ? null : `${MEDIA_SCHEME}://slide/${row.slideId}`,
    notes: row.notes || null,
    // The picture this slide was before it was edited, when it can still be brought back.
    originalImage: row.originalFound == null ? null : `${MEDIA_SCHEME}://slide/${row.originalFound}`,
    // The slide taken apart for editing: its background without its words, and its words as text boxes. Null when not available.
    layers: parseLayers(row.layers),
  };
}

/** The longest a PowerPoint slide's speaker notes may be. */
export const MAX_SLIDE_NOTES = 4000;

/** Speaker notes as stored: Windows line endings made plain, cut to MAX_SLIDE_NOTES, trailing space trimmed. Blank notes are ''. */
export function cleanNotes(raw) {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .slice(0, MAX_SLIDE_NOTES)
    .trimEnd();
}

/**
 * A PowerPoint slide's words as slide content: its title as a plain line, then each paragraph as a bullet. Empty when the slide had no text,
 * and cut to the length a slide's content may have.
 */
export function slideText(slide) {
  if (!slide) return '';
  const lines = [];
  if (slide.title && String(slide.title).trim()) lines.push(String(slide.title).trim());
  for (const p of slide.paragraphs ?? []) if (String(p).trim()) lines.push(`- ${String(p).trim()}`);
  return lines.join('\n').slice(0, 4000);
}

/** The longest a slide's title may be. */
export const MAX_SLIDE_TITLE = 120;

/** A slide's title, trimmed and with runs of spaces made one. Throws a message the operator can read. */
export function validSlideTitle(raw) {
  const title = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!title) throw new Error('Give the slide a title.');
  if (title.length > MAX_SLIDE_TITLE) throw new Error(`A slide title can be at most ${MAX_SLIDE_TITLE} characters.`);
  return title;
}

/** A folder's name, trimmed and with runs of spaces made one. Throws a message the operator can read. */
export function validFolderName(raw) {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Give the folder a name.');
  if (name.length > MAX_FOLDER_NAME) throw new Error(`A folder name can be at most ${MAX_FOLDER_NAME} characters.`);
  return name;
}

const duplicateError = (name) => new Error(`There is already a folder called "${name}". Choose a different name.`);
const isDuplicate = (err) => /UNIQUE constraint/i.test(String(err?.message ?? ''));

/** Whiteboard data access. Pure: takes a database handle, so the rules can be tested without Electron. */
export function createWhiteboardService(db, deps = {}) {
  const { showOpenDialog, importDeck, readTexts, readLayers, saveLayerImage, removeLayerImage, emitProgress = () => {} } = deps;
  const list = db.prepare(`${SELECT} ORDER BY w.position, w.id`);
  const get = db.prepare(`${SELECT} AND w.id = ?`);
  const nextPosition = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS next FROM whiteboard_slides');
  const insert = db.prepare('INSERT INTO whiteboard_slides (title, content, design, position, slide_id, folder_id, layers) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const update = db.prepare("UPDATE whiteboard_slides SET title = ?, content = ?, design = ?, updated_at = datetime('now') WHERE id = ?");
  const remove = db.prepare('DELETE FROM whiteboard_slides WHERE id = ?');
  const setPosition = db.prepare('UPDATE whiteboard_slides SET position = ? WHERE id = ?');
  const setFolder = db.prepare('UPDATE whiteboard_slides SET folder_id = ? WHERE id = ?');
  const slideIdOf = db.prepare('SELECT slide_id AS slideId FROM whiteboard_slides WHERE id = ?');
  const setOwnNotes = db.prepare("UPDATE whiteboard_slides SET notes = ?, updated_at = datetime('now') WHERE id = ?");
  const setPictureNotes = db.prepare('UPDATE announcement_slides SET notes = ? WHERE id = ?');
  const makeEditable = db.prepare(
    "UPDATE whiteboard_slides SET title = ?, content = ?, design = ?, original_slide_id = slide_id, slide_id = NULL, updated_at = datetime('now') WHERE id = ? AND slide_id IS NOT NULL",
  );
  const restore = db.prepare(
    "UPDATE whiteboard_slides SET slide_id = original_slide_id, original_slide_id = NULL, design = ?, updated_at = datetime('now') WHERE id = ? AND original_slide_id IS NOT NULL AND slide_id IS NULL",
  );
  const originalOf = db.prepare('SELECT original_slide_id AS id FROM whiteboard_slides WHERE id = ?');
  const pictureExists = db.prepare('SELECT 1 AS ok FROM announcement_slides WHERE id = ?');
  const filesOf = db.prepare('SELECT layers, design FROM whiteboard_slides WHERE id = ?');
  const fileUsed = db.prepare('SELECT 1 AS ok FROM whiteboard_slides WHERE layers LIKE ? OR design LIKE ? LIMIT 1');
  // Where a PowerPoint slide came from: the file it was imported from and its name there ("Deck - Slide 3"), whether it is still a picture or was edited.
  // Prepared when first used: they read Announcements columns that only a full database has.
  const lazy = (sql) => {
    let stmt = null;
    return { get: (...args) => (stmt ??= db.prepare(sql)).get(...args), all: (...args) => (stmt ??= db.prepare(sql)).all(...args) };
  };
  const sourceRow = lazy(`
    SELECT a.source_name AS file, a.original_name AS name, a.folder_id AS folder
    FROM whiteboard_slides w JOIN announcement_slides a ON a.id = COALESCE(w.slide_id, w.original_slide_id)
    WHERE w.id = ?`);
  const deckRows = lazy(`
    SELECT w.id AS id, w.layers AS layers, a.original_name AS name
    FROM whiteboard_slides w JOIN announcement_slides a ON a.id = COALESCE(w.slide_id, w.original_slide_id)
    WHERE a.source_name = ? AND a.folder_id = ?`);
  const deckCount = lazy('SELECT COUNT(*) AS n FROM announcement_slides WHERE source_name = ? AND folder_id = ?');
  const setLayers = db.prepare('UPDATE whiteboard_slides SET layers = ? WHERE id = ?');
  const renameSlide = db.prepare("UPDATE whiteboard_slides SET title = ?, updated_at = datetime('now') WHERE id = ?");

  const folders = db.prepare(`
    SELECT f.id, f.name,
      (SELECT COUNT(*) FROM whiteboard_slides w LEFT JOIN announcement_slides a ON a.id = w.slide_id
        WHERE w.folder_id = f.id AND ${VISIBLE}) AS count
    FROM whiteboard_folders f ORDER BY f.position, f.id`);
  const folderRow = db.prepare('SELECT id, name FROM whiteboard_folders WHERE id = ?');
  const nextFolderPosition = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS next FROM whiteboard_folders');
  const insertFolder = db.prepare('INSERT INTO whiteboard_folders (name, position) VALUES (?, ?)');
  const renameFolder = db.prepare('UPDATE whiteboard_folders SET name = ? WHERE id = ?');
  const deleteFolder = db.prepare('DELETE FROM whiteboard_folders WHERE id = ?');
  const unfileFolder = db.prepare('UPDATE whiteboard_slides SET folder_id = NULL WHERE folder_id = ?');
  const countIn = db.prepare(`SELECT COUNT(*) AS n FROM whiteboard_slides w LEFT JOIN announcement_slides a ON a.id = w.slide_id WHERE w.folder_id = ? AND ${VISIBLE}`);
  const unfiledIds = db.prepare('SELECT id FROM whiteboard_slides WHERE folder_id IS NULL');
  const countUnfiled = db.prepare(`SELECT COUNT(*) AS n FROM whiteboard_slides w LEFT JOIN announcement_slides a ON a.id = w.slide_id WHERE w.folder_id IS NULL AND ${VISIBLE}`);

  /** A folder id that exists, or null for Unfiled. Anything else is refused, so a slide never points at a folder that is gone. */
  const folderIdOf = (raw) => {
    if (raw == null) return null;
    const row = folderRow.get(Number(raw));
    if (!row) throw new Error('That folder no longer exists.');
    return row.id;
  };

  const insertSlide = (slide, folderId = null, layers = null) => {
    const { lastInsertRowid } = insert.run(slide.title, slide.content, JSON.stringify(slide.design), nextPosition.get().next, slide.slideId ?? null, folderId, layers);
    return Number(lastInsertRowid);
  };

  /** The layer pictures these slides use, read before they are deleted. */
  const layerFilesOf = (ids) => [
    ...new Set(
      ids.flatMap((id) => {
        const row = filesOf.get(id);
        return row ? `${row.layers ?? ''} ${row.design ?? ''}`.match(LAYER_IN_TEXT) ?? [] : [];
      }),
    ),
  ];
  /** Deletes the layer pictures that no slide uses any more. Call after the rows are gone. */
  const dropUnusedLayerFiles = (names) => {
    for (const name of names) {
      if (fileUsed.get(`%${name}%`, `%${name}%`)) continue;
      try {
        removeLayerImage?.(name);
      } catch {
        // A file that cannot be removed now is only wasted space.
      }
    }
  };
  const removeSlides = (ids) => {
    const files = layerFilesOf(ids);
    const removed = db.transaction(() => ids.reduce((n, id) => n + remove.run(id).changes, 0))();
    dropUnusedLayerFiles(files);
    return removed;
  };

  return {
    list: () => list.all().map(toSlide),

    get: (id) => {
      const row = get.get(Number(id));
      return row ? toSlide(row) : null;
    },

    /** Saves a slide. A new one goes into `input.folderId` (Unfiled when absent); an existing one keeps its folder. */
    save(input = {}) {
      const slide = cleanSlide(input);
      if (input.id == null) {
        return toSlide(get.get(insertSlide(slide, folderIdOf(input.folderId))));
      }
      const id = Number(input.id);
      if (update.run(slide.title, slide.content, JSON.stringify(slide.design), id).changes === 0) {
        throw new Error('That slide no longer exists.');
      }
      return toSlide(get.get(id));
    },

    remove: (id) => removeSlides([Number(id)]) > 0,

    /**
     * Changes a PowerPoint slide into an editable slide, in place: it keeps its place, folder and title, takes the text and design given, and
     * its picture is remembered so it can be brought back. The picture itself is never changed or deleted.
     */
    makeEditable(id, input = {}) {
      const slide = cleanSlide(input);
      if (makeEditable.run(slide.title, slide.content, JSON.stringify(slide.design), Number(id)).changes === 0) {
        if (!get.get(Number(id))) throw new Error('That slide no longer exists.');
        throw new Error('This slide is already editable.');
      }
      return toSlide(get.get(Number(id)));
    },

    /** Turns an edited PowerPoint slide back into its picture. The text it holds is kept, and its design goes back to the default. */
    restorePicture(id) {
      const original = originalOf.get(Number(id))?.id;
      if (original == null) throw new Error('This slide has no PowerPoint picture to go back to.');
      if (!pictureExists.get(original)) throw new Error('The PowerPoint picture was deleted, so it cannot be brought back.');
      if (restore.run(JSON.stringify(SLIDE_DESIGN_DEFAULTS), Number(id)).changes === 0) throw new Error('This slide is already its PowerPoint picture.');
      return toSlide(get.get(Number(id)));
    },

    /** Deletes several slides in one step. Resolves to how many were removed. Ids that no longer exist are skipped. */
    removeMany(ids) {
      const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger))];
      return removeSlides(wanted);
    },

    /**
     * Deletes every Unfiled slide in one step. Slides in folders are never touched. Resolves to how many the operator could see (an Unfiled
     * picture slide whose Announcements image is gone is hidden, so it is cleared too but not counted).
     */
    clearUnfiled() {
      const shown = countUnfiled.get().n;
      removeSlides(unfiledIds.all().map((row) => row.id));
      return shown;
    },

    /** Changes only a slide's title. Works for every slide, including PowerPoint slides. */
    rename(id, rawTitle) {
      const title = validSlideTitle(rawTitle);
      if (renameSlide.run(title, Number(id)).changes === 0) throw new Error('That slide no longer exists.');
      return toSlide(get.get(Number(id)));
    },

    /**
     * Saves a slide's speaker notes, cut to MAX_SLIDE_NOTES. A PowerPoint picture's notes live on its Announcements image, so they are
     * written there; every other slide keeps its own. Blank notes clear them.
     */
    setNotes(id, rawNotes) {
      const row = slideIdOf.get(Number(id));
      if (!row) throw new Error('That slide no longer exists.');
      const notes = cleanNotes(rawNotes);
      if (row.slideId != null) setPictureNotes.run(notes || null, row.slideId);
      else setOwnNotes.run(notes, Number(id));
      return toSlide(get.get(Number(id)));
    },

    /** Sets the order from the ids as given, first to last. */
    reorder(ids) {
      db.transaction(() => ids.forEach((id, i) => setPosition.run(i + 1, Number(id))))();
      return true;
    },

    listFolders: () => folders.all(),

    createFolder(rawName) {
      const name = validFolderName(rawName);
      try {
        const { lastInsertRowid } = insertFolder.run(name, nextFolderPosition.get().next);
        return { id: Number(lastInsertRowid), name, count: 0 };
      } catch (err) {
        if (isDuplicate(err)) throw duplicateError(name);
        throw err;
      }
    },

    renameFolder(id, rawName) {
      if (!folderRow.get(Number(id))) throw new Error('That folder no longer exists.');
      const name = validFolderName(rawName);
      try {
        renameFolder.run(name, Number(id));
        return true;
      } catch (err) {
        if (isDuplicate(err)) throw duplicateError(name);
        throw err;
      }
    },

    /** Removes the folder. Its slides are kept and become Unfiled. Resolves to how many slides were kept. */
    deleteFolder(id) {
      const folderId = Number(id);
      if (!folderRow.get(folderId)) throw new Error('That folder no longer exists.');
      return db.transaction(() => {
        const kept = countIn.get(folderId).n;
        unfileFolder.run(folderId);
        deleteFolder.run(folderId);
        return kept;
      })();
    },

    /**
     * Moves slides into a folder, or to Unfiled when `folderId` is null, in one transaction: either every slide moves or none does.
     * Resolves to how many slides were moved. Ids that no longer exist are skipped and not counted.
     */
    moveSlides(ids, folderId) {
      const target = folderIdOf(folderId);
      const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger))];
      return db.transaction(() => wanted.reduce((n, id) => n + Number(setFolder.run(target, id).changes), 0))();
    },

    /** The bulk "Move to folder": `{ slideIds, targetFolderId }`, where a null target means Unfiled. Resolves to how many moved. */
    moveSelectedToFolder({ slideIds, targetFolderId } = {}) {
      return this.moveSlides(slideIds, targetFolderId ?? null);
    },

    /**
     * Each visible slide of a PowerPoint becomes a picture of that slide, exactly as PowerPoint draws it: layout, images, fonts and
     * speaker notes all come through. Hidden slides are skipped. The slides go into `folderId` (Unfiled when null). Importing the
     * same file again replaces its earlier slides.
     */
    async importFile(file, folderId = null, report = () => {}) {
      const target = folderIdOf(folderId);
      report('reading');
      const pictures = await importDeck(file, report);
      // The text of each visible slide is kept with its picture: the picture cannot be edited, but its words can be searched and, in an
      // editable copy, changed. It is used only when it lines up one for one with the pictures made.
      let texts = [];
      try {
        texts = readTexts ? await readTexts(file) : [];
      } catch {
        texts = [];
      }
      if (texts.length !== pictures.length) texts = [];
      // Each slide is also taken apart, so its words, their places and its background can be edited one by one. A deck that cannot be
      // taken apart still imports: its slides can then be edited with their picture as the background.
      const layers = await this.readLayersFor(file, pictures.length, report);
      report('finishing', 0, 1);
      try {
        db.transaction(() => {
          pictures.forEach((picture, i) =>
            insertSlide({ title: picture.name, content: slideText(texts[i]), design: SLIDE_DESIGN_DEFAULTS, slideId: picture.id }, target, layers[i] ?? null),
          );
        })();
      } catch (err) {
        dropUnusedLayerFiles(layers.map((l) => JSON.parse(l).background));
        throw err;
      }
      report('finishing', 1, 1);
      return pictures.length;
    },

    /**
     * Each slide of the deck taken apart, as the JSON stored with it, one per picture. Empty when it cannot be done for this file, or the
     * slides do not line up one for one with the pictures made.
     */
    async readLayersFor(file, count, report = () => {}) {
      if (!readLayers || !saveLayerImage) return [];
      let parts;
      try {
        // One hidden window draws every slide in one go, so this step has no per-slide count.
        report('layers');
        parts = await readLayers(file);
      } catch (err) {
        console.warn(`[whiteboard] The slides of ${path.basename(file)} could not be taken apart for editing: ${err.message}`);
        return [];
      }
      if (!Array.isArray(parts) || parts.length !== count) return [];
      const saved = [];
      try {
        for (const part of parts) {
          const boxes = (Array.isArray(part.boxes) ? part.boxes : []).slice(0, MAX_TEXT_BOXES).map(sanitizeTextBox);
          saved.push(JSON.stringify({ background: await saveLayerImage(part.background), boxes }));
          report('layerImages', saved.length, parts.length);
        }
      } catch (err) {
        dropUnusedLayerFiles(saved.map((l) => JSON.parse(l).background));
        console.warn(`[whiteboard] The slide backgrounds of ${path.basename(file)} could not be saved: ${err.message}`);
        return [];
      }
      return saved;
    },

    /**
     * The PowerPoint file a slide came from, and its number there, when its words can be read again from that file: `{ file, slideNo }`, or
     * null for a slide that did not come from a .pptx file.
     */
    pptxSource(id) {
      const row = sourceRow.get(Number(id));
      if (!row?.file || !/\.pptx$/i.test(row.file)) return null;
      const slideNo = slideNoOf(row.name);
      return slideNo ? { file: row.file, slideNo } : null;
    },

    /**
     * Takes a PowerPoint slide imported before slides were taken apart, apart now, from its file. Every Whiteboard slide from the same file
     * gets its background and text boxes too, so the file is chosen only once. The file must be the same deck: it must have as many slides as
     * were imported. Resolves to the slide asked for.
     */
    async layersFromFile(id, file) {
      const source = this.pptxSource(id);
      if (!source) throw new Error('This slide did not come from a PowerPoint (.pptx) file, so its words cannot be read again.');
      if (!readLayers || !saveLayerImage) throw new Error('Slides cannot be taken apart here.');
      const { folder } = sourceRow.get(Number(id));
      const expected = deckCount.get(source.file, folder).n;
      const parts = await readLayers(file);
      if (!Array.isArray(parts) || parts.length !== expected) {
        throw new Error(`That file has ${parts?.length ?? 0} slides, but ${source.file} had ${expected} when it was imported. Choose the same PowerPoint file.`);
      }
      const replaced = [];
      for (const row of deckRows.all(source.file, folder)) {
        const part = parts[(slideNoOf(row.name) ?? 0) - 1];
        if (!part) continue;
        const boxes = (Array.isArray(part.boxes) ? part.boxes : []).slice(0, MAX_TEXT_BOXES).map(sanitizeTextBox);
        const background = await saveLayerImage(part.background);
        setLayers.run(JSON.stringify({ background, boxes }), row.id);
        replaced.push(...(String(row.layers ?? '').match(LAYER_IN_TEXT) ?? []));
      }
      dropUnusedLayerFiles(replaced);
      return toSlide(get.get(Number(id)));
    },

    /** Asks for the PowerPoint file a slide came from, then takes its slides apart. Resolves to the slide, or null if the picker was cancelled. */
    async pickLayersFile(win, id) {
      const source = this.pptxSource(id);
      if (!source) throw new Error('This slide did not come from a PowerPoint (.pptx) file, so its words cannot be read again.');
      const picked = await showOpenDialog(win, {
        title: `Choose ${source.file}`,
        defaultPath: source.file,
        properties: ['openFile'],
        filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
      });
      if (picked.canceled || picked.filePaths.length === 0) return null;
      return this.layersFromFile(id, picked.filePaths[0]);
    },

    /** Opens the file picker and imports every .pptx or .ppt chosen into `folderId`. Resolves to the number of slides added, or null if the picker was cancelled. */
    async importPowerPoint(win, folderId = null) {
      folderIdOf(folderId);
      const picked = await showOpenDialog(win, { title: 'Import PowerPoint', properties: ['openFile', 'multiSelections'], filters: [{ name: 'PowerPoint', extensions: ['pptx', 'ppt'] }] });
      if (picked.canceled) return null;
      let total = 0;
      const files = picked.filePaths;
      for (let i = 0; i < files.length; i++) {
        const report = createImportReporter({ emit: (p) => emitProgress(win, p), fileName: path.basename(files[i]), fileIndex: i, fileCount: files.length });
        total += await this.importFile(files[i], folderId, report);
      }
      return total;
    },
  };
}

/**
 * Imports a PowerPoint through Announcements into its own folder and returns the new picture slides, in slide order. A file
 * imported before has its old slides replaced there, and the Whiteboard leaves out the cards that pointed at them.
 */
async function importDeckAsPictures(announcements, file, report) {
  const existing = announcements.listFolders().folders.find((f) => f.name.toLowerCase() === POWERPOINT_FOLDER.toLowerCase());
  const folder = existing ?? announcements.createFolder(POWERPOINT_FOLDER);
  const before = new Set(announcements.listSlides(folder.id).map((s) => s.id));
  const { failed } = await announcements.importPaths(folder.id, [file], report);
  if (failed.length > 0) throw new Error(failed[0].reason);
  return announcements.listSlides(folder.id).filter((s) => s.slideType === 'image' && !before.has(s.id));
}

/** Registers the `whiteboard:*` IPC channels. Called once from the main process. */
export function setupWhiteboard(db, announcements, { onChanged = () => {}, convertPdf } = {}) {
  const layerFile = (name) => (LAYER_FILE.test(name) ? resolveAsset(getAssetRoot(), relPath(LAYER_FOLDER, name)) : null);
  const service = createWhiteboardService(db, {
    showOpenDialog: (win, options) => (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)),
    importDeck: (file, report) => importDeckAsPictures(announcements, file, report),
    emitProgress: (win, payload) => sendToWindow(win)(payload),
    readTexts: async (file) => (await readPptxSlides(file)).filter((slide) => !slide.hidden),
    readLayers: convertPdf
      ? async (file) => {
          const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'apccmma-layers-'));
          try {
            return await renderLayers(file, workDir, convertPdf);
          } finally {
            await fs.promises.rm(workDir, { recursive: true, force: true });
          }
        }
      : undefined,
    saveLayerImage: async (jpeg) => {
      const name = `${crypto.randomUUID()}.jpg`;
      await fs.promises.writeFile(layerFile(name), jpeg);
      return name;
    },
    removeLayerImage: (name) => {
      const file = layerFile(name);
      if (file) fs.rmSync(file, { force: true });
    },
  });
  // `apcc-media://wb/<file>`: a slide's background without its words.
  registerMediaRoute('wb', (name) => (LAYER_FILE.test(name) ? relPath(LAYER_FOLDER, name) : null));
  // A call that changes something tells every window afterwards, so a list open in another window (Go Live, the editor) reloads at once.
  const handle = (channel, fn, { changes = false } = {}) =>
    ipcMain.handle(`whiteboard:${channel}`, async (event, ...args) => {
      const result = await fn(BrowserWindow.fromWebContents(event.sender), ...args);
      if (changes) onChanged();
      return result;
    });
  handle('list', () => service.list());
  handle('get', (_win, id) => service.get(id));
  handle('save', (_win, input) => service.save(input), { changes: true });
  handle('delete', (_win, id) => service.remove(id), { changes: true });
  handle('reorder', (_win, ids) => service.reorder(Array.isArray(ids) ? ids : []), { changes: true });
  handle('deleteMany', (_win, ids) => service.removeMany(ids), { changes: true });
  handle('clearUnfiled', () => service.clearUnfiled(), { changes: true });
  handle('rename', (_win, id, title) => service.rename(id, title), { changes: true });
  handle('setNotes', (_win, id, notes) => service.setNotes(id, notes), { changes: true });
  handle('makeEditable', (_win, id, input) => service.makeEditable(id, input), { changes: true });
  handle('restorePicture', (_win, id) => service.restorePicture(id), { changes: true });
  handle('pptxSource', (_win, id) => service.pptxSource(id));
  handle('layersFromFile', (win, id) => service.pickLayersFile(win, id), { changes: true });
  handle('folders', () => service.listFolders());
  handle('createFolder', (_win, name) => service.createFolder(name), { changes: true });
  handle('renameFolder', (_win, id, name) => service.renameFolder(id, name), { changes: true });
  handle('deleteFolder', (_win, id) => service.deleteFolder(id), { changes: true });
  handle('move', (_win, ids, folderId) => service.moveSlides(ids, folderId), { changes: true });
  handle('moveSelectedToFolder', (_win, request) => service.moveSelectedToFolder(request), { changes: true });
  handle('importPowerPoint', (win, folderId) => service.importPowerPoint(win, folderId ?? null), { changes: true });
  return service;
}

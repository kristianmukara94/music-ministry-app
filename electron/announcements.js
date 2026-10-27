import { BrowserWindow, dialog, ipcMain } from 'electron';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ANN_LANGS, annT } from '../shared/announcements-i18n.js';
import { parseTextStyle, sanitizeTextStyle } from '../shared/text-style.js';
import { createPdfConverter } from './pdf-converter.js';
import os from 'node:os';
import { DOCUMENT_EXTENSIONS, findSoffice, pptxToPdf, readDocumentPages, readPptxSlides, renderWithPowerPoint } from './documents.js';
import { LYRICS_MIGRATIONS, LYRICS_STYLE_MIGRATIONS } from './lyrics.js';
import { LECTIONARY_ACCLAMATION_MIGRATIONS, LECTIONARY_MIGRATIONS, LECTIONARY_STYLE_MIGRATIONS } from './lectionary.js';
import { MEDIA_AUDIO_MIGRATIONS, MEDIA_MIGRATIONS } from './media.js';
import { WHITEBOARD_MIGRATIONS } from './whiteboard.js';
import { MASS_PLAN_MIGRATIONS, PLAN_BIBLE_MIGRATIONS, PLAN_COMMUNION_MIGRATIONS, PLAN_CUSTOM_MIGRATIONS, PLAN_NOTES_MIGRATIONS } from './mass-plans.js';
import { PRAYER_NOTES_MIGRATIONS, setupNotes } from './notes.js';
import { ROSARY_LITANY_MIGRATIONS } from './rosary.js';
import { BIBLE_MIGRATIONS } from './bible-seed.js';
import { ROSARY_MIGRATIONS } from './rosary.js';
import { PW_MIGRATIONS } from './pw-sessions.js';
import { SONG_CATEGORY_MIGRATIONS } from './song-categories.js';
import { TRANSFER_MIGRATIONS } from './transfer.js';
import { MEDIA_SCHEME, installMediaProtocol, registerMediaRoute } from './protocol.js';
import { assetRootFor, migrateAbsolutePaths, relPath, resolveAsset, setActiveAssetRoot } from './assets.js';

const SEED_FOLDERS = ['CBCP Oratio Imperata', 'Second Collections', 'Parish Bulletins', 'Mass Sponsors'];
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg']);
// Files that become several slides. Importing one of them again replaces the slides it made earlier.
const DECK_EXTENSIONS = new Set(['.pdf', '.pptx', '.ppt', '.docx', '.txt']);
const DIALOG_FILTER = [
  { name: 'Slides and documents', extensions: ['png', 'jpg', 'jpeg', 'pdf', 'pptx', 'ppt', 'docx', 'txt'] },
];
const IMAGE_FILTER = [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }];
// Files we write are named by UUID, so only that shape is ever served or deleted.
const MEDIA_NAME = /^[0-9a-f-]{36}\.(png|jpe?g)$/i;
const MAX_PAGES = 200;
const MAX_FOLDER_NAME = 60;
const FOLDER = 'announcements';
// One folder per deck for the pages a PDF or PowerPoint import produces: presentations/<deck id>/.
const PRESENTATIONS = 'presentations';

/**
 * Schema migrations, applied in order. PRAGMA user_version records how many have run.
 * Never edit a shipped migration; append a new one instead.
 */
const MIGRATIONS = [
  `
  CREATE TABLE announcement_folders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE announcement_slides (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id      INTEGER NOT NULL REFERENCES announcement_folders(id) ON DELETE CASCADE,
    file_path      TEXT NOT NULL,
    original_name  TEXT NOT NULL,
    kind           TEXT NOT NULL CHECK (kind IN ('image', 'pdf', 'pptx')),
    display_order  INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_announcement_slides_folder ON announcement_slides (folder_id, display_order);
  `,
  // Dual formats: image slides point at a file, text slides carry their prayer text.
  `
  CREATE TABLE announcement_slides_v2 (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id              INTEGER NOT NULL REFERENCES announcement_folders(id) ON DELETE CASCADE,
    slide_type             TEXT NOT NULL DEFAULT 'image' CHECK (slide_type IN ('image', 'text')),
    file_path              TEXT,
    original_name          TEXT NOT NULL,
    text_content           TEXT,
    background_image_path  TEXT,
    display_order          INTEGER NOT NULL DEFAULT 0,
    CHECK (
      (slide_type = 'image' AND file_path IS NOT NULL AND text_content IS NULL) OR
      (slide_type = 'text' AND text_content IS NOT NULL AND file_path IS NULL)
    )
  );
  INSERT INTO announcement_slides_v2 (id, folder_id, slide_type, file_path, original_name, display_order)
    SELECT id, folder_id, 'image', file_path, original_name, display_order FROM announcement_slides;
  DROP TABLE announcement_slides;
  ALTER TABLE announcement_slides_v2 RENAME TO announcement_slides;
  CREATE INDEX idx_announcement_slides_folder ON announcement_slides (folder_id, display_order);
  `,
];

// Speaker notes from a PowerPoint import. Only text slides carry them. NULL means the slide has none.
const NOTES_MIGRATIONS = [`ALTER TABLE announcement_slides ADD COLUMN notes TEXT;`];

// The typography and background of a text slide, as JSON (see shared/text-style.js). NULL keeps the projector's default look.
const STYLE_MIGRATIONS = [`ALTER TABLE announcement_slides ADD COLUMN style TEXT;`];

// The headline of a document slide, kept apart from its body. Manual text slides have none.
const HEADLINE_MIGRATIONS = [`ALTER TABLE announcement_slides ADD COLUMN title_text TEXT;`];

// The file a slide was imported from. Importing that file again replaces its earlier slides. NULL for slides added by hand.
const SOURCE_MIGRATIONS = [`ALTER TABLE announcement_slides ADD COLUMN source_name TEXT;`];

// Every module shares one database, so migrations from each module run in one sequence.
const ALL_MIGRATIONS = [
  ...MIGRATIONS,
  ...LYRICS_MIGRATIONS,
  ...LECTIONARY_MIGRATIONS,
  ...MEDIA_MIGRATIONS,
  ...MASS_PLAN_MIGRATIONS,
  ...BIBLE_MIGRATIONS,
  // New migrations go at the end only: user_version counts positions in this list.
  ...PLAN_BIBLE_MIGRATIONS,
  ...ROSARY_MIGRATIONS,
  ...NOTES_MIGRATIONS,
  ...HEADLINE_MIGRATIONS,
  ...SOURCE_MIGRATIONS,
  ...STYLE_MIGRATIONS,
  ...LECTIONARY_STYLE_MIGRATIONS,
  ...LYRICS_STYLE_MIGRATIONS,
  ...PLAN_CUSTOM_MIGRATIONS,
  ...ROSARY_LITANY_MIGRATIONS,
  ...PRAYER_NOTES_MIGRATIONS,
  ...PLAN_NOTES_MIGRATIONS,
  ...MEDIA_AUDIO_MIGRATIONS,
  ...WHITEBOARD_MIGRATIONS,
  ...PW_MIGRATIONS,
  ...LECTIONARY_ACCLAMATION_MIGRATIONS,
  ...PLAN_COMMUNION_MIGRATIONS,
  ...SONG_CATEGORY_MIGRATIONS,
  ...TRANSFER_MIGRATIONS,
];

const SLIDE_SELECT = `
  SELECT s.id, s.folder_id AS folderId, s.slide_type AS slideType, s.original_name AS name,
         s.text_content AS text, s.file_path AS filePath, s.background_image_path AS bgPath,
         s.notes AS notes, s.title_text AS headline, s.style AS styleJson, s.display_order AS "order"
  FROM announcement_slides s`;

/** Opens (or creates) the database, runs pending migrations, and seeds the parish folders. */
export function openDatabase(dbPath) {
  const db = new Database(dbPath);
  // Rollback journal, not WAL: WAL needs shared memory on one machine and can corrupt a
  // database on a network share. A busy timeout rides out brief lock contention instead of failing.
  db.pragma('journal_mode = DELETE');
  db.pragma('busy_timeout = 5000');
  // Proves the file is a readable database before anything else is registered against it.
  db.prepare('SELECT 1').get();
  db.pragma('foreign_keys = ON');

  let applied = db.pragma('user_version', { simple: true });
  // Databases from before migrations existed already have the v1 tables but no version number.
  const hasV1Tables = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'announcement_folders'").get();
  if (applied === 0 && hasV1Tables) {
    db.pragma('user_version = 1');
    applied = 1;
  }
  ALL_MIGRATIONS.slice(applied).forEach((sql, i) => {
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${applied + i + 1}`);
    })();
  });

  const seed = db.prepare('INSERT OR IGNORE INTO announcement_folders (name) VALUES (?)');
  db.transaction(() => SEED_FOLDERS.forEach((name) => seed.run(name)))();
  return db;
}

const langOf = (lang) => (ANN_LANGS.includes(lang) ? lang : 'en');

/**
 * Data access and file handling for Announcements. Files are written under `root` (the asset
 * folder), and the database stores their relative paths only.
 */
export function createAnnouncementService(db, root, deps) {
  const { showOpenDialog, convertPdf } = deps;

  /** A new file in the announcements folder: its relative path (stored) and absolute path (written). */
  const newAsset = (ext) => {
    const rel = relPath(FOLDER, `${randomUUID()}${ext}`);
    return { rel, abs: resolveAsset(root, rel) };
  };

  /** A new page file for one deck, in `presentations/<deck id>/`. The deck's folder is made on first use. */
  const newDeckAsset = (deckId, ext) => {
    const rel = relPath(`${PRESENTATIONS}/${deckId}`, `${randomUUID()}${ext}`);
    const abs = resolveAsset(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    return { rel, abs };
  };

  /** Removes a deck's folder once its last page file is gone. A folder that still holds files is left alone. */
  const removeDeckFolder = (deckId) => {
    try {
      fs.rmdirSync(path.join(root, PRESENTATIONS, String(deckId)));
    } catch {
      // Missing, or not empty: either way there is nothing to remove.
    }
  };

  const q = {
    folders: db.prepare(`
      SELECT f.id, f.name, f.created_at AS createdAt, COUNT(s.id) AS count
      FROM announcement_folders f
      LEFT JOIN announcement_slides s ON s.folder_id = f.id
      GROUP BY f.id
      ORDER BY f.id`),
    total: db.prepare('SELECT COUNT(*) AS n FROM announcement_slides'),
    folder: db.prepare('SELECT id, name, created_at AS createdAt FROM announcement_folders WHERE id = ?'),
    insertFolder: db.prepare('INSERT INTO announcement_folders (name) VALUES (?)'),
    renameFolder: db.prepare('UPDATE announcement_folders SET name = ? WHERE id = ?'),
    deleteFolder: db.prepare('DELETE FROM announcement_folders WHERE id = ?'),
    folderPaths: db.prepare(`
      SELECT file_path AS p FROM announcement_slides WHERE folder_id = ?
      UNION
      SELECT background_image_path AS p FROM announcement_slides WHERE folder_id = ?`),
    slidesIn: db.prepare(`${SLIDE_SELECT} WHERE s.folder_id = ? ORDER BY s.display_order, s.id`),
    slidesAll: db.prepare(`${SLIDE_SELECT} ORDER BY s.folder_id, s.display_order, s.id`),
    slideRow: db.prepare(`${SLIDE_SELECT} WHERE s.id = ?`),
    slideIdsIn: db.prepare('SELECT id FROM announcement_slides WHERE folder_id = ?'),
    setOrder: db.prepare('UPDATE announcement_slides SET display_order = ? WHERE id = ? AND folder_id = ?'),
    deleteSlide: db.prepare('DELETE FROM announcement_slides WHERE id = ?'),
    nextOrder: db.prepare('SELECT COALESCE(MAX(display_order), 0) + 1 AS n FROM announcement_slides WHERE folder_id = ?'),
    // slide_type is fixed to 'image' here: a PowerPoint or PDF page is always an image slide.
    insertImage: db.prepare(
      "INSERT INTO announcement_slides (folder_id, slide_type, file_path, original_name, display_order, notes, source_name) VALUES (?, 'image', ?, ?, ?, ?, ?)",
    ),
    insertText: db.prepare(
      "INSERT INTO announcement_slides (folder_id, slide_type, text_content, background_image_path, original_name, display_order, notes, title_text, source_name, style) VALUES (?, 'text', ?, ?, ?, ?, ?, ?, ?, ?)",
    ),
    importedFrom: db.prepare('SELECT id, file_path AS filePath, background_image_path AS bgPath FROM announcement_slides WHERE folder_id = ? AND source_name = ?'),
    referenced: db.prepare('SELECT 1 FROM announcement_slides WHERE file_path = ? OR background_image_path = ? LIMIT 1'),
    imagePath: db.prepare("SELECT file_path AS p FROM announcement_slides WHERE id = ? AND slide_type = 'image'"),
  };

  // Projector-facing shape: stored paths never leave the main process. Images are
  // addressed by slide id, backgrounds by their UUID file name.
  const toSlide = ({ filePath, bgPath, styleJson, ...row }) => ({
    ...row,
    src: row.slideType === 'image' ? `${MEDIA_SCHEME}://slide/${row.id}` : null,
    bgSrc: bgPath ? `${MEDIA_SCHEME}://bg/${path.basename(bgPath)}` : null,
    style: parseTextStyle(styleJson),
  });

  /** Deletes files that no remaining slide points at. Takes relative paths. Call after the rows are gone. */
  const removeIfUnreferenced = (rels) => {
    for (const rel of new Set(rels.filter(Boolean))) {
      const file = resolveAsset(root, rel);
      if (file && !q.referenced.get(rel, rel)) fs.rmSync(file, { force: true });
    }
  };

  const requireFolder = (id) => {
    const folder = q.folder.get(id);
    if (!folder) throw new Error('That folder no longer exists.');
    return folder;
  };

  const validName = (raw) => {
    const name = String(raw ?? '').trim();
    if (!name || name.length > MAX_FOLDER_NAME) throw new Error(`Folder name must be 1 to ${MAX_FOLDER_NAME} characters.`);
    return name;
  };

  const duplicateError = (name) => new Error(`A folder named "${name}" already exists.`);

  /** A background chosen earlier: its file name in the announcements folder, as a relative path. */
  const resolveBackground = (name) => {
    if (!MEDIA_NAME.test(name)) throw new Error('Background image is invalid. Upload it again.');
    const rel = relPath(FOLDER, name);
    if (!fs.existsSync(resolveAsset(root, rel))) throw new Error('Background image is missing. Upload it again.');
    return rel;
  };

  const insertImages = db.transaction((folderId, files) => {
    let order = q.nextOrder.get(folderId).n;
    for (const f of files) q.insertImage.run(folderId, f.rel, f.name, order++, f.notes ?? null, f.source ?? null);
  });

  /** Removes slides by id, and the files they used when nothing else uses those files. */
  const removeSlides = (rows) => {
    db.transaction(() => rows.forEach((r) => q.deleteSlide.run(r.id)))();
    removeIfUnreferenced(rows.flatMap((r) => [r.filePath, r.bgPath]));
  };

  /**
   * Each page is `{ title, body, notes }`. The title is the headline, or null. The slide's name in the
   * library is the headline, or the body's first line when there is none.
   */
  const insertTexts = db.transaction((folderId, pages, bgRel, source = null, styleJson = null) => {
    let order = q.nextOrder.get(folderId).n;
    for (const { title, body, notes } of pages) {
      const name = (title || body.split('\n')[0]).slice(0, 40);
      q.insertText.run(folderId, body, bgRel, name, order++, notes ?? null, title ?? null, source, styleJson);
    }
  });

  const listSlides = (folderId) => (folderId == null ? q.slidesAll.all() : q.slidesIn.all(folderId)).map(toSlide);

  /**
   * Imports each file on its own, so one bad file does not stop the rest. Image and PDF-page rows are
   * saved together at the end, and a file that fails leaves no orphan files. Text documents become
   * text slides as they are read. Resolves to the number of slides added and the files skipped, with reasons.
   */
  /** Reads a text document into text slides. Resolves to the number of slides added. */
  async function textDocument(folderId, source) {
    const pages = await readDocumentPages(source);
    if (pages.length > MAX_PAGES) throw new Error(`It would make ${pages.length} slides. One file can make at most ${MAX_PAGES}.`);
    insertTexts(folderId, pages, null, path.basename(source));
    return pages.length;
  }

  /**
   * Turns a deck into one 1920x1080 image per slide, so the slides look exactly as they do in PowerPoint. Each image
   * keeps its slide's speaker notes. Windows uses PowerPoint itself, and LibreOffice is the fallback. If neither renders
   * the deck, the import fails with the reason, rather than making plain-text cards.
   */
  async function pptxImageRows(folderId, source) {
    const name = path.basename(source);
    // A legacy .ppt file is a binary format with no XML, so its speaker notes cannot be read and are left empty.
    // For .pptx, hidden slides are not rendered, so the notes are matched to the visible slides only.
    const slides = path.extname(source).toLowerCase() === '.pptx'
      ? (await readPptxSlides(source)).filter((slide) => !slide.hidden)
      : null;
    const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'apccmma-pptx-'));
    try {
      const images = await renderSlideImages(source, workDir);
      if (slides && images.length !== slides.length) {
        throw new Error(`${name} has ${slides.length} slides, but ${images.length} were rendered.`);
      }
      const base = path.basename(source, path.extname(source));
      const rows = [];
      try {
        for (let i = 0; i < images.length; i++) {
          const dest = newDeckAsset(folderId, '.jpg');
          await fs.promises.writeFile(dest.abs, images[i]);
          rows.push({ rel: dest.rel, name: `${base} - Slide ${i + 1}`, notes: slides?.[i]?.notes ?? null, source: name });
        }
      } catch (err) {
        removeIfUnreferenced(rows.map((r) => r.rel));
        throw err;
      }
      return rows;
    } finally {
      await fs.promises.rm(workDir, { recursive: true, force: true });
    }
  }

  /** One JPEG per slide, from the first renderer that works: PowerPoint on Windows, then LibreOffice. */
  async function renderSlideImages(source, workDir) {
    const name = path.basename(source);
    if (process.platform === 'win32') {
      try {
        return await renderWithPowerPoint(source, workDir);
      } catch (err) {
        console.warn(`[pptx] PowerPoint could not render ${name}: ${err.message}`);
      }
    }
    if (findSoffice()) {
      try {
        return (await convertPdf(await pptxToPdf(source, workDir))).map((page) => page.jpeg);
      } catch (err) {
        console.warn(`[pptx] LibreOffice could not render ${name}: ${err.message}`);
      }
    }
    throw new Error(`${name} could not be shown as slides. Install Microsoft PowerPoint or LibreOffice on this computer, then import it again.`);
  }

  /**
   * Imports the chosen files. A deck file (PDF, PowerPoint, Word, text) that was imported before into this folder is
   * replaced: its old slides are removed after the new ones are saved, so a failed re-import keeps the old slides.
   * PowerPoint files only ever become image slides. They are never converted into text.
   */
  async function importFiles(folderId, sources) {
    const failed = [];
    const copied = [];
    const replaced = [];
    let texts = 0;
    for (const source of sources) {
      const name = path.basename(source);
      const ext = path.extname(source).toLowerCase();
      try {
        if (!fs.existsSync(source)) throw new Error('The file is no longer there.');
        const earlier = DECK_EXTENSIONS.has(ext) ? q.importedFrom.all(folderId, name) : [];
        if (IMAGE_EXT.has(ext)) {
          const dest = newAsset(ext);
          await fs.promises.copyFile(source, dest.abs);
          copied.push({ rel: dest.rel, name });
        } else if (ext === '.pdf') {
          const pages = await convertPdf(source);
          const base = path.basename(source, ext);
          const rows = [];
          try {
            for (let i = 0; i < pages.length; i++) {
              const dest = newDeckAsset(folderId, '.jpg');
              await fs.promises.writeFile(dest.abs, pages[i].jpeg);
              // The page's text is kept as its speaker notes, so the operator can read it beside the page.
              rows.push({ rel: dest.rel, name: `${base} - Page ${i + 1}`, notes: pages[i].text || null, source: name });
            }
          } catch (err) {
            removeIfUnreferenced(rows.map((r) => r.rel));
            throw err;
          }
          copied.push(...rows);
          replaced.push(...earlier);
        } else if (ext === '.pptx' || ext === '.ppt') {
          copied.push(...(await pptxImageRows(folderId, source)));
          replaced.push(...earlier);
        } else if (DOCUMENT_EXTENSIONS.includes(ext)) {
          texts += await textDocument(folderId, source);
          replaced.push(...earlier);
        } else {
          throw new Error('This file type cannot be imported.');
        }
      } catch (err) {
        failed.push({ name, reason: err.message });
      }
    }
    try {
      insertImages(folderId, copied);
    } catch (err) {
      removeIfUnreferenced(copied.map((c) => c.rel));
      throw err;
    }
    if (replaced.length > 0) removeSlides(replaced);
    return { imported: copied.length + texts, failed };
  }

  return {
    listFolders() {
      return { folders: q.folders.all(), total: q.total.get().n };
    },

    listSlides,

    createFolder(rawName) {
      const name = validName(rawName);
      try {
        const { lastInsertRowid } = q.insertFolder.run(name);
        return { ...q.folder.get(lastInsertRowid), count: 0 };
      } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') throw duplicateError(name);
        throw err;
      }
    },

    renameFolder(id, rawName) {
      requireFolder(id);
      const name = validName(rawName);
      try {
        q.renameFolder.run(name, id);
        return true;
      } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') throw duplicateError(name);
        throw err;
      }
    },

    /** Removes the folder, its slides, and any files only they used. */
    deleteFolder(id) {
      requireFolder(id);
      const paths = q.folderPaths.all(id, id).map((r) => r.p);
      q.deleteFolder.run(id);
      removeIfUnreferenced(paths);
      removeDeckFolder(id);
      return true;
    },

    /** Opens the file picker, then imports what was chosen. Resolves to null if the picker was cancelled. */
    async importSlides(folderId, lang, win) {
      requireFolder(folderId);
      const picked = await showOpenDialog(win, {
        title: annT(langOf(lang), 'dialogImport'),
        properties: ['openFiles', 'multiSelections'],
        filters: DIALOG_FILTER,
      });
      if (picked.canceled || picked.filePaths.length === 0) return null;
      return importFiles(folderId, picked.filePaths);
    },

    /** Imports files dropped onto a deck. Same rules as the picker. */
    importPaths(folderId, sources) {
      requireFolder(folderId);
      if (!Array.isArray(sources) || sources.some((s) => typeof s !== 'string')) throw new Error('No files were dropped.');
      return importFiles(folderId, sources);
    },

    /** Opens the file picker for a background, copies it into the announcements folder, and returns its file name. */
    async pickBackground(lang, win) {
      const picked = await showOpenDialog(win, {
        title: annT(langOf(lang), 'backgroundDialog'),
        properties: ['openFile'],
        filters: IMAGE_FILTER,
      });
      if (picked.canceled || picked.filePaths.length === 0) return null;
      const source = picked.filePaths[0];
      const ext = path.extname(source).toLowerCase();
      if (!IMAGE_EXT.has(ext)) throw new Error('Backgrounds must be PNG or JPEG images.');
      const dest = newAsset(ext);
      await fs.promises.copyFile(source, dest.abs);
      return path.basename(dest.rel);
    },

    /** Drops a background the operator picked but then cancelled. */
    discardBackground(name) {
      if (MEDIA_NAME.test(name)) removeIfUnreferenced([relPath(FOLDER, name)]);
      return true;
    },

    /** Saves each page as its own text slide, all sharing one background (if any). */
    /** Saves each page as a text slide. The style (font, size, colours, alignment) is checked, then stored with every page. */
    createTextSlides(folderId, pages, backgroundName, style) {
      requireFolder(folderId);
      const texts = (Array.isArray(pages) ? pages : []).map((p) => String(p ?? '').trim()).filter(Boolean);
      if (texts.length === 0) throw new Error('There is no text to save.');
      if (texts.length > MAX_PAGES) throw new Error(`A sequence can hold at most ${MAX_PAGES} slides.`);
      const bgRel = backgroundName ? resolveBackground(backgroundName) : null;
      const checked = sanitizeTextStyle(style);
      insertTexts(
        folderId,
        texts.map((body) => ({ title: null, body, notes: null })),
        bgRel,
        null,
        checked ? JSON.stringify(checked) : null,
      );
      return texts.length;
    },

    /** Receives every slide id in the folder, in the new order, and rewrites display_order in one transaction. */
    reorderSlides(folderId, ids) {
      requireFolder(folderId);
      const current = new Set(q.slideIdsIn.all(folderId).map((r) => r.id));
      const wanted = (Array.isArray(ids) ? ids : []).map(Number);
      const complete = wanted.length === current.size && new Set(wanted).size === wanted.length && wanted.every((id) => current.has(id));
      if (!complete) throw new Error('Slide order is out of date. Refresh and try again.');
      db.transaction(() => wanted.forEach((id, i) => q.setOrder.run(i + 1, id, folderId)))();
      return wanted.length;
    },

    deleteSlide(id) {
      const row = q.slideRow.get(id);
      if (!row) return false;
      q.deleteSlide.run(id);
      removeIfUnreferenced([row.filePath, row.bgPath]);
      return true;
    },

    /** Relative path of an image slide's file. The protocol resolves it against the open database's folder. */
    filePath(slideId) {
      return q.imagePath.get(slideId)?.p ?? null;
    },

    /** Relative path of a background, if the name is one we wrote and the file exists. */
    backgroundPath(name) {
      if (!MEDIA_NAME.test(name)) return null;
      const rel = relPath(FOLDER, name);
      return fs.existsSync(resolveAsset(root, rel)) ? rel : null;
    },
  };
}

function registerIpc(service) {
  // Every handler receives the calling window first, then the arguments from the preload.
  const handle = (channel, fn) =>
    ipcMain.handle(`announcements:${channel}`, (event, ...args) => fn(BrowserWindow.fromWebContents(event.sender), ...args));

  handle('folders', () => service.listFolders());
  handle('slides', (_win, folderId) => service.listSlides(folderId == null ? null : Number(folderId)));
  handle('createFolder', (_win, name) => service.createFolder(name));
  handle('renameFolder', (_win, id, name) => service.renameFolder(Number(id), name));
  handle('deleteFolder', (_win, id) => service.deleteFolder(Number(id)));
  handle('import', (win, folderId, lang) => service.importSlides(Number(folderId), lang, win));
  handle('importPaths', (_win, folderId, paths) => service.importPaths(Number(folderId), paths));
  handle('reorder', (_win, folderId, ids) => service.reorderSlides(Number(folderId), ids));
  handle('deleteSlide', (_win, id) => service.deleteSlide(Number(id)));
  handle('pickBackground', (win, lang) => service.pickBackground(lang, win));
  handle('discardBackground', (_win, name) => service.discardBackground(name));
  handle('createTextSlides', (_win, folderId, pages, backgroundName, style) =>
    service.createTextSlides(Number(folderId), pages, backgroundName, style),
  );
}

/** Announcements own the `slide` and `bg` hosts of the shared media protocol. */
function registerMediaProtocol(service) {
  registerMediaRoute('slide', (name) => service.filePath(Number(name)));
  registerMediaRoute('bg', (name) => service.backgroundPath(name));
}

/**
 * Called once from the main process after `app` is ready. Opens the database, makes its
 * folder the asset root, converts any old absolute paths, then registers IPC. Everything that
 * can fail happens before registration, so a failed attempt can be retried with another path.
 */
export function setupAnnouncements({ loadRoute, preload, dbPath }) {
  const db = openDatabase(dbPath);
  const root = assetRootFor(dbPath);
  try {
    setActiveAssetRoot(root);
    migrateAbsolutePaths(db, root);
  } catch (err) {
    db.close();
    throw err;
  }

  const converter = createPdfConverter({ loadRoute, preload });
  const service = createAnnouncementService(db, root, {
    showOpenDialog: (win, options) => (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)),
    convertPdf: (file, mode) => converter.convert(file, mode),
  });

  registerIpc(service);
  registerMediaProtocol(service);
  installMediaProtocol();

  return {
    db,
    root,
    convertPdf: (file, mode) => converter.convert(file, mode),
    close() {
      converter.dispose();
      db.close();
    },
  };
}

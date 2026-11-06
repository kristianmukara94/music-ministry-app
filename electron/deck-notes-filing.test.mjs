// Tests the deck's speaker notes editing and drag filing in the services: notes saved on Whiteboard slides (their own, or on a PowerPoint
// picture's Announcements image), and announcement slides filed into another folder in one step.
// Run with: node --test electron/deck-notes-filing.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { WHITEBOARD_MIGRATIONS, WHITEBOARD_POWERPOINT_MIGRATIONS, WHITEBOARD_FOLDER_MIGRATIONS, WHITEBOARD_RESTORE_MIGRATIONS, WHITEBOARD_LAYER_MIGRATIONS, WHITEBOARD_NOTES_MIGRATIONS, MAX_SLIDE_NOTES, createWhiteboardService } =
  await import('./whiteboard.js');
const { createAnnouncementService } = await import('./announcements.js');
const { WHITEBOARD_POWERPOINT_FOLDER } = await import('../shared/deck-items.js');

function setup() {
  const db = new DatabaseSync(':memory:');
  // The columns of Announcements the services read.
  db.exec(`
    CREATE TABLE announcement_folders (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE announcement_slides (
      id INTEGER PRIMARY KEY AUTOINCREMENT, folder_id INTEGER NOT NULL, slide_type TEXT NOT NULL DEFAULT 'text', original_name TEXT NOT NULL DEFAULT '',
      text_content TEXT, file_path TEXT, background_image_path TEXT, notes TEXT, title_text TEXT, style TEXT, source_name TEXT,
      display_order INTEGER NOT NULL DEFAULT 0
    );
  `);
  for (const sql of [...WHITEBOARD_MIGRATIONS, ...WHITEBOARD_POWERPOINT_MIGRATIONS, ...WHITEBOARD_FOLDER_MIGRATIONS, ...WHITEBOARD_RESTORE_MIGRATIONS, ...WHITEBOARD_LAYER_MIGRATIONS, ...WHITEBOARD_NOTES_MIGRATIONS]) db.exec(sql);
  // node:sqlite has no .transaction(); the services only need it to group writes.
  db.transaction = (fn) => (...args) => fn(...args);
  const wb = createWhiteboardService(db, { importDeck: async () => [] });
  const ann = createAnnouncementService(db, os.tmpdir(), { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) });
  const folder = (name) => Number(db.prepare('INSERT INTO announcement_folders (name) VALUES (?)').run(name).lastInsertRowid);
  const slide = (folderId, name, order, notes = null) =>
    Number(db.prepare('INSERT INTO announcement_slides (folder_id, original_name, text_content, display_order, notes) VALUES (?, ?, ?, ?, ?)').run(folderId, name, name, order, notes).lastInsertRowid);
  return { db, wb, ann, folder, slide };
}

test('a designed slide keeps its own notes; blank notes clear them', () => {
  const { wb } = setup();
  const s = wb.save({ title: 'Homily', content: '- one', design: {} });
  assert.equal(s.notes, null);
  assert.equal(wb.setNotes(s.id, 'Point one\r\nPoint two  ').notes, 'Point one\nPoint two');
  assert.equal(wb.get(s.id).notes, 'Point one\nPoint two');
  assert.equal(wb.setNotes(s.id, '   ').notes, null);
});

test('notes are cut to the longest allowed', () => {
  const { wb } = setup();
  const s = wb.save({ title: 'Long', content: '', design: {} });
  assert.equal(wb.setNotes(s.id, 'x'.repeat(MAX_SLIDE_NOTES + 50)).notes.length, MAX_SLIDE_NOTES);
});

test("a PowerPoint picture's notes are written on its Announcements image", () => {
  const { db, wb, folder, slide } = setup();
  const picture = slide(folder(WHITEBOARD_POWERPOINT_FOLDER), 'Deck - Slide 1', 1, 'From PowerPoint');
  const id = Number(db.prepare("INSERT INTO whiteboard_slides (title, slide_id) VALUES ('Deck', ?)").run(picture).lastInsertRowid);
  assert.equal(wb.get(id).notes, 'From PowerPoint');
  assert.equal(wb.setNotes(id, 'Rewritten').notes, 'Rewritten');
  assert.equal(db.prepare('SELECT notes FROM announcement_slides WHERE id = ?').get(picture).notes, 'Rewritten');
  assert.equal(db.prepare('SELECT notes FROM whiteboard_slides WHERE id = ?').get(id).notes, null);
});

test("an edited PowerPoint slide shows its picture's notes until its own are written, and clearing them does not bring those back", () => {
  const { db, wb, folder, slide } = setup();
  const picture = slide(folder(WHITEBOARD_POWERPOINT_FOLDER), 'Deck - Slide 1', 1, 'Original notes');
  const id = Number(db.prepare("INSERT INTO whiteboard_slides (title, slide_id) VALUES ('Deck', ?)").run(picture).lastInsertRowid);
  wb.makeEditable(id, { title: 'Deck', content: 'words', design: {} });
  assert.equal(wb.get(id).notes, 'Original notes');
  assert.equal(wb.setNotes(id, 'Mine').notes, 'Mine');
  assert.equal(wb.setNotes(id, '').notes, null);
  assert.equal(db.prepare('SELECT notes FROM announcement_slides WHERE id = ?').get(picture).notes, 'Original notes');
});

test('notes for a slide that is gone are refused', () => {
  const { wb, ann } = setup();
  assert.throws(() => wb.setNotes(999, 'x'), /no longer exists/);
  assert.throws(() => ann.setNotes(999, 'x'), /no longer exists/);
});

test('announcement notes are saved and cleared', () => {
  const { db, ann, folder, slide } = setup();
  const id = slide(folder('Bulletins'), 'Week 1', 1);
  assert.equal(ann.setNotes(id, 'Read slowly'), true);
  assert.equal(db.prepare('SELECT notes FROM announcement_slides WHERE id = ?').get(id).notes, 'Read slowly');
  ann.setNotes(id, '');
  assert.equal(db.prepare('SELECT notes FROM announcement_slides WHERE id = ?').get(id).notes, null);
});

test('picked announcement slides are filed into another folder in one step, after the slides already there', () => {
  const { db, ann, folder, slide } = setup();
  const from = folder('Bulletins');
  const to = folder('Sponsors');
  const kept = slide(to, 'Already here', 1);
  const a = slide(from, 'A', 1);
  const b = slide(from, 'B', 2);
  const c = slide(from, 'C', 3);
  assert.equal(ann.moveSlides([c, a, a, kept, 999], to), 2);
  const rows = db.prepare('SELECT id, folder_id AS folderId FROM announcement_slides WHERE folder_id = ? ORDER BY display_order').all(to);
  assert.deepEqual(rows.map((r) => r.id), [kept, c, a]);
  assert.equal(db.prepare('SELECT folder_id AS f FROM announcement_slides WHERE id = ?').get(b).f, from);
});

test("the app's PowerPoint folder neither takes nor gives slides", () => {
  const { db, ann, folder, slide } = setup();
  const system = folder(WHITEBOARD_POWERPOINT_FOLDER);
  const other = folder('Bulletins');
  const picture = slide(system, 'Deck - Slide 1', 1);
  const mine = slide(other, 'Mine', 1);
  assert.throws(() => ann.moveSlides([mine], system), /kept by the app/);
  assert.equal(ann.moveSlides([picture], folder('Elsewhere')), 0);
  assert.equal(db.prepare('SELECT folder_id AS f FROM announcement_slides WHERE id = ?').get(picture).f, system);
});

test('filing into a folder that is gone is refused', () => {
  const { ann, folder, slide } = setup();
  const id = slide(folder('Bulletins'), 'A', 1);
  assert.throws(() => ann.moveSlides([id], 999), /no longer exists/);
});

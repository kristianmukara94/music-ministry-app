// A category change while another program holds the database file: it gives up quickly with a readable message instead of holding the main
// thread (and with it, typing in the window) for the connection's full 5-second busy wait. Run with: node --test electron/song-category-lock.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CATEGORY_BUSY_MESSAGE, CATEGORY_LOCK_WAIT_MS, createSongCategoryService } from './song-categories.js';

function open(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = DELETE; PRAGMA busy_timeout = 5000;');
  db.transaction = (work) => (...args) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
  return db;
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'apcc-cat-lock-'));
  const file = join(dir, 'library.db');
  const app = open(file);
  app.exec(`
    CREATE TABLE hymns (id INTEGER PRIMARY KEY, song_category TEXT NOT NULL DEFAULT '', categories_json TEXT);
    CREATE TABLE song_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE, position INTEGER NOT NULL,
      target_mode TEXT NOT NULL DEFAULT 'ALL');
  `);
  const other = open(file);
  return { app, other, done: () => (app.close(), other.close(), rmSync(dir, { recursive: true, force: true })) };
}

const timeoutOf = (db) => Object.values(db.prepare('PRAGMA busy_timeout').get())[0];

test('adding categories back to back with nothing else on the file is immediate', () => {
  const { app, done } = setup();
  try {
    const service = createSongCategoryService(app);
    const start = performance.now();
    for (const name of ['Sample Category A', 'Sample Category B', 'Sample Category C']) service.createSongCategory({ name });
    assert.ok(performance.now() - start < 500);
    assert.deepEqual(service.listSongCategories().map((c) => c.name), ['Sample Category A', 'Sample Category B', 'Sample Category C']);
  } finally {
    done();
  }
});

test('while another program holds the write lock, add, rename and remove give up within the short wait, with a readable message', () => {
  const { app, other, done } = setup();
  try {
    const service = createSongCategoryService(app);
    const kept = service.createSongCategory({ name: 'Sample Category A' });
    other.exec('BEGIN IMMEDIATE');
    for (const change of [
      () => service.createSongCategory({ name: 'Sample Category B' }),
      () => service.renameSongCategory(kept.id, { name: 'Sample Category Renamed' }),
      () => service.deleteSongCategory(kept.id),
    ]) {
      const start = performance.now();
      assert.throws(change, { message: CATEGORY_BUSY_MESSAGE });
      const waited = performance.now() - start;
      assert.ok(waited < CATEGORY_LOCK_WAIT_MS * 3, `waited ${Math.round(waited)} ms, the connection's own wait is 5000`);
    }
    other.exec('ROLLBACK');
    // The connection's own busy wait is back for everything else, and the next try goes through.
    assert.equal(timeoutOf(app), 5000);
    assert.equal(service.createSongCategory({ name: 'Sample Category B' }).name, 'Sample Category B');
  } finally {
    done();
  }
});

test('a refused name (a repeat) still reads as itself and leaves the busy wait as it was', () => {
  const { app, done } = setup();
  try {
    const service = createSongCategoryService(app);
    service.createSongCategory({ name: 'Sample Category A' });
    assert.throws(() => service.createSongCategory({ name: 'sample category a' }), /already exists/);
    assert.equal(timeoutOf(app), 5000);
  } finally {
    done();
  }
});

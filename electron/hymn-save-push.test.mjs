// Tests that saving a hymn triggers the song push: a create, five quick edits, a save while offline, and the editor not waiting on the send.
// The hymn service and the song sync are the real ones, on the laptop's own schema in memory. Run with: node --test electron/hymn-save-push.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { HYMN_DELETE_MIGRATIONS, LYRICS_MIGRATIONS, LYRICS_STYLE_MIGRATIONS, createLyricsService } = await import('./lyrics.js');
const { MASS_PLAN_MIGRATIONS, PLAN_BIBLE_MIGRATIONS, PLAN_COMMUNION_MIGRATIONS, PLAN_CUSTOM_MIGRATIONS, PLAN_NOTES_MIGRATIONS } = await import('./mass-plans.js');
const { PW_MIGRATIONS } = await import('./pw-sessions.js');
const { SONG_CATEGORY_MIGRATIONS, createSongCategoryService } = await import('./song-categories.js');
const { TRANSFER_MIGRATIONS } = await import('./transfer.js');
const { PLAN_SYNC_MIGRATIONS } = await import('./plan-sync-schema.js');
const { createSongSync, SONG_ROWS_SQL } = await import('./song-sync.js');

function laptopDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  // As better-sqlite3 does: the transaction runs its function with the arguments it was given.
  db.transaction = (work) => (...args) => {
    db.exec('BEGIN');
    try {
      const result = work(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
  for (const sqlText of [...LYRICS_MIGRATIONS, ...LYRICS_STYLE_MIGRATIONS, ...HYMN_DELETE_MIGRATIONS, ...MASS_PLAN_MIGRATIONS, ...PLAN_BIBLE_MIGRATIONS, ...PLAN_CUSTOM_MIGRATIONS,
    ...PLAN_NOTES_MIGRATIONS, ...PW_MIGRATIONS, ...PLAN_COMMUNION_MIGRATIONS, ...SONG_CATEGORY_MIGRATIONS, ...TRANSFER_MIGRATIONS, ...PLAN_SYNC_MIGRATIONS]) {
    db.exec(sqlText);
  }
  return db;
}

/** The laptop wired as main.js wires it: a hymn save calls the song sync's notify. Pushes are counted, and timers are kept until run. */
function wired({ online = true } = {}) {
  const db = laptopDb();
  // A hymn needs a song category to be saved, so the laptop has one to choose.
  createSongCategoryService(db).createSongCategory({ name: 'General' });
  const timers = new Map();
  let next = 1;
  const pushes = [];
  const link = { online };
  const sync = createSongSync({
    readRows: () => db.prepare(SONG_ROWS_SQL).all(),
    push: async (songs) => {
      if (!link.online) throw Object.assign(new Error('Cannot reach the cloud.'), { offline: true });
      pushes.push(songs);
      return { created: 0, updated: 0, unchanged: 0, removed: 0 };
    },
    setTimer: (fn, ms) => {
      const id = next;
      next += 1;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });
  const service = createLyricsService(db, { onHymnChanged: () => sync.notify() });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  /** Runs every timer that is waiting, letting each send finish before the next. */
  async function runTimers() {
    for (const [id, t] of [...timers]) {
      if (!timers.has(id)) continue;
      timers.delete(id);
      t.fn();
      await flush();
      await flush();
    }
  }
  return { db, service, sync, pushes, timers, runTimers, link };
}

const HYMN = { title: 'Praise the Lord', composer: '', category: 'General', songCategory: 'General', language: 'EN', musicalKey: 'G', raw: 'Praise the Lord, all his works\n\nAll his works, praise the Lord' };

test('creating a hymn triggers one push, and the pushed list has the new hymn', async () => {
  const l = wired();
  l.service.createHymn(HYMN);
  assert.equal(l.pushes.length, 0, 'the save does not wait on the send');
  await l.runTimers();
  assert.equal(l.pushes.length, 1, 'one push');
  assert.deepEqual(l.pushes[0].map((s) => s.title), ['Praise the Lord']);
});

test('five quick edits trigger one push, sent after the last edit', async () => {
  const l = wired();
  const { id } = l.service.createHymn(HYMN);
  await l.runTimers();
  assert.equal(l.pushes.length, 1, 'the create was sent');
  for (let i = 1; i <= 5; i += 1) l.service.editHymn(id, { ...HYMN, title: `Praise the Lord, edit ${i}` });
  assert.equal(l.timers.size, 1, 'one send is waiting for the five edits');
  assert.equal([...l.timers.values()][0].ms, 2000, 'it waits two seconds after the last edit');
  await l.runTimers();
  assert.equal(l.pushes.length, 2, 'five edits made one push');
  assert.equal(l.pushes[1][0].title, 'Praise the Lord, edit 5', 'the push holds the last edit');
});

test('a hymn saved while offline is sent when the connection returns', async () => {
  const l = wired({ online: false });
  l.service.createHymn(HYMN);
  await l.runTimers();
  assert.equal(l.sync.status().status, 'offline');
  assert.equal(l.sync.status().unsent, true, 'the hymn is marked unsent');
  l.link.online = true;
  await l.runTimers();
  assert.equal(l.pushes.length, 1, 'sent when the connection returned');
  assert.equal(l.pushes[0][0].title, 'Praise the Lord');
  assert.equal(l.sync.status().unsent, false);
});

test('the save returns at once, even when the cloud is slow or down', () => {
  const l = wired({ online: false });
  const started = Date.now();
  l.service.createHymn(HYMN);
  assert.ok(Date.now() - started < 1000, 'the editor is not held up by the send');
});

// ---- Deleting a hymn (the same hook as create and edit) ----

test('deleting a hymn triggers one push, and the pushed list has no trace of it', async () => {
  const l = wired();
  const keep = l.service.createHymn({ ...HYMN, title: 'Keep this one' });
  const gone = l.service.createHymn({ ...HYMN, title: 'Delete this one' });
  await l.runTimers();
  assert.equal(l.pushes.length, 1, 'the two creates were sent');
  assert.equal(l.service.deleteHymn(gone.id), true);
  assert.equal(l.timers.size, 1, 'one send is waiting for the delete');
  assert.equal([...l.timers.values()][0].ms, 2000, 'it uses the same two-second wait');
  await l.runTimers();
  assert.equal(l.pushes.length, 2, 'one push for the delete');
  assert.deepEqual(l.pushes[1].map((s) => s.title), ['Keep this one'], 'only the deleted hymn is missing from the list');
  assert.ok(keep.id, 'the other hymn is still there');
});

test('deleting the last hymn sends an empty list; the server refuses it, so the last song stays on the web (see the server test)', async () => {
  const l = wired();
  const only = l.service.createHymn({ ...HYMN, title: 'The only song' });
  await l.runTimers();
  l.service.deleteHymn(only.id);
  await l.runTimers();
  assert.equal(l.pushes.length, 2, 'the delete is sent');
  assert.deepEqual(l.pushes[1], [], 'the laptop sends the empty list it has');
});

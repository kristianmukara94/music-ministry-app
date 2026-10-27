// Tests for the Recently deleted hymns: a delete hides a hymn everywhere, undo brings it back with the same id and sends it again, the
// 30-day purge removes old ones on this laptop only, the cap still applies to a larger delete, and a plan or segment that uses a deleted
// hymn keeps its reference and shows it as deleted. The laptop's schema is real and in memory. Run with: node --test electron/hymn-recycle.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { HYMN_DELETE_MIGRATIONS, LYRICS_MIGRATIONS, LYRICS_STYLE_MIGRATIONS, RECYCLE_DAYS, createLyricsService, purgeDeletedHymns } = await import('./lyrics.js');
const { MASS_PLAN_MIGRATIONS, PLAN_BIBLE_MIGRATIONS, PLAN_COMMUNION_MIGRATIONS, PLAN_CUSTOM_MIGRATIONS, PLAN_NOTES_MIGRATIONS, createMassPlanService } = await import('./mass-plans.js');
const { PW_MIGRATIONS, createPwService } = await import('./pw-sessions.js');
const { SONG_CATEGORY_MIGRATIONS, createSongCategoryService } = await import('./song-categories.js');
const { LECTIONARY_MIGRATIONS } = await import('./lectionary.js');
const { MEDIA_MIGRATIONS } = await import('./media.js');
const { BIBLE_MIGRATIONS } = await import('./bible-seed.js');
const { PRAYER_NOTES_MIGRATIONS } = await import('./notes.js');
const { TRANSFER_MIGRATIONS } = await import('./transfer.js');
const { PLAN_SYNC_MIGRATIONS } = await import('./plan-sync-schema.js');
const { createSongSync, SONG_ROWS_SQL, buildSongList } = await import('./song-sync.js');

const DAY = 24 * 60 * 60 * 1000;

function laptopDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
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
  for (const sqlText of [...LYRICS_MIGRATIONS, ...LYRICS_STYLE_MIGRATIONS, ...HYMN_DELETE_MIGRATIONS, ...MASS_PLAN_MIGRATIONS, ...PLAN_BIBLE_MIGRATIONS,
    ...PLAN_CUSTOM_MIGRATIONS, ...PLAN_NOTES_MIGRATIONS, ...PW_MIGRATIONS, ...PLAN_COMMUNION_MIGRATIONS, ...SONG_CATEGORY_MIGRATIONS, ...TRANSFER_MIGRATIONS, ...PLAN_SYNC_MIGRATIONS,
    ...LECTIONARY_MIGRATIONS, ...MEDIA_MIGRATIONS, ...BIBLE_MIGRATIONS, ...PRAYER_NOTES_MIGRATIONS]) {
    db.exec(sqlText);
  }
  // The announcement slides table is only checked for existence by the plan read, so a minimal one is enough here.
  db.exec('CREATE TABLE IF NOT EXISTS announcement_slides (id INTEGER PRIMARY KEY)');
  return db;
}

/** The laptop wired as main.js wires it: a delete, edit, create or undo asks the song sync for a send. Pushes are counted. */
function wired() {
  const db = laptopDb();
  // A hymn needs a song category to be saved, so the laptop has one to choose.
  createSongCategoryService(db).createSongCategory({ name: 'General' });
  const timers = new Map();
  let next = 1;
  const pushes = [];
  const sync = createSongSync({
    readRows: () => db.prepare(SONG_ROWS_SQL).all(),
    push: async (songs) => {
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
  async function runTimers() {
    for (const [id, t] of [...timers]) {
      if (!timers.has(id)) continue;
      timers.delete(id);
      t.fn();
      await flush();
      await flush();
    }
  }
  return { db, service, sync, pushes, timers, runTimers };
}

const hymn = (title) => ({ title, composer: '', category: 'General', songCategory: 'General', language: 'EN', musicalKey: 'G', raw: `${title}, first line\n\nSecond line of ${title}` });
const titlesIn = (list) => list.map((h) => h.title).sort();

test('a deleted hymn is hidden from the library, the search, the setlist picker and the song push list', async () => {
  const l = wired();
  l.service.createHymn(hymn('Alpha hymn'));
  const beta = l.service.createHymn(hymn('Beta hymn'));
  await l.runTimers();
  const stanzasBefore = l.db.prepare('SELECT COUNT(*) AS n FROM hymn_stanzas WHERE hymn_id = ?').get(beta.id).n;
  assert.equal(l.service.deleteHymn(beta.id), true);
  // Library and the picker, which reads the same list.
  assert.deepEqual(titlesIn(l.service.listHymns({})), ['Alpha hymn'], 'the library hides it');
  assert.deepEqual(l.service.listHymns({ search: 'Beta' }), [], 'the search does not find it');
  assert.deepEqual(titlesIn(l.service.listHymns({ songCategory: '' })), ['Alpha hymn'], 'the picker does not offer it');
  // The song push list.
  await l.runTimers();
  assert.deepEqual(buildSongList(l.db.prepare(SONG_ROWS_SQL).all()).songs.map((s) => s.title), ['Alpha hymn']);
  assert.deepEqual(l.pushes.at(-1).map((s) => s.title), ['Alpha hymn'], 'the sent list does not have it');
  // Nothing is removed from the database at delete time.
  assert.equal(l.db.prepare('SELECT COUNT(*) AS n FROM hymns').get().n, 2, 'the row is kept');
  assert.equal(l.db.prepare('SELECT COUNT(*) AS n FROM hymn_stanzas WHERE hymn_id = ?').get(beta.id).n, stanzasBefore, 'its lyrics are kept');
});

test('undo restores the same id to the library, and the song list is sent again with it', async () => {
  const l = wired();
  const beta = l.service.createHymn(hymn('Beta hymn'));
  await l.runTimers();
  l.service.deleteHymn(beta.id);
  await l.runTimers();
  assert.deepEqual(l.service.listDeletedHymns().map((h) => h.title), ['Beta hymn'], 'it is in Recently deleted');
  assert.equal(l.service.undoDeleteHymn(beta.id), true);
  const back = l.service.listHymns({}).find((h) => h.title === 'Beta hymn');
  assert.ok(back, 'it is back in the library');
  assert.equal(back.id, beta.id, 'with the same id');
  assert.equal(l.service.listDeletedHymns().length, 0, 'and it is out of Recently deleted');
  await l.runTimers();
  assert.deepEqual(l.pushes.at(-1).map((s) => s.title), ['Beta hymn'], 'the song list is sent again with it');
});

test('a hymn deleted more than 30 days ago is purged locally and is not sent; a newer one is kept', async () => {
  const l = wired();
  const old = l.service.createHymn(hymn('Old hymn'));
  const recent = l.service.createHymn(hymn('Recent hymn'));
  await l.runTimers();
  const pushesBefore = l.pushes.length;
  const now = new Date();
  l.service.deleteHymn(old.id, new Date(now.getTime() - (RECYCLE_DAYS + 1) * DAY));
  l.service.deleteHymn(recent.id, new Date(now.getTime() - (RECYCLE_DAYS - 1) * DAY));
  await l.runTimers();
  const sentBeforePurge = l.pushes.length;
  const purged = purgeDeletedHymns(l.db, now);
  assert.equal(purged, 1, 'one hymn is past the 30 days');
  assert.equal(l.db.prepare('SELECT COUNT(*) AS n FROM hymns WHERE id = ?').get(old.id).n, 0, 'the old hymn is gone from this laptop');
  assert.equal(l.db.prepare('SELECT COUNT(*) AS n FROM hymn_stanzas WHERE hymn_id = ?').get(old.id).n, 0, 'its lyrics went with it');
  assert.equal(l.db.prepare('SELECT COUNT(*) AS n FROM hymns WHERE id = ?').get(recent.id).n, 1, 'the newer one is kept');
  assert.deepEqual(l.service.listDeletedHymns(now).map((h) => h.title), ['Recent hymn'], 'and still in Recently deleted');
  assert.equal(l.pushes.length, sentBeforePurge, 'the purge sent nothing');
  assert.ok(sentBeforePurge > pushesBefore, 'the delete itself was sent, as before');
});

test('the purge is local only: it takes only the database, makes no request, and schedules nothing', async () => {
  const l = wired();
  const gone = l.service.createHymn(hymn('Gone for good'));
  await l.runTimers();
  const pushes = l.pushes.length;
  l.service.deleteHymn(gone.id, new Date(Date.now() - 40 * DAY));
  await l.runTimers();
  const sent = l.pushes.length;
  const timersBefore = l.timers.size;
  purgeDeletedHymns(l.db);
  assert.equal(l.pushes.length, sent, 'no list is pushed by the purge');
  assert.equal(l.timers.size, timersBefore, 'nothing is scheduled by the purge');
  assert.ok(sent > pushes, 'the delete was sent');
  // The server keeps the row it already has: a later push that leaves the song out marks it removed, and nothing here deletes it there.
});

test('deleting six or more hymns at once still sends one list, with all of them missing; the server\'s cap refuses a list that removes more than five', async () => {
  const l = wired();
  const hymns = Array.from({ length: 7 }, (_, i) => l.service.createHymn(hymn(`Song ${i + 1}`)));
  await l.runTimers();
  for (const h of hymns.slice(0, 6)) l.service.deleteHymn(h.id);
  await l.runTimers();
  const sent = l.pushes.at(-1);
  assert.equal(sent.length, 1, 'six of seven are gone from the list sent');
  assert.deepEqual(sent.map((s) => s.title), ['Song 7']);
  // The server refuses a push that would remove more than five songs at once (songs-sync.test.mjs, "a push that would remove 6 songs is refused").
});

test('a plan that uses a deleted hymn keeps its reference and shows it as deleted, and undo makes it live again', () => {
  const l = wired();
  const h = l.service.createHymn(hymn('Used in a plan'));
  const plans = createMassPlanService(l.db);
  const planId = Number(l.db.prepare("INSERT INTO mass_plans (name, liturgical_date) VALUES ('Sunday', '2026-11-01')").run().lastInsertRowid);
  l.db.prepare(`INSERT INTO mass_plan_items (plan_id, liturgical_block, source_module, source_id, label, display_order) VALUES (?, 'word', 'lyrics', ?, 'Used in a plan', 1)`)
    .run(planId, String(h.id));
  const live = plans.getPlan(planId).items[0];
  assert.equal(live.stale, false);
  assert.equal(live.deleted, false);

  l.service.deleteHymn(h.id);
  const deleted = plans.getPlan(planId).items[0];
  assert.equal(deleted.sourceId, String(h.id), 'the reference is kept');
  assert.equal(deleted.label, 'Used in a plan', 'the plan still names it');
  assert.equal(deleted.deleted, true, 'it is shown as deleted, not dropped');
  assert.equal(deleted.stale, true);

  l.service.undoDeleteHymn(h.id);
  const back = plans.getPlan(planId).items[0];
  assert.equal(back.deleted, false);
  assert.equal(back.stale, false, 'live again');
});

test('a praise segment that uses a deleted song shows it as deleted, and the setlist keeps the entry marked deleted', () => {
  const l = wired();
  const h = l.service.createHymn(hymn('Praise song'));
  const pw = createPwService(l.db);
  const sessionId = Number(l.db.prepare("INSERT INTO pw_sessions (name, liturgical_date, groups) VALUES ('Night', '2026-11-06', '[]')").run().lastInsertRowid);
  l.db.prepare(`INSERT INTO pw_segments (session_id, display_order, segment_key, group_key, name, type, minutes, leader, content_ref, arrangement, cues, notes)
    VALUES (?, 1, 'joyful_song', 'praise', 'Joyful', 'song', 5, '', ?, '{}', '{}', '')`)
    .run(sessionId, JSON.stringify({ kind: 'song', hymnIds: [h.id], maxSongs: 1, category: null }));
  const setlist = l.service.createSetlist({ name: 'Sunday set', date: '2026-11-01' });
  l.service.saveSetlist(setlist.id, [h.id]);

  l.service.deleteHymn(h.id);
  const seg = pw.getSession(sessionId).segments[0];
  assert.equal(seg.deleted, true, 'the segment shows the song as deleted');
  assert.equal(seg.stale, true);
  assert.deepEqual(l.service.getSetlist(setlist.id).map((e) => [e.title, e.deleted]), [['Praise song', true]], 'the setlist keeps it, marked deleted');

  l.service.undoDeleteHymn(h.id);
  assert.equal(pw.getSession(sessionId).segments[0].deleted, false);
  assert.equal(pw.getSession(sessionId).segments[0].stale, false);
});

test('a deleted hymn cannot be edited until it is restored', () => {
  const l = wired();
  const h = l.service.createHymn(hymn('Edit me later'));
  l.service.deleteHymn(h.id);
  assert.throws(() => l.service.editHymn(h.id, hymn('Changed while deleted')), /Undo the delete to change it/);
});

// The legacy Mass slot in the service, and a song's scope through export and import. Run with: node --test electron/song-scope-slot.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { HYMN_DELETE_MIGRATIONS, LYRICS_MIGRATIONS, LYRICS_STYLE_MIGRATIONS, createLyricsService } = await import('./lyrics.js');
const { MASS_PLAN_MIGRATIONS, PLAN_BIBLE_MIGRATIONS, PLAN_COMMUNION_MIGRATIONS, PLAN_CUSTOM_MIGRATIONS, PLAN_LANGUAGE_MIGRATIONS, PLAN_NOTES_MIGRATIONS } = await import('./mass-plans.js');
const { PW_MIGRATIONS } = await import('./pw-sessions.js');
const { SONG_CATEGORY_MIGRATIONS, SONG_SCOPE_MIGRATIONS } = await import('./song-categories.js');
const { TRANSFER_MIGRATIONS, applyImport, collectLibrary, decodeTransfer, encodeTransfer } = await import('./transfer.js');
const { PLAN_SYNC_MIGRATIONS } = await import('./plan-sync-schema.js');

function open() {
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
  for (const sql of [...LYRICS_MIGRATIONS, ...LYRICS_STYLE_MIGRATIONS, ...HYMN_DELETE_MIGRATIONS, ...MASS_PLAN_MIGRATIONS, ...PLAN_LANGUAGE_MIGRATIONS, ...PLAN_BIBLE_MIGRATIONS,
    ...PLAN_CUSTOM_MIGRATIONS, ...PLAN_NOTES_MIGRATIONS, ...PW_MIGRATIONS, ...PLAN_COMMUNION_MIGRATIONS, ...SONG_CATEGORY_MIGRATIONS, ...SONG_SCOPE_MIGRATIONS,
    ...TRANSFER_MIGRATIONS, ...PLAN_SYNC_MIGRATIONS]) {
    db.exec(sql);
  }
  return db;
}

const BASE = { composer: '', language: 'EN', musicalKey: '', raw: 'A line' };

function setup() {
  const db = open();
  return { db, service: createLyricsService(db) };
}

test('the Mass slot follows the scope and song category when the form sends none', () => {
  const { service } = setup();
  const slotOf = (title, primaryCategory, songCategory) => service.getHymn(service.createHymn({ ...BASE, title, primaryCategory, songCategory }).id).category;
  assert.equal(slotOf('In', 'MASS', 'Entrance Procession'), 'Entrance');
  assert.equal(slotOf('Gifts', 'MASS', 'Offertory Song'), 'Offertory');
  assert.equal(slotOf('Gifts 2', 'MASS', 'Preparation of the Gifts'), 'Offertory');
  assert.equal(slotOf('Bread', 'MASS', 'Communion Procession'), 'Communion');
  assert.equal(slotOf('Out', 'MASS', 'Recessional'), 'Recessional');
  assert.equal(slotOf('Glory', 'MASS', 'Gloria'), 'General');
  assert.equal(slotOf('Joy', 'PRAISE_AND_WORSHIP', 'Joyful Song'), 'General');
});

test('the lineup\'s Offertory slot finds a song by the slot it was given', async () => {
  const { service } = setup();
  const { fitsSegment } = await import('../shared/pw.js');
  const id = service.createHymn({ ...BASE, title: 'Gifts', primaryCategory: 'MASS', songCategory: 'Offertory Song' }).id;
  const segment = { key: 'offertory', content: { kind: 'song', category: 'Offertory' } };
  assert.equal(fitsSegment(service.getHymn(id), segment, []), true);
});

test('a caller that names a Mass slot still gets it', () => {
  const { service } = setup();
  const { id } = service.createHymn({ ...BASE, title: 'Named', category: 'Communion', primaryCategory: 'MASS', songCategory: 'Gloria' });
  assert.equal(service.getHymn(id).category, 'Communion');
});

test('an edit that leaves the scope and song category alone keeps the slot; changing either follows the new pair', () => {
  const { service } = setup();
  const form = { ...BASE, title: 'Edited', primaryCategory: 'MASS' };
  const { id } = service.createHymn({ ...form, category: 'Recessional', songCategory: 'Joyful Song' });
  service.editHymn(id, { ...form, raw: 'A new line', songCategory: 'Joyful Song' });
  assert.equal(service.getHymn(id).category, 'Recessional', 'unchanged filing keeps the slot');
  service.editHymn(id, { ...form, songCategory: 'Communion Procession' });
  assert.equal(service.getHymn(id).category, 'Communion', 'a new song category follows the new pair');
  service.editHymn(id, { ...form, primaryCategory: 'PRAISE_AND_WORSHIP', songCategory: 'Communion Procession' });
  assert.equal(service.getHymn(id).category, 'General', 'a new scope follows the new pair');
});

// ---- Export and import ----

const exportOf = (db) => decodeTransfer(encodeTransfer(collectLibrary(db, { songs: true, lyrics: true }, { laptop: 'PC1', exportedAt: '2026-10-27T05:52:00.000Z' })));
const scopesOf = (db) => Object.fromEntries(db.prepare('SELECT title, primary_category AS p FROM hymns').all().map((r) => [r.title, r.p]));

test('a song\'s scope goes into the file and comes back out of it', () => {
  const { service, db } = setup();
  service.createHymn({ ...BASE, title: 'Worship one', primaryCategory: 'PRAISE_AND_WORSHIP', songCategory: 'Worship Song' });
  service.createHymn({ ...BASE, title: 'Mass one', primaryCategory: 'MASS', songCategory: 'Gloria' });
  const data = exportOf(db);
  assert.deepEqual(Object.fromEntries(data.songs.map((s) => [s.title, s.scope])), { 'Worship one': 'PRAISE_AND_WORSHIP', 'Mass one': 'MASS' });
  const other = open();
  applyImport(other, data);
  assert.deepEqual(scopesOf(other), { 'Worship one': 'PRAISE_AND_WORSHIP', 'Mass one': 'MASS' });
});

test('a file made before scopes is read by the library rules: a Mass slot or Mass part means Mass, anything else General', () => {
  const { service, db } = setup();
  service.createHymn({ ...BASE, title: 'Slot song', category: 'Entrance', songCategory: 'Joyful Song' });
  service.createHymn({ ...BASE, title: 'Part song', category: 'General', songCategory: 'Gloria' });
  service.createHymn({ ...BASE, title: 'Plain song', category: 'General', songCategory: 'Joyful Song' });
  const data = exportOf(db);
  for (const song of data.songs) delete song.scope;
  const other = open();
  applyImport(other, data);
  assert.deepEqual(scopesOf(other), { 'Slot song': 'MASS', 'Part song': 'MASS', 'Plain song': 'GENERAL' });
});

test('a file with a scope this version does not know is read like a file with none', () => {
  const { service, db } = setup();
  service.createHymn({ ...BASE, title: 'Odd', category: 'General', songCategory: 'Joyful Song' });
  const data = exportOf(db);
  data.songs[0].scope = 'CHOIR';
  const other = open();
  applyImport(other, data);
  assert.deepEqual(scopesOf(other), { Odd: 'GENERAL' });
});

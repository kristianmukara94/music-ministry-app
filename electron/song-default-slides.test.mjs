// A song's default slide arrangement in the database (hymns.default_slides_json): saved from Go Live, read back on the next run, kept while
// the words stay the same, dropped once Song Lyrics rewrites them or Reset Default Layout clears it, and carried by export/import with the
// lyrics. The song's own words are never changed by it. Synthetic words only. Run with: node --test electron/song-default-slides.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { HYMN_DELETE_MIGRATIONS, HYMN_FILING_MIGRATIONS, HYMN_FONT_SCALE_MIGRATIONS, HYMN_DEFAULT_SLIDES_MIGRATIONS, LYRICS_MIGRATIONS, LYRICS_STYLE_MIGRATIONS, createLyricsService } = await import('./lyrics.js');
const { MASS_PLAN_MIGRATIONS, MASS_SLOT_MIGRATIONS, PLAN_BIBLE_MIGRATIONS, PLAN_COMMUNION_MIGRATIONS, PLAN_CUSTOM_MIGRATIONS, PLAN_LANGUAGE_MIGRATIONS, PLAN_NOTES_MIGRATIONS } = await import('./mass-plans.js');
const { PW_MIGRATIONS } = await import('./pw-sessions.js');
const { SONG_CATEGORY_MIGRATIONS, SONG_CATEGORY_MODE_MIGRATIONS, SONG_SCOPE_MIGRATIONS } = await import('./song-categories.js');
const { TRANSFER_MIGRATIONS, applyImport, collectLibrary, decodeTransfer, encodeTransfer } = await import('./transfer.js');
const { PLAN_SYNC_MIGRATIONS } = await import('./plan-sync-schema.js');
const { lyricsHash, resolveSongSlides } = await import('../shared/song-slides.js');

const RAW = '[Verse 1]\nSample Lyric Line One\nSample Lyric Line Two\n\n[Chorus]\nSample Chorus Line';

function makeDb() {
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
  for (const sql of [...LYRICS_MIGRATIONS, ...LYRICS_STYLE_MIGRATIONS, ...HYMN_DELETE_MIGRATIONS, ...HYMN_FILING_MIGRATIONS, ...HYMN_FONT_SCALE_MIGRATIONS, ...HYMN_DEFAULT_SLIDES_MIGRATIONS,
    ...MASS_PLAN_MIGRATIONS, ...PLAN_LANGUAGE_MIGRATIONS, ...PLAN_BIBLE_MIGRATIONS, ...PLAN_CUSTOM_MIGRATIONS, ...PLAN_NOTES_MIGRATIONS, ...PW_MIGRATIONS, ...PLAN_COMMUNION_MIGRATIONS,
    ...SONG_CATEGORY_MIGRATIONS, ...SONG_SCOPE_MIGRATIONS, ...SONG_CATEGORY_MODE_MIGRATIONS, ...MASS_SLOT_MIGRATIONS, ...TRANSFER_MIGRATIONS, ...PLAN_SYNC_MIGRATIONS]) {
    db.exec(sql);
  }
  return db;
}

function setup() {
  const db = makeDb();
  const changed = [];
  const pushed = [];
  const service = createLyricsService(db, { onLyricsChanged: (id) => changed.push(id), onHymnChanged: () => pushed.push(true) });
  service.createSongCategory({ name: 'Sample Category' });
  const input = { title: 'Sample Song Title', composer: '', language: 'EN', musicalKey: 'G', primaryCategory: 'PRAISE_AND_WORSHIP', songCategory: 'Sample Category', raw: RAW };
  const { id } = service.createHymn(input);
  pushed.length = 0;
  changed.length = 0;
  return { db, service, id, input, changed, pushed };
}

/** An operator's arrangement: the verse's two lines combined on one slide, a new slide after the chorus, the chorus formatted on its own. */
const SLIDES = [
  { label: 'Verse 1', sectionTag: 'V1', lines: ['Sample Lyric Line One Sample Lyric Line Two'] },
  { label: 'Chorus', sectionTag: 'C', lines: ['Sample Chorus Line'], style: { align: 'left', textCase: 'uppercase' }, notes: 'Sample note' },
  { label: 'Bridge', sectionTag: 'B', lines: ['Sample Bridge Line'] },
];

test('the migration adds an empty column: songs saved before it play automatically', () => {
  const { db, service, id } = setup();
  assert.equal(db.prepare('SELECT default_slides_json AS json FROM hymns WHERE id = ?').get(id).json, null);
  const hymn = service.getHymn(id);
  assert.equal(hymn.defaultSlides, null);
  assert.equal(resolveSongSlides(hymn).slideLayout, 'auto');
});

test('saving from Go Live stores the slides on the song, stamped with its words, and the next run reads them back exactly', () => {
  const { db, service, id, changed, pushed } = setup();
  const wordsBefore = db.prepare('SELECT stanza_type, lyrics_text FROM hymn_stanzas WHERE hymn_id = ? ORDER BY display_order').all(id);
  const saved = service.saveDefaultSlides(id, SLIDES);
  assert.equal(saved.lyricsHash, lyricsHash(service.getHymn(id).stanzas));
  assert.deepEqual(changed, [id], 'open windows reload the song');
  assert.deepEqual(pushed, [], 'nothing for the cloud song list changed');
  // The song's words are untouched.
  assert.deepEqual(db.prepare('SELECT stanza_type, lyrics_text FROM hymn_stanzas WHERE hymn_id = ? ORDER BY display_order').all(id), wordsBefore);

  // A restart: a new service on the same database.
  const again = createLyricsService(db).getHymn(id);
  assert.deepEqual(again.defaultSlides, saved);
  const played = resolveSongSlides(again);
  assert.equal(played.slideLayout, 'default');
  assert.deepEqual(
    played.stanzas.map((s) => [s.stanzaType, s.lyricsText, s.pages, s.look ?? null, s.notes ?? null]),
    [
      ['Verse 1', 'Sample Lyric Line One Sample Lyric Line Two', ['Sample Lyric Line One Sample Lyric Line Two'], null, null],
      ['Chorus', 'Sample Chorus Line', ['Sample Chorus Line'], { textCase: 'uppercase', align: 'left' }, 'Sample note'],
      ['Bridge', 'Sample Bridge Line', ['Sample Bridge Line'], null, null],
    ],
  );
});

test('Reset Default Layout clears the arrangement; a deleted or missing song is refused', () => {
  const { service, id } = setup();
  service.saveDefaultSlides(id, SLIDES);
  assert.equal(service.saveDefaultSlides(id, null), null);
  assert.equal(service.getHymn(id).defaultSlides, null);
  assert.equal(resolveSongSlides(service.getHymn(id)).slideLayout, 'auto');
  assert.throws(() => service.saveDefaultSlides(9999, SLIDES), /no longer exists/);
  assert.throws(() => service.saveDefaultSlides(id, [{ label: 'Verse 1', lines: [' '] }]), /needs some words/);
  service.deleteHymn(id);
  assert.throws(() => service.saveDefaultSlides(id, SLIDES), /deleted/);
});

test('rewriting the words in Song Lyrics clears the arrangement; saving the song with the same words keeps it', () => {
  const { service, id, input } = setup();
  service.saveDefaultSlides(id, SLIDES);
  // Same words, another title: the arrangement still fits.
  service.editHymn(id, { ...input, title: 'Sample Song Title Renamed' });
  assert.ok(service.getHymn(id).defaultSlides);
  assert.equal(resolveSongSlides(service.getHymn(id)).slideLayout, 'default');
  // New words: the song is paged automatically again.
  service.editHymn(id, { ...input, raw: `${RAW}\n\n[Verse 2]\nSample Lyric Line Three` });
  assert.equal(service.getHymn(id).defaultSlides, null);
  assert.equal(resolveSongSlides(service.getHymn(id)).slideLayout, 'auto');
});

test('export with lyrics carries the arrangement, and import restores it with the words', () => {
  const { db, service, id } = setup();
  service.saveDefaultSlides(id, SLIDES);
  const saved = service.getHymn(id).defaultSlides;
  const data = decodeTransfer(encodeTransfer(collectLibrary(db, { songs: true, lyrics: true }, { laptop: 'PC1', exportedAt: '2026-11-21T00:00:00.000Z' })));
  assert.deepEqual(data.songs[0].defaultSlides, saved);

  const target = makeDb();
  applyImport(target, data);
  const imported = createLyricsService(target).getHymn(target.prepare('SELECT id FROM hymns').get().id);
  assert.deepEqual(imported.defaultSlides, saved);
  assert.equal(resolveSongSlides(imported).slideLayout, 'default');
  assert.deepEqual(resolveSongSlides(imported).stanzas.map((s) => s.lyricsText), SLIDES.map((s) => s.lines.join('\n')));
});

test('export without lyrics leaves the arrangement out, and an arrangement for other words is not imported', () => {
  const { db, service, id } = setup();
  service.saveDefaultSlides(id, SLIDES);
  const bare = collectLibrary(db, { songs: true, lyrics: false }, { laptop: 'PC1' });
  assert.equal('defaultSlides' in bare.songs[0], false, 'no lyric text leaves the laptop');

  const data = decodeTransfer(encodeTransfer(collectLibrary(db, { songs: true, lyrics: true }, { laptop: 'PC1' })));
  data.songs[0].lyrics[0].lyricsText = 'Sample Lyric Line Changed';
  const target = makeDb();
  applyImport(target, data);
  const imported = createLyricsService(target).getHymn(target.prepare('SELECT id FROM hymns').get().id);
  assert.equal(imported.defaultSlides, null);
});

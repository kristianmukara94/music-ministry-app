// Splitting a stanza that is too long for one slide: the song gets two stanzas under the same label, the first keeps the stanza's id, and
// every saved lineup that sings the song in its own order gets the second half after the first. Run with: node --test electron/stanza-split.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { HYMN_DELETE_MIGRATIONS, LYRICS_MIGRATIONS, LYRICS_STYLE_MIGRATIONS, createLyricsService } = await import('./lyrics.js');
const { MASS_PLAN_MIGRATIONS, PLAN_BIBLE_MIGRATIONS, PLAN_COMMUNION_MIGRATIONS, PLAN_CUSTOM_MIGRATIONS, PLAN_LANGUAGE_MIGRATIONS, PLAN_NOTES_MIGRATIONS } = await import('./mass-plans.js');
const { PW_MIGRATIONS } = await import('./pw-sessions.js');
const { SONG_CATEGORY_MIGRATIONS, SONG_SCOPE_MIGRATIONS } = await import('./song-categories.js');
const { TRANSFER_MIGRATIONS } = await import('./transfer.js');
const { PLAN_SYNC_MIGRATIONS } = await import('./plan-sync-schema.js');

function setup() {
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
  const service = createLyricsService(db);
  const { id } = service.createHymn({
    title: 'Long Song',
    composer: '',
    language: 'EN',
    musicalKey: 'G',
    category: 'Offertory',
    primaryCategory: 'MASS',
    songCategory: 'Offertory Song',
    raw: '[Verse 1]\nOne\nTwo\nThree\nFour\n\n[Chorus]\nSing\nAloud\n\n[Verse 2]\nLast line',
  });
  return { db, service, id };
}

/** A saved lineup segment that sings the song in its own order. */
function lineup(db, hymnId, order) {
  const session = Number(db.prepare("INSERT INTO pw_sessions (name, liturgical_date, groups) VALUES ('Night', '2026-11-01', '[]')").run().lastInsertRowid);
  db.prepare(
    `INSERT INTO pw_segments (session_id, display_order, segment_key, group_key, name, type, minutes, leader, content_ref, arrangement, cues, notes)
     VALUES (?, 1, 'worship', 'praise', 'Worship', 'song', 10, '', ?, ?, '{}', '')`,
  ).run(session, JSON.stringify({ kind: 'song', hymnIds: [hymnId], maxSongs: 1, category: null }), JSON.stringify({ [String(hymnId)]: order }));
  return () => JSON.parse(db.prepare('SELECT arrangement FROM pw_segments WHERE session_id = ?').get(session).arrangement)[String(hymnId)];
}

test('a split stanza becomes two stanzas in its place, both with its label, and the rest of the song is unchanged', () => {
  const { service, id } = setup();
  const before = service.getHymn(id);
  service.splitStanza(id, 0, ['One\nTwo', 'Three\nFour']);
  const after = service.getHymn(id);
  assert.deepEqual(after.stanzas.map((s) => [s.stanzaType, s.lyricsText]), [
    ['Verse 1', 'One\nTwo'],
    ['Verse 1', 'Three\nFour'],
    ['Chorus', 'Sing\nAloud'],
    ['Verse 2', 'Last line'],
  ]);
  assert.equal(after.stanzas[0].id, before.stanzas[0].id, 'the first half keeps the stanza id');
  assert.ok(!before.stanzas.some((s) => s.id === after.stanzas[1].id), 'the second half is a new stanza');
  assert.equal(after.stanzas[2].id, before.stanzas[1].id, 'the chorus keeps its id after moving down');
});

test('the song keeps its details, scope, song category and Mass slot', () => {
  const { service, id } = setup();
  service.splitStanza(id, 0, ['One\nTwo', 'Three\nFour']);
  const after = service.getHymn(id);
  assert.deepEqual([after.title, after.musicalKey, after.primaryCategory, after.songCategory, after.category], ['Long Song', 'G', 'MASS', 'Offertory Song', 'Offertory']);
});

test('a saved lineup with its own order gets the second half after every appearance of the first', () => {
  const { db, service, id } = setup();
  const [v1, chorus, v2] = service.getHymn(id).stanzas.map((s) => String(s.id));
  const order = lineup(db, id, [v1, chorus, v1, chorus, v2]);
  const result = service.splitStanza(id, 0, ['One\nTwo', 'Three\nFour']);
  const second = String(result.secondId);
  assert.deepEqual(order(), [v1, second, chorus, v1, second, chorus, v2]);
  assert.equal(result.lineupsChanged, 1);
  assert.equal(String(result.firstId), v1);
});

test('a lineup that does not list the stanza is left as it was', () => {
  const { db, service, id } = setup();
  const [, chorus, v2] = service.getHymn(id).stanzas.map((s) => String(s.id));
  const order = lineup(db, id, [chorus, v2]);
  assert.equal(service.splitStanza(id, 0, ['One\nTwo', 'Three\nFour']).lineupsChanged, 0);
  assert.deepEqual(order(), [chorus, v2]);
});

test('a split with an empty half, a stanza that is not there, or a deleted song is refused, and nothing changes', () => {
  const { service, id } = setup();
  const before = JSON.stringify(service.getHymn(id).stanzas);
  assert.throws(() => service.splitStanza(id, 0, ['One', '   ']), /Both halves/);
  assert.throws(() => service.splitStanza(id, 9, ['a', 'b']), /not in the song/);
  assert.throws(() => service.splitStanza(id, 0, null), /Both halves/);
  assert.equal(JSON.stringify(service.getHymn(id).stanzas), before);
  service.deleteHymn(id);
  assert.throws(() => service.splitStanza(id, 0, ['a', 'b']), /no longer exists/);
});

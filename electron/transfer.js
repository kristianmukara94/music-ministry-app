// Export and import of the library: plans, setlists, Praise & Worship sessions and songs, in one .apccmma file.
// Pure of Electron: the database handle and the laptop name are passed in, so the tests run under plain Node.
//
// Every record has a UUID that is set once and never changed (the `uuid` column), and an `updated_at` that the database
// sets on every change (triggers, below). Import matches records by UUID first. Songs also match by title and language,
// so the same song is not added twice under two IDs; that match is remembered in transfer_song_aliases.
import crypto from 'node:crypto';

export const TRANSFER_FORMAT = 'apccmma-library';
export const TRANSFER_FORMAT_VERSION = 1;
export const TRANSFER_EXTENSION = '.apccmma';
export const TRANSFER_TYPES = ['songs', 'setlists', 'plans', 'praiseWorship'];

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// ---- Migration -------------------------------------------------------------------------------------------------------

const UUID_SQL = `(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))))`;
const STAMP_SQL = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
// While an import runs, the touch triggers stand down: the import writes each record's own updated_at.
const IMPORT_GUARD = 'transfer_import_guard';
const NOT_IMPORTING = `NOT EXISTS (SELECT 1 FROM ${IMPORT_GUARD})`;

/** The records that get a UUID and updated_at, each with the child tables whose changes count as a change to it. */
const RECORDS = [
  { table: 'hymns', children: [['hymn_stanzas', 'hymn_id'], ['pw_hymn_tags', 'hymn_id']] },
  { table: 'setlists', children: [['setlist_items', 'setlist_id']] },
  { table: 'mass_plans', children: [['mass_plan_items', 'plan_id']] },
  { table: 'pw_sessions', children: [['pw_segments', 'session_id']] },
];

function identitySql(table) {
  return `
  ALTER TABLE ${table} ADD COLUMN uuid TEXT;
  ALTER TABLE ${table} ADD COLUMN updated_at TEXT;
  UPDATE ${table} SET uuid = ${UUID_SQL},
    updated_at = COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', created_at), ${STAMP_SQL})
    WHERE uuid IS NULL;
  CREATE UNIQUE INDEX idx_${table}_uuid ON ${table} (uuid);
  -- A new row gets its UUID and time here, whichever code inserted it.
  CREATE TRIGGER ${table}_identity AFTER INSERT ON ${table} WHEN NEW.uuid IS NULL OR NEW.updated_at IS NULL BEGIN
    UPDATE ${table} SET uuid = COALESCE(NEW.uuid, ${UUID_SQL}), updated_at = COALESCE(NEW.updated_at, ${STAMP_SQL}) WHERE id = NEW.id;
  END;
  -- A UUID is set once. Nothing may change it afterwards.
  CREATE TRIGGER ${table}_uuid_fixed BEFORE UPDATE OF uuid ON ${table} WHEN OLD.uuid IS NOT NULL AND NEW.uuid IS NOT OLD.uuid BEGIN
    SELECT RAISE(ABORT, 'A record ID cannot be changed.');
  END;
  -- Any change that does not set updated_at itself stamps it now. Import sets it explicitly, so the guard keeps it.
  CREATE TRIGGER ${table}_touch AFTER UPDATE ON ${table} WHEN NEW.updated_at IS OLD.updated_at AND ${NOT_IMPORTING} BEGIN
    UPDATE ${table} SET updated_at = ${STAMP_SQL} WHERE id = NEW.id;
  END;`;
}

function childSql(child, fk, parent) {
  const stamp = (ref) => `UPDATE ${parent} SET updated_at = ${STAMP_SQL} WHERE id = ${ref};`;
  return `
  CREATE TRIGGER ${child}_touch_insert AFTER INSERT ON ${child} WHEN ${NOT_IMPORTING} BEGIN ${stamp(`NEW.${fk}`)} END;
  CREATE TRIGGER ${child}_touch_update AFTER UPDATE ON ${child} WHEN ${NOT_IMPORTING} BEGIN ${stamp(`NEW.${fk}`)} ${stamp(`OLD.${fk}`)} END;
  CREATE TRIGGER ${child}_touch_delete AFTER DELETE ON ${child} WHEN ${NOT_IMPORTING} BEGIN ${stamp(`OLD.${fk}`)} END;`;
}

/**
 * Adds UUIDs and updated_at to the four record types, keeps updated_at current through triggers, and adds the table that
 * links a title-matched song to its ID. Appended last: the plan item table is rebuilt by earlier migrations, which would
 * drop triggers on it. A later migration that rebuilds one of these tables must recreate its triggers.
 */
export const TRANSFER_MIGRATIONS = [
  [
    `CREATE TABLE ${IMPORT_GUARD} (active INTEGER PRIMARY KEY CHECK (active = 1));`,
    ...RECORDS.map((r) => identitySql(r.table)),
    ...RECORDS.flatMap((r) => r.children.map(([child, fk]) => childSql(child, fk, r.table))),
    `CREATE TABLE transfer_song_aliases (
       imported_uuid  TEXT PRIMARY KEY,
       hymn_id        INTEGER NOT NULL REFERENCES hymns(id) ON DELETE CASCADE
     );`,
  ].join('\n'),
];

// ---- File format -----------------------------------------------------------------------------------------------------

// The checksum line is the last thing in the file. Its checksum covers every byte before that line.
const CHECKSUM_LINE = /,\n  "checksum": "([0-9a-f]{64})"\n\}\n?$/;

/** The text of a .apccmma file. The checksum is SHA-256 of everything before its own line. */
export function encodeTransfer(data) {
  const body = JSON.stringify(data, null, 2);
  const head = body.slice(0, -2);
  return `${head},\n  "checksum": "${sha256(head)}"\n}\n`;
}

/** Reads a .apccmma file's text. Throws a message the operator can read when the file is damaged or of another format. */
export function decodeTransfer(text) {
  const line = CHECKSUM_LINE.exec(String(text));
  if (!line) throw new Error('This file is damaged or is not an APCCMMA library file. Nothing was imported.');
  const head = text.slice(0, line.index);
  if (sha256(head) !== line[1]) throw new Error('The checksum does not match, so this file is damaged. Nothing was imported.');
  let data;
  try {
    data = JSON.parse(`${head}\n}`);
  } catch {
    throw new Error('This file is damaged. Nothing was imported.');
  }
  if (data?.format !== TRANSFER_FORMAT) throw new Error('This is not an APCCMMA library file. Nothing was imported.');
  if (data.formatVersion !== TRANSFER_FORMAT_VERSION) {
    throw new Error(`This file is format version ${data.formatVersion}. This version of APCCMMA reads version ${TRANSFER_FORMAT_VERSION}. Nothing was imported.`);
  }
  return data;
}

// ---- Export ----------------------------------------------------------------------------------------------------------

const parseJson = (text, fallback) => {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

function readSetlists(db) {
  const items = db.prepare('SELECT setlist_id AS setlistId, hymn_id AS hymnId FROM setlist_items ORDER BY setlist_id, position').all();
  return db
    .prepare('SELECT id, uuid, name, date, updated_at AS updatedAt FROM setlists ORDER BY date, id')
    .all()
    .map((row) => ({ ...row, hymnIds: items.filter((i) => i.setlistId === row.id).map((i) => i.hymnId) }));
}

function readPlans(db) {
  const items = db
    .prepare(
      `SELECT plan_id AS planId, liturgical_block AS liturgicalBlock, source_module AS sourceModule, source_id AS sourceId,
              label, display_order AS displayOrder FROM mass_plan_items ORDER BY plan_id, display_order`,
    )
    .all();
  return db
    .prepare('SELECT id, uuid, name, liturgical_date AS liturgicalDate, updated_at AS updatedAt FROM mass_plans ORDER BY liturgical_date, id')
    .all()
    .map((row) => ({ ...row, items: items.filter((i) => i.planId === row.id) }));
}

function readSessions(db) {
  const segments = db
    .prepare(
      `SELECT session_id AS sessionId, display_order AS displayOrder, segment_key AS segmentKey, group_key AS groupKey, name, type,
              minutes, leader, content_ref AS contentRef, arrangement, cues, notes FROM pw_segments ORDER BY session_id, display_order`,
    )
    .all();
  return db
    .prepare('SELECT id, uuid, name, liturgical_date AS liturgicalDate, groups, updated_at AS updatedAt FROM pw_sessions ORDER BY liturgical_date, id')
    .all()
    .map((row) => ({
      ...row,
      groups: parseJson(row.groups, []),
      segments: segments
        .filter((s) => s.sessionId === row.id)
        .map((s) => ({
          ...s,
          contentRef: parseJson(s.contentRef, {}),
          arrangement: parseJson(s.arrangement, {}),
          cues: parseJson(s.cues, {}),
        })),
    }));
}

/** The stanza ids of a song in the order it is sung and shown. Import and export use the same order, so an index means the same stanza. */
function stanzaIdsOf(db, hymnId) {
  return db.prepare('SELECT id FROM hymn_stanzas WHERE hymn_id = ? ORDER BY display_order, id').all(hymnId).map((r) => r.id);
}

/**
 * The library as the export file holds it. A record type is included only when it is asked for, but a song that a
 * chosen setlist, plan or session uses always comes with it, so the file stands on its own. Lyrics are included only
 * when asked for; without them, no lyric text leaves the laptop and song arrangements are left out.
 */
export function collectLibrary(db, options, { laptop, exportedAt = new Date().toISOString() } = {}) {
  const hymns = db
    .prepare(
      `SELECT id, uuid, title, composer, category, language, musical_key AS musicalKey, song_category AS songCategory,
              updated_at AS updatedAt FROM hymns WHERE deleted_at IS NULL ORDER BY id`,
    )
    .all();
  const hymnById = new Map(hymns.map((h) => [h.id, h]));
  const setlists = options.setlists ? readSetlists(db) : [];
  const plans = options.plans ? readPlans(db) : [];
  const sessions = options.praiseWorship ? readSessions(db) : [];

  const needed = new Set(options.songs ? hymns.map((h) => h.id) : []);
  for (const s of setlists) s.hymnIds.forEach((id) => needed.add(id));
  for (const p of plans) for (const i of p.items) if (i.sourceModule === 'lyrics') needed.add(Number(i.sourceId));
  for (const w of sessions) for (const seg of w.segments) (seg.contentRef.hymnIds ?? []).forEach((id) => needed.add(id));

  const tagRows = db.prepare('SELECT hymn_id AS hymnId, segment_key AS segmentKey FROM pw_hymn_tags').all();
  const stanzaRows = options.lyrics
    ? db.prepare('SELECT id, hymn_id AS hymnId, stanza_type AS stanzaType, lyrics_text AS lyricsText, display_order AS displayOrder FROM hymn_stanzas ORDER BY hymn_id, display_order, id').all()
    : [];

  const songs = hymns
    .filter((h) => needed.has(h.id))
    .map((h) => {
      const song = {
        id: h.uuid,
        title: h.title,
        composer: h.composer,
        category: h.category,
        language: h.language,
        musicalKey: h.musicalKey,
        songCategory: h.songCategory,
        updatedAt: h.updatedAt,
        tags: tagRows.filter((t) => t.hymnId === h.id).map((t) => t.segmentKey).sort(),
      };
      if (options.lyrics) {
        song.lyrics = stanzaRows
          .filter((s) => s.hymnId === h.id)
          .map((s) => ({ stanzaType: s.stanzaType, lyricsText: s.lyricsText, displayOrder: s.displayOrder }));
      }
      return song;
    });
  const uuidOf = (hymnId) => hymnById.get(hymnId)?.uuid ?? null;

  const setlistsOut = setlists.map((s) => ({
    id: s.uuid,
    name: s.name,
    date: s.date,
    updatedAt: s.updatedAt,
    songs: s.hymnIds.map(uuidOf).filter(Boolean),
  }));

  const plansOut = plans.map((p) => ({
    id: p.uuid,
    name: p.name,
    liturgicalDate: p.liturgicalDate,
    updatedAt: p.updatedAt,
    // A lyrics item points at a song by its UUID. One whose song is gone is left out.
    items: p.items
      .map((i) => (i.sourceModule === 'lyrics' ? { ...i, sourceId: uuidOf(Number(i.sourceId)) } : i))
      .filter((i) => i.sourceId !== null)
      .map(({ planId, ...item }) => item),
  }));

  const sessionsOut = sessions.map((w) => ({
    id: w.uuid,
    name: w.name,
    liturgicalDate: w.liturgicalDate,
    groups: w.groups,
    updatedAt: w.updatedAt,
    segments: w.segments.map((seg) => {
      const contentRef = seg.contentRef.kind === 'song'
        ? { ...seg.contentRef, hymnIds: (seg.contentRef.hymnIds ?? []).map(uuidOf).filter(Boolean) }
        : seg.contentRef;
      return {
        displayOrder: seg.displayOrder,
        segmentKey: seg.segmentKey,
        groupKey: seg.groupKey,
        name: seg.name,
        type: seg.type,
        minutes: seg.minutes,
        leader: seg.leader,
        notes: seg.notes,
        contentRef,
        arrangement: arrangementToFile(db, seg.arrangement, options.lyrics),
        cues: seg.cues,
      };
    }),
  }));

  const data = {
    format: TRANSFER_FORMAT,
    formatVersion: TRANSFER_FORMAT_VERSION,
    exportedAt,
    laptop: laptop ?? '',
    includesLyrics: Boolean(options.lyrics),
    counts: { songs: songs.length, setlists: setlistsOut.length, plans: plansOut.length, praiseWorship: sessionsOut.length },
    songs,
    setlists: setlistsOut,
    plans: plansOut,
    praiseWorship: sessionsOut,
  };
  return data;
}

/** An arrangement keyed by song UUID, with each stanza as its index in the song. Without lyrics there is nothing to index, so it is dropped. */
function arrangementToFile(db, arrangement, withLyrics) {
  if (!withLyrics) return {};
  const out = {};
  for (const [hymnKey, stanzaIds] of Object.entries(arrangement ?? {})) {
    const hymnId = Number(hymnKey);
    if (!Array.isArray(stanzaIds)) continue;
    const order = stanzaIdsOf(db, hymnId).map(String);
    const indices = stanzaIds.map((id) => order.indexOf(String(id))).filter((i) => i >= 0);
    if (indices.length === 0) continue;
    const uuid = db.prepare('SELECT uuid FROM hymns WHERE id = ?').get(hymnId)?.uuid;
    if (uuid) out[uuid] = indices;
  }
  return out;
}

// ---- Import ----------------------------------------------------------------------------------------------------------

const titleKey = (title, language) => `${String(title ?? '').trim().toLowerCase()}\u0000${String(language ?? '').trim().toLowerCase()}`;

/**
 * Sorts every record in the file into NEW (added), SAME (already here, skipped) or CHANGED (here with a different
 * updated_at; the operator chooses). Reads only: nothing is written here.
 */
export function planImport(db, data) {
  const hymns = db.prepare('SELECT id, uuid, title, language, updated_at AS updatedAt FROM hymns ORDER BY id').all();
  const hymnById = new Map(hymns.map((h) => [h.id, h]));
  const hymnByUuid = new Map(hymns.filter((h) => h.uuid).map((h) => [h.uuid, h]));
  const hymnByTitle = new Map();
  for (const h of hymns) if (!hymnByTitle.has(titleKey(h.title, h.language))) hymnByTitle.set(titleKey(h.title, h.language), h);
  const aliases = new Map(db.prepare('SELECT imported_uuid AS importedUuid, hymn_id AS hymnId FROM transfer_song_aliases').all().map((a) => [a.importedUuid, a.hymnId]));

  const songs = (data.songs ?? []).map((record) => {
    let local = hymnByUuid.get(record.id);
    let viaTitle = false;
    if (!local && aliases.has(record.id)) local = hymnById.get(aliases.get(record.id));
    if (!local) {
      local = hymnByTitle.get(titleKey(record.title, record.language));
      viaTitle = Boolean(local);
    }
    if (!local) return { record, status: 'new', localId: null, viaTitle: false };
    return { record, status: local.updatedAt === record.updatedAt ? 'same' : 'changed', localId: local.id, localUpdatedAt: local.updatedAt, viaTitle };
  });

  const matchRecords = (table, list) => {
    const locals = new Map(db.prepare(`SELECT id, uuid, updated_at AS updatedAt FROM ${table}`).all().filter((r) => r.uuid).map((r) => [r.uuid, r]));
    return (list ?? []).map((record) => {
      const local = locals.get(record.id);
      if (!local) return { record, status: 'new', localId: null };
      return { record, status: local.updatedAt === record.updatedAt ? 'same' : 'changed', localId: local.id, localUpdatedAt: local.updatedAt };
    });
  };

  return {
    songs,
    setlists: matchRecords('setlists', data.setlists),
    plans: matchRecords('mass_plans', data.plans),
    praiseWorship: matchRecords('pw_sessions', data.praiseWorship),
  };
}

const NAMES = { songs: (r) => r.title, setlists: (r) => r.name, plans: (r) => r.name, praiseWorship: (r) => r.name };

/** The preview the operator sees before anything is written. */
export function previewImport(db, data) {
  const plan = planImport(db, data);
  const counts = {};
  const changed = [];
  for (const type of TRANSFER_TYPES) {
    counts[type] = { new: 0, same: 0, changed: 0 };
    for (const entry of plan[type]) {
      counts[type][entry.status] += 1;
      if (entry.status === 'changed') {
        changed.push({
          key: `${type}:${entry.record.id}`,
          type,
          name: NAMES[type](entry.record) ?? '',
          localUpdatedAt: entry.localUpdatedAt,
          importedUpdatedAt: entry.record.updatedAt,
        });
      }
    }
  }
  const totals = TRANSFER_TYPES.reduce(
    (sum, type) => ({ new: sum.new + counts[type].new, same: sum.same + counts[type].same, changed: sum.changed + counts[type].changed }),
    { new: 0, same: 0, changed: 0 },
  );
  const notes = [];
  if (!data.includesLyrics && counts.songs.new > 0) {
    notes.push(`The file has no lyrics. ${counts.songs.new} new song${counts.songs.new === 1 ? '' : 's'} will be added without lyrics.`);
  }
  return {
    laptop: data.laptop ?? '',
    exportedAt: data.exportedAt ?? '',
    includesLyrics: Boolean(data.includesLyrics),
    counts,
    totals,
    changed,
    notes,
  };
}

// ---- Writing ---------------------------------------------------------------------------------------------------------

function writeSongDetails(db, hymnId, record) {
  if (Array.isArray(record.tags)) {
    db.prepare('DELETE FROM pw_hymn_tags WHERE hymn_id = ?').run(hymnId);
    const tag = db.prepare('INSERT OR IGNORE INTO pw_hymn_tags (hymn_id, segment_key) VALUES (?, ?)');
    for (const key of record.tags) tag.run(hymnId, String(key));
  }
  if (Array.isArray(record.lyrics)) {
    db.prepare('DELETE FROM hymn_stanzas WHERE hymn_id = ?').run(hymnId);
    const stanza = db.prepare('INSERT INTO hymn_stanzas (hymn_id, stanza_type, lyrics_text, display_order) VALUES (?, ?, ?, ?)');
    record.lyrics.forEach((s, i) => stanza.run(hymnId, s.stanzaType, s.lyricsText, s.displayOrder ?? i));
  }
}

function insertSong(db, record) {
  const info = db
    .prepare(
      `INSERT INTO hymns (title, composer, category, language, musical_key, song_category, uuid, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(record.title, record.composer ?? '', record.category, record.language, record.musicalKey ?? '', record.songCategory ?? '', record.id, record.updatedAt);
  const id = Number(info.lastInsertRowid);
  writeSongDetails(db, id, record);
  return id;
}

function overwriteSong(db, hymnId, record) {
  db.prepare(
    `UPDATE hymns SET title = ?, composer = ?, category = ?, language = ?, musical_key = ?, song_category = ?, updated_at = ? WHERE id = ?`,
  ).run(record.title, record.composer ?? '', record.category, record.language, record.musicalKey ?? '', record.songCategory ?? '', record.updatedAt, hymnId);
  writeSongDetails(db, hymnId, record);
}

/** Maps a file's song UUID to this laptop's song. A UUID with no song is an error, which rolls the whole import back. */
function localSong(songIdMap, uuid, where) {
  const id = songIdMap.get(uuid);
  if (id === undefined) throw new Error(`${where} uses a song that is not in the file.`);
  return id;
}

function writeSetlistItems(db, setlistId, songUuids, songIdMap) {
  const insert = db.prepare('INSERT INTO setlist_items (setlist_id, hymn_id, position) VALUES (?, ?, ?)');
  songUuids.forEach((uuid, i) => insert.run(setlistId, localSong(songIdMap, uuid, 'A setlist'), i + 1));
}

function writePlanItems(db, planId, items, songIdMap) {
  const insert = db.prepare(
    'INSERT INTO mass_plan_items (plan_id, liturgical_block, source_module, source_id, label, display_order) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const item of items) {
    const sourceId = item.sourceModule === 'lyrics' ? String(localSong(songIdMap, item.sourceId, 'A plan')) : String(item.sourceId);
    insert.run(planId, item.liturgicalBlock, item.sourceModule, sourceId, item.label, item.displayOrder);
  }
}

function writeSegments(db, sessionId, segments, songIdMap, stanzaIdsFor) {
  const insert = db.prepare(
    `INSERT INTO pw_segments (session_id, display_order, segment_key, group_key, name, type, minutes, leader, content_ref, arrangement, cues, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const seg of segments) {
    const contentRef = seg.contentRef?.kind === 'song'
      ? { ...seg.contentRef, hymnIds: (seg.contentRef.hymnIds ?? []).map((uuid) => localSong(songIdMap, uuid, 'A Praise & Worship segment')) }
      : seg.contentRef ?? {};
    const arrangement = {};
    for (const [uuid, indices] of Object.entries(seg.arrangement ?? {})) {
      const hymnId = songIdMap.get(uuid);
      if (hymnId === undefined || !Array.isArray(indices)) continue;
      const order = stanzaIdsFor(hymnId);
      arrangement[String(hymnId)] = indices.map((i) => order[i]).filter((id) => id !== undefined).map(String);
    }
    insert.run(
      sessionId,
      seg.displayOrder,
      seg.segmentKey,
      seg.groupKey,
      seg.name,
      seg.type,
      seg.minutes ?? 0,
      seg.leader ?? '',
      JSON.stringify(contentRef),
      JSON.stringify(arrangement),
      JSON.stringify(seg.cues ?? {}),
      seg.notes ?? '',
    );
  }
}

/**
 * Writes the chosen records in one transaction. NEW records are added. SAME records are skipped. CHANGED records are
 * replaced only when `choices` says 'use' for them; the default is to keep this laptop's version. Nothing is deleted.
 * Any failure rolls back everything. `choices` maps `type:uuid` to 'keep' or 'use'.
 */
export function applyImport(db, data, choices = {}) {
  const added = { songs: 0, setlists: 0, plans: 0, praiseWorship: 0 };
  const skipped = { songs: 0, setlists: 0, plans: 0, praiseWorship: 0 };
  const changed = { kept: 0, used: 0 };
  const decide = (type, uuid) => {
    const choice = choices[`${type}:${uuid}`] ?? 'keep';
    if (choice !== 'keep' && choice !== 'use') throw new Error('A choice must be to keep this laptop\'s version or to use the imported one.');
    return choice;
  };

  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`INSERT INTO ${IMPORT_GUARD} (active) VALUES (1);`);
    const plan = planImport(db, data);

    // Songs first: setlists, plans and sessions refer to them by UUID.
    const songIdMap = new Map();
    for (const entry of plan.songs) {
      const record = entry.record;
      if (entry.status === 'new') {
        songIdMap.set(record.id, insertSong(db, record));
        added.songs += 1;
        continue;
      }
      songIdMap.set(record.id, entry.localId);
      if (entry.status === 'same') {
        skipped.songs += 1;
      } else if (decide('songs', record.id) === 'use') {
        overwriteSong(db, entry.localId, record);
        changed.used += 1;
      } else {
        changed.kept += 1;
      }
      // A song matched by title keeps that link, so the next import matches it by ID.
      if (entry.viaTitle) db.prepare('INSERT OR IGNORE INTO transfer_song_aliases (imported_uuid, hymn_id) VALUES (?, ?)').run(record.id, entry.localId);
    }

    const stanzaIdsFor = (hymnId) => stanzaIdsOf(db, hymnId);

    for (const entry of plan.setlists) {
      const r = entry.record;
      if (entry.status === 'same') {
        skipped.setlists += 1;
        continue;
      }
      if (entry.status === 'new') {
        const info = db.prepare('INSERT INTO setlists (uuid, name, date, updated_at) VALUES (?, ?, ?, ?)').run(r.id, r.name, r.date, r.updatedAt);
        writeSetlistItems(db, Number(info.lastInsertRowid), r.songs ?? [], songIdMap);
        added.setlists += 1;
      } else if (decide('setlists', r.id) === 'use') {
        db.prepare('UPDATE setlists SET name = ?, date = ?, updated_at = ? WHERE id = ?').run(r.name, r.date, r.updatedAt, entry.localId);
        db.prepare('DELETE FROM setlist_items WHERE setlist_id = ?').run(entry.localId);
        writeSetlistItems(db, entry.localId, r.songs ?? [], songIdMap);
        changed.used += 1;
      } else {
        changed.kept += 1;
      }
    }

    for (const entry of plan.plans) {
      const r = entry.record;
      if (entry.status === 'same') {
        skipped.plans += 1;
        continue;
      }
      if (entry.status === 'new') {
        const info = db.prepare('INSERT INTO mass_plans (uuid, name, liturgical_date, updated_at) VALUES (?, ?, ?, ?)').run(r.id, r.name, r.liturgicalDate, r.updatedAt);
        const planId = Number(info.lastInsertRowid);
        writePlanItems(db, planId, r.items ?? [], songIdMap);
        added.plans += 1;
      } else if (decide('plans', r.id) === 'use') {
        db.prepare('UPDATE mass_plans SET name = ?, liturgical_date = ?, updated_at = ? WHERE id = ?').run(r.name, r.liturgicalDate, r.updatedAt, entry.localId);
        db.prepare('DELETE FROM mass_plan_items WHERE plan_id = ?').run(entry.localId);
        writePlanItems(db, entry.localId, r.items ?? [], songIdMap);
        changed.used += 1;
      } else {
        changed.kept += 1;
      }
    }

    for (const entry of plan.praiseWorship) {
      const r = entry.record;
      if (entry.status === 'same') {
        skipped.praiseWorship += 1;
        continue;
      }
      const groups = JSON.stringify(r.groups ?? []);
      if (entry.status === 'new') {
        const info = db.prepare('INSERT INTO pw_sessions (uuid, name, liturgical_date, groups, updated_at) VALUES (?, ?, ?, ?, ?)').run(r.id, r.name, r.liturgicalDate, groups, r.updatedAt);
        const sessionId = Number(info.lastInsertRowid);
        writeSegments(db, sessionId, r.segments ?? [], songIdMap, stanzaIdsFor);
        added.praiseWorship += 1;
      } else if (decide('praiseWorship', r.id) === 'use') {
        db.prepare('UPDATE pw_sessions SET name = ?, liturgical_date = ?, groups = ?, updated_at = ? WHERE id = ?').run(r.name, r.liturgicalDate, groups, r.updatedAt, entry.localId);
        db.prepare('DELETE FROM pw_segments WHERE session_id = ?').run(entry.localId);
        writeSegments(db, entry.localId, r.segments ?? [], songIdMap, stanzaIdsFor);
        changed.used += 1;
      } else {
        changed.kept += 1;
      }
    }

    db.exec(`DELETE FROM ${IMPORT_GUARD};`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw new Error(`The import failed, so nothing was changed. ${err.message}`);
  }
  return { added, skipped, changed };
}

// ---- Export options from the dialog ----------------------------------------------------------------------------------

/** The options the export dialog sends, checked. Throws when nothing is chosen. */
export function checkExportOptions(input) {
  const options = {
    plans: input?.plans === true,
    setlists: input?.setlists === true,
    praiseWorship: input?.praiseWorship === true,
    songs: input?.songs === true,
    lyrics: input?.lyrics === true,
  };
  if (!options.plans && !options.setlists && !options.praiseWorship && !options.songs) {
    throw new Error('Choose at least one thing to export.');
  }
  return options;
}

/** A default file name such as APCCMMA-export-2026-10-27-1352.apccmma, in local time. */
export function defaultExportName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `APCCMMA-export-${stamp}${TRANSFER_EXTENSION}`;
}

import { ipcMain } from 'electron';
import { DEFAULT_CUES, DEFAULT_TEMPLATE, MAX_CHAIN, MAX_SONGS, PW_TYPES, segmentFromTemplate } from '../shared/pw.js';
import { recordTombstone } from './plan-sync-schema.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_NAME = 120;
const MAX_SEGMENT_NAME = 120;
const MAX_LEADER = 80;
const MAX_NOTES = 2000;
const MAX_SEGMENTS = 40;
const MAX_GROUPS = 12;
const MAX_MINUTES = 240;
const MAX_SECTIONS = 40;

/**
 * Praise & Worship sessions. A session copies its segments from a template when it is created, so editing a
 * template never changes a session already planned. `content_ref`, `arrangement` and `cues` are JSON; the
 * service checks them on the way in and fills defaults on the way out. Tags mark which hymns suit which segment.
 */
export const PW_MIGRATIONS = [
  `
  CREATE TABLE pw_sessions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT NOT NULL,
    liturgical_date  TEXT NOT NULL CHECK (liturgical_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    groups           TEXT NOT NULL DEFAULT '[]',
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE pw_segments (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id     INTEGER NOT NULL REFERENCES pw_sessions(id) ON DELETE CASCADE,
    display_order  INTEGER NOT NULL,
    segment_key    TEXT NOT NULL,
    group_key      TEXT NOT NULL,
    name           TEXT NOT NULL,
    type           TEXT NOT NULL CHECK (type IN ('prayer', 'song', 'scripture')),
    minutes        INTEGER NOT NULL DEFAULT 0 CHECK (minutes BETWEEN 0 AND 240),
    leader         TEXT NOT NULL DEFAULT '',
    content_ref    TEXT NOT NULL DEFAULT '{}',
    arrangement    TEXT NOT NULL DEFAULT '{}',
    cues           TEXT NOT NULL DEFAULT '{}',
    notes          TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_pw_segments_order ON pw_segments (session_id, display_order);

  CREATE TABLE pw_templates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    groups      TEXT NOT NULL,
    segments    TEXT NOT NULL,
    built_in    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE pw_hymn_tags (
    hymn_id      INTEGER NOT NULL REFERENCES hymns(id) ON DELETE CASCADE,
    segment_key  TEXT NOT NULL,
    PRIMARY KEY (hymn_id, segment_key)
  );
  `,
];

const parseJson = (text, fallback) => {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

const cleanText = (value, max, label) => {
  const text = String(value ?? '').trim();
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return text;
};

const requireKey = (value, label) => {
  const key = String(value ?? '');
  if (!KEY.test(key)) throw new Error(`${label} must be lowercase letters, digits or _.`);
  return key;
};

function cleanGroups(input) {
  const list = Array.isArray(input) ? input : [];
  if (list.length === 0 || list.length > MAX_GROUPS) throw new Error(`A lineup needs 1 to ${MAX_GROUPS} groups.`);
  const groups = list.map((g) => ({ key: requireKey(g?.key, 'Group key'), name: cleanText(g?.name, MAX_SEGMENT_NAME, 'Group name') }));
  if (new Set(groups.map((g) => g.key)).size !== groups.length) throw new Error('Group keys must be unique.');
  if (groups.some((g) => !g.name)) throw new Error('Every group needs a name.');
  return groups;
}

/**
 * The items chained after a card's first item. A prayer card chains prayers and a scripture card chains readings. Ids that point at
 * nothing are refused by the caller's `exists` check, as for the first item.
 */
function cleanChain(input) {
  const list = Array.isArray(input) ? input : [];
  if (list.length > MAX_CHAIN) throw new Error(`A card can chain at most ${MAX_CHAIN} items.`);
  return list.map((item) => {
    const minutes = Number(item?.minutes ?? 0);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_MINUTES) throw new Error(`Minutes must be a whole number from 0 to ${MAX_MINUTES}.`);
    if (item?.kind === 'prayer') {
      const noteId = Number(item.noteId);
      if (!Number.isInteger(noteId)) throw new Error('Unknown prayer.');
      return { kind: 'prayer', noteId, minutes };
    }
    if (item?.kind === 'lectionary') return { kind: 'lectionary', readingType: cleanText(item.readingType, 40, 'Reading'), minutes };
    throw new Error('A card can only chain prayers and readings.');
  });
}

/** `content` with its chain attached. A card with no chain keeps the shape it was saved in, with no `more` field. */
const attachMore = (content, more) => (more.length ? { ...content, more } : content);

/**
 * The content slot of a card. Any card holds songs (`hymnIds`) and a chain of prayers and readings (`more`), whatever its first item is.
 * Ids that point at nothing are refused by the caller's `exists` check.
 */
function cleanContent(input) {
  const c = input ?? {};
  const hymnIds = (Array.isArray(c.hymnIds) ? c.hymnIds : []).map(Number).filter(Number.isInteger);
  if (hymnIds.length > MAX_SONGS) throw new Error(`A card holds at most ${MAX_SONGS} songs.`);
  const more = cleanChain(c.more);
  if (c.kind === 'song') {
    // The card's song limit is kept at or above the songs it holds, so a card never refuses what it was saved with.
    const maxSongs = Math.min(Math.max(Number.parseInt(c.maxSongs, 10) || 1, hymnIds.length, 1), MAX_SONGS);
    const category = c.category == null ? null : cleanText(c.category, 40, 'Category');
    return attachMore({ kind: 'song', hymnIds, maxSongs, category: category || null }, more);
  }
  if (c.kind === 'prayer') {
    const noteId = c.noteId == null ? null : Number(c.noteId);
    if (noteId !== null && !Number.isInteger(noteId)) throw new Error('Unknown prayer.');
    return attachMore({ kind: 'prayer', noteId, hymnIds }, more);
  }
  if (c.kind === 'lectionary') return attachMore({ kind: 'lectionary', readingType: cleanText(c.readingType, 40, 'Reading'), hymnIds }, more);
  if (c.kind === 'title') return attachMore({ kind: 'title', hymnIds }, more);
  throw new Error('A card needs a song, prayer, title slide or lectionary link.');
}

function cleanArrangement(input, content) {
  const out = {};
  for (const id of content.hymnIds) {
    const order = input?.[String(id)];
    if (!Array.isArray(order)) continue;
    const ids = order.map(String).filter((s) => /^\d+$/.test(s));
    if (ids.length > MAX_SECTIONS) throw new Error(`An arrangement can have at most ${MAX_SECTIONS} sections.`);
    if (ids.length) out[String(id)] = ids;
  }
  return out;
}

function cleanCues(input) {
  const c = input ?? {};
  return Object.fromEntries(Object.entries(DEFAULT_CUES).map(([k, d]) => [k, typeof c[k] === 'boolean' ? c[k] : d]));
}

/** Checks one segment. `groupKeys` are the session's groups; the segment must belong to one. */
function cleanSegment(input, groupKeys) {
  const s = input ?? {};
  const type = String(s.type ?? '');
  if (!PW_TYPES.includes(type)) throw new Error('Unknown segment type.');
  const group = requireKey(s.group, 'Group');
  if (!groupKeys.includes(group)) throw new Error('A segment belongs to a group that is not in this lineup.');
  const name = cleanText(s.name, MAX_SEGMENT_NAME, 'Segment name');
  if (!name) throw new Error('Every segment needs a name.');
  const minutes = Number(s.minutes);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_MINUTES) throw new Error(`Minutes must be a whole number from 0 to ${MAX_MINUTES}.`);
  const content = cleanContent(s.content);
  return {
    key: requireKey(s.key, 'Segment key'),
    group,
    name,
    type,
    minutes,
    leader: cleanText(s.leader, MAX_LEADER, 'Leader'),
    content,
    arrangement: cleanArrangement(s.arrangement, content),
    cues: cleanCues(s.cues),
    notes: cleanText(s.notes, MAX_NOTES, 'Notes'),
  };
}

function cleanSegments(list, groupKeys) {
  const segments = Array.isArray(list) ? list : [];
  if (segments.length > MAX_SEGMENTS) throw new Error(`A lineup can have at most ${MAX_SEGMENTS} segments.`);
  const cleaned = segments.map((s) => cleanSegment(s, groupKeys));
  // A live position is held by segment key, so two segments with one key would be ambiguous.
  if (new Set(cleaned.map((s) => s.key)).size !== cleaned.length) throw new Error('Each segment in a lineup needs its own key.');
  return cleaned;
}

/** Session data access. Pure: takes a database handle. */
export function createPwService(db) {
  const q = {
    sessions: db.prepare(`
      SELECT s.id, s.name, s.liturgical_date AS liturgicalDate, s.created_at AS createdAt,
             (SELECT COUNT(*) FROM pw_segments g WHERE g.session_id = s.id) AS segmentCount
      FROM pw_sessions s ORDER BY s.liturgical_date DESC, s.id DESC`),
    session: db.prepare('SELECT id, name, liturgical_date AS liturgicalDate, groups FROM pw_sessions WHERE id = ?'),
    insertSession: db.prepare('INSERT INTO pw_sessions (name, liturgical_date, groups) VALUES (?, ?, ?)'),
    updateSession: db.prepare('UPDATE pw_sessions SET name = ?, liturgical_date = ?, groups = ? WHERE id = ?'),
    deleteSession: db.prepare('DELETE FROM pw_sessions WHERE id = ?'),
    sessionUuid: db.prepare('SELECT uuid FROM pw_sessions WHERE id = ?'),
    segments: db.prepare(`
      SELECT id, segment_key AS key, group_key AS "group", name, type, minutes, leader,
             content_ref AS content, arrangement, cues, notes
      FROM pw_segments WHERE session_id = ? ORDER BY display_order, id`),
    clearSegments: db.prepare('DELETE FROM pw_segments WHERE session_id = ?'),
    insertSegment: db.prepare(`
      INSERT INTO pw_segments
        (session_id, display_order, segment_key, group_key, name, type, minutes, leader, content_ref, arrangement, cues, notes)
      VALUES (@sessionId, @order, @key, @group, @name, @type, @minutes, @leader, @content, @arrangement, @cues, @notes)`),
    templates: db.prepare('SELECT id, name, built_in AS builtIn, groups, segments FROM pw_templates ORDER BY built_in DESC, name COLLATE NOCASE'),
    template: db.prepare('SELECT id, name, built_in AS builtIn, groups, segments FROM pw_templates WHERE id = ?'),
    builtIn: db.prepare('SELECT id FROM pw_templates WHERE built_in = 1 LIMIT 1'),
    insertTemplate: db.prepare('INSERT INTO pw_templates (name, groups, segments, built_in) VALUES (?, ?, ?, ?)'),
    deleteTemplate: db.prepare('DELETE FROM pw_templates WHERE id = ? AND built_in = 0'),
    tags: db.prepare('SELECT hymn_id AS hymnId, segment_key AS segmentKey FROM pw_hymn_tags ORDER BY hymn_id'),
    addTag: db.prepare('INSERT OR IGNORE INTO pw_hymn_tags (hymn_id, segment_key) VALUES (?, ?)'),
    removeTag: db.prepare('DELETE FROM pw_hymn_tags WHERE hymn_id = ? AND segment_key = ?'),
    // A live hymn is in the library. A deleted one is kept for undo, and the segment shows it as deleted.
    liveHymn: db.prepare('SELECT 1 FROM hymns WHERE id = ? AND deleted_at IS NULL'),
    deletedHymn: db.prepare('SELECT 1 FROM hymns WHERE id = ? AND deleted_at IS NOT NULL'),
    note: db.prepare('SELECT display FROM notes WHERE id = ?'),
  };

  const requireSession = (id) => {
    const row = q.session.get(id);
    if (!row) throw new Error('That session no longer exists.');
    return { id: row.id, name: row.name, liturgicalDate: row.liturgicalDate, groups: parseJson(row.groups, []) };
  };

  /** Operator-only notes are private, so they never count as a projectable prayer. */
  const noteProjectable = (id) => {
    const row = q.note.get(id);
    return Boolean(row) && row.display !== 'operator';
  };

  /** Whether every item a card chains still exists. Readings are not in the database, so only prayers can be missing. */
  const chainExists = (more) => (more ?? []).every((item) => item.kind !== 'prayer' || noteProjectable(item.noteId));

  /** Whether everything a segment points at still exists. */
  const contentExists = (content) => {
    if (!content.hymnIds.every((id) => q.liveHymn.get(id))) return false;
    if (content.kind === 'prayer') return (content.noteId == null || noteProjectable(content.noteId)) && chainExists(content.more);
    return chainExists(content.more);
  };

  /** The content with anything deleted from its library taken out. */
  const pruneContent = (content) => {
    const { more, hymnIds, ...rest } = content;
    const first = rest.kind === 'prayer' && rest.noteId != null && !noteProjectable(rest.noteId) ? { ...rest, noteId: null } : rest;
    return attachMore({ ...first, hymnIds: hymnIds.filter((id) => q.liveHymn.get(id)) }, (more ?? []).filter((item) => item.kind !== 'prayer' || noteProjectable(item.noteId)));
  };

  /** Refuses a save that points at deleted content, so a lineup never points at nothing when it is written. */
  const requireContent = (segment) => {
    const operatorOnly = (noteId) => noteId != null && q.note.get(noteId)?.display === 'operator';
    const chained = (segment.content.more ?? []).some((item) => item.kind === 'prayer' && operatorOnly(item.noteId));
    if ((segment.content.kind === 'prayer' && operatorOnly(segment.content.noteId)) || chained) {
      throw new Error('Operator-only notes cannot be projected. Choose a prayer shown full screen or on the lower third.');
    }
    if (!contentExists(segment.content)) {
      throw new Error(`"${segment.name}" points at a song or prayer that no longer exists. Replace it and try again.`);
    }
  };

  const writeSegments = (sessionId, segments) => {
    q.clearSegments.run(sessionId);
    segments.forEach((s, i) =>
      q.insertSegment.run({
        sessionId,
        order: i + 1,
        ...s,
        content: JSON.stringify(s.content),
        arrangement: JSON.stringify(s.arrangement),
        cues: JSON.stringify(s.cues),
      }),
    );
  };

  const toTemplate = (row) => ({
    id: row.id,
    name: row.name,
    builtIn: Boolean(row.builtIn),
    groups: parseJson(row.groups, []),
    segments: parseJson(row.segments, []),
  });

  return {
    /** Adds the default lineup as the built-in template the first time, and leaves it alone after that. */
    seedDefaultTemplate() {
      if (q.builtIn.get()) return false;
      q.insertTemplate.run(DEFAULT_TEMPLATE.name, JSON.stringify(DEFAULT_TEMPLATE.groups), JSON.stringify(DEFAULT_TEMPLATE.segments), 1);
      return true;
    },

    listSessions() {
      return q.sessions.all();
    },

    /** Creates a session from a template: the built-in one when `templateId` is absent. */
    createSession(input = {}) {
      const name = cleanText(input.name, MAX_NAME, 'Session name');
      if (!name) throw new Error(`Session name must be 1 to ${MAX_NAME} characters.`);
      const liturgicalDate = String(input.liturgicalDate ?? '');
      if (!DATE.test(liturgicalDate)) throw new Error('Date must be in the form YYYY-MM-DD.');
      const row = input.templateId != null ? q.template.get(Number(input.templateId)) : q.template.get(q.builtIn.get()?.id ?? -1);
      if (!row) throw new Error('That template no longer exists.');
      const template = toTemplate(row);
      const groups = cleanGroups(template.groups);
      // Template songs or prayers deleted since the template was saved are dropped, so the new session starts clean.
      const segments = cleanSegments(template.segments.map(segmentFromTemplate), groups.map((g) => g.key)).map((s) => ({
        ...s,
        content: pruneContent(s.content),
      }));
      const id = db.transaction(() => {
        const { lastInsertRowid } = q.insertSession.run(name, liturgicalDate, JSON.stringify(groups));
        writeSegments(Number(lastInsertRowid), segments);
        return Number(lastInsertRowid);
      })();
      return this.getSession(id);
    },

    deleteSession(id) {
      // The tombstone and the delete happen together, so a deleted session is never pulled back on the next sync.
      return db.transaction(() => {
        const row = q.sessionUuid.get(id);
        if (row) recordTombstone(db, { uuid: row.uuid, kind: 'praise' });
        return q.deleteSession.run(id).changes > 0;
      })();
    },

    /** Segments carry `stale: true` when a song or prayer they point at was deleted after the session was saved. */
    getSession(id) {
      const session = requireSession(id);
      const segments = q.segments.all(id).map((row) => {
        const content = { hymnIds: [], ...parseJson(row.content, {}) };
        const segment = {
          ...row,
          content,
          arrangement: parseJson(row.arrangement, {}),
          cues: { ...DEFAULT_CUES, ...parseJson(row.cues, {}) },
        };
        // A segment with a deleted song shows it as deleted, not as missing, so the planner can undo the delete.
        const deleted = (content.hymnIds ?? []).some((id) => q.deletedHymn.get(id));
        return { ...segment, deleted, stale: !contentExists(content) };
      });
      return { ...session, segments };
    },

    /** Replaces the session's details and segments. The segment order is the order they are sent in. */
    saveSession(id, input = {}) {
      const current = requireSession(id);
      const name = input.name === undefined ? current.name : cleanText(input.name, MAX_NAME, 'Session name');
      if (!name) throw new Error(`Session name must be 1 to ${MAX_NAME} characters.`);
      const liturgicalDate = input.liturgicalDate === undefined ? current.liturgicalDate : String(input.liturgicalDate);
      if (!DATE.test(liturgicalDate)) throw new Error('Date must be in the form YYYY-MM-DD.');
      const groups = input.groups === undefined ? current.groups : cleanGroups(input.groups);
      const segments = cleanSegments(input.segments, groups.map((g) => g.key));
      segments.forEach(requireContent);
      db.transaction(() => {
        q.updateSession.run(name, liturgicalDate, JSON.stringify(groups), id);
        writeSegments(id, segments);
      })();
      return this.getSession(id);
    },

    listTemplates() {
      return q.templates.all().map(toTemplate);
    },

    /**
     * Saves a session's lineup as a new template. Structure, times, cues, leaders, prayers and scripture links are kept.
     * Songs and operator notes are left out: they change from one night to the next.
     */
    saveAsTemplate(sessionId, name) {
      const session = this.getSession(sessionId);
      const templateName = cleanText(name, MAX_NAME, 'Template name');
      if (!templateName) throw new Error(`Template name must be 1 to ${MAX_NAME} characters.`);
      const segments = session.segments.map((s) => ({
        key: s.key,
        group: s.group,
        name: s.name,
        type: s.type,
        minutes: s.minutes,
        leader: s.leader,
        cues: s.cues,
        content: { ...s.content, hymnIds: [] },
      }));
      const { lastInsertRowid } = q.insertTemplate.run(templateName, JSON.stringify(session.groups), JSON.stringify(segments), 0);
      return toTemplate(q.template.get(Number(lastInsertRowid)));
    },

    /** The built-in template cannot be deleted. */
    deleteTemplate(id) {
      return q.deleteTemplate.run(id).changes > 0;
    },

    listTags() {
      return q.tags.all();
    },

    /** Tags or untags a hymn as suiting a segment. */
    setTag(hymnId, segmentKey, on) {
      const key = requireKey(segmentKey, 'Segment key');
      if (!q.liveHymn.get(hymnId)) throw new Error('That hymn no longer exists.');
      if (on) q.addTag.run(hymnId, key);
      else q.removeTag.run(hymnId, key);
      return this.listTags();
    },
  };
}

/** Registers the `pw:*` IPC channels and seeds the default template. Called once from the main process. */
export function setupPwSessions(db) {
  const service = createPwService(db);
  service.seedDefaultTemplate();
  const handle = (channel, fn) => ipcMain.handle(`pw:${channel}`, (_event, ...args) => fn(...args));

  handle('listSessions', () => service.listSessions());
  handle('createSession', (input) => service.createSession(input));
  handle('getSession', (id) => service.getSession(Number(id)));
  handle('saveSession', (id, input) => service.saveSession(Number(id), input));
  handle('deleteSession', (id) => service.deleteSession(Number(id)));
  handle('listTemplates', () => service.listTemplates());
  handle('saveAsTemplate', (sessionId, name) => service.saveAsTemplate(Number(sessionId), name));
  handle('deleteTemplate', (id) => service.deleteTemplate(Number(id)));
  handle('listTags', () => service.listTags());
  handle('setTag', (hymnId, segmentKey, on) => service.setTag(Number(hymnId), segmentKey, Boolean(on)));
  return service;
}

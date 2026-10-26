-- APCCMMA local database (SQLite via better-sqlite3 in the Electron main process).
-- Localized text is stored one row per language so EN / TL / CEB can be added independently.

PRAGMA foreign_keys = ON;

-- ── Lectionary ─────────────────────────────────────────────────────────────
CREATE TABLE lectionary_days (
  id              TEXT PRIMARY KEY,                 -- e.g. 'ot-29-sun-A', 'santo-nino', '0928-lorenzo-ruiz'
  fixed_date      TEXT,                             -- 'MM-DD' for fixed feasts, NULL for moveable
  sunday_cycle    TEXT CHECK (sunday_cycle IN ('A','B','C')),
  weekday_cycle   TEXT CHECK (weekday_cycle IN ('I','II')),
  season          TEXT NOT NULL CHECK (season IN ('advent','christmas','lent','triduum','easter','ordinary')),
  rank            TEXT NOT NULL,
  regional        INTEGER NOT NULL DEFAULT 0        -- 1 = Philippine proper calendar
);

CREATE TABLE lectionary_day_names (
  day_id  TEXT NOT NULL REFERENCES lectionary_days(id) ON DELETE CASCADE,
  lang    TEXT NOT NULL,
  name    TEXT NOT NULL,
  PRIMARY KEY (day_id, lang)
);

CREATE TABLE readings (
  id          INTEGER PRIMARY KEY,
  day_id      TEXT NOT NULL REFERENCES lectionary_days(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('first','psalm','second','gospel_acclamation','gospel')),
  lang        TEXT NOT NULL,
  citation    TEXT NOT NULL,
  intro       TEXT,
  body        TEXT NOT NULL,                        -- for psalms: JSON array of stanzas (array of lines)
  response    TEXT,                                 -- psalm response / Alleluia verse
  conclusion  TEXT,
  reply       TEXT
);
CREATE INDEX idx_readings_day ON readings(day_id, lang);

-- ── Order of the Mass ──────────────────────────────────────────────────────
CREATE TABLE mass_parts (
  id     TEXT PRIMARY KEY,                          -- 'kyrie','gloria','credo','sanctus',...
  sort   INTEGER NOT NULL
);

CREATE TABLE mass_part_texts (
  part_id  TEXT NOT NULL REFERENCES mass_parts(id) ON DELETE CASCADE,
  lang     TEXT NOT NULL,
  name     TEXT NOT NULL,
  slides   TEXT NOT NULL,                           -- JSON SlideLine[][]
  source   TEXT,                                    -- missal edition the text was checked against
  PRIMARY KEY (part_id, lang)
);

-- ── Hymns ──────────────────────────────────────────────────────────────────
CREATE TABLE hymns (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  hymnal         TEXT NOT NULL,                     -- 'Bukas Palad','Hangad','Papuri','Himig Heswita',...
  hymnal_number  TEXT,
  composer       TEXT,
  lang           TEXT NOT NULL,
  music_key      TEXT,
  tempo          INTEGER,
  moments        TEXT NOT NULL DEFAULT '[]',        -- JSON MassMoment[]
  seasons        TEXT NOT NULL DEFAULT '[]',        -- JSON Season[]
  arrangement    TEXT NOT NULL DEFAULT '[]',        -- JSON section ids in sung order
  license        TEXT
);

CREATE TABLE hymn_sections (
  hymn_id  TEXT NOT NULL REFERENCES hymns(id) ON DELETE CASCADE,
  id       TEXT NOT NULL,                           -- 'v1','r','b'
  kind     TEXT NOT NULL CHECK (kind IN ('verse','refrain','chorus','bridge','tag')),
  label    TEXT NOT NULL,
  lines    TEXT NOT NULL,                           -- JSON string[]
  PRIMARY KEY (hymn_id, id)
);

CREATE VIRTUAL TABLE hymn_search USING fts5(hymn_id UNINDEXED, title, lyrics, hymnal);

-- ── Special prayers (Oratio Imperata, CBCP prayers) ───────────────────────
CREATE TABLE special_prayers (
  id               TEXT PRIMARY KEY,
  category         TEXT NOT NULL CHECK (category IN ('oratio_imperata','election','calamity','pastoral_letter','novena','other')),
  issued_by        TEXT NOT NULL,
  occasion         TEXT,
  effective_from   TEXT,
  effective_until  TEXT,
  pinned           INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE special_prayer_texts (
  prayer_id  TEXT NOT NULL REFERENCES special_prayers(id) ON DELETE CASCADE,
  lang       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  PRIMARY KEY (prayer_id, lang)
);

-- ── Announcements, media, notes ────────────────────────────────────────────
CREATE TABLE announcements (
  id         TEXT PRIMARY KEY,
  media_id   TEXT REFERENCES media(id),
  starts_at  TEXT,
  ends_at    TEXT,
  sort       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE announcement_texts (
  announcement_id  TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  lang             TEXT NOT NULL,
  title            TEXT NOT NULL,
  body             TEXT NOT NULL,
  PRIMARY KEY (announcement_id, lang)
);

CREATE TABLE media (
  id     TEXT PRIMARY KEY,
  kind   TEXT NOT NULL CHECK (kind IN ('image','video','background')),
  path   TEXT NOT NULL,
  label  TEXT NOT NULL,
  loop   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE notes (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- ── Mass planner (feeds the live queue) ───────────────────────────────────
CREATE TABLE mass_plans (
  id               TEXT PRIMARY KEY,
  date             TEXT NOT NULL,
  time             TEXT NOT NULL,
  celebration      TEXT NOT NULL,
  lang             TEXT NOT NULL,
  lectionary_day   TEXT REFERENCES lectionary_days(id)
);

CREATE TABLE mass_plan_items (
  id        TEXT PRIMARY KEY,
  plan_id   TEXT NOT NULL REFERENCES mass_plans(id) ON DELETE CASCADE,
  sort      INTEGER NOT NULL,
  kind      TEXT NOT NULL,
  ref_id    TEXT NOT NULL,
  label     TEXT NOT NULL,
  moment    TEXT
);
CREATE INDEX idx_plan_items ON mass_plan_items(plan_id, sort);

-- ── Praise & Worship (live copy: PW_MIGRATIONS in electron/pw-sessions.js) ──
-- Separate from the Mass planner. A session copies its segments from a template when created.
CREATE TABLE pw_sessions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  liturgical_date  TEXT NOT NULL,
  groups           TEXT NOT NULL DEFAULT '[]',       -- JSON [{ key, name }] in lineup order
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE pw_segments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     INTEGER NOT NULL REFERENCES pw_sessions(id) ON DELETE CASCADE,
  display_order  INTEGER NOT NULL,
  segment_key    TEXT NOT NULL,                     -- 'marian_song', 'worship', ...
  group_key      TEXT NOT NULL,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('prayer','song','scripture')),
  minutes        INTEGER NOT NULL DEFAULT 0,
  leader         TEXT NOT NULL DEFAULT '',
  content_ref    TEXT NOT NULL DEFAULT '{}',        -- JSON PwContent (shared/pw.d.ts)
  arrangement    TEXT NOT NULL DEFAULT '{}',        -- JSON { hymnId: stanzaId[] }
  cues           TEXT NOT NULL DEFAULT '{}',        -- JSON { lowerThird, titleFirst, fadeOut }
  notes          TEXT NOT NULL DEFAULT ''           -- operator only, never projected
);
CREATE INDEX idx_pw_segments_order ON pw_segments (session_id, display_order);

CREATE TABLE pw_templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  groups      TEXT NOT NULL,
  segments    TEXT NOT NULL,
  built_in    INTEGER NOT NULL DEFAULT 0,           -- 1 = the default lineup, seeded at launch, cannot be deleted
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE pw_hymn_tags (
  hymn_id      INTEGER NOT NULL REFERENCES hymns(id) ON DELETE CASCADE,
  segment_key  TEXT NOT NULL,
  PRIMARY KEY (hymn_id, segment_key)
);

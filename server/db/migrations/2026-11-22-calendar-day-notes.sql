-- The web Planner's day memos: one short note per church per calendar day ("Choir practice after the 5:00 PM Holy Mass"), shown in the
-- Liturgical and Praise & Worship calendars (server/lib/day-notes.js). Safe to run more than once. Until it runs, the calendars show no
-- memos and saving one answers 503, so nothing else breaks.
CREATE TABLE IF NOT EXISTS calendar_day_notes (
  church_id       UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  liturgical_date DATE NOT NULL,
  note            TEXT NOT NULL CHECK (char_length(note) BETWEEN 1 AND 200),
  updated_at      TIMESTAMPTZ NOT NULL,
  updated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (church_id, liturgical_date)
);

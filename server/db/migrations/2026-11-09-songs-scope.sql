-- Adds the songs.scope column to a database created before scopes. schema.sql has it, but CREATE TABLE only applies to a new database,
-- and without the column every song push fails at its first read (42703). Safe to run more than once. Existing songs become GENERAL
-- until the next push from the laptop sets their real scope.
ALTER TABLE songs ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'GENERAL'
  CHECK (scope IN ('GENERAL', 'MASS', 'PRAISE_AND_WORSHIP'));

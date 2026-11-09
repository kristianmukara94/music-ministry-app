-- Adds setup_keys.license_days to a database created before it. schema.sql has it, but CREATE TABLE only applies to a new database, and without
-- the column every setup key redemption fails (42703), so run this BEFORE deploying the server that reads it.
-- Safe to run more than once. Existing keys read as null, which means a perpetual licence.
ALTER TABLE setup_keys ADD COLUMN IF NOT EXISTS license_days INTEGER CHECK (license_days >= 0);

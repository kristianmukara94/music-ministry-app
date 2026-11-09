-- Adds plans.synced_at to a database created before it. schema.sql has it, but CREATE TABLE only applies to a new database, and without the
-- column the plan list, every web save and every laptop push and pull fail (42703), so run this BEFORE deploying the server that reads it.
-- Safe to run more than once. Existing plans read as not synced until a laptop next pushes or pulls them.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

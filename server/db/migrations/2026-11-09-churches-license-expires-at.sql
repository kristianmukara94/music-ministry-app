-- Adds churches.license_expires_at to a database created before it, and fills it in for churches already activated with a timed key. Without
-- the column device-status, church setup and renewal all fail (42703), so run this BEFORE deploying the server that reads it.
-- Safe to run more than once: the fill runs only when the column is first added, so it can never undo a later renewal.
-- Needs setup_keys.license_days (2026-11-09-setup-keys-license-days.sql) first.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'churches' AND column_name = 'license_expires_at'
  ) THEN
    ALTER TABLE churches ADD COLUMN license_expires_at TIMESTAMPTZ;
    UPDATE churches c
    SET license_expires_at = k.used_at + interval '1 day' * k.license_days
    FROM setup_keys k
    WHERE k.church_id = c.id AND k.used_at IS NOT NULL AND k.license_days > 0;
  END IF;
END $$;

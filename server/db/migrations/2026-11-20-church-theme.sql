-- The church's colour theme, sent by its laptops so the website paints the same theme (server/lib/theme-sync.js).
-- Safe to run more than once. Until it runs, the website keeps its own theme and laptops hold their change and retry.
ALTER TABLE churches ADD COLUMN IF NOT EXISTS theme TEXT CHECK (theme IS NULL OR theme ~ '^[a-z][a-z-]{1,31}$');
ALTER TABLE churches ADD COLUMN IF NOT EXISTS theme_updated_at TIMESTAMPTZ;

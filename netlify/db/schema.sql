-- Church data for the cloud API (proposed, not yet run). Postgres, as on Neon.
-- Every synced table carries church_id. The API takes church_id from the authenticated token and filters every query by it.
-- Nothing is keyed by church name.

CREATE TABLE churches (
  id            UUID PRIMARY KEY,
  display_code  TEXT NOT NULL UNIQUE CHECK (display_code ~ '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$'),
  name          TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  logo_key      TEXT,                              -- Netlify Blobs key, or NULL until a logo is uploaded
  logo_type     TEXT CHECK (logo_type IN ('image/png', 'image/svg+xml')),
  accent_gold   TEXT NOT NULL DEFAULT '#ecc98a' CHECK (accent_gold ~ '^#[0-9a-f]{6}$'),
  font_choice   TEXT NOT NULL DEFAULT 'Archivo'
                CHECK (font_choice IN ('Archivo', 'Cormorant Garamond', 'JetBrains Mono')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A device or a web session. Each token belongs to exactly one church.
CREATE TABLE device_tokens (
  token_hash    TEXT PRIMARY KEY,                  -- a hash of the token, never the token itself
  church_id     UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  device_name   TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX device_tokens_church ON device_tokens (church_id);

-- One-time link codes an admin issues so another laptop can join.
CREATE TABLE link_codes (
  code_hash     TEXT PRIMARY KEY,
  church_id     UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ
);

-- The licence record names the church it was issued to. The app syncs only when the two match.
CREATE TABLE licences (
  licence_key   TEXT PRIMARY KEY,
  church_id     UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE
);

-- Synced tables. Each one carries church_id, and each query filters by it.
CREATE TABLE plans (
  id            UUID PRIMARY KEY,
  church_id     UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  liturgical_date DATE NOT NULL,
  body          JSONB NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX plans_church ON plans (church_id, liturgical_date);

CREATE TABLE songs (
  id            UUID PRIMARY KEY,
  church_id     UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  category      TEXT NOT NULL,
  language      TEXT NOT NULL,
  musical_key   TEXT NOT NULL DEFAULT '',
  updated_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX songs_church ON songs (church_id, title);

CREATE TABLE devices (
  id            UUID PRIMARY KEY,
  church_id     UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  last_seen_at  TIMESTAMPTZ
);
CREATE INDEX devices_church ON devices (church_id);

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

-- Web planner sign-in. Usernames are unique within a church (case-insensitive). Sign-in can name the church by its display
-- code when the same username is used by more than one church.
CREATE TABLE users (
  id                    UUID PRIMARY KEY,
  church_id             UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  username              TEXT NOT NULL CHECK (char_length(username) BETWEEN 1 AND 80),
  display_name          TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  role                  TEXT NOT NULL CHECK (role IN ('admin', 'planner', 'viewer')),
  password_hash         TEXT NOT NULL,
  must_change_password  BOOLEAN NOT NULL DEFAULT true,
  disabled              BOOLEAN NOT NULL DEFAULT false,
  failed_attempts       INT NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  last_login_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_church_username ON users (church_id, lower(username));

-- A web session. Only a keyed hash of the token is stored, never the token.
CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  church_id   UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions (user_id);

-- Every user-management change: who did it, to whom, and when. Holds no passwords.
CREATE TABLE audit_log (
  id              BIGSERIAL PRIMARY KEY,
  church_id       UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  action          TEXT NOT NULL CHECK (action IN ('user.created', 'user.role_changed', 'user.disabled', 'user.enabled',
                                                  'user.password_reset', 'user.unlocked')),
  target_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_church ON audit_log (church_id, created_at);

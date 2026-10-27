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

-- The church's song list, sent from the laptop as metadata only: no lyrics, slides, media or Bible text. `id` is the laptop's own
-- song id (a UUID, stable across renames). A song the laptop no longer has is marked removed, not deleted, so plans that use it
-- keep their reference.
CREATE TABLE songs (
  id            UUID NOT NULL,
  church_id     UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  title         TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  category      TEXT NOT NULL DEFAULT '' CHECK (char_length(category) <= 40),
  language      TEXT NOT NULL CHECK (language IN ('English', 'Tagalog', 'Cebuano')),
  musical_key   TEXT NOT NULL DEFAULT '' CHECK (char_length(musical_key) <= 10),
  removed_at    TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (church_id, id)
);
CREATE INDEX songs_church_active ON songs (church_id, removed_at, lower(title));

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
                                                  'user.password_reset', 'user.unlocked',
                                                  'device.link_code_created', 'device.linked', 'device.unlinked',
                                                  'church.created', 'plan.saved', 'songs.synced', 'plan.created', 'plan.synced')),
  target_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  target_plan_id  UUID REFERENCES plans(id) ON DELETE SET NULL,
  detail          JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_church ON audit_log (church_id, created_at);

-- One-time link codes an admin issues so another laptop can join. Only a keyed hash of the code is stored. A code works once,
-- expires after 10 minutes, and records the admin who created it.
CREATE TABLE link_codes (
  code_hash     TEXT PRIMARY KEY,
  church_id     UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ
);

-- A linked laptop. Each token belongs to exactly one church. user_id is the admin who linked the laptop, so the laptop
-- can act for that admin when it creates web accounts. setup_until is set only for a laptop linked during church setup.
CREATE TABLE device_tokens (
  token_hash    TEXT PRIMARY KEY,                  -- a keyed hash of the token, never the token itself
  device_id     UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),  -- a stable id the website can name when it unlinks a laptop
  church_id     UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  device_name   TEXT NOT NULL,
  setup_until   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX device_tokens_church ON device_tokens (church_id);

-- One-time setup keys. The developer makes a key with scripts/create-setup-key.mjs and gives it out once. Using it creates a
-- church and its first admin from a laptop. Only a keyed hash of the key is stored. A key works once and expires after 7 days.
CREATE TABLE setup_keys (
  key_hash    TEXT PRIMARY KEY,                  -- a keyed hash of the key, never the key itself
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  used_at     TIMESTAMPTZ,
  church_id   UUID REFERENCES churches(id) ON DELETE SET NULL  -- set when the key is used
);

-- Request counts for the rate limits, shared by every function instance. One row per bucket (a limit name and a client
-- address or keyed token). The window restarts when window_start is older than the window.
CREATE TABLE rate_limits (
  bucket_key    TEXT PRIMARY KEY,
  window_start  TIMESTAMPTZ NOT NULL,
  hits          INTEGER NOT NULL
);

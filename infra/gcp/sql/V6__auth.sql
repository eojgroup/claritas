-- V6: AuthN/AuthZ schema for OAuth providers and session management

-- Core users table (app-level users)
CREATE TABLE IF NOT EXISTS app_user (
  id             BIGSERIAL PRIMARY KEY,
  email          TEXT,
  email_verified BOOLEAN DEFAULT false,
  display_name   TEXT,
  avatar_url     TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS app_user_email_unique
  ON app_user (lower(email))
  WHERE email IS NOT NULL;

-- OAuth identity links to external providers (Google/Microsoft/Apple)
CREATE TABLE IF NOT EXISTS auth_identity (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  email            TEXT,
  email_verified   BOOLEAN DEFAULT false,
  name             TEXT,
  picture_url      TEXT,
  profile          JSONB,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (provider, provider_subject)
);

CREATE INDEX IF NOT EXISTS auth_identity_user_idx ON auth_identity (user_id);

-- Session table for opaque tokens (stored hashed)
CREATE TABLE IF NOT EXISTS auth_session (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE,
  created_at         TIMESTAMPTZ DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL,
  revoked_at         TIMESTAMPTZ,
  last_seen_at       TIMESTAMPTZ,
  ip_address         TEXT,
  user_agent         TEXT
);

CREATE INDEX IF NOT EXISTS auth_session_user_idx ON auth_session (user_id);
CREATE INDEX IF NOT EXISTS auth_session_expires_idx ON auth_session (expires_at);

-- Authorization roles
CREATE TABLE IF NOT EXISTS auth_role (
  id          BIGSERIAL PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_user_role (
  user_id    BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role_id    BIGINT NOT NULL REFERENCES auth_role(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS auth_user_role_role_idx ON auth_user_role (role_id);

-- OAuth state table (PKCE + nonce + redirect)
CREATE TABLE IF NOT EXISTS auth_state (
  id            BIGSERIAL PRIMARY KEY,
  provider      TEXT NOT NULL,
  state         TEXT NOT NULL UNIQUE,
  nonce         TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  redirect_url  TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_state_expires_idx ON auth_state (expires_at);

-- Triggers to maintain updated_at
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_app_user') THEN
    CREATE TRIGGER set_updated_at_app_user BEFORE UPDATE ON app_user
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_auth_identity') THEN
    CREATE TRIGGER set_updated_at_auth_identity BEFORE UPDATE ON auth_identity
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_auth_role') THEN
    CREATE TRIGGER set_updated_at_auth_role BEFORE UPDATE ON auth_role
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Default roles
INSERT INTO auth_role (key, description)
VALUES
  ('user', 'Default user'),
  ('admin', 'Administrator')
ON CONFLICT (key) DO NOTHING;

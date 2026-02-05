-- Safety migration: ensure OAuth state table exists for PKCE/login start flow.
-- This is idempotent and safe even if V6__auth.sql already ran successfully.

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

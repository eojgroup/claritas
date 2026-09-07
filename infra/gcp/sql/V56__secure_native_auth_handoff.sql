-- Bind OAuth state to the initiating browser and exchange native login results
-- through a short-lived, single-use PKCE handoff instead of a bearer in a URL.
-- Columns remain nullable during the compatibility rollout so an older API pod
-- can finish requests while a replacement pod starts using the stronger flow.

ALTER TABLE auth_state
  ADD COLUMN IF NOT EXISTS browser_binding_hash TEXT;

ALTER TABLE auth_state
  ADD COLUMN IF NOT EXISTS native_code_challenge TEXT;

CREATE TABLE IF NOT EXISTS auth_native_handoff (
  id             BIGSERIAL PRIMARY KEY,
  code_hash      TEXT NOT NULL UNIQUE,
  user_id        BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  code_challenge TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_native_handoff_expires_idx
  ON auth_native_handoff (expires_at);

COMMENT ON COLUMN auth_state.browser_binding_hash IS
  'SHA-256 hash of the per-state HttpOnly browser binding cookie; never the raw binding secret.';

COMMENT ON COLUMN auth_state.native_code_challenge IS
  'RFC 7636 S256 challenge supplied by an explicitly allowlisted native client.';

COMMENT ON TABLE auth_native_handoff IS
  'Short-lived one-time native authorization handoffs; code_hash stores no reusable bearer or raw handoff code.';

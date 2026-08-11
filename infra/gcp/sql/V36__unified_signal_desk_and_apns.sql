-- V36: make event-correlation decisions auditable and add fail-closed APNs
-- delivery. APNs accepts a notification asynchronously; an accepted request is
-- recorded separately from in-app acknowledgement and never treated as proof
-- that a person saw the alert.

CREATE TABLE IF NOT EXISTS intelligence_correlation_decision (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_record_type  TEXT NOT NULL,
  source_record_id    TEXT NOT NULL,
  candidate_event_id  UUID REFERENCES intelligence_event(id) ON DELETE SET NULL,
  selected_event_id   UUID NOT NULL REFERENCES intelligence_event(id) ON DELETE CASCADE,
  decision            TEXT NOT NULL CHECK (decision IN ('created','attached','related','rejected')),
  score               DOUBLE PRECISION CHECK (score IS NULL OR score BETWEEN 0 AND 1),
  threshold           DOUBLE PRECISION CHECK (threshold IS NULL OR threshold BETWEEN 0 AND 1),
  factors             JSONB NOT NULL DEFAULT '{}'::jsonb,
  methodology         TEXT NOT NULL,
  rationale           TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_record_type, source_record_id, selected_event_id, decision)
);
CREATE INDEX IF NOT EXISTS intelligence_correlation_candidate_time_idx
  ON intelligence_event (event_type, last_activity_time DESC)
  WHERE status IN ('emerging','active','monitoring');
CREATE INDEX IF NOT EXISTS intelligence_correlation_decision_source_idx
  ON intelligence_correlation_decision (source_record_type, source_record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS intelligence_event_entity_lookup_idx
  ON intelligence_event_entity (entity_type, entity_key, event_id);

ALTER TABLE earth_observation
  ADD COLUMN IF NOT EXISTS analysis_summary TEXT,
  ADD COLUMN IF NOT EXISTS analysis_details JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Budget-deferred jobs become eligible at the next UTC day/month boundary.
-- Keep that recovery path indexed alongside the original queue index.
CREATE INDEX IF NOT EXISTS earth_processing_job_budget_queue_idx
  ON earth_processing_job (status, priority, available_at)
  WHERE status IN ('queued','failed','budget_deferred');

CREATE TABLE IF NOT EXISTS user_push_device (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  platform            TEXT NOT NULL CHECK (platform IN ('ios','watchos')),
  installation_id     UUID NOT NULL,
  device_token        TEXT NOT NULL,
  token_hash          TEXT NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  app_bundle_id       TEXT NOT NULL CHECK (char_length(app_bundle_id) BETWEEN 1 AND 255),
  environment         TEXT NOT NULL CHECK (environment IN ('development','production')),
  active              BOOLEAN NOT NULL DEFAULT true,
  last_registered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  invalidated_at      TIMESTAMPTZ,
  invalidation_reason TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (token_hash, app_bundle_id, environment),
  CHECK ((active AND device_token ~ '^[0-9a-f]+$'
          AND char_length(device_token) BETWEEN 32 AND 256
          AND char_length(device_token) % 2 = 0)
      OR (NOT active AND device_token = '')),
  CHECK ((active AND invalidated_at IS NULL AND invalidation_reason IS NULL)
      OR (NOT active AND invalidated_at IS NOT NULL AND invalidation_reason IS NOT NULL)),
  CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX IF NOT EXISTS user_push_device_user_active_idx
  ON user_push_device (user_id, last_registered_at DESC) WHERE active;
CREATE UNIQUE INDEX IF NOT EXISTS user_push_device_active_installation_idx
  ON user_push_device (user_id, platform, installation_id, app_bundle_id, environment)
  WHERE active;

CREATE TABLE IF NOT EXISTS apns_delivery (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id        UUID NOT NULL REFERENCES alert_candidate(id) ON DELETE CASCADE,
  user_id             BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  device_id           UUID NOT NULL REFERENCES user_push_device(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
                        'queued','sending','accepted','failed','dead_letter','token_invalid','suppressed'
                      )),
  attempts            INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts        INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  available_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  apns_id             TEXT,
  credential_fingerprint TEXT CHECK (credential_fingerprint IS NULL OR credential_fingerprint ~ '^[0-9a-f]{64}$'),
  apns_status         INTEGER CHECK (apns_status IS NULL OR apns_status BETWEEN 0 AND 599),
  apns_reason         TEXT,
  accepted_at         TIMESTAMPTZ,
  last_error          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, device_id),
  CHECK (attempts <= max_attempts),
  CHECK (status <> 'accepted' OR (apns_status = 200 AND accepted_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS apns_delivery_queue_idx
  ON apns_delivery (status, available_at, created_at)
  WHERE status IN ('queued','failed','sending');
CREATE INDEX IF NOT EXISTS apns_delivery_candidate_idx
  ON apns_delivery (candidate_id, status);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_updated_at_user_push_device'
      AND tgrelid = 'user_push_device'::regclass
  ) THEN
    CREATE TRIGGER set_updated_at_user_push_device BEFORE UPDATE ON user_push_device
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_updated_at_apns_delivery'
      AND tgrelid = 'apns_delivery'::regclass
  ) THEN
    CREATE TRIGGER set_updated_at_apns_delivery BEFORE UPDATE ON apns_delivery
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

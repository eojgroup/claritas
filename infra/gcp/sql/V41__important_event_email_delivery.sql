-- V41: durable, explicitly opted-in email delivery for important intelligence
-- events. SMTP configuration remains outside the database and the application
-- worker fails closed when no relay is configured.

CREATE TABLE IF NOT EXISTS alert_email_delivery (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id        UUID NOT NULL REFERENCES alert_candidate(id) ON DELETE CASCADE,
  user_id             BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  recipient_email     TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
                        'queued','sending','submitting','sent','failed','dead_letter','suppressed'
                      )),
  attempts            INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts        INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider            TEXT NOT NULL DEFAULT 'smtp',
  provider_message_id TEXT,
  deterministic_message_id TEXT NOT NULL,
  context_snapshot    JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error          TEXT,
  queued_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  submission_started_at TIMESTAMPTZ,
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, user_id),
  UNIQUE (deterministic_message_id),
  CHECK (attempts <= max_attempts),
  CHECK (jsonb_typeof(context_snapshot) = 'object')
);

CREATE INDEX IF NOT EXISTS alert_email_delivery_queue_idx
  ON alert_email_delivery (status, available_at, queued_at)
  WHERE status IN ('queued','failed','sending','submitting');
CREATE INDEX IF NOT EXISTS alert_email_delivery_user_time_idx
  ON alert_email_delivery (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS alert_email_delivery_submission_time_idx
  ON alert_email_delivery (submission_started_at DESC)
  WHERE submission_started_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS alert_email_delivery_user_submission_time_idx
  ON alert_email_delivery (user_id, submission_started_at DESC)
  WHERE submission_started_at IS NOT NULL;

-- Earlier clients could persist string/number truthy values. Email consent is
-- now an exact JSON boolean contract; legacy non-booleans become explicit false.
UPDATE user_intelligence_watchlist
SET metadata=jsonb_set(metadata,'{email_enabled}','false'::jsonb,true),updated_at=now()
WHERE metadata ? 'email_enabled'
  AND jsonb_typeof(metadata->'email_enabled') IS DISTINCT FROM 'boolean';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_updated_at_alert_email_delivery'
      AND tgrelid = 'alert_email_delivery'::regclass
  ) THEN
    CREATE TRIGGER set_updated_at_alert_email_delivery
      BEFORE UPDATE ON alert_email_delivery
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION materialize_alert_email_deliveries(
  target_candidate UUID DEFAULT NULL,
  target_user BIGINT DEFAULT NULL,
  maximum_age_hours INTEGER DEFAULT 48,
  per_user_daily_cap INTEGER DEFAULT 5,
  global_daily_cap INTEGER DEFAULT 200,
  materialization_limit INTEGER DEFAULT 200
)
RETURNS INTEGER AS $$
DECLARE
  changed_rows INTEGER := 0;
  inserted_rows INTEGER := 0;
BEGIN
  -- Materialization runs in every API pod. Serialize the allowance calculation
  -- so two workers cannot independently consume the same per-user/global cap.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('important-event-email-materialization', 0)
  );

  -- A watch plus the user's daily-email preference is the explicit dual
  -- opt-in. A verified active account is required at materialization time.
  UPDATE alert_candidate_recipient email_recipient
  SET eligibility_status = 'muted',
      last_error = 'Important-event email opt-in or recipient eligibility is no longer active.',
      updated_at = now()
  WHERE email_recipient.channel = 'email'
    AND email_recipient.eligibility_status = 'eligible'
    AND (target_candidate IS NULL OR email_recipient.candidate_id = target_candidate)
    AND (target_user IS NULL OR email_recipient.user_id = target_user)
    AND NOT EXISTS (
      SELECT 1
      FROM alert_candidate_recipient in_app
      JOIN alert_candidate candidate ON candidate.id=in_app.candidate_id
      JOIN intelligence_event event ON event.id=candidate.event_id
      JOIN user_intelligence_watchlist watch ON watch.id=in_app.matched_watch_id
      JOIN app_user account ON account.id=in_app.user_id
      JOIN user_daily_briefing_schedule schedule ON schedule.user_id=in_app.user_id
      WHERE in_app.candidate_id=email_recipient.candidate_id
        AND in_app.user_id=email_recipient.user_id
        AND in_app.channel='in_app'
        AND in_app.eligibility_status IN ('eligible','delivered')
        AND candidate.status IN ('candidate','eligible','delivered')
        AND candidate.severity IN ('high','critical')
        AND candidate.created_at >= now() - make_interval(hours => LEAST(168,GREATEST(1,maximum_age_hours)))
        AND event.status NOT IN ('resolved','dismissed')
        AND watch.alerts_enabled
        AND watch.metadata->'email_enabled' = 'true'::jsonb
        AND account.is_active AND account.email_verified
        AND account.email IS NOT NULL
        AND account.email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        AND schedule.enabled AND schedule.email_enabled
    );

  UPDATE alert_email_delivery delivery
  SET status='suppressed',
      last_error='Important-event email was disabled before delivery.',
      updated_at=now()
  WHERE delivery.status IN ('queued','failed','sending')
    AND (target_candidate IS NULL OR delivery.candidate_id=target_candidate)
    AND (target_user IS NULL OR delivery.user_id=target_user)
    AND NOT EXISTS (
      SELECT 1 FROM alert_candidate_recipient recipient
      WHERE recipient.candidate_id=delivery.candidate_id
        AND recipient.user_id=delivery.user_id
        AND recipient.channel='email'
        AND recipient.eligibility_status='eligible'
    );

  WITH eligible_matches AS (
    SELECT DISTINCT ON (candidate.id,in_app.user_id)
      candidate.id AS candidate_id,
      in_app.user_id,
      in_app.matched_watch_id,
      in_app.metadata,
      account.email
    FROM alert_candidate candidate
    JOIN intelligence_event event ON event.id=candidate.event_id
    JOIN alert_candidate_recipient in_app ON in_app.candidate_id=candidate.id
      AND in_app.channel='in_app' AND in_app.eligibility_status IN ('eligible','delivered')
    JOIN user_intelligence_watchlist watch ON watch.id=in_app.matched_watch_id
    JOIN app_user account ON account.id=in_app.user_id
    JOIN user_daily_briefing_schedule schedule ON schedule.user_id=in_app.user_id
    WHERE candidate.status IN ('candidate','eligible','delivered')
      AND candidate.severity IN ('high','critical')
      AND candidate.created_at >= now() - make_interval(hours => LEAST(168,GREATEST(1,maximum_age_hours)))
      AND event.status NOT IN ('resolved','dismissed')
      AND watch.alerts_enabled
      AND watch.metadata->'email_enabled' = 'true'::jsonb
      AND account.is_active AND account.email_verified
      AND account.email IS NOT NULL
      AND account.email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      AND schedule.enabled AND schedule.email_enabled
      AND (target_candidate IS NULL OR candidate.id=target_candidate)
      AND (target_user IS NULL OR in_app.user_id=target_user)
      AND NOT EXISTS (
        SELECT 1 FROM alert_email_delivery terminal_delivery
        WHERE terminal_delivery.candidate_id=candidate.id
          AND terminal_delivery.user_id=in_app.user_id
          AND terminal_delivery.status='dead_letter'
      )
    ORDER BY candidate.id,in_app.user_id,watch.created_at,watch.id
  )
  INSERT INTO alert_candidate_recipient (
    candidate_id,user_id,channel,eligibility_status,matched_watch_id,metadata
  )
  SELECT candidate_id,user_id,'email','eligible',matched_watch_id,
         metadata || jsonb_build_object('email_opt_in','daily_email_and_enabled_watch')
  FROM eligible_matches
  ON CONFLICT (candidate_id,user_id,channel) DO UPDATE SET
    eligibility_status=CASE
      WHEN alert_candidate_recipient.eligibility_status='delivered' THEN 'delivered'
      ELSE 'eligible' END,
    matched_watch_id=EXCLUDED.matched_watch_id,
    last_error=NULL,
    metadata=alert_candidate_recipient.metadata || EXCLUDED.metadata,
    updated_at=now();

  GET DIAGNOSTICS changed_rows = ROW_COUNT;

  -- A verified address change updates only unsent work. The stable candidate
  -- and user keys, context snapshot and deterministic Message-ID are retained.
  UPDATE alert_email_delivery delivery
  SET recipient_email=account.email,updated_at=now()
  FROM alert_candidate_recipient recipient
  JOIN app_user account ON account.id=recipient.user_id
  WHERE delivery.candidate_id=recipient.candidate_id
    AND delivery.user_id=recipient.user_id
    AND delivery.status IN ('queued','failed')
    AND recipient.channel='email' AND recipient.eligibility_status='eligible'
    AND account.is_active AND account.email_verified
    AND account.email IS NOT NULL
    AND account.email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    AND delivery.recipient_email IS DISTINCT FROM account.email;

  WITH candidates AS (
    SELECT candidate.id AS candidate_id,candidate.created_at,candidate.severity,
           recipient.user_id,account.email,recipient.matched_watch_id,
           watch.watch_type,watch.watch_key,watch.minimum_severity,
           schedule.industries,schedule.company_symbols,schedule.country_iso2s,
           schedule.regions,schedule.email_theme,
           CASE candidate.severity WHEN 'critical' THEN 2 ELSE 1 END AS severity_rank,
           (SELECT count(*)::int FROM alert_email_delivery existing
            WHERE existing.user_id=recipient.user_id
              AND existing.created_at >= now()-interval '24 hours'
              AND existing.status <> 'suppressed') AS existing_24h,
           (SELECT count(*)::int FROM alert_email_delivery global_existing
            WHERE global_existing.created_at >= now()-interval '24 hours'
              AND global_existing.status <> 'suppressed') AS global_existing_24h
    FROM alert_candidate candidate
    JOIN intelligence_event event ON event.id=candidate.event_id
    JOIN alert_candidate_recipient recipient ON recipient.candidate_id=candidate.id
      AND recipient.channel='email' AND recipient.eligibility_status='eligible'
    JOIN app_user account ON account.id=recipient.user_id
    JOIN user_intelligence_watchlist watch ON watch.id=recipient.matched_watch_id
    JOIN user_daily_briefing_schedule schedule ON schedule.user_id=recipient.user_id
    WHERE candidate.status IN ('candidate','eligible','delivered')
      AND candidate.severity IN ('high','critical')
      AND candidate.created_at >= now() - make_interval(hours => LEAST(168,GREATEST(1,maximum_age_hours)))
      AND event.status NOT IN ('resolved','dismissed')
      AND watch.alerts_enabled
      AND watch.metadata->'email_enabled' = 'true'::jsonb
      AND account.is_active AND account.email_verified
      AND account.email IS NOT NULL
      AND account.email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      AND schedule.enabled AND schedule.email_enabled
      AND (target_candidate IS NULL OR candidate.id=target_candidate)
      AND (target_user IS NULL OR recipient.user_id=target_user)
      AND NOT EXISTS (
        SELECT 1 FROM alert_email_delivery duplicate
        WHERE duplicate.candidate_id=candidate.id AND duplicate.user_id=recipient.user_id
      )
  ), ranked AS (
    SELECT candidates.*,
           row_number() OVER (
             PARTITION BY user_id ORDER BY severity_rank DESC,created_at DESC,candidate_id
           ) AS user_rank,
           row_number() OVER (
             ORDER BY severity_rank DESC,created_at DESC,candidate_id,user_id
           ) AS global_rank
    FROM candidates
  ), bounded AS (
    SELECT * FROM ranked
    WHERE user_rank <= GREATEST(0,LEAST(20,per_user_daily_cap)-existing_24h)
      AND global_rank <= GREATEST(0,LEAST(5000,global_daily_cap)-global_existing_24h)
    ORDER BY severity_rank DESC,created_at DESC,candidate_id,user_id
    LIMIT LEAST(1000,GREATEST(1,materialization_limit))
  )
  INSERT INTO alert_email_delivery (
    candidate_id,user_id,recipient_email,deterministic_message_id,context_snapshot
  )
  SELECT candidate_id,user_id,email,
         'claritas-event-' || candidate_id::text || '-' || user_id::text || '@claritas',
         jsonb_build_object(
           'matched_watch',jsonb_build_object(
             'id',matched_watch_id,'type',watch_type,'key',watch_key,
             'minimum_severity',minimum_severity
           ),
           'preferences',jsonb_build_object(
             'industries',industries,'company_symbols',company_symbols,
             'country_iso2s',country_iso2s,'regions',regions,'email_theme',email_theme
           ),
           'selection','high_or_critical_explicit_watch_email_opt_in_and_verified_email'
         )
  FROM bounded
  ON CONFLICT (candidate_id,user_id) DO NOTHING;

  GET DIAGNOSTICS inserted_rows = ROW_COUNT;
  RETURN changed_rows + inserted_rows;
END;
$$ LANGUAGE plpgsql;

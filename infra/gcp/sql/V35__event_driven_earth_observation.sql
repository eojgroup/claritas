-- V35: event-driven, geospatial cross-domain intelligence and Earth observation.
-- Domain-table triggers write to the outbox in the same transaction as source
-- persistence. Raster bytes remain in GCS; PostgreSQL stores governed metadata.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS intelligence_location (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                TEXT NOT NULL UNIQUE,
  location_type       TEXT NOT NULL CHECK (location_type IN (
                        'country','region','city','port','airport','chokepoint','canal','strait',
                        'border_crossing','industrial_facility','refinery','lng_terminal',
                        'power_station','oil_gas_field','storage_hub','mine','rail_terminal',
                        'agricultural_region','reservoir','dam','strategic_site','point','area'
                      )),
  canonical_name      TEXT NOT NULL,
  country_iso2        CHAR(2) REFERENCES country(iso2),
  admin1              TEXT,
  latitude            DOUBLE PRECISION,
  longitude           DOUBLE PRECISION,
  bbox                DOUBLE PRECISION[],
  geometry            geometry(Geometry, 4326),
  center              geography(Point, 4326),
  timezone            TEXT,
  importance_score    DOUBLE PRECISION NOT NULL DEFAULT 0.5 CHECK (importance_score BETWEEN 0 AND 1),
  monitoring_tier     SMALLINT NOT NULL DEFAULT 3 CHECK (monitoring_tier BETWEEN 1 AND 3),
  source_id           BIGINT REFERENCES source(id) ON DELETE SET NULL,
  source_external_id  TEXT,
  source_url          TEXT,
  license             TEXT,
  attribution         TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  active              BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((latitude IS NULL AND longitude IS NULL) OR
         (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)),
  CHECK (bbox IS NULL OR array_length(bbox, 1) = 4)
);

CREATE INDEX IF NOT EXISTS intelligence_location_center_gix
  ON intelligence_location USING GIST (center);
CREATE INDEX IF NOT EXISTS intelligence_location_geometry_gix
  ON intelligence_location USING GIST (geometry);
CREATE INDEX IF NOT EXISTS intelligence_location_country_type_idx
  ON intelligence_location (country_iso2, location_type, monitoring_tier)
  WHERE active;
CREATE INDEX IF NOT EXISTS intelligence_location_monitoring_idx
  ON intelligence_location (monitoring_tier, importance_score DESC)
  WHERE active;

CREATE TABLE IF NOT EXISTS intelligence_location_alias (
  id                  BIGSERIAL PRIMARY KEY,
  location_id         UUID NOT NULL REFERENCES intelligence_location(id) ON DELETE CASCADE,
  alias               TEXT NOT NULL,
  normalized_alias    TEXT NOT NULL,
  language_code       TEXT,
  alias_type          TEXT NOT NULL DEFAULT 'common' CHECK (alias_type IN ('common','historic','translated','abbreviation')),
  source_id           BIGINT REFERENCES source(id) ON DELETE SET NULL,
  confidence          DOUBLE PRECISION NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (location_id, normalized_alias)
);
CREATE INDEX IF NOT EXISTS intelligence_location_alias_lookup_idx
  ON intelligence_location_alias (normalized_alias);

CREATE TABLE IF NOT EXISTS intelligence_location_identifier (
  id                  BIGSERIAL PRIMARY KEY,
  location_id         UUID NOT NULL REFERENCES intelligence_location(id) ON DELETE CASCADE,
  identifier_scheme   TEXT NOT NULL,
  identifier_value    TEXT NOT NULL,
  source_url          TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (identifier_scheme, identifier_value)
);

CREATE TABLE IF NOT EXISTS physical_asset (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id         UUID NOT NULL REFERENCES intelligence_location(id) ON DELETE RESTRICT,
  asset_type          TEXT NOT NULL,
  canonical_name      TEXT NOT NULL,
  operator_name       TEXT,
  source_id           BIGINT REFERENCES source(id) ON DELETE SET NULL,
  source_external_id  TEXT,
  source_url          TEXT,
  license             TEXT,
  attribution         TEXT,
  confidence          DOUBLE PRECISION NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  active              BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (location_id, asset_type, canonical_name)
);

CREATE TABLE IF NOT EXISTS market_location_exposure (
  id                  BIGSERIAL PRIMARY KEY,
  instrument_id       BIGINT NOT NULL REFERENCES market_instrument(id) ON DELETE CASCADE,
  location_id         UUID NOT NULL REFERENCES intelligence_location(id) ON DELETE CASCADE,
  relationship        TEXT NOT NULL CHECK (relationship IN (
                        'production_region','export_terminal','transport_corridor','storage_region','benchmark_exposure'
                      )),
  confidence          DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  source_url          TEXT NOT NULL,
  attribution         TEXT NOT NULL,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (instrument_id, location_id, relationship)
);

CREATE TABLE IF NOT EXISTS intelligence_event (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key          TEXT NOT NULL UNIQUE,
  event_type          TEXT NOT NULL,
  title               TEXT NOT NULL,
  summary             TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('emerging','active','monitoring','resolved','dismissed')),
  severity            TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  confidence          DOUBLE PRECISION NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  start_time          TIMESTAMPTZ NOT NULL,
  last_activity_time  TIMESTAMPTZ NOT NULL,
  end_time            TIMESTAMPTZ,
  primary_location_id UUID REFERENCES intelligence_location(id) ON DELETE SET NULL,
  primary_country_iso2 CHAR(2) REFERENCES country(iso2),
  geography           geometry(Geometry, 4326),
  source_diversity    INTEGER NOT NULL DEFAULT 1 CHECK (source_diversity >= 0),
  domain_count        INTEGER NOT NULL DEFAULT 1 CHECK (domain_count >= 0),
  relevance_score     DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (relevance_score BETWEEN 0 AND 1),
  urgency_score       DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (urgency_score BETWEEN 0 AND 1),
  materiality_score   DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (materiality_score BETWEEN 0 AND 1),
  score_components    JSONB NOT NULL DEFAULT '{}'::jsonb,
  assessment_kind     TEXT NOT NULL DEFAULT 'deterministic' CHECK (assessment_kind IN ('deterministic','model_assisted','analyst')),
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intelligence_event_rank_idx
  ON intelligence_event (status, relevance_score DESC, last_activity_time DESC);
CREATE INDEX IF NOT EXISTS intelligence_event_relevance_time_idx
  ON intelligence_event (relevance_score DESC, last_activity_time DESC);
CREATE INDEX IF NOT EXISTS intelligence_event_country_time_idx
  ON intelligence_event (primary_country_iso2, last_activity_time DESC);
CREATE INDEX IF NOT EXISTS intelligence_event_location_time_idx
  ON intelligence_event (primary_location_id, last_activity_time DESC);
CREATE INDEX IF NOT EXISTS intelligence_event_geography_gix
  ON intelligence_event USING GIST (geography);

CREATE TABLE IF NOT EXISTS intelligence_event_location (
  event_id            UUID NOT NULL REFERENCES intelligence_event(id) ON DELETE CASCADE,
  location_id         UUID NOT NULL REFERENCES intelligence_location(id) ON DELETE CASCADE,
  relationship        TEXT NOT NULL DEFAULT 'affected' CHECK (relationship IN ('primary','affected','nearby','origin','destination','exposed')),
  distance_km         DOUBLE PRECISION,
  confidence          DOUBLE PRECISION NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, location_id, relationship)
);
CREATE INDEX IF NOT EXISTS intelligence_event_location_location_idx
  ON intelligence_event_location (location_id, event_id);

CREATE TABLE IF NOT EXISTS intelligence_event_evidence (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL REFERENCES intelligence_event(id) ON DELETE CASCADE,
  domain              TEXT NOT NULL CHECK (domain IN ('news','transport','market','weather','earth_observation','disaster','podcast','assessment')),
  evidence_type       TEXT NOT NULL,
  source_record_type  TEXT NOT NULL,
  source_record_id    TEXT NOT NULL,
  source_id           BIGINT REFERENCES source(id) ON DELETE SET NULL,
  observed_at         TIMESTAMPTZ NOT NULL,
  published_at        TIMESTAMPTZ,
  location_id         UUID REFERENCES intelligence_location(id) ON DELETE SET NULL,
  confidence          DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  relationship        TEXT NOT NULL CHECK (relationship IN ('reported','observed','derived','model_interpretation','assessment','corroborates','contradicts','context')),
  provenance          JSONB NOT NULL,
  license             TEXT,
  attribution         TEXT,
  correlation_score   DOUBLE PRECISION NOT NULL DEFAULT 1 CHECK (correlation_score BETWEEN 0 AND 1),
  correlation_factors JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, domain, source_record_type, source_record_id)
);
CREATE INDEX IF NOT EXISTS intelligence_event_evidence_event_domain_idx
  ON intelligence_event_evidence (event_id, domain, observed_at DESC);
CREATE INDEX IF NOT EXISTS intelligence_event_evidence_source_idx
  ON intelligence_event_evidence (source_record_type, source_record_id);

CREATE TABLE IF NOT EXISTS intelligence_event_entity (
  event_id            UUID NOT NULL REFERENCES intelligence_event(id) ON DELETE CASCADE,
  entity_type         TEXT NOT NULL,
  entity_key          TEXT NOT NULL,
  display_name        TEXT NOT NULL,
  relationship        TEXT NOT NULL DEFAULT 'mentioned',
  confidence          DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (event_id, entity_type, entity_key, relationship)
);

CREATE TABLE IF NOT EXISTS intelligence_event_relationship (
  from_event_id       UUID NOT NULL REFERENCES intelligence_event(id) ON DELETE CASCADE,
  to_event_id         UUID NOT NULL REFERENCES intelligence_event(id) ON DELETE CASCADE,
  relationship        TEXT NOT NULL CHECK (relationship IN ('updates','related','possible_driver','possible_consequence','contradicts')),
  confidence          DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  rationale           TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (from_event_id, to_event_id, relationship),
  CHECK (from_event_id <> to_event_id)
);

CREATE TABLE IF NOT EXISTS event_outbox (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type          TEXT NOT NULL,
  aggregate_type      TEXT NOT NULL,
  aggregate_id        TEXT NOT NULL,
  dedupe_key          TEXT NOT NULL UNIQUE,
  payload             JSONB NOT NULL,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','publishing','published','failed','dead_letter')),
  attempts            INTEGER NOT NULL DEFAULT 0,
  available_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at           TIMESTAMPTZ,
  published_at        TIMESTAMPTZ,
  last_error          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_outbox_dispatch_idx
  ON event_outbox (status, available_at, occurred_at)
  WHERE status IN ('pending','failed','publishing');

CREATE TABLE IF NOT EXISTS consumed_domain_event (
  consumer_name       TEXT NOT NULL,
  event_id            UUID NOT NULL,
  event_type          TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('processing','processed','failed')),
  attempts            INTEGER NOT NULL DEFAULT 1,
  lease_until         TIMESTAMPTZ,
  last_error          TEXT,
  processed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_name, event_id)
);

CREATE TABLE IF NOT EXISTS event_dead_letter (
  id                  BIGSERIAL PRIMARY KEY,
  outbox_event_id     UUID NOT NULL UNIQUE,
  event_type          TEXT NOT NULL,
  payload             JSONB NOT NULL,
  attempts            INTEGER NOT NULL,
  last_error          TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at         TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS earth_scene (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider            TEXT NOT NULL,
  mission             TEXT NOT NULL,
  collection          TEXT NOT NULL,
  provider_scene_id   TEXT NOT NULL,
  capture_start       TIMESTAMPTZ NOT NULL,
  capture_end         TIMESTAMPTZ,
  published_at        TIMESTAMPTZ,
  geometry            geometry(Geometry, 4326),
  bbox                DOUBLE PRECISION[] NOT NULL CHECK (array_length(bbox, 1) = 4),
  cloud_cover         DOUBLE PRECISION,
  resolution_m        DOUBLE PRECISION,
  orbit_direction     TEXT,
  quality             JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_url          TEXT NOT NULL,
  license             TEXT NOT NULL,
  attribution         TEXT NOT NULL,
  raw_metadata        JSONB NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, collection, provider_scene_id)
);
CREATE INDEX IF NOT EXISTS earth_scene_capture_idx ON earth_scene (capture_start DESC);
CREATE INDEX IF NOT EXISTS earth_scene_geometry_gix ON earth_scene USING GIST (geometry);

CREATE TABLE IF NOT EXISTS earth_scene_location (
  scene_id            UUID NOT NULL REFERENCES earth_scene(id) ON DELETE CASCADE,
  location_id         UUID NOT NULL REFERENCES intelligence_location(id) ON DELETE CASCADE,
  intersection_ratio  DOUBLE PRECISION CHECK (intersection_ratio BETWEEN 0 AND 1),
  distance_km         DOUBLE PRECISION,
  rank_score          DOUBLE PRECISION NOT NULL DEFAULT 0,
  rank_components     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scene_id, location_id)
);

CREATE TABLE IF NOT EXISTS earth_observation (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id            UUID NOT NULL REFERENCES earth_scene(id) ON DELETE CASCADE,
  location_id         UUID REFERENCES intelligence_location(id) ON DELETE SET NULL,
  event_id            UUID REFERENCES intelligence_event(id) ON DELETE SET NULL,
  product_type        TEXT NOT NULL CHECK (product_type IN ('true_color','false_color','ndvi','ndwi','burn_index','sar','gibs_layer')),
  status              TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','available','failed','expired')),
  captured_at         TIMESTAMPTZ NOT NULL,
  generated_at        TIMESTAMPTZ,
  analysis_kind       TEXT NOT NULL DEFAULT 'rendered_observation' CHECK (analysis_kind IN ('rendered_observation','derived_metric','model_interpretation')),
  quality             JSONB NOT NULL DEFAULT '{}'::jsonb,
  methodology         JSONB NOT NULL DEFAULT '{}'::jsonb,
  attribution         TEXT NOT NULL,
  license             TEXT NOT NULL,
  last_error          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (scene_id, location_id, event_id, product_type)
);
CREATE INDEX IF NOT EXISTS earth_observation_event_idx
  ON earth_observation (event_id, captured_at DESC) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS earth_observation_location_idx
  ON earth_observation (location_id, captured_at DESC) WHERE location_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS earth_observation_asset (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id      UUID NOT NULL REFERENCES earth_observation(id) ON DELETE CASCADE,
  asset_type          TEXT NOT NULL CHECK (asset_type IN ('thumbnail','preview','full','legend')),
  mime_type           TEXT NOT NULL,
  width               INTEGER NOT NULL CHECK (width > 0),
  height              INTEGER NOT NULL CHECK (height > 0),
  gcs_object          TEXT NOT NULL,
  content_hash        TEXT NOT NULL,
  etag                TEXT,
  size_bytes          BIGINT NOT NULL CHECK (size_bytes >= 0),
  generated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ,
  UNIQUE (observation_id, asset_type)
);

CREATE TABLE IF NOT EXISTS earth_processing_job (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key          TEXT NOT NULL UNIQUE,
  job_type            TEXT NOT NULL CHECK (job_type IN ('scene_discovery','render','compare','vision_enrichment')),
  provider            TEXT NOT NULL,
  event_id            UUID REFERENCES intelligence_event(id) ON DELETE CASCADE,
  location_id         UUID REFERENCES intelligence_location(id) ON DELETE CASCADE,
  scene_id            UUID REFERENCES earth_scene(id) ON DELETE SET NULL,
  observation_id      UUID REFERENCES earth_observation(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','success','failed','dead_letter','budget_deferred')),
  priority            INTEGER NOT NULL DEFAULT 100,
  attempts            INTEGER NOT NULL DEFAULT 0,
  max_attempts        INTEGER NOT NULL DEFAULT 5,
  available_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at          TIMESTAMPTZ,
  finished_at         TIMESTAMPTZ,
  last_error          TEXT,
  parameters          JSONB NOT NULL DEFAULT '{}'::jsonb,
  result              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS earth_processing_job_queue_idx
  ON earth_processing_job (status, priority, available_at) WHERE status IN ('queued','failed');

CREATE TABLE IF NOT EXISTS earth_provider_usage (
  provider            TEXT NOT NULL,
  usage_date          DATE NOT NULL,
  scene_searches      INTEGER NOT NULL DEFAULT 0,
  process_requests    INTEGER NOT NULL DEFAULT 0,
  processing_units    DOUBLE PRECISION NOT NULL DEFAULT 0,
  rendered_pixels     BIGINT NOT NULL DEFAULT 0,
  cache_hits          INTEGER NOT NULL DEFAULT 0,
  bytes_stored        BIGINT NOT NULL DEFAULT 0,
  errors              INTEGER NOT NULL DEFAULT 0,
  rate_limits         INTEGER NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, usage_date)
);

CREATE TABLE IF NOT EXISTS earth_fire_detection (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_external_id TEXT NOT NULL UNIQUE,
  location             geography(Point, 4326) NOT NULL,
  latitude             DOUBLE PRECISION NOT NULL,
  longitude            DOUBLE PRECISION NOT NULL,
  acquisition_time    TIMESTAMPTZ NOT NULL,
  satellite           TEXT NOT NULL,
  instrument          TEXT NOT NULL,
  confidence          TEXT NOT NULL,
  fire_radiative_power DOUBLE PRECISION,
  day_night           TEXT,
  source_version      TEXT,
  raw_payload         JSONB NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS earth_fire_detection_location_gix
  ON earth_fire_detection USING GIST (location);
CREATE INDEX IF NOT EXISTS earth_fire_detection_time_idx
  ON earth_fire_detection (acquisition_time DESC);

CREATE TABLE IF NOT EXISTS earthquake_observation (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usgs_event_id       TEXT NOT NULL UNIQUE,
  location            geography(Point, 4326) NOT NULL,
  latitude            DOUBLE PRECISION NOT NULL,
  longitude           DOUBLE PRECISION NOT NULL,
  depth_km            DOUBLE PRECISION,
  magnitude           DOUBLE PRECISION,
  magnitude_type      TEXT,
  place               TEXT,
  significance        INTEGER,
  alert_level         TEXT,
  tsunami             BOOLEAN NOT NULL DEFAULT false,
  felt                INTEGER,
  observed_at         TIMESTAMPTZ NOT NULL,
  updated_at_source   TIMESTAMPTZ NOT NULL,
  source_url          TEXT NOT NULL,
  raw_payload         JSONB NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS earthquake_observation_location_gix
  ON earthquake_observation USING GIST (location);
CREATE INDEX IF NOT EXISTS earthquake_observation_time_idx
  ON earthquake_observation (observed_at DESC);

CREATE TABLE IF NOT EXISTS alert_candidate (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL REFERENCES intelligence_event(id) ON DELETE CASCADE,
  dedupe_key          TEXT NOT NULL UNIQUE,
  severity            TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  title               TEXT NOT NULL,
  body                TEXT NOT NULL,
  eligibility         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status              TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','eligible','muted','delivered','failed','expired')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alert_candidate_status_idx ON alert_candidate (status, created_at DESC);

CREATE TABLE IF NOT EXISTS user_intelligence_watchlist (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  watch_type          TEXT NOT NULL CHECK (watch_type IN ('country','location','port','airport','chokepoint','commodity','market_symbol','event_type')),
  watch_key           TEXT NOT NULL,
  minimum_severity    TEXT NOT NULL DEFAULT 'high' CHECK (minimum_severity IN ('low','medium','high','critical')),
  alerts_enabled      BOOLEAN NOT NULL DEFAULT true,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, watch_type, watch_key)
);

-- Delivery remains deliberately channel-neutral. This table materializes the
-- user-eligibility stage so in-app clients can consume correlated alerts now,
-- while APNs/email delivery can be enabled later without re-evaluating raw
-- feeds or pretending that an external notification was sent.
CREATE TABLE IF NOT EXISTS alert_candidate_recipient (
  candidate_id        UUID NOT NULL REFERENCES alert_candidate(id) ON DELETE CASCADE,
  user_id             BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  channel             TEXT NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app','push','email')),
  eligibility_status  TEXT NOT NULL DEFAULT 'eligible' CHECK (eligibility_status IN ('eligible','muted','delivered','failed')),
  matched_watch_id    UUID REFERENCES user_intelligence_watchlist(id) ON DELETE SET NULL,
  acknowledged_at     TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  last_error          TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (candidate_id, user_id, channel)
);
CREATE INDEX IF NOT EXISTS alert_candidate_recipient_user_idx
  ON alert_candidate_recipient (user_id, eligibility_status, created_at DESC);

CREATE OR REPLACE FUNCTION materialize_alert_candidate_recipients(
  target_candidate UUID DEFAULT NULL,
  target_user BIGINT DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  changed_rows INTEGER := 0;
BEGIN
  -- Re-evaluation is deterministic: temporarily mute current in-app matches in
  -- the requested scope, then promote only recipients that still satisfy an
  -- enabled watch and its minimum severity.
  UPDATE alert_candidate_recipient recipient
  SET eligibility_status = 'muted', updated_at = now()
  WHERE recipient.channel = 'in_app'
    AND recipient.eligibility_status <> 'delivered'
    AND (target_candidate IS NULL OR recipient.candidate_id = target_candidate)
    AND (target_user IS NULL OR recipient.user_id = target_user);

  INSERT INTO alert_candidate_recipient (
    candidate_id, user_id, channel, eligibility_status, matched_watch_id, metadata
  )
  SELECT DISTINCT ON (candidate.id, watch.user_id)
    candidate.id,
    watch.user_id,
    'in_app',
    'eligible',
    watch.id,
    jsonb_build_object('watch_type', watch.watch_type, 'watch_key', watch.watch_key)
  FROM alert_candidate candidate
  JOIN intelligence_event event ON event.id = candidate.event_id
  LEFT JOIN intelligence_location location ON location.id = event.primary_location_id
  JOIN user_intelligence_watchlist watch
    ON watch.alerts_enabled
   AND CASE candidate.severity
         WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1
       END >= CASE watch.minimum_severity
         WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1
       END
   AND (
     (watch.watch_type = 'country' AND upper(watch.watch_key) = event.primary_country_iso2)
     OR (watch.watch_type = 'event_type' AND lower(watch.watch_key) = lower(event.event_type))
     OR (watch.watch_type = 'market_symbol' AND lower(watch.watch_key) = lower(event.metadata->>'symbol'))
     OR (watch.watch_type = 'commodity' AND lower(watch.watch_key) = lower(event.metadata->>'commodity'))
     OR (watch.watch_type = 'location' AND (
       lower(watch.watch_key) = lower(COALESCE(location.id::text, ''))
       OR lower(watch.watch_key) = lower(COALESCE(location.slug, ''))
       OR lower(watch.watch_key) = lower(COALESCE(location.canonical_name, ''))
     ))
     OR (watch.watch_type = 'port' AND location.location_type = 'port' AND (
       lower(watch.watch_key) = lower(location.slug) OR lower(watch.watch_key) = lower(location.canonical_name)
     ))
     OR (watch.watch_type = 'airport' AND location.location_type = 'airport' AND (
       lower(watch.watch_key) = lower(location.slug) OR lower(watch.watch_key) = lower(location.canonical_name)
     ))
     OR (watch.watch_type = 'chokepoint' AND location.location_type IN ('strait','canal') AND (
       lower(watch.watch_key) = lower(location.slug) OR lower(watch.watch_key) = lower(location.canonical_name)
     ))
   )
  WHERE (target_candidate IS NULL OR candidate.id = target_candidate)
    AND (target_user IS NULL OR watch.user_id = target_user)
    AND candidate.status IN ('candidate','eligible')
    AND candidate.created_at >= now() - interval '30 days'
  ORDER BY candidate.id, watch.user_id, watch.created_at, watch.id
  ON CONFLICT (candidate_id, user_id, channel) DO UPDATE SET
    eligibility_status = CASE
      WHEN alert_candidate_recipient.eligibility_status = 'delivered' THEN 'delivered'
      ELSE 'eligible'
    END,
    matched_watch_id = EXCLUDED.matched_watch_id,
    metadata = alert_candidate_recipient.metadata || EXCLUDED.metadata,
    updated_at = now();

  GET DIAGNOSTICS changed_rows = ROW_COUNT;

  UPDATE alert_candidate candidate
  SET status = CASE
      WHEN EXISTS (
        SELECT 1 FROM alert_candidate_recipient recipient
        WHERE recipient.candidate_id = candidate.id
          AND recipient.eligibility_status IN ('eligible','delivered')
      ) THEN 'eligible'
      ELSE 'candidate'
    END,
    updated_at = now()
  WHERE (target_candidate IS NULL OR candidate.id = target_candidate)
    AND candidate.status IN ('candidate','eligible');

  RETURN changed_rows;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS provider_runtime_state (
  provider            TEXT PRIMARY KEY,
  enabled             BOOLEAN NOT NULL DEFAULT false,
  last_attempt_at     TIMESTAMPTZ,
  last_success_at     TIMESTAMPTZ,
  last_event_at       TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  circuit_open_until  TIMESTAMPTZ,
  rate_limited_until  TIMESTAMPTZ,
  last_error          TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Atomically expose writes from existing domain persistence without forcing
-- every connector to duplicate event-publishing logic.
CREATE OR REPLACE FUNCTION enqueue_claritas_domain_event()
RETURNS TRIGGER AS $$
DECLARE
  emitted_type TEXT;
  emitted_id TEXT;
  emitted_time TIMESTAMPTZ;
  emitted_payload JSONB;
  emitted_dedupe TEXT;
BEGIN
  IF TG_TABLE_NAME = 'item' THEN
    IF NEW.kind IS DISTINCT FROM 'news_article' THEN RETURN NEW; END IF;
    emitted_type := CASE WHEN TG_OP = 'INSERT' THEN 'news.story.ingested' ELSE 'news.story.updated' END;
    emitted_id := NEW.id::text;
    emitted_time := COALESCE(NEW.event_time, NEW.updated_at, now());
    emitted_payload := jsonb_build_object('item_id', NEW.id, 'country_iso2', NEW.country_iso2, 'event_time', emitted_time);
    emitted_dedupe := emitted_type || ':' || NEW.id::text || ':' || extract(epoch FROM COALESCE(NEW.updated_at, now()))::bigint::text;
  ELSIF TG_TABLE_NAME = 'global_event' THEN
    emitted_type := 'news.event.observed'; emitted_id := NEW.id::text;
    emitted_time := NEW.event_time;
    emitted_payload := jsonb_build_object('global_event_id', NEW.id, 'country_iso2', NEW.action_country_iso2, 'event_time', NEW.event_time);
    emitted_dedupe := emitted_type || ':' || NEW.id::text || ':' || extract(epoch FROM COALESCE(NEW.updated_at, now()))::bigint::text;
  ELSIF TG_TABLE_NAME = 'weather_alert' THEN
    emitted_type := CASE WHEN TG_OP = 'INSERT' THEN 'weather.alert.created' ELSE 'weather.alert.updated' END;
    emitted_id := NEW.id::text; emitted_time := NEW.starts_at;
    emitted_payload := jsonb_build_object('weather_alert_id', NEW.id, 'country_iso2', NEW.country_iso2, 'starts_at', NEW.starts_at);
    emitted_dedupe := emitted_type || ':' || NEW.id::text || ':' || extract(epoch FROM COALESCE(NEW.updated_at, now()))::bigint::text;
  ELSIF TG_TABLE_NAME = 'transport_movement_event' THEN
    emitted_type := 'transport.movement.recorded'; emitted_id := NEW.id::text; emitted_time := NEW.observed_at;
    emitted_payload := jsonb_build_object('movement_event_id', NEW.id, 'country_iso2', NEW.country_iso2, 'location_name', NEW.location_name, 'observed_at', NEW.observed_at);
    emitted_dedupe := emitted_type || ':' || NEW.id::text;
  ELSIF TG_TABLE_NAME = 'market_indicator' THEN
    emitted_type := 'market.instrument.observed'; emitted_id := NEW.id::text; emitted_time := NEW.observed_at;
    emitted_payload := jsonb_build_object('market_indicator_id', NEW.id, 'country_iso2', NEW.country_iso2, 'instrument_id', NEW.instrument_id, 'observed_at', NEW.observed_at);
    emitted_dedupe := emitted_type || ':' || NEW.id::text || ':' || extract(epoch FROM COALESCE(NEW.updated_at, now()))::bigint::text;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO event_outbox (event_type, aggregate_type, aggregate_id, dedupe_key, payload, occurred_at)
  VALUES (emitted_type, TG_TABLE_NAME, emitted_id, emitted_dedupe, emitted_payload, emitted_time)
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS item_domain_outbox ON item;
CREATE TRIGGER item_domain_outbox AFTER INSERT OR UPDATE OF title, summary, country_iso2, event_time, payload
  ON item FOR EACH ROW EXECUTE FUNCTION enqueue_claritas_domain_event();
DROP TRIGGER IF EXISTS global_event_domain_outbox ON global_event;
CREATE TRIGGER global_event_domain_outbox AFTER INSERT OR UPDATE
  ON global_event FOR EACH ROW EXECUTE FUNCTION enqueue_claritas_domain_event();
DROP TRIGGER IF EXISTS weather_alert_domain_outbox ON weather_alert;
CREATE TRIGGER weather_alert_domain_outbox AFTER INSERT OR UPDATE
  ON weather_alert FOR EACH ROW EXECUTE FUNCTION enqueue_claritas_domain_event();
DROP TRIGGER IF EXISTS transport_movement_domain_outbox ON transport_movement_event;
CREATE TRIGGER transport_movement_domain_outbox AFTER INSERT
  ON transport_movement_event FOR EACH ROW EXECUTE FUNCTION enqueue_claritas_domain_event();
DROP TRIGGER IF EXISTS market_indicator_domain_outbox ON market_indicator;
CREATE TRIGGER market_indicator_domain_outbox AFTER INSERT OR UPDATE
  ON market_indicator FOR EACH ROW EXECUTE FUNCTION enqueue_claritas_domain_event();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_intelligence_location') THEN
    CREATE TRIGGER set_updated_at_intelligence_location BEFORE UPDATE ON intelligence_location
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_physical_asset') THEN
    CREATE TRIGGER set_updated_at_physical_asset BEFORE UPDATE ON physical_asset
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_intelligence_event') THEN
    CREATE TRIGGER set_updated_at_intelligence_event BEFORE UPDATE ON intelligence_event
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_event_outbox') THEN
    CREATE TRIGGER set_updated_at_event_outbox BEFORE UPDATE ON event_outbox
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_alert_candidate') THEN
    CREATE TRIGGER set_updated_at_alert_candidate BEFORE UPDATE ON alert_candidate
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_intelligence_watchlist') THEN
    CREATE TRIGGER set_updated_at_intelligence_watchlist BEFORE UPDATE ON user_intelligence_watchlist
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_alert_recipient') THEN
    CREATE TRIGGER set_updated_at_alert_recipient BEFORE UPDATE ON alert_candidate_recipient
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Curated strategic catalogue. Coordinates are general-purpose public facts;
-- provenance is recorded per row and can be replaced by an administrator.
INSERT INTO country (iso2, iso3, name, region, ext)
VALUES ('PA', 'PAN', 'Panama', 'Americas', '{"seed_reason":"strategic_location_catalogue"}'::jsonb)
ON CONFLICT (iso2) DO NOTHING;

INSERT INTO intelligence_location (
  slug, location_type, canonical_name, country_iso2, latitude, longitude, bbox,
  geometry, center, importance_score, monitoring_tier, source_url, license, attribution, metadata
)
VALUES
  ('strait-of-hormuz','strait','Strait of Hormuz',NULL,26.56,56.25,ARRAY[55.5,25.7,57.2,27.3],ST_MakeEnvelope(55.5,25.7,57.2,27.3,4326),ST_SetSRID(ST_MakePoint(56.25,26.56),4326)::geography,1,1,'https://www.naturalearthdata.com/','Public domain','Natural Earth / Claritas curated catalogue','{"category":"maritime_chokepoint"}'),
  ('bab-el-mandeb','strait','Bab el-Mandeb',NULL,12.58,43.33,ARRAY[42.8,12.0,44.0,13.2],ST_MakeEnvelope(42.8,12.0,44.0,13.2,4326),ST_SetSRID(ST_MakePoint(43.33,12.58),4326)::geography,1,1,'https://www.naturalearthdata.com/','Public domain','Natural Earth / Claritas curated catalogue','{"category":"maritime_chokepoint"}'),
  ('suez-canal','canal','Suez Canal','EG',30.59,32.33,ARRAY[32.1,29.8,32.7,31.4],ST_MakeEnvelope(32.1,29.8,32.7,31.4,4326),ST_SetSRID(ST_MakePoint(32.33,30.59),4326)::geography,1,1,'https://www.naturalearthdata.com/','Public domain','Natural Earth / Claritas curated catalogue','{"category":"maritime_chokepoint"}'),
  ('panama-canal','canal','Panama Canal','PA',9.08,-79.68,ARRAY[-79.95,8.75,-79.45,9.45],ST_MakeEnvelope(-79.95,8.75,-79.45,9.45,4326),ST_SetSRID(ST_MakePoint(-79.68,9.08),4326)::geography,1,1,'https://www.naturalearthdata.com/','Public domain','Natural Earth / Claritas curated catalogue','{"category":"maritime_chokepoint"}'),
  ('strait-of-malacca','strait','Strait of Malacca',NULL,3.15,100.55,ARRAY[98.3,0.8,103.8,6.5],ST_MakeEnvelope(98.3,0.8,103.8,6.5,4326),ST_SetSRID(ST_MakePoint(100.55,3.15),4326)::geography,1,1,'https://www.naturalearthdata.com/','Public domain','Natural Earth / Claritas curated catalogue','{"category":"maritime_chokepoint"}'),
  ('singapore-strait','strait','Singapore Strait','SG',1.20,103.75,ARRAY[103.4,1.0,104.2,1.4],ST_MakeEnvelope(103.4,1.0,104.2,1.4,4326),ST_SetSRID(ST_MakePoint(103.75,1.20),4326)::geography,1,1,'https://www.naturalearthdata.com/','Public domain','Natural Earth / Claritas curated catalogue','{"category":"maritime_chokepoint"}'),
  ('bosporus','strait','Bosporus','TR',41.12,29.08,ARRAY[28.8,40.95,29.3,41.35],ST_MakeEnvelope(28.8,40.95,29.3,41.35,4326),ST_SetSRID(ST_MakePoint(29.08,41.12),4326)::geography,0.95,1,'https://www.naturalearthdata.com/','Public domain','Natural Earth / Claritas curated catalogue','{"category":"maritime_chokepoint"}'),
  ('dardanelles','strait','Dardanelles','TR',40.20,26.45,ARRAY[26.0,39.9,26.8,40.55],ST_MakeEnvelope(26.0,39.9,26.8,40.55,4326),ST_SetSRID(ST_MakePoint(26.45,40.20),4326)::geography,0.9,1,'https://www.naturalearthdata.com/','Public domain','Natural Earth / Claritas curated catalogue','{"category":"maritime_chokepoint"}'),
  ('strait-of-gibraltar','strait','Strait of Gibraltar',NULL,35.98,-5.60,ARRAY[-6.2,35.7,-5.1,36.3],ST_MakeEnvelope(-6.2,35.7,-5.1,36.3,4326),ST_SetSRID(ST_MakePoint(-5.60,35.98),4326)::geography,0.95,1,'https://www.naturalearthdata.com/','Public domain','Natural Earth / Claritas curated catalogue','{"category":"maritime_chokepoint"}'),
  ('dover-strait','strait','English Channel / Dover Strait',NULL,51.02,1.45,ARRAY[0.7,50.7,2.1,51.5],ST_MakeEnvelope(0.7,50.7,2.1,51.5,4326),ST_SetSRID(ST_MakePoint(1.45,51.02),4326)::geography,0.95,1,'https://www.naturalearthdata.com/','Public domain','Natural Earth / Claritas curated catalogue','{"category":"maritime_chokepoint"}'),
  ('taiwan-strait','strait','Taiwan Strait',NULL,24.20,119.40,ARRAY[117.2,22.0,121.0,26.3],ST_MakeEnvelope(117.2,22.0,121.0,26.3,4326),ST_SetSRID(ST_MakePoint(119.40,24.20),4326)::geography,1,1,'https://www.naturalearthdata.com/','Public domain','Natural Earth / Claritas curated catalogue','{"category":"maritime_chokepoint"}'),
  ('port-singapore','port','Port of Singapore','SG',1.264,103.840,ARRAY[103.60,1.10,104.10,1.40],ST_MakeEnvelope(103.60,1.10,104.10,1.40,4326),ST_SetSRID(ST_MakePoint(103.840,1.264),4326)::geography,1,1,'https://www.wikidata.org/','CC0','Wikidata / Claritas curated catalogue','{"unlocode":"SGSIN"}'),
  ('port-rotterdam','port','Port of Rotterdam','NL',51.95,4.14,ARRAY[3.80,51.80,4.55,52.10],ST_MakeEnvelope(3.80,51.80,4.55,52.10,4326),ST_SetSRID(ST_MakePoint(4.14,51.95),4326)::geography,0.95,1,'https://www.wikidata.org/','CC0','Wikidata / Claritas curated catalogue','{"unlocode":"NLRTM"}'),
  ('port-shanghai','port','Port of Shanghai','CN',31.23,121.50,ARRAY[121.2,30.7,122.2,31.6],ST_MakeEnvelope(121.2,30.7,122.2,31.6,4326),ST_SetSRID(ST_MakePoint(121.50,31.23),4326)::geography,1,1,'https://www.wikidata.org/','CC0','Wikidata / Claritas curated catalogue','{"unlocode":"CNSHA"}'),
  ('port-los-angeles','port','Port of Los Angeles','US',33.74,-118.27,ARRAY[-118.35,33.68,-118.18,33.82],ST_MakeEnvelope(-118.35,33.68,-118.18,33.82,4326),ST_SetSRID(ST_MakePoint(-118.27,33.74),4326)::geography,0.9,1,'https://www.wikidata.org/','CC0','Wikidata / Claritas curated catalogue','{"unlocode":"USLAX"}'),
  ('port-jebel-ali','port','Port of Jebel Ali','AE',25.01,55.06,ARRAY[54.90,24.90,55.20,25.15],ST_MakeEnvelope(54.90,24.90,55.20,25.15,4326),ST_SetSRID(ST_MakePoint(55.06,25.01),4326)::geography,0.95,1,'https://www.wikidata.org/','CC0','Wikidata / Claritas curated catalogue','{"unlocode":"AEJEA"}'),
  ('port-fujairah','port','Port of Fujairah','AE',25.17,56.36,ARRAY[56.20,25.05,56.48,25.30],ST_MakeEnvelope(56.20,25.05,56.48,25.30,4326),ST_SetSRID(ST_MakePoint(56.36,25.17),4326)::geography,0.95,1,'https://www.wikidata.org/','CC0','Wikidata / Claritas curated catalogue','{"unlocode":"AEFJR"}'),
  ('airport-heathrow','airport','London Heathrow Airport','GB',51.470,-0.454,ARRAY[-0.55,51.42,-0.38,51.52],ST_MakeEnvelope(-0.55,51.42,-0.38,51.52,4326),ST_SetSRID(ST_MakePoint(-0.454,51.470),4326)::geography,0.85,2,'https://ourairports.com/data/','Public domain','OurAirports','{"iata":"LHR","icao":"EGLL"}'),
  ('airport-dubai','airport','Dubai International Airport','AE',25.253,55.365,ARRAY[55.30,25.20,55.44,25.31],ST_MakeEnvelope(55.30,25.20,55.44,25.31,4326),ST_SetSRID(ST_MakePoint(55.365,25.253),4326)::geography,0.9,1,'https://ourairports.com/data/','Public domain','OurAirports','{"iata":"DXB","icao":"OMDB"}'),
  ('airport-singapore-changi','airport','Singapore Changi Airport','SG',1.364,103.991,ARRAY[103.94,1.32,104.04,1.41],ST_MakeEnvelope(103.94,1.32,104.04,1.41,4326),ST_SetSRID(ST_MakePoint(103.991,1.364),4326)::geography,0.9,1,'https://ourairports.com/data/','Public domain','OurAirports','{"iata":"SIN","icao":"WSSS"}'),
  ('airport-hartsfield-jackson','airport','Hartsfield-Jackson Atlanta International Airport','US',33.640,-84.427,ARRAY[-84.49,33.60,-84.37,33.69],ST_MakeEnvelope(-84.49,33.60,-84.37,33.69,4326),ST_SetSRID(ST_MakePoint(-84.427,33.640),4326)::geography,0.85,2,'https://ourairports.com/data/','Public domain','OurAirports','{"iata":"ATL","icao":"KATL"}'),
  ('persian-gulf-energy-export-region','area','Persian Gulf energy export region',NULL,26.0,52.0,ARRAY[47.0,23.0,57.5,30.5],ST_MakeEnvelope(47.0,23.0,57.5,30.5,4326),ST_SetSRID(ST_MakePoint(52.0,26.0),4326)::geography,1,1,'https://www.eia.gov/international/','U.S. government public domain','U.S. Energy Information Administration','{"category":"energy_region"}'),
  ('brazil-coffee-belt','agricultural_region','Brazil coffee belt','BR',-20.0,-47.0,ARRAY[-52.0,-24.5,-41.0,-16.0],ST_MakeEnvelope(-52.0,-24.5,-41.0,-16.0,4326),ST_SetSRID(ST_MakePoint(-47.0,-20.0),4326)::geography,0.75,2,'https://www.fao.org/faostat/','CC BY 4.0','FAO / Claritas generalized production region','{"commodity":"coffee","geometry_quality":"generalized"}'),
  ('west-africa-cocoa-belt','agricultural_region','West Africa cocoa belt',NULL,7.0,-3.0,ARRAY[-8.5,3.5,2.5,10.5],ST_MakeEnvelope(-8.5,3.5,2.5,10.5,4326),ST_SetSRID(ST_MakePoint(-3.0,7.0),4326)::geography,0.8,2,'https://www.fao.org/faostat/','CC BY 4.0','FAO / Claritas generalized production region','{"commodity":"cocoa","geometry_quality":"generalized"}'),
  ('black-sea-grain-export-region','agricultural_region','Black Sea grain export region',NULL,46.0,34.0,ARRAY[27.0,41.0,42.0,51.0],ST_MakeEnvelope(27.0,41.0,42.0,51.0,4326),ST_SetSRID(ST_MakePoint(34.0,46.0),4326)::geography,0.9,1,'https://www.fao.org/faostat/','CC BY 4.0','FAO / Claritas generalized production region','{"commodity":"wheat","geometry_quality":"generalized"}')
ON CONFLICT (slug) DO UPDATE SET
  canonical_name = EXCLUDED.canonical_name,
  bbox = EXCLUDED.bbox,
  geometry = EXCLUDED.geometry,
  center = EXCLUDED.center,
  importance_score = EXCLUDED.importance_score,
  monitoring_tier = EXCLUDED.monitoring_tier,
  source_url = EXCLUDED.source_url,
  license = EXCLUDED.license,
  attribution = EXCLUDED.attribution,
  metadata = intelligence_location.metadata || EXCLUDED.metadata,
  updated_at = now();

INSERT INTO intelligence_location_alias (location_id, alias, normalized_alias, alias_type)
SELECT location.id, aliases.alias, lower(regexp_replace(aliases.alias, '[^[:alnum:]]+', ' ', 'g')), aliases.alias_type
FROM intelligence_location location
JOIN (VALUES
  ('strait-of-hormuz','Hormuz','common'),('strait-of-hormuz','Hormuz Strait','common'),
  ('bab-el-mandeb','Bab al-Mandab','translated'),('bab-el-mandeb','Bab el Mandeb','common'),
  ('suez-canal','Suez','common'),('panama-canal','Panama Canal','common'),
  ('strait-of-malacca','Malacca Strait','common'),('singapore-strait','Singapore Strait','common'),
  ('bosporus','Bosphorus','translated'),('dardanelles','Dardanelles Strait','common'),
  ('strait-of-gibraltar','Gibraltar Strait','common'),('dover-strait','Dover Strait','common'),
  ('taiwan-strait','Taiwan Strait','common'),('port-singapore','Singapore Port','common'),
  ('port-rotterdam','Rotterdam Port','common'),('port-shanghai','Shanghai Port','common'),
  ('port-los-angeles','Los Angeles Port','common'),('port-jebel-ali','Jebel Ali','common'),
  ('port-fujairah','Fujairah Port','common'),('airport-heathrow','Heathrow','common'),
  ('airport-dubai','DXB','abbreviation'),('airport-singapore-changi','Changi','common'),
  ('airport-hartsfield-jackson','ATL','abbreviation')
) AS aliases(slug, alias, alias_type) ON aliases.slug = location.slug
ON CONFLICT (location_id, normalized_alias) DO NOTHING;

INSERT INTO intelligence_location_alias (location_id, alias, normalized_alias, alias_type)
SELECT id, canonical_name, lower(regexp_replace(canonical_name, '[^[:alnum:]]+', ' ', 'g')), 'common'
FROM intelligence_location
ON CONFLICT (location_id, normalized_alias) DO NOTHING;

INSERT INTO intelligence_location_identifier (location_id, identifier_scheme, identifier_value, source_url)
SELECT id, 'UNLOCODE', metadata->>'unlocode', source_url FROM intelligence_location WHERE metadata ? 'unlocode'
ON CONFLICT (identifier_scheme, identifier_value) DO NOTHING;
INSERT INTO intelligence_location_identifier (location_id, identifier_scheme, identifier_value, source_url)
SELECT id, 'IATA', metadata->>'iata', source_url FROM intelligence_location WHERE metadata ? 'iata'
ON CONFLICT (identifier_scheme, identifier_value) DO NOTHING;
INSERT INTO intelligence_location_identifier (location_id, identifier_scheme, identifier_value, source_url)
SELECT id, 'ICAO', metadata->>'icao', source_url FROM intelligence_location WHERE metadata ? 'icao'
ON CONFLICT (identifier_scheme, identifier_value) DO NOTHING;

INSERT INTO physical_asset (location_id, asset_type, canonical_name, source_url, license, attribution, metadata)
SELECT id,
       CASE WHEN location_type = 'port' THEN 'port'
            WHEN location_type = 'airport' THEN 'airport'
            WHEN location_type IN ('strait','canal','chokepoint') THEN 'shipping_chokepoint'
            ELSE location_type END,
       canonical_name, source_url, license, attribution, metadata
FROM intelligence_location
WHERE location_type IN ('port','airport','strait','canal','chokepoint')
ON CONFLICT (location_id, asset_type, canonical_name) DO UPDATE SET
  source_url = EXCLUDED.source_url, license = EXCLUDED.license,
  attribution = EXCLUDED.attribution, metadata = physical_asset.metadata || EXCLUDED.metadata;

-- Declarative, provenance-bearing defaults for physical commodity exposure.
-- The trigger also covers instruments first observed after this migration.
CREATE OR REPLACE FUNCTION link_default_market_location_exposure()
RETURNS TRIGGER AS $$
DECLARE
  searchable TEXT := lower(COALESCE(NEW.canonical_symbol,'') || ' ' || COALESCE(NEW.name,'') || ' ' || COALESCE(NEW.provider_symbol,''));
BEGIN
  INSERT INTO market_location_exposure (
    instrument_id,location_id,relationship,confidence,source_url,attribution,metadata
  )
  SELECT NEW.id,location.id,
         CASE WHEN location.slug='strait-of-hormuz' THEN 'transport_corridor'
              ELSE 'production_region' END,
         CASE WHEN location.slug='strait-of-hormuz' THEN 0.75 ELSE 0.7 END,
         location.source_url,location.attribution,
         jsonb_build_object('rule','governed commodity/location keyword v1','generalized',true)
  FROM intelligence_location location
  WHERE (location.slug='brazil-coffee-belt' AND searchable ~ '(coffee)')
     OR (location.slug='west-africa-cocoa-belt' AND searchable ~ '(cocoa)')
     OR (location.slug='black-sea-grain-export-region' AND searchable ~ '(wheat|grain|corn|maize)')
     OR (location.slug='persian-gulf-energy-export-region' AND searchable ~ '(oil|crude|brent|wti|natural gas|lng)')
     OR (location.slug='strait-of-hormuz' AND searchable ~ '(oil|crude|brent|wti|lng)')
  ON CONFLICT (instrument_id,location_id,relationship) DO UPDATE SET
    confidence=EXCLUDED.confidence,source_url=EXCLUDED.source_url,
    attribution=EXCLUDED.attribution,metadata=market_location_exposure.metadata||EXCLUDED.metadata;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS market_instrument_default_location_exposure ON market_instrument;
CREATE TRIGGER market_instrument_default_location_exposure
AFTER INSERT OR UPDATE OF canonical_symbol,name,provider_symbol ON market_instrument
FOR EACH ROW EXECUTE FUNCTION link_default_market_location_exposure();

INSERT INTO market_location_exposure (
  instrument_id,location_id,relationship,confidence,source_url,attribution,metadata
)
SELECT instrument.id,location.id,
       CASE WHEN location.slug='strait-of-hormuz' THEN 'transport_corridor'
            ELSE 'production_region' END,
       CASE WHEN location.slug='strait-of-hormuz' THEN 0.75 ELSE 0.7 END,
       location.source_url,location.attribution,
       '{"rule":"governed commodity/location keyword v1","generalized":true}'::jsonb
FROM market_instrument instrument
CROSS JOIN intelligence_location location
CROSS JOIN LATERAL (
  SELECT lower(COALESCE(instrument.canonical_symbol,'') || ' ' || COALESCE(instrument.name,'') || ' ' || COALESCE(instrument.provider_symbol,'')) AS text
) searchable
WHERE (location.slug='brazil-coffee-belt' AND searchable.text ~ '(coffee)')
   OR (location.slug='west-africa-cocoa-belt' AND searchable.text ~ '(cocoa)')
   OR (location.slug='black-sea-grain-export-region' AND searchable.text ~ '(wheat|grain|corn|maize)')
   OR (location.slug='persian-gulf-energy-export-region' AND searchable.text ~ '(oil|crude|brent|wti|natural gas|lng)')
   OR (location.slug='strait-of-hormuz' AND searchable.text ~ '(oil|crude|brent|wti|lng)')
ON CONFLICT (instrument_id,location_id,relationship) DO UPDATE SET
  confidence=EXCLUDED.confidence,source_url=EXCLUDED.source_url,
  attribution=EXCLUDED.attribution,metadata=market_location_exposure.metadata||EXCLUDED.metadata;

INSERT INTO source (name, api_base_url, auth_type, metadata)
VALUES
  ('copernicus-cdse','https://sh.dataspace.copernicus.eu','oauth2_client_credentials','{"domain":"earth_observation","license":"Copernicus data terms","attribution":"Contains modified Copernicus Sentinel data"}'),
  ('nasa-firms','https://firms.modaps.eosdis.nasa.gov','map_key','{"domain":"earth_observation","dataset":"VIIRS active fire","attribution":"NASA FIRMS"}'),
  ('nasa-gibs','https://gibs.earthdata.nasa.gov','none','{"domain":"earth_observation","service":"WMTS","attribution":"NASA EOSDIS GIBS"}'),
  ('usgs-earthquakes','https://earthquake.usgs.gov','none','{"domain":"disaster","license":"U.S. government public domain","attribution":"U.S. Geological Survey"}')
ON CONFLICT (name) DO UPDATE SET
  api_base_url = EXCLUDED.api_base_url,
  auth_type = EXCLUDED.auth_type,
  metadata = source.metadata || EXCLUDED.metadata;

INSERT INTO provider_runtime_state (provider, enabled, metadata)
VALUES
  ('copernicus', false, '{"feature_flag":"COPERNICUS_ENABLED"}'),
  ('nasa_firms', false, '{"feature_flag":"NASA_FIRMS_ENABLED"}'),
  ('nasa_gibs', false, '{"feature_flag":"NASA_GIBS_ENABLED"}'),
  ('usgs_earthquakes', false, '{"feature_flag":"USGS_EARTHQUAKES_ENABLED"}'),
  ('event_correlation', true, '{"feature_flag":"EVENT_CORRELATION_ENABLED"}')
ON CONFLICT (provider) DO NOTHING;

-- Restartable country-location backfill preserves the current country model
-- while giving all existing country-linked evidence a normalized spatial key.
INSERT INTO intelligence_location (
  slug, location_type, canonical_name, country_iso2, importance_score,
  monitoring_tier, source_url, license, attribution, metadata
)
SELECT 'country-' || lower(iso2::text), 'country', name, iso2, 0.5, 3,
       'https://www.iso.org/iso-3166-country-codes.html',
       'ISO reference data; verify redistribution terms', 'ISO 3166 country code',
       jsonb_build_object('iso3', iso3, 'region', region, 'backfilled', true)
FROM country
ON CONFLICT (slug) DO UPDATE SET canonical_name = EXCLUDED.canonical_name,
  country_iso2 = EXCLUDED.country_iso2,
  metadata = intelligence_location.metadata || EXCLUDED.metadata,
  updated_at = now();

INSERT INTO intelligence_location_alias (location_id, alias, normalized_alias, alias_type)
SELECT location.id, candidate.alias,
       lower(regexp_replace(candidate.alias, '[^[:alnum:]]+', ' ', 'g')),
       candidate.alias_type
FROM intelligence_location location
JOIN country ON country.iso2 = location.country_iso2
CROSS JOIN LATERAL (VALUES
  (country.name, 'common'),
  (country.iso2::text, 'abbreviation'),
  (country.iso3::text, 'abbreviation')
) candidate(alias, alias_type)
WHERE location.location_type = 'country' AND candidate.alias IS NOT NULL
ON CONFLICT (location_id, normalized_alias) DO NOTHING;

INSERT INTO intelligence_location_identifier (location_id, identifier_scheme, identifier_value, source_url)
SELECT location.id, 'ISO3166-1-alpha2', country.iso2::text, location.source_url
FROM intelligence_location location
JOIN country ON country.iso2 = location.country_iso2
WHERE location.location_type = 'country'
ON CONFLICT (identifier_scheme, identifier_value) DO NOTHING;

ANALYZE intelligence_location;
ANALYZE intelligence_event;
ANALYZE event_outbox;

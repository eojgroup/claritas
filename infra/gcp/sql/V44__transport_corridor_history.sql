-- V44: retain bounded, auditable corridor samples for longer-range trends.
--
-- The source stream can contain many observations per vehicle per hour. Do not
-- retain that cardinality for 90-day analysis. This table stores at most one
-- aggregate per day/mode/country pair; the ingestion leader additionally caps
-- newly admitted pairs per day/mode before inserting them.
CREATE TABLE IF NOT EXISTS transport_country_activity_day (
  bucket                    DATE NOT NULL,
  mode                      TEXT NOT NULL,
  country_iso2              CHAR(2) NOT NULL,
  peak_active_entities      INTEGER NOT NULL DEFAULT 0,
  observed_hour_mask        BIGINT NOT NULL DEFAULT 0,
  observation_batches       INTEGER NOT NULL DEFAULT 0,
  first_observed_at         TIMESTAMPTZ NOT NULL,
  last_observed_at          TIMESTAMPTZ NOT NULL,
  source_names              TEXT[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (bucket, mode, country_iso2),
  CHECK (mode IN ('maritime', 'aviation')),
  CHECK (country_iso2 ~ '^[A-Z]{2}$'),
  CHECK (peak_active_entities >= 0),
  CHECK (observed_hour_mask >= 0),
  CHECK (observation_batches >= 0)
);

CREATE INDEX IF NOT EXISTS transport_country_activity_country_time_idx
  ON transport_country_activity_day (country_iso2, bucket DESC, mode);

CREATE TABLE IF NOT EXISTS transport_corridor_activity_day (
  bucket                       DATE NOT NULL,
  mode                         TEXT NOT NULL,
  origin_country_iso2          CHAR(2) NOT NULL,
  destination_country_iso2     CHAR(2) NOT NULL,
  peak_active_entities         INTEGER NOT NULL DEFAULT 0,
  peak_observed_origins        INTEGER NOT NULL DEFAULT 0,
  peak_flag_proxy_origins      INTEGER NOT NULL DEFAULT 0,
  observed_hour_mask           BIGINT NOT NULL DEFAULT 0,
  observation_batches          INTEGER NOT NULL DEFAULT 0,
  first_observed_at            TIMESTAMPTZ NOT NULL,
  last_observed_at             TIMESTAMPTZ NOT NULL,
  source_names                 TEXT[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (bucket, mode, origin_country_iso2, destination_country_iso2),
  CHECK (mode IN ('maritime', 'aviation')),
  CHECK (origin_country_iso2 ~ '^[A-Z]{2}$'),
  CHECK (destination_country_iso2 ~ '^[A-Z]{2}$'),
  CHECK (origin_country_iso2 <> destination_country_iso2),
  CHECK (peak_active_entities >= 0),
  CHECK (peak_observed_origins >= 0),
  CHECK (peak_flag_proxy_origins >= 0),
  CHECK (observed_hour_mask >= 0),
  CHECK (observation_batches >= 0)
);

-- The table is new and empty, so these ordinary index builds remain small and
-- transactional. V44 deliberately does not scan or index existing live data.
CREATE INDEX IF NOT EXISTS transport_corridor_activity_pair_time_idx
  ON transport_corridor_activity_day (
    origin_country_iso2,
    destination_country_iso2,
    bucket DESC,
    mode
  );

CREATE INDEX IF NOT EXISTS transport_corridor_activity_destination_time_idx
  ON transport_corridor_activity_day (
    destination_country_iso2,
    bucket DESC,
    mode,
    origin_country_iso2
  );

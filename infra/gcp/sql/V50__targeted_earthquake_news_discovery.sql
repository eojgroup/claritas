-- A bounded acquisition queue lets a significant physical event request its
-- own publisher search instead of hoping to appear in a 25-row global news
-- sample. Results still pass the connector's publisher-date and URL checks;
-- the queue records acquisition state only and does not assert correlation.
CREATE TABLE IF NOT EXISTS earthquake_news_discovery (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  earthquake_observation_id UUID NOT NULL UNIQUE
    REFERENCES earthquake_observation(id) ON DELETE CASCADE,
  status                     TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','retry','completed','dead_letter')),
  attempts                   INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts               INTEGER NOT NULL DEFAULT 6 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_until                TIMESTAMPTZ,
  payload                    JSONB NOT NULL,
  last_result                JSONB,
  last_error                 TEXT,
  completed_at               TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS earthquake_news_discovery_dispatch_idx
  ON earthquake_news_discovery (available_at, created_at)
  WHERE status IN ('pending','processing','retry');
CREATE INDEX IF NOT EXISTS earthquake_news_discovery_terminal_idx
  ON earthquake_news_discovery (completed_at)
  WHERE status IN ('completed','dead_letter');

-- Recover recent events that arrived before this queue existed. The hard cap
-- prevents a deployment from producing an unbounded provider burst.
INSERT INTO earthquake_news_discovery (
  earthquake_observation_id,status,attempts,max_attempts,available_at,payload
)
SELECT
  observation.id,
  'pending',
  0,
  6,
  now(),
  jsonb_build_object(
    'usgs_event_id', observation.usgs_event_id,
    'place', observation.place,
    'country_iso2', NULL,
    'magnitude', observation.magnitude,
    'significance', observation.significance,
    'tsunami', observation.tsunami,
    'latitude', observation.latitude,
    'longitude', observation.longitude,
    'observed_at', observation.observed_at,
    'source_updated_at', observation.updated_at_source
  )
FROM earthquake_observation observation
WHERE observation.observed_at >= now()-interval '7 days'
  AND (
    observation.magnitude >= 5.5
    OR observation.significance >= 600
    OR observation.tsunami
  )
ORDER BY observation.observed_at DESC
LIMIT 100
ON CONFLICT (earthquake_observation_id) DO NOTHING;

ANALYZE earthquake_news_discovery;

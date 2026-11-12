CREATE TABLE intelligence_feed_snapshot (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK(singleton),
  schema_version INTEGER NOT NULL CHECK(schema_version=1),
  generated_at TIMESTAMPTZ NOT NULL,
  events JSONB NOT NULL CHECK(jsonb_typeof(events)='array')
);
COMMENT ON TABLE intelligence_feed_snapshot IS
  'Exact global priority feed prepared by the worker; readers recheck current event visibility for only the saved page.';

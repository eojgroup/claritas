-- Search every saved investigation in the selected period, not only visible cards.
CREATE INDEX CONCURRENTLY IF NOT EXISTS intelligence_overview_search_idx
  ON intelligence_overview_projection USING gin
  (to_tsvector('simple',COALESCE(event->>'title','')||' '||COALESCE(event->>'summary','')||' '||COALESCE(event->>'location_name','')));
ANALYZE intelligence_overview_projection;

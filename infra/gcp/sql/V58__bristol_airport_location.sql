-- OurAirports EGGD facility data, verified 2026-09-21; public domain.
INSERT INTO intelligence_location (slug,location_type,canonical_name,country_iso2,latitude,longitude,center,
 source_url,license,attribution,metadata)
VALUES ('airport-bristol','airport','Bristol Airport','GB',51.382326,-2.716453,
 ST_SetSRID(ST_MakePoint(-2.716453,51.382326),4326)::geography,
 'https://ourairports.com/airports/EGGD/','Public domain','OurAirports','{"iata":"BRS","icao":"EGGD"}')
ON CONFLICT (slug) DO NOTHING;
INSERT INTO intelligence_location_alias(location_id,alias,normalized_alias,alias_type)
SELECT id,'Bristol Airport','bristol airport','common' FROM intelligence_location WHERE slug='airport-bristol'
ON CONFLICT (location_id,normalized_alias) DO NOTHING;
INSERT INTO intelligence_location_identifier(location_id,identifier_scheme,identifier_value,source_url)
SELECT id,scheme,value,source_url FROM intelligence_location
CROSS JOIN (VALUES ('IATA','BRS'),('ICAO','EGGD')) identifiers(scheme,value)
WHERE slug='airport-bristol' ON CONFLICT (identifier_scheme,identifier_value) DO NOTHING;

-- Repair only the known source-only mislocation; never move a multi-source investigation.
WITH corrected AS (
 UPDATE intelligence_event e SET primary_country_iso2='GB',primary_location_id=l.id,
   geography=l.center::geometry,event_type='aviation_disruption',updated_at=now(),
   metadata=e.metadata || jsonb_build_object('geography_repair','bristol-airport-whole-word-v1','previous_country',e.primary_country_iso2)
 FROM intelligence_location l
 WHERE l.slug='airport-bristol' AND e.primary_country_iso2='CA'
   AND e.title='Bristol Airport flights cancelled or delayed - updates'
   AND (SELECT count(*) FROM intelligence_event_evidence v WHERE v.event_id=e.id)=1
 RETURNING e.id,e.primary_location_id
), repaired_evidence AS (
 UPDATE intelligence_event_evidence v SET location_id=c.primary_location_id
 FROM corrected c WHERE v.event_id=c.id RETURNING v.event_id
)
UPDATE intelligence_event_location el SET location_id=c.primary_location_id,
 metadata=el.metadata || '{"geography_repair":"bristol-airport-whole-word-v1"}'::jsonb
FROM corrected c WHERE el.event_id=c.id AND el.relationship='primary';

UPDATE item SET country_iso2='GB',payload=payload ||
 '{"country_attribution":"content_alias","country_inference":{"source":"content_alias","confidence":"high","matched_alias":"Bristol Airport"}}'::jsonb,
 updated_at=now()
WHERE kind='news_article' AND country_iso2 IS NULL
 AND title='Bristol Airport flights cancelled or delayed - updates';

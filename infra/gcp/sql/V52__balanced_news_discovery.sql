-- V52: make the governed news poll reliably current and remove subject-country
-- values that were populated only from a publisher jurisdiction. Runtime DOC
-- discovery now uses category-balanced lanes while retaining the same bounded
-- 25-headline-per-poll storage ceiling.

-- Runtime country attribution uses the complete ISO catalogue. Older
-- databases only seeded countries encountered by a few early connectors,
-- which made otherwise structured GOV.UK world locations impossible to
-- backfill. Complete the catalogue before repairing historical news.
INSERT INTO country (iso2, iso3, name, region)
VALUES
  ('AD','AND','Andorra','Europe'),
  ('AE','ARE','United Arab Emirates','Asia'),
  ('AF','AFG','Afghanistan','Asia'),
  ('AG','ATG','Antigua and Barbuda','Americas'),
  ('AI','AIA','Anguilla','Americas'),
  ('AL','ALB','Albania','Europe'),
  ('AM','ARM','Armenia','Asia'),
  ('AO','AGO','Angola','Africa'),
  ('AQ','ATA','Antarctica','Antarctic'),
  ('AR','ARG','Argentina','Americas'),
  ('AS','ASM','American Samoa','Oceania'),
  ('AT','AUT','Austria','Europe'),
  ('AU','AUS','Australia','Oceania'),
  ('AW','ABW','Aruba','Americas'),
  ('AX','ALA','Åland Islands','Europe'),
  ('AZ','AZE','Azerbaijan','Asia'),
  ('BA','BIH','Bosnia and Herzegovina','Europe'),
  ('BB','BRB','Barbados','Americas'),
  ('BD','BGD','Bangladesh','Asia'),
  ('BE','BEL','Belgium','Europe'),
  ('BF','BFA','Burkina Faso','Africa'),
  ('BG','BGR','Bulgaria','Europe'),
  ('BH','BHR','Bahrain','Asia'),
  ('BI','BDI','Burundi','Africa'),
  ('BJ','BEN','Benin','Africa'),
  ('BL','BLM','Saint Barthélemy','Americas'),
  ('BM','BMU','Bermuda','Americas'),
  ('BN','BRN','Brunei','Asia'),
  ('BO','BOL','Bolivia','Americas'),
  ('BQ','BES','Caribbean Netherlands','Americas'),
  ('BR','BRA','Brazil','Americas'),
  ('BS','BHS','Bahamas','Americas'),
  ('BT','BTN','Bhutan','Asia'),
  ('BV','BVT','Bouvet Island','Antarctic'),
  ('BW','BWA','Botswana','Africa'),
  ('BY','BLR','Belarus','Europe'),
  ('BZ','BLZ','Belize','Americas'),
  ('CA','CAN','Canada','Americas'),
  ('CC','CCK','Cocos (Keeling) Islands','Oceania'),
  ('CD','COD','DR Congo','Africa'),
  ('CF','CAF','Central African Republic','Africa'),
  ('CG','COG','Republic of the Congo','Africa'),
  ('CH','CHE','Switzerland','Europe'),
  ('CI','CIV','Ivory Coast','Africa'),
  ('CK','COK','Cook Islands','Oceania'),
  ('CL','CHL','Chile','Americas'),
  ('CM','CMR','Cameroon','Africa'),
  ('CN','CHN','China','Asia'),
  ('CO','COL','Colombia','Americas'),
  ('CR','CRI','Costa Rica','Americas'),
  ('CU','CUB','Cuba','Americas'),
  ('CV','CPV','Cape Verde','Africa'),
  ('CW','CUW','Curaçao','Americas'),
  ('CX','CXR','Christmas Island','Oceania'),
  ('CY','CYP','Cyprus','Europe'),
  ('CZ','CZE','Czechia','Europe'),
  ('DE','DEU','Germany','Europe'),
  ('DJ','DJI','Djibouti','Africa'),
  ('DK','DNK','Denmark','Europe'),
  ('DM','DMA','Dominica','Americas'),
  ('DO','DOM','Dominican Republic','Americas'),
  ('DZ','DZA','Algeria','Africa'),
  ('EC','ECU','Ecuador','Americas'),
  ('EE','EST','Estonia','Europe'),
  ('EG','EGY','Egypt','Africa'),
  ('EH','ESH','Western Sahara','Africa'),
  ('ER','ERI','Eritrea','Africa'),
  ('ES','ESP','Spain','Europe'),
  ('ET','ETH','Ethiopia','Africa'),
  ('FI','FIN','Finland','Europe'),
  ('FJ','FJI','Fiji','Oceania'),
  ('FK','FLK','Falkland Islands','Americas'),
  ('FM','FSM','Micronesia','Oceania'),
  ('FO','FRO','Faroe Islands','Europe'),
  ('FR','FRA','France','Europe'),
  ('GA','GAB','Gabon','Africa'),
  ('GB','GBR','United Kingdom','Europe'),
  ('GD','GRD','Grenada','Americas'),
  ('GE','GEO','Georgia','Asia'),
  ('GF','GUF','French Guiana','Americas'),
  ('GG','GGY','Guernsey','Europe'),
  ('GH','GHA','Ghana','Africa'),
  ('GI','GIB','Gibraltar','Europe'),
  ('GL','GRL','Greenland','Americas'),
  ('GM','GMB','Gambia','Africa'),
  ('GN','GIN','Guinea','Africa'),
  ('GP','GLP','Guadeloupe','Americas'),
  ('GQ','GNQ','Equatorial Guinea','Africa'),
  ('GR','GRC','Greece','Europe'),
  ('GS','SGS','South Georgia','Antarctic'),
  ('GT','GTM','Guatemala','Americas'),
  ('GU','GUM','Guam','Oceania'),
  ('GW','GNB','Guinea-Bissau','Africa'),
  ('GY','GUY','Guyana','Americas'),
  ('HK','HKG','Hong Kong','Asia'),
  ('HM','HMD','Heard Island and McDonald Islands','Antarctic'),
  ('HN','HND','Honduras','Americas'),
  ('HR','HRV','Croatia','Europe'),
  ('HT','HTI','Haiti','Americas'),
  ('HU','HUN','Hungary','Europe'),
  ('ID','IDN','Indonesia','Asia'),
  ('IE','IRL','Ireland','Europe'),
  ('IL','ISR','Israel','Asia'),
  ('IM','IMN','Isle of Man','Europe'),
  ('IN','IND','India','Asia'),
  ('IO','IOT','British Indian Ocean Territory','Africa'),
  ('IQ','IRQ','Iraq','Asia'),
  ('IR','IRN','Iran','Asia'),
  ('IS','ISL','Iceland','Europe'),
  ('IT','ITA','Italy','Europe'),
  ('JE','JEY','Jersey','Europe'),
  ('JM','JAM','Jamaica','Americas'),
  ('JO','JOR','Jordan','Asia'),
  ('JP','JPN','Japan','Asia'),
  ('KE','KEN','Kenya','Africa'),
  ('KG','KGZ','Kyrgyzstan','Asia'),
  ('KH','KHM','Cambodia','Asia'),
  ('KI','KIR','Kiribati','Oceania'),
  ('KM','COM','Comoros','Africa'),
  ('KN','KNA','Saint Kitts and Nevis','Americas'),
  ('KP','PRK','North Korea','Asia'),
  ('KR','KOR','South Korea','Asia'),
  ('KW','KWT','Kuwait','Asia'),
  ('KY','CYM','Cayman Islands','Americas'),
  ('KZ','KAZ','Kazakhstan','Asia'),
  ('LA','LAO','Laos','Asia'),
  ('LB','LBN','Lebanon','Asia'),
  ('LC','LCA','Saint Lucia','Americas'),
  ('LI','LIE','Liechtenstein','Europe'),
  ('LK','LKA','Sri Lanka','Asia'),
  ('LR','LBR','Liberia','Africa'),
  ('LS','LSO','Lesotho','Africa'),
  ('LT','LTU','Lithuania','Europe'),
  ('LU','LUX','Luxembourg','Europe'),
  ('LV','LVA','Latvia','Europe'),
  ('LY','LBY','Libya','Africa'),
  ('MA','MAR','Morocco','Africa'),
  ('MC','MCO','Monaco','Europe'),
  ('MD','MDA','Moldova','Europe'),
  ('ME','MNE','Montenegro','Europe'),
  ('MF','MAF','Saint Martin','Americas'),
  ('MG','MDG','Madagascar','Africa'),
  ('MH','MHL','Marshall Islands','Oceania'),
  ('MK','MKD','North Macedonia','Europe'),
  ('ML','MLI','Mali','Africa'),
  ('MM','MMR','Myanmar','Asia'),
  ('MN','MNG','Mongolia','Asia'),
  ('MO','MAC','Macau','Asia'),
  ('MP','MNP','Northern Mariana Islands','Oceania'),
  ('MQ','MTQ','Martinique','Americas'),
  ('MR','MRT','Mauritania','Africa'),
  ('MS','MSR','Montserrat','Americas'),
  ('MT','MLT','Malta','Europe'),
  ('MU','MUS','Mauritius','Africa'),
  ('MV','MDV','Maldives','Asia'),
  ('MW','MWI','Malawi','Africa'),
  ('MX','MEX','Mexico','Americas'),
  ('MY','MYS','Malaysia','Asia'),
  ('MZ','MOZ','Mozambique','Africa'),
  ('NA','NAM','Namibia','Africa'),
  ('NC','NCL','New Caledonia','Oceania'),
  ('NE','NER','Niger','Africa'),
  ('NF','NFK','Norfolk Island','Oceania'),
  ('NG','NGA','Nigeria','Africa'),
  ('NI','NIC','Nicaragua','Americas'),
  ('NL','NLD','Netherlands','Europe'),
  ('NO','NOR','Norway','Europe'),
  ('NP','NPL','Nepal','Asia'),
  ('NR','NRU','Nauru','Oceania'),
  ('NU','NIU','Niue','Oceania'),
  ('NZ','NZL','New Zealand','Oceania'),
  ('OM','OMN','Oman','Asia'),
  ('PA','PAN','Panama','Americas'),
  ('PE','PER','Peru','Americas'),
  ('PF','PYF','French Polynesia','Oceania'),
  ('PG','PNG','Papua New Guinea','Oceania'),
  ('PH','PHL','Philippines','Asia'),
  ('PK','PAK','Pakistan','Asia'),
  ('PL','POL','Poland','Europe'),
  ('PM','SPM','Saint Pierre and Miquelon','Americas'),
  ('PN','PCN','Pitcairn Islands','Oceania'),
  ('PR','PRI','Puerto Rico','Americas'),
  ('PS','PSE','Palestine','Asia'),
  ('PT','PRT','Portugal','Europe'),
  ('PW','PLW','Palau','Oceania'),
  ('PY','PRY','Paraguay','Americas'),
  ('QA','QAT','Qatar','Asia'),
  ('RE','REU','Réunion','Africa'),
  ('RO','ROU','Romania','Europe'),
  ('RS','SRB','Serbia','Europe'),
  ('RU','RUS','Russia','Europe'),
  ('RW','RWA','Rwanda','Africa'),
  ('SA','SAU','Saudi Arabia','Asia'),
  ('SB','SLB','Solomon Islands','Oceania'),
  ('SC','SYC','Seychelles','Africa'),
  ('SD','SDN','Sudan','Africa'),
  ('SE','SWE','Sweden','Europe'),
  ('SG','SGP','Singapore','Asia'),
  ('SH','SHN','Saint Helena, Ascension and Tristan da Cunha','Africa'),
  ('SI','SVN','Slovenia','Europe'),
  ('SJ','SJM','Svalbard and Jan Mayen','Europe'),
  ('SK','SVK','Slovakia','Europe'),
  ('SL','SLE','Sierra Leone','Africa'),
  ('SM','SMR','San Marino','Europe'),
  ('SN','SEN','Senegal','Africa'),
  ('SO','SOM','Somalia','Africa'),
  ('SR','SUR','Suriname','Americas'),
  ('SS','SSD','South Sudan','Africa'),
  ('ST','STP','São Tomé and Príncipe','Africa'),
  ('SV','SLV','El Salvador','Americas'),
  ('SX','SXM','Sint Maarten','Americas'),
  ('SY','SYR','Syria','Asia'),
  ('SZ','SWZ','Eswatini','Africa'),
  ('TC','TCA','Turks and Caicos Islands','Americas'),
  ('TD','TCD','Chad','Africa'),
  ('TF','ATF','French Southern and Antarctic Lands','Antarctic'),
  ('TG','TGO','Togo','Africa'),
  ('TH','THA','Thailand','Asia'),
  ('TJ','TJK','Tajikistan','Asia'),
  ('TK','TKL','Tokelau','Oceania'),
  ('TL','TLS','Timor-Leste','Asia'),
  ('TM','TKM','Turkmenistan','Asia'),
  ('TN','TUN','Tunisia','Africa'),
  ('TO','TON','Tonga','Oceania'),
  ('TR','TUR','Türkiye','Asia'),
  ('TT','TTO','Trinidad and Tobago','Americas'),
  ('TV','TUV','Tuvalu','Oceania'),
  ('TW','TWN','Taiwan','Asia'),
  ('TZ','TZA','Tanzania','Africa'),
  ('UA','UKR','Ukraine','Europe'),
  ('UG','UGA','Uganda','Africa'),
  ('UM','UMI','United States Minor Outlying Islands','Americas'),
  ('US','USA','United States','Americas'),
  ('UY','URY','Uruguay','Americas'),
  ('UZ','UZB','Uzbekistan','Asia'),
  ('VA','VAT','Vatican City','Europe'),
  ('VC','VCT','Saint Vincent and the Grenadines','Americas'),
  ('VE','VEN','Venezuela','Americas'),
  ('VG','VGB','British Virgin Islands','Americas'),
  ('VI','VIR','United States Virgin Islands','Americas'),
  ('VN','VNM','Vietnam','Asia'),
  ('VU','VUT','Vanuatu','Oceania'),
  ('WF','WLF','Wallis and Futuna','Oceania'),
  ('WS','WSM','Samoa','Oceania'),
  ('XK','UNK','Kosovo','Europe'),
  ('YE','YEM','Yemen','Asia'),
  ('YT','MYT','Mayotte','Africa'),
  ('ZA','ZAF','South Africa','Africa'),
  ('ZM','ZMB','Zambia','Africa'),
  ('ZW','ZWE','Zimbabwe','Africa')
ON CONFLICT (iso2) DO UPDATE SET
  iso3 = COALESCE(country.iso3, EXCLUDED.iso3),
  name = CASE
    WHEN lower(BTRIM(country.name)) = lower(BTRIM(country.iso2::text))
      THEN EXCLUDED.name
    ELSE country.name
  END,
  region = COALESCE(country.region, EXCLUDED.region),
  ext = COALESCE(country.ext, '{}'::jsonb)
    || '{"catalogue_completed_by":"V52"}'::jsonb;

-- Backfill-only session flags let this migration repair derived metadata
-- without pretending every historical article was freshly updated or
-- flooding the event outbox ahead of genuinely current signals. They are
-- connection-local and disappear even if the Flyway process exits early.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  IF current_setting('claritas.preserve_updated_at', true) = 'on' THEN
    RETURN NEW;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enqueue_claritas_domain_event()
RETURNS TRIGGER AS $$
DECLARE
  emitted_type TEXT;
  emitted_id TEXT;
  emitted_time TIMESTAMPTZ;
  emitted_payload JSONB;
  emitted_dedupe TEXT;
BEGIN
  IF TG_TABLE_NAME = 'item'
     AND current_setting('claritas.suppress_item_outbox', true) = 'on' THEN
    RETURN NEW;
  END IF;
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

UPDATE ingestion_automation_rule
SET schedule_interval_minutes = CASE
      WHEN schedule_interval_minutes = 60 THEN 15
      ELSE schedule_interval_minutes
    END,
    min_spacing_minutes = CASE
      WHEN min_spacing_minutes = 15 THEN 10
      ELSE min_spacing_minutes
    END,
    freshness_sla_minutes = CASE
      WHEN freshness_sla_minutes = 90 THEN 30
      ELSE freshness_sla_minutes
    END,
    next_scheduled_at = CASE
      WHEN schedule_interval_minutes IN (15, 60) THEN LEAST(
        COALESCE(next_scheduled_at, now()),
        now() + interval '1 minute'
      )
      ELSE next_scheduled_at
    END,
    default_payload = jsonb_set(
      COALESCE(default_payload, '{}'::jsonb),
      '{gdelt}',
      '{"timespan":"1h","maxRecords":25,"maxRawRows":190}'::jsonb
        || COALESCE(default_payload->'gdelt', '{}'::jsonb)
        || CASE
             -- GDELT DOC currently rejects sub-hour windows. Repair the V48
             -- 30-minute default while preserving an operator's valid longer
             -- discovery window.
             WHEN lower(COALESCE(default_payload#>>'{gdelt,timespan}','30min'))
                    IN ('15min','30min','45min')
               THEN '{"timespan":"1h"}'::jsonb
             ELSE '{}'::jsonb
           END,
      true
    ),
    updated_at = now()
WHERE pipeline = 'news';

SELECT set_config('claritas.preserve_updated_at','on',false);
SELECT set_config('claritas.suppress_item_outbox','on',false);

-- Pre-V52 accepted GDELT items encode verified publisher time in `time_basis`.
-- Backfill the explicit flag before the new conflict merger starts so a
-- transient publisher fetch failure cannot demote that trusted timestamp.
UPDATE item news
SET payload = jsonb_set(news.payload, '{publication_time_verified}', 'true'::jsonb, true)
FROM source provider
WHERE provider.id = news.source_id
  AND lower(provider.name) = 'gdelt'
  AND news.kind = 'news_article'
  AND news.payload->>'time_basis' LIKE 'publisher_published%'
  AND NULLIF(news.payload->>'publisher_published_at','') IS NOT NULL
  AND COALESCE(news.payload->>'publication_time_verified', 'false') <> 'true';

-- Preserve every structured GOV.UK world location as subject geography. The
-- API resolves common, official and alternate country names; mirror the
-- important GOV.UK variants here so existing rows receive the same treatment
-- as newly ingested rows. This is deliberately an array: a cross-border
-- release belongs to every named country and must not be collapsed to the
-- publisher's GB jurisdiction.
WITH location_aliases AS (
  SELECT upper(BTRIM(country.iso2::text)) AS iso2,
         BTRIM(regexp_replace(lower(country.name), '[^[:alnum:]]+', ' ', 'g')) AS normalized_name
  FROM country
  UNION
  SELECT alias.iso2, alias.normalized_name
  FROM (VALUES
    ('US','united states of america'),
    ('GB','great britain'),
    ('GB','uk'),
    ('MM','burma'),
    ('PS','occupied palestinian territories'),
    ('PS','palestinian territories'),
    ('CD','democratic republic of the congo'),
    ('CD','dr congo'),
    ('CG','republic of the congo'),
    ('CI','cote d ivoire'),
    ('CI','côte d ivoire'),
    ('SZ','swaziland'),
    ('CZ','czech republic'),
    ('CV','cape verde'),
    ('TL','east timor'),
    ('VA','vatican city'),
    ('KR','republic of korea'),
    ('KP','democratic people s republic of korea'),
    ('RU','russian federation'),
    ('LA','laos'),
    ('MD','moldova'),
    ('SY','syria'),
    ('TZ','tanzania'),
    ('VE','venezuela'),
    ('BO','bolivia'),
    ('BN','brunei'),
    ('IR','iran'),
    ('VN','vietnam'),
    ('TR','turkey'),
    ('TR','türkiye')
  ) AS alias(iso2, normalized_name)
), structured AS (
  SELECT news.id,
         jsonb_agg(DISTINCT location_aliases.iso2
                   ORDER BY location_aliases.iso2) AS countries
  FROM item news
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(news.payload->'world_locations')='array'
      THEN news.payload->'world_locations' ELSE '[]'::jsonb END
  ) world_location
  JOIN location_aliases ON location_aliases.normalized_name=
    BTRIM(regexp_replace(lower(world_location->>'title'), '[^[:alnum:]]+', ' ', 'g'))
  WHERE news.kind='news_article'
    AND news.payload->>'provider'='govuk_search'
  GROUP BY news.id
)
UPDATE item news
SET payload = jsonb_set(
      news.payload,
      '{subject_country_iso2s}',
      structured.countries,
      true
    )
FROM structured
WHERE structured.id=news.id
  AND news.payload->'subject_country_iso2s' IS DISTINCT FROM structured.countries;

-- A reviewed central bank, regulator or statistics agency is different from
-- a general publisher: its jurisdiction is part of the release's subject
-- context. Preserve that US context while retaining any additional country
-- named by the release itself.
WITH institutional AS (
  SELECT news.id,
         COALESCE(news.country_iso2, news.source_country_iso2) AS primary_country,
         CASE
           WHEN news.payload->>'country_attribution'='content_alias' THEN 'content_alias'
           ELSE 'institutional_jurisdiction'
         END AS attribution,
         (
           SELECT jsonb_agg(country ORDER BY country)
           FROM (
             SELECT upper(existing_country) AS country
             FROM jsonb_array_elements_text(
               CASE WHEN jsonb_typeof(news.payload->'subject_country_iso2s')='array'
                 THEN news.payload->'subject_country_iso2s' ELSE '[]'::jsonb END
             ) existing_country
             WHERE existing_country ~ '^[A-Za-z]{2}$'
             UNION
             SELECT upper(BTRIM(news.country_iso2::text))
             WHERE news.country_iso2 IS NOT NULL
             UNION
             SELECT upper(BTRIM(news.source_country_iso2::text))
             WHERE news.source_country_iso2 IS NOT NULL
           ) countries
         ) AS countries
  FROM item news
  WHERE news.kind='news_article'
    AND news.payload->>'provider'='institutional_rss'
    AND news.payload->>'feed' IN (
      'federal_reserve_press_releases',
      'sec_press_releases',
      'bls_employment_situation',
      'bls_consumer_price_index',
      'bls_producer_price_index',
      'bls_job_openings'
    )
    AND news.source_country_iso2 IS NOT NULL
)
UPDATE item news
SET country_iso2=institutional.primary_country,
    payload=jsonb_set(
      jsonb_set(
        COALESCE(news.payload,'{}'::jsonb),
        '{country_attribution}',
        to_jsonb(institutional.attribution),
        true
      ),
      '{subject_country_iso2s}',
      institutional.countries,
      true
    )
FROM institutional
WHERE institutional.id=news.id;

-- `sourcecountry` in DOC describes the publisher, not the subject. Earlier
-- rows explicitly labelled as publisher-country fallbacks must not make a
-- country-scoped reader claim that the article is about that country. Strong
-- headline/metadata inference, GKG locations and linked canonical events are
-- retained and are all understood by the reader query.
UPDATE item news
SET country_iso2 = NULL
FROM source provider
WHERE news.kind = 'news_article'
  AND provider.id=news.source_id
  AND lower(provider.name) IN ('gdelt','govuk_search','institutional_rss')
  AND (
    lower(COALESCE(
      NULLIF(news.payload->>'country_attribution',''),
      NULLIF(news.payload#>>'{country_inference,source}',''),
      ''
    )) IN ('','none','publisher_country_fallback','feed_hint','locale_hint','url_tld')
    OR (
      lower(COALESCE(news.payload#>>'{country_inference,source}',''))='content_alias'
      AND lower(COALESCE(news.payload#>>'{country_inference,confidence}','none')) IN ('low','none')
    )
  )
  AND news.country_iso2 IS NOT NULL;

SELECT set_config('claritas.suppress_item_outbox','off',false);
SELECT set_config('claritas.preserve_updated_at','off',false);

ANALYZE item;

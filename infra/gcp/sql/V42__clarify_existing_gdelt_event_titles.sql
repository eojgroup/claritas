-- V42: replace actor-token-only canonical copy for machine-coded GDELT events
-- with a bounded action/actor/location presentation. Publisher-led canonical
-- events are excluded by the canonical evidence key guard.
WITH canonical_gdelt AS (
  SELECT event.id,
         global_event.event_code,
         global_event.event_root_code,
         global_event.actor1_name,
         global_event.actor2_name,
         global_event.action_geo_name,
         global_event.action_country_iso2,
         global_event.mention_count,
         global_event.source_count,
         global_event.article_count,
         CASE COALESCE(NULLIF(global_event.event_root_code, ''), left(global_event.event_code, 2))
           WHEN '01' THEN 'public statement'
           WHEN '02' THEN 'appeal'
           WHEN '03' THEN 'intent to cooperate'
           WHEN '04' THEN 'consultation'
           WHEN '05' THEN 'diplomatic cooperation'
           WHEN '06' THEN 'material cooperation'
           WHEN '07' THEN 'aid'
           WHEN '08' THEN 'concession'
           WHEN '09' THEN 'investigation'
           WHEN '10' THEN 'demand'
           WHEN '11' THEN 'disapproval'
           WHEN '12' THEN 'rejection'
           WHEN '13' THEN 'threat'
           WHEN '14' THEN 'protest'
           WHEN '15' THEN 'force posture'
           WHEN '16' THEN 'reduced relations'
           WHEN '17' THEN 'coercion'
           WHEN '18' THEN 'assault'
           WHEN '19' THEN 'armed conflict'
           WHEN '20' THEN 'mass violence'
           ELSE 'interaction'
         END AS action_label
  FROM intelligence_event event
  JOIN intelligence_event_evidence evidence
    ON evidence.event_id = event.id
   AND evidence.domain = 'news'
   AND evidence.source_record_type = 'global_event'
   AND evidence.source_record_id ~ '^[0-9]+$'
  JOIN global_event ON global_event.id = evidence.source_record_id::bigint
  WHERE event.metadata->>'canonical_evidence_key'
          = 'news:global_event:' || global_event.id::text
    AND COALESCE(event.metadata->>'presentation_version', '') <> 'gdelt-event-v2'
), presentation AS (
  SELECT id,
         action_label,
         COALESCE(
           NULLIF(concat_ws(' / ',
             NULLIF(initcap(lower(actor1_name)), ''),
             NULLIF(initcap(lower(actor2_name)), '')
           ), ''),
           'Unspecified actors'
         ) AS actors,
         COALESCE(NULLIF(action_geo_name, ''), action_country_iso2::text, 'unspecified location') AS location,
         mention_count,
         source_count,
         article_count
  FROM canonical_gdelt
)
UPDATE intelligence_event event
SET title = left(
      'Reported ' || presentation.action_label || ': '
      || presentation.actors || ' — ' || presentation.location,
      300
    ),
    summary = left(
      'GDELT machine-coded signal describing '
      || CASE WHEN left(presentation.action_label, 1) IN ('a','e','i','o','u') THEN 'an ' ELSE 'a ' END
      || presentation.action_label || ' involving '
      || presentation.actors || ' near ' || presentation.location || '. '
      || CASE WHEN COALESCE(presentation.source_count, 0)
                    + COALESCE(presentation.article_count, 0)
                    + COALESCE(presentation.mention_count, 0) > 0
         THEN 'The source record reports '
           || concat_ws(', ',
                CASE WHEN presentation.source_count > 0 THEN presentation.source_count || ' sources' END,
                CASE WHEN presentation.article_count > 0 THEN presentation.article_count || ' articles' END,
                CASE WHEN presentation.mention_count > 0 THEN presentation.mention_count || ' mentions' END
              ) || '. '
         ELSE '' END
      || 'This is a structured coverage signal; linked publisher reporting or physical observations are required before treating the underlying claim as confirmed.',
      1800
    ),
    metadata = event.metadata || jsonb_build_object(
      'presentation_version', 'gdelt-event-v2',
      'gdelt_action', presentation.action_label
    ),
    updated_at = now()
FROM presentation
WHERE event.id = presentation.id;

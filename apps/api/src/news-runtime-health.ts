import { NEWS_ASSESSMENT_METHODOLOGY } from "./news-intelligence";
import { newsStoryKeySql, trustedNewsDirectCountrySql } from "./news-country-attribution";

export type NewsRuntimeHealthRow = {
  current_count: number | string | null;
  assessed_count: number | string | null;
  market_count: number | string | null;
  verified_count: number | string | null;
  verified_market_count: number | string | null;
  publisher_count: number | string | null;
  latest_verified_event_time: string | null;
  mapped_24h_count: number | string | null;
  mapped_24h_countries: number | string | null;
  non_gb_24h_count: number | string | null;
  release_run_id: number | string | null;
  release_run_status: string | null;
  release_run_trigger_mode: string | null;
  release_run_finished_at: string | null;
  release_gdelt_step_status: string | null;
  release_gdelt_doc_status: string | null;
  release_gdelt_raw_archive_status: string | null;
  release_gdelt_gkg_archives_scanned: number | string | null;
  release_gdelt_gkg_sampled: number | string | null;
  release_gdelt_gkg_matched: number | string | null;
  release_gdelt_gkg_matched_country_rows: number | string | null;
  release_gdelt_gkg_canonical_country_url_probes: number | string | null;
  latest_success_at: string | null;
};

export type NewsRuntimeHealth = {
  ready: boolean;
  state: "current" | "stale_or_incomplete";
  checked_at: string;
  methodology: string;
  current: {
    count: number;
    assessed: number;
    assessment_ratio: number;
    markets: number;
    publisher_verified: number;
    publisher_verified_markets: number;
    publishers: number;
    latest_verified_event_time: string | null;
  };
  geography_24h: {
    mapped_stories: number;
    countries: number;
    non_gb_stories: number;
  };
  release_run: {
    id: number | null;
    status: string | null;
    trigger_mode: string | null;
    finished_at: string | null;
    gdelt_step_status: string | null;
    gdelt_doc_status: string | null;
    gdelt_raw_archive_status: string | null;
    gdelt_gkg_archives_scanned: number;
    gdelt_gkg_sampled: number;
    gdelt_gkg_matched: number;
    gdelt_gkg_matched_country_rows: number;
    gdelt_gkg_canonical_country_url_probes: number;
  };
  latest_success_at: string | null;
  checks: Record<string, boolean>;
};

export function buildNewsRuntimeHealthQuery(): string {
  const trustedDirect = trustedNewsDirectCountrySql("current_item");
  return `WITH current_news AS MATERIALIZED (
      SELECT current_item.id,current_item.event_time,current_item.country_iso2,current_item.payload,
             ${newsStoryKeySql("current_item")} AS story_key,
             canonical_news_publisher_key(current_item.url,current_item.payload,current_source.name) AS publisher_key,
             assessment.categories,
             (
               assessment.item_id IS NOT NULL
               AND assessment.assessed_at>=current_item.updated_at
               AND (
                 now()<=current_item.event_time+interval '1 hour'
                 OR assessment.assessed_at>current_item.event_time+interval '1 hour'
               )
               AND NOT EXISTS (
                 SELECT 1
                 FROM intelligence_event_evidence changed_evidence
                 JOIN intelligence_event changed_event ON changed_event.id=changed_evidence.event_id
                 WHERE changed_evidence.domain='news'
                   AND changed_evidence.source_record_type='item'
                   AND changed_evidence.source_record_id=current_item.id::text
                   AND GREATEST(changed_event.updated_at,changed_evidence.created_at)>assessment.assessed_at
               )
             ) AS assessed,
             (
               COALESCE(current_item.payload->>'time_basis','') LIKE 'publisher_published%'
               OR lower(COALESCE(current_item.payload->>'publication_time_verified',''))
                    IN ('true','t','1','yes','y','on')
             ) AS publisher_verified
      FROM item current_item
      JOIN source current_source ON current_source.id=current_item.source_id
      LEFT JOIN news_item_assessment assessment
        ON assessment.item_id=current_item.id
       AND assessment.methodology_version=$1
      WHERE current_item.kind='news_article'
        AND lower(current_source.name) IN ('gdelt','govuk_search','institutional_rss')
        AND lower(COALESCE(current_source.metadata->>'retired','false'))
              NOT IN ('true','t','1','yes','y','on')
        AND (lower(current_source.name)<>'gdelt' OR current_item.payload->>'quality_status'='accepted')
        AND current_item.event_time>=now()-interval '4 hours'
        AND current_item.event_time<=now()+interval '5 minutes'
    ), current_rollup AS (
      SELECT count(DISTINCT current_news.story_key)::int AS current_count,
             count(DISTINCT current_news.story_key) FILTER (WHERE current_news.assessed)::int AS assessed_count,
             count(DISTINCT current_news.story_key) FILTER (
               WHERE current_news.assessed AND current_news.categories ? 'markets'
             )::int AS market_count,
             count(DISTINCT current_news.story_key) FILTER (WHERE current_news.publisher_verified)::int AS verified_count,
             count(DISTINCT current_news.story_key) FILTER (
               WHERE current_news.assessed
                 AND current_news.publisher_verified
                 AND current_news.categories ? 'markets'
             )::int AS verified_market_count,
             count(DISTINCT current_news.publisher_key) FILTER (
               WHERE current_news.assessed
                 AND current_news.publisher_verified
                 AND current_news.publisher_key<>'unknown'
             )::int AS publisher_count,
             max(current_news.event_time) FILTER (WHERE current_news.publisher_verified)::text AS latest_verified_event_time
      FROM current_news
    ), geography_news AS MATERIALIZED (
      SELECT current_item.id,current_item.title,current_item.url,current_item.event_time,
             current_item.country_iso2,current_item.payload,
             ${newsStoryKeySql("current_item")} AS story_key
      FROM item current_item
      JOIN source current_source ON current_source.id=current_item.source_id
      WHERE current_item.kind='news_article'
        AND lower(current_source.name) IN ('gdelt','govuk_search','institutional_rss')
        AND lower(COALESCE(current_source.metadata->>'retired','false'))
              NOT IN ('true','t','1','yes','y','on')
        AND (lower(current_source.name)<>'gdelt' OR current_item.payload->>'quality_status'='accepted')
        AND current_item.event_time>=now()-interval '24 hours'
        AND current_item.event_time<=now()+interval '5 minutes'
    ), subject_countries AS MATERIALIZED (
      SELECT current_item.story_key,upper(BTRIM(current_item.country_iso2::text)) AS country
      FROM geography_news current_item
      WHERE ${trustedDirect}
      UNION ALL
      SELECT current_item.story_key,upper(subject_country) AS country
      FROM geography_news current_item
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(current_item.payload->'subject_country_iso2s')='array'
          THEN current_item.payload->'subject_country_iso2s' ELSE '[]'::jsonb END
      ) subject_country
      WHERE subject_country ~ '^[A-Za-z]{2}$'
      UNION ALL
      SELECT current_item.story_key,upper(location->>'country_iso2') AS country
      FROM geography_news current_item
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(current_item.payload#>'{gkg,locations}')='array'
          THEN current_item.payload#>'{gkg,locations}' ELSE '[]'::jsonb END
      ) location
      WHERE location->>'country_iso2' ~ '^[A-Za-z]{2}$'
      UNION ALL
      SELECT current_item.story_key,upper(BTRIM(linked_event.primary_country_iso2::text)) AS country
      FROM geography_news current_item
      JOIN intelligence_event_evidence evidence
        ON evidence.domain='news'
       AND evidence.source_record_type='item'
       AND evidence.source_record_id=current_item.id::text
       AND evidence.correlation_factors->>'decision'='attached'
      JOIN intelligence_event linked_event ON linked_event.id=evidence.event_id
      WHERE linked_event.status<>'dismissed'
        AND linked_event.primary_country_iso2 IS NOT NULL
    ), geography_rollup AS (
      SELECT count(DISTINCT story_key)::int AS mapped_24h_count,
             count(DISTINCT country)::int AS mapped_24h_countries,
             count(DISTINCT story_key) FILTER (WHERE country<>'GB')::int AS non_gb_24h_count
      FROM subject_countries
      WHERE country ~ '^[A-Z]{2}$'
    ), requested_run AS MATERIALIZED (
      SELECT id,status,trigger_mode,finished_at,stats
      FROM ingestion_run
      WHERE id=$2::bigint AND pipeline='news'
      LIMIT 1
    ), release_run AS (
      SELECT requested_run.id AS release_run_id,
             requested_run.status AS release_run_status,
             requested_run.trigger_mode AS release_run_trigger_mode,
             requested_run.finished_at AS release_run_finished_at,
             gdelt_step.step->>'status' AS release_gdelt_step_status,
             gdelt_step.step#>>'{result,doc_status}' AS release_gdelt_doc_status,
             gdelt_step.step#>>'{result,raw_archive_status}' AS release_gdelt_raw_archive_status,
             gdelt_step.step#>>'{result,gkg_archives_scanned}' AS release_gdelt_gkg_archives_scanned,
             gdelt_step.step#>>'{result,gkg_sampled}' AS release_gdelt_gkg_sampled,
             gdelt_step.step#>>'{result,gkg_matched}' AS release_gdelt_gkg_matched,
             gdelt_step.step#>>'{result,gkg_matched_country_rows}' AS release_gdelt_gkg_matched_country_rows,
             gdelt_step.step#>>'{result,gkg_canonical_country_url_probes}' AS release_gdelt_gkg_canonical_country_url_probes
      FROM (SELECT 1) anchor
      LEFT JOIN requested_run ON true
      LEFT JOIN LATERAL (
        SELECT step
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(requested_run.stats->'steps')='array'
            THEN requested_run.stats->'steps' ELSE '[]'::jsonb END
        ) AS release_step(step)
        WHERE step->>'step'='gdelt/doc-event-gkg'
        LIMIT 1
      ) gdelt_step ON true
    )
    SELECT current_rollup.current_count,
           current_rollup.assessed_count,
           current_rollup.market_count,
           current_rollup.verified_count,
           current_rollup.verified_market_count,
           current_rollup.publisher_count,
           current_rollup.latest_verified_event_time,
           geography_rollup.mapped_24h_count,
           geography_rollup.mapped_24h_countries,
           geography_rollup.non_gb_24h_count,
           release_run.release_run_id,
           release_run.release_run_status,
           release_run.release_run_trigger_mode,
           release_run.release_run_finished_at::text,
           release_run.release_gdelt_step_status,
           release_run.release_gdelt_doc_status,
           release_run.release_gdelt_raw_archive_status,
           release_run.release_gdelt_gkg_archives_scanned,
           release_run.release_gdelt_gkg_sampled,
           release_run.release_gdelt_gkg_matched,
           release_run.release_gdelt_gkg_matched_country_rows,
           release_run.release_gdelt_gkg_canonical_country_url_probes,
           CASE WHEN release_run.release_run_status='success'
             THEN release_run.release_run_finished_at::text ELSE NULL END AS latest_success_at
    FROM current_rollup
    CROSS JOIN geography_rollup
    CROSS JOIN release_run`;
}

function finiteCount(value: number | string | null): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

export function evaluateNewsRuntimeHealth(
  row: NewsRuntimeHealthRow | undefined,
  now = new Date(),
): NewsRuntimeHealth {
  const currentCount = finiteCount(row?.current_count ?? 0);
  const assessedCount = finiteCount(row?.assessed_count ?? 0);
  const marketCount = finiteCount(row?.market_count ?? 0);
  const verifiedCount = finiteCount(row?.verified_count ?? 0);
  const verifiedMarketCount = finiteCount(row?.verified_market_count ?? 0);
  const publisherCount = finiteCount(row?.publisher_count ?? 0);
  const mappedStories = finiteCount(row?.mapped_24h_count ?? 0);
  const mappedCountries = finiteCount(row?.mapped_24h_countries ?? 0);
  const nonGbStories = finiteCount(row?.non_gb_24h_count ?? 0);
  const releaseRunId = finiteCount(row?.release_run_id ?? 0);
  const releaseRunStatus = row?.release_run_status ?? null;
  const releaseRunTriggerMode = row?.release_run_trigger_mode ?? null;
  const releaseGdeltStepStatus = row?.release_gdelt_step_status ?? null;
  const releaseGdeltDocStatus = row?.release_gdelt_doc_status ?? null;
  const releaseGdeltRawArchiveStatus = row?.release_gdelt_raw_archive_status ?? null;
  const releaseGdeltGkgArchivesScanned = finiteCount(row?.release_gdelt_gkg_archives_scanned ?? 0);
  const releaseGdeltGkgSampled = finiteCount(row?.release_gdelt_gkg_sampled ?? 0);
  const releaseGdeltGkgMatched = finiteCount(row?.release_gdelt_gkg_matched ?? 0);
  const releaseGdeltGkgMatchedCountryRows = finiteCount(
    row?.release_gdelt_gkg_matched_country_rows ?? 0,
  );
  const releaseGdeltGkgCanonicalCountryUrlProbes = finiteCount(
    row?.release_gdelt_gkg_canonical_country_url_probes ?? 0,
  );
  const latestEventMs = Date.parse(row?.latest_verified_event_time ?? "");
  const nowMs = now.getTime();
  const assessmentRatio = currentCount > 0 ? assessedCount / currentCount : 0;
  const checks = {
    current_volume: currentCount >= 3,
    current_timestamp: Number.isFinite(latestEventMs)
      && latestEventMs <= nowMs + 5 * 60_000
      && nowMs - latestEventMs <= 4 * 3_600_000,
    assessed: assessedCount >= Math.min(currentCount, 3) && assessmentRatio >= 0.6,
    publisher_verified: verifiedCount >= 2,
    markets: marketCount >= 1 && verifiedMarketCount >= 1,
    publisher_diversity: publisherCount >= 2,
    mapped_geography: mappedStories >= 2 && mappedCountries >= 2,
    non_gb_geography: nonGbStories >= 1,
    exact_release_run: releaseRunId > 0
      && releaseRunStatus === "success"
      && releaseRunTriggerMode === "release_gate",
    release_gdelt_acquisition: ["success", "degraded"].includes(releaseGdeltStepStatus ?? "")
      && ["healthy", "healthy_partial", "degraded_fallback"].includes(releaseGdeltDocStatus ?? ""),
    // DOC discovery and the latest available GKG interval need not contain the
    // same publisher URL. Require a deterministic country-bearing GKG row to
    // traverse parsing, WHATWG canonicalization and persistence; keep random
    // DOC/GKG intersections as observability rather than a release condition.
    release_gdelt_raw_enrichment: ["healthy", "degraded"].includes(
      releaseGdeltRawArchiveStatus ?? "",
    ) && releaseGdeltGkgArchivesScanned >= 1
      && releaseGdeltGkgSampled >= 1
      && releaseGdeltGkgCanonicalCountryUrlProbes >= 1,
  };
  const ready = Object.values(checks).every(Boolean);
  return {
    ready,
    state: ready ? "current" : "stale_or_incomplete",
    checked_at: now.toISOString(),
    methodology: NEWS_ASSESSMENT_METHODOLOGY,
    current: {
      count: currentCount,
      assessed: assessedCount,
      assessment_ratio: Math.round(assessmentRatio * 1000) / 1000,
      markets: marketCount,
      publisher_verified: verifiedCount,
      publisher_verified_markets: verifiedMarketCount,
      publishers: publisherCount,
      latest_verified_event_time: row?.latest_verified_event_time ?? null,
    },
    geography_24h: {
      mapped_stories: mappedStories,
      countries: mappedCountries,
      non_gb_stories: nonGbStories,
    },
    release_run: {
      id: releaseRunId > 0 ? releaseRunId : null,
      status: releaseRunStatus,
      trigger_mode: releaseRunTriggerMode,
      finished_at: row?.release_run_finished_at ?? null,
      gdelt_step_status: releaseGdeltStepStatus,
      gdelt_doc_status: releaseGdeltDocStatus,
      gdelt_raw_archive_status: releaseGdeltRawArchiveStatus,
      gdelt_gkg_archives_scanned: releaseGdeltGkgArchivesScanned,
      gdelt_gkg_sampled: releaseGdeltGkgSampled,
      gdelt_gkg_matched: releaseGdeltGkgMatched,
      gdelt_gkg_matched_country_rows: releaseGdeltGkgMatchedCountryRows,
      gdelt_gkg_canonical_country_url_probes: releaseGdeltGkgCanonicalCountryUrlProbes,
    },
    latest_success_at: row?.latest_success_at ?? null,
    checks,
  };
}

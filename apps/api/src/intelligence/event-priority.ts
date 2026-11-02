import { sourceRecordBigintSql } from "./source-record";
/** One priority model for investigations from every source family. */
const sqlAlias = (value: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error("Invalid SQL alias");
  return value;
};

export function activeSocialEvidenceSql(alias = "evidence") {
  const evidence = sqlAlias(alias);
  return `(${evidence}.domain<>'social' OR EXISTS (SELECT 1 FROM social_signal retained
    WHERE retained.id=${sourceRecordBigintSql(evidence)} AND retained.expires_at>now()))`;
}

export function eventOriginDomainSql(alias = "event") {
  const event = sqlAlias(alias);
  return `COALESCE(NULLIF(${event}.metadata->>'origin_domain',''),
    (SELECT CASE WHEN origin.domain='disaster' THEN 'earth_observation'
                 WHEN origin.domain='earth_observation' AND origin.source_record_type IN ('earth_observation','earth_scene') THEN 'imagery'
                 ELSE origin.domain END
     FROM intelligence_event_evidence origin WHERE origin.event_id=${event}.id
       AND origin.relationship<>'assessment' AND ${activeSocialEvidenceSql("origin")}
       ORDER BY origin.created_at,origin.id LIMIT 1),
    'news')`;
}

export function eventSignalDomainsSql(alias = "event") {
  const event = sqlAlias(alias);
  return `COALESCE((SELECT array_agg(DISTINCT CASE
      WHEN signal.domain='disaster' THEN 'earth_observation'
      WHEN signal.domain='earth_observation' AND signal.source_record_type IN ('earth_observation','earth_scene') THEN 'imagery'
      ELSE signal.domain END)
    FROM intelligence_event_evidence signal WHERE signal.event_id=${event}.id
      AND signal.relationship<>'assessment' AND ${activeSocialEvidenceSql("signal")}),ARRAY[]::text[])`;
}

/** News assessment is an input to the event feed, never a separate ranked list. */
export function eventNewsPrioritySql(alias = "event") {
  const event = sqlAlias(alias);
  return `COALESCE((SELECT max(assessment.score)/100
    FROM intelligence_event_evidence report
    JOIN item article ON article.id=${sourceRecordBigintSql("report", "item")}
    JOIN news_item_assessment assessment ON assessment.item_id=article.id AND assessment.assessed_at>=article.updated_at
    WHERE report.event_id=${event}.id AND report.domain='news'
      AND COALESCE(article.payload->>'quality_status','accepted')='accepted'),0)`;
}

export function eventPriorityScoreSql(alias = "event", precomputed = false) {
  const event = sqlAlias(alias);
  const origin = precomputed ? `${event}.origin_domain` : eventOriginDomainSql(event);
  const newsPriority = precomputed ? `${event}.news_priority` : eventNewsPrioritySql(event);
  return `LEAST(CASE WHEN ${origin} IN ('social','podcast') AND ${event}.source_diversity=0 THEN 0.6 ELSE 1 END,
    0.55*GREATEST(${event}.relevance_score,${newsPriority})
    + 0.20*${event}.urgency_score + 0.15*${event}.materiality_score
    + 0.10*GREATEST(0,1-GREATEST(0,extract(epoch FROM (now()-${event}.last_activity_time)))/259200))`;
}

export function eventPriorityReasons(input: {
  origin_domain?: string; signal_domains?: string[]; source_diversity?: number;
  urgency_score?: number; news_priority?: number; origin_topic_rank?: number; severity?: string;
}) {
  const reasons: string[] = [];
  if (Number(input.news_priority) >= 0.5) reasons.push("Material publisher reporting");
  if (Number(input.urgency_score) >= 0.65) reasons.push("Time-sensitive development");
  if (Number(input.source_diversity) > 1) reasons.push(`${input.source_diversity} distinct source identities`);
  if ((input.signal_domains?.length ?? 0) > 1) reasons.push(`Context across ${input.signal_domains!.length} source types`);
  if (input.origin_domain === "social") reasons.push("Unverified social lead; attention is not confirmation");
  if (input.origin_domain === "podcast") reasons.push("Transcript-derived lead; interpretation is not confirmation");
  if (Number(input.origin_topic_rank) > 1 && input.severity !== "critical") reasons.push("Similar signals grouped lower to expose other developments");
  if (!reasons.length) reasons.push("Source significance, urgency and freshness");
  return reasons;
}

export const SIGNAL_FAMILIES = [
  ["news", "News"], ["earth_observation", "Earth observation"], ["imagery", "Imagery"],
  ["transport", "Transport"], ["podcast", "Podcasts"], ["social", "Socials"],
  ["weather", "Weather"], ["market", "Markets"],
  ["model_interpretation", "Model interpretation"],
] as const;

export function evidenceSignalDomain(item: { domain?: string; source_record_type?: string; relationship?: string }) {
  if (item.relationship === "model_interpretation" && item.domain !== "podcast") return "model_interpretation";
  if (item.domain === "disaster") return "earth_observation";
  if (item.domain === "earth_observation" && ["earth_observation", "earth_scene"].includes(item.source_record_type ?? "")) return "imagery";
  return item.domain ?? "news";
}

export function buildSignalCoverage(evidence: Array<{ domain?: string; source_record_type?: string; source_record_id?: string; relationship?: string }>, socialContext: Array<{ signal_id: string | number }> = []) {
  return SIGNAL_FAMILIES.map(([domain, label]) => {
    const records = evidence.filter((item) => evidenceSignalDomain(item) === domain && item.relationship?.trim() !== "assessment");
    const extraSocial = domain === "social" ? new Set(socialContext.map((item) => String(item.signal_id))
      .filter((id) => !records.some((item) => item.source_record_type === "social_signal" && String(item.source_record_id) === id))).size : 0;
    const count = records.length + extraSocial;
    const contextOnly = domain === "social" || (records.length > 0 && records.every((item) => ["context", "model_interpretation"].includes(item.relationship ?? "")));
    return { domain, label, count, state: !count ? "none" : contextOnly ? "context" : "linked" };
  });
}

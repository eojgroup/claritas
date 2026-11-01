import { useMemo, useState } from "react";
import { ArrowDown, ArrowUpRight, CloudSun, ExternalLink, Globe2, Image, Link2, MessageCircle, Mic, Newspaper, RadioTower, Sparkles, TrendingUp, Truck } from "lucide-react";
import type { IntelligenceEventDetail, IntelligenceEvidence } from "../lib/api";
import { connectionDimensions, presentEventLinkage } from "./eventLinkagePresentation";
import { eventOrigin, evidenceFamily, isCoverageAssessment, sourceFamilies, sourceFamily, sourceFamilyLabel } from "./eventSourcePresentation";

const familyIcons = { news: Newspaper, earth_observation: Globe2, imagery: Image, transport: Truck, podcast: Mic, social: MessageCircle, weather: CloudSun, market: TrendingUp, official: RadioTower, model_interpretation: Sparkles };
const dateLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(date);
};
const recordString = (record: Record<string, unknown> | undefined, key: string) => typeof record?.[key] === "string" ? String(record[key]) : null;
const title = (item: IntelligenceEvidence) => item.title || item.source_title || recordString(item.metadata, "original_title") || item.evidence_type.replace(/_/g, " ");
const summary = (item: IntelligenceEvidence) => item.summary || item.source_summary || recordString(item.metadata, "description");
const sourceUrl = (item: IntelligenceEvidence) => item.source_url || recordString(item.provenance, "url");
const relationshipLabel = (relationship: string) => ({ reported: "Reported", observed: "Observed", context: "Context", derived: "Derived", corroborates: "Corroborates", contradicts: "Contradicts", model_interpretation: "Model interpretation", assessment: "Coverage assessment" }[relationship.trim().toLowerCase()] || "Context");

export default function EventConnections({ detail, onOpenImagery, selectedFamily, onSelectFamily }: { detail: IntelligenceEventDetail; onOpenImagery?: (id?: string) => void; selectedFamily?: string; onSelectFamily?: (family: string) => void }) {
  const [localSelected, setSelected] = useState("all");
  const selected = selectedFamily ?? localSelected;
  const [showAll, setShowAll] = useState(false);
  const assessments = detail.evidence.filter(isCoverageAssessment);
  const records = useMemo(() => {
    const evidence = detail.evidence.filter((item) => !isCoverageAssessment(item));
    // Older responses can provide enriched reporting separately from evidence.
    const ids = new Set(evidence.map((item) => item.id));
    const reports: IntelligenceEvidence[] = (detail.linked_news ?? [])
      .filter((item) => item.relationship.trim().toLowerCase() !== "assessment" && !ids.has(item.id))
      .map((item) => ({ ...item, domain: "news", source_record_type: "news", source_record_id: item.id, source_name: item.publisher, source_url: item.url }));
    const retainedSocialIds = new Set(evidence.filter((item) => evidenceFamily(item) === "social").map((item) => item.source_record_id));
    const social: IntelligenceEvidence[] = (detail.social_context ?? [])
      .filter((post) => !retainedSocialIds.has(String(post.signal_id)))
      .map((post) => ({ id: `social-context-${post.signal_id}`, domain: "social", evidence_type: "social_context", source_record_type: "social_signal", source_record_id: String(post.signal_id), observed_at: post.posted_at, relationship: "context", confidence: 0, title: `${post.author} · ${post.platform}`, summary: post.text, source_name: post.author, source_url: post.url, correlation_factors: { rationale: `This unverified claim shares the event’s topic and time window${post.matched_terms.length ? ` (${post.matched_terms.join(", ")})` : ""}. ${post.assessment_boundary}` } }));
    return [...evidence, ...reports, ...social].sort((left, right) => Date.parse(right.observed_at) - Date.parse(left.observed_at));
  }, [detail]);
  const groups = sourceFamilies.map((family) => {
    const items = records.filter((item) => evidenceFamily(item) === family.domain);
    const social = family.domain === "social" ? detail.social_context ?? [] : [];
    const imagery = family.domain === "imagery" ? detail.earth_observations : [];
    const coverage = detail.signal_coverage?.find((entry) => sourceFamily(entry.domain) === family.domain);
    // Keep context claims / scenes visible without adding them to evidence counts twice.
    const count = items.length + (items.length ? 0 : social.length + imagery.length);
    const context = detail.context_signals?.filter((item) => sourceFamily(item.domain) === family.domain) ?? [];
    const nearbyReports = family.domain === "news" ? detail.regional_reporting?.items.length ?? 0 : 0;
    const unavailable = assessments.filter((item) => evidenceFamily(item) === family.domain);
    const dimensions = [...new Set(items.flatMap((item) => connectionDimensions(item.correlation_factors)))];
    const contextOnly = family.domain === "social" || family.domain === "model_interpretation"
      || (items.length > 0 && items.every((item) => ["context", "model_interpretation", "derived"].includes(item.relationship.trim().toLowerCase())));
    const state = count ? contextOnly ? "context" : "linked" : context.length || nearbyReports ? "context" : "none";
    return { ...family, items, count, social, imagery, context, nearbyReports, unavailable, dimensions, state, reportedCount: coverage?.count ?? 0 };
  }).filter((family) => !["market", "official", "model_interpretation"].includes(family.domain) || family.count > 0 || family.context.length > 0);
  const selectedGroup = groups.find((group) => group.domain === selected);
  const visibleRecords = selected === "all" ? records : selectedGroup?.items ?? [];
  const displayedRecords = showAll ? visibleRecords : visibleRecords.slice(0, 6);
  const count = groups.filter((group) => group.count > 0).length;
  const origin = eventOrigin(detail.event);
  const choose = (domain: string) => { setSelected(domain); onSelectFamily?.(domain); setShowAll(false); };

  return <section className="event-connections" aria-labelledby="event-connections-heading">
    <div className="event-connections-heading">
      <div><span className="event-section-kicker">2 · Connect the evidence</span><h3 id="event-connections-heading">Related signals</h3><p>Select a source type to see its records and why they are here.</p></div>
      <span className="event-connection-count">{count} source {count === 1 ? "type" : "types"} · {records.length} records</span>
    </div>
    <div className="event-connection-anchor"><Link2 size={18} aria-hidden="true" /><div><strong>This event</strong><span>{origin ? `Started from ${origin}` : "Origin not recorded"} · {detail.event.location_name || detail.event.primary_country_iso2 || "Location unresolved"}</span></div><ArrowDown size={18} aria-hidden="true" /></div>
    <div className="event-connection-grid" role="group" aria-label="Explore related signals by source type">
      {groups.map((group) => {
        const Icon = familyIcons[group.domain as keyof typeof familyIcons] ?? RadioTower;
        return <button type="button" key={group.domain} aria-pressed={selected === group.domain} aria-controls="event-connection-records" onClick={() => choose(group.domain)} className={`event-connection-node ${group.state === "none" ? "is-empty" : ""}`}>
          <span className="event-connection-node-top"><Icon size={17} aria-hidden="true" /><strong>{group.count || "—"}</strong></span>
          <span className="event-connection-node-label">{group.label}</span>
          <small>{group.count ? group.state === "context" ? "Context / interpretation" : "Linked records" : group.nearbyReports ? `${group.nearbyReports} nearby reports · context` : group.context.length ? "Nearby data · context" : group.unavailable.length ? "Coverage limited" : "No linked data"}</small>
          {group.dimensions.length > 0 && <span className="event-node-dimensions">{group.dimensions.slice(0, 2).join(" · ")}</span>}
        </button>;
      })}
    </div>
    <p className="event-connection-legend"><span>● Linked records</span><span>◌ Context is labelled separately</span><span>— No linked data is not evidence of no activity</span></p>

    <div id="event-connection-records" className="event-connection-reader">
      <div className="event-connection-reader-heading"><h4>{selectedGroup ? `${selectedGroup.label} connections` : "All connected sources"}</h4><button type="button" className="event-evidence-filter" aria-pressed={selected === "all"} onClick={() => choose("all")}>All sources · {records.length}</button></div>
      <p role="status" aria-label="Evidence filter results" className="event-reader-status">{visibleRecords.length} {visibleRecords.length === 1 ? "record" : "records"} · {selectedGroup?.label ?? "All sources"} · latest first</p>
      <ol className="event-connected-records">
        {displayedRecords.map((item) => {
          const linkage = presentEventLinkage(item.correlation_score, item.correlation_factors);
          const dimensions = connectionDimensions(item.correlation_factors);
          const url = sourceUrl(item);
          const matchedEntities = Array.isArray(item.correlation_factors?.matched_entities) ? item.correlation_factors.matched_entities.filter((value): value is string => typeof value === "string") : [];
          return <li key={item.id} id={`event-evidence-${item.id}`} className="event-connected-record">
            <div className="event-record-meta"><span>{sourceFamilyLabel(evidenceFamily(item))}</span><span className={`evidence-relationship-${item.relationship}`}>{evidenceFamily(item) === "social" ? "Unverified claim" : relationshipLabel(item.relationship)}</span><time dateTime={item.observed_at}>{dateLabel(item.observed_at)}</time></div>
            <h5>{title(item)}</h5>
            {summary(item) && <p className="event-record-summary">{summary(item)}</p>}
            <div className="event-record-connection"><span className="event-link-chip">{evidenceFamily(item) === "social" && item.correlation_factors?.decision !== "created" ? "Context match" : linkage.label}</span>{dimensions.map((dimension) => <span className="event-dimension-chip" key={dimension}>{dimension}</span>)}</div>
            {(matchedEntities.length > 0 || item.location_name) && <p className="event-matched-values">{item.location_name && <span>Place: {item.location_name}</span>}{matchedEntities.length > 0 && <span>Shared mentions: {matchedEntities.map((value) => value.replace(/^instrument:/, "$").replace(/^[a-z_]+:/, "")).join(", ")}</span>}</p>}
            <p className="event-link-explanation"><strong>Why shown:</strong> {linkage.explanation}</p>
            <div className="event-record-provenance"><span>{item.source_name || item.source_record_type}</span>{item.published_at && <span>Published {dateLabel(item.published_at)}</span>}{item.attribution && <span>Attribution: {item.attribution}</span>}{url && <a href={url} target="_blank" rel="noreferrer">Open source <ExternalLink size={12} /></a>}{item.native_route && <a href={item.native_route}>Source explorer <ArrowUpRight size={12} /></a>}</div>
          </li>;
        })}
      </ol>
      {visibleRecords.length > 6 && <button type="button" className="event-show-records" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer records" : `Show all ${visibleRecords.length} records`}</button>}
      {selected === "imagery" && detail.earth_observations.length > 0 && <div className="event-connection-empty"><strong>{detail.earth_observations.length} event-linked {detail.earth_observations.length === 1 ? "scene" : "scenes"}</strong><p>Scenes provide visual context. Open the imagery assessment below to inspect acquisition time, resolution and interpretation.</p>{onOpenImagery && <button type="button" onClick={() => onOpenImagery(detail.event.id)}>Inspect event imagery <ArrowUpRight size={14} /></button>}</div>}
      {selectedGroup && !selectedGroup.count && <div className="event-connection-empty"><strong>No linked {selectedGroup.label.toLowerCase()} records</strong><p>{selectedGroup.context.length || selectedGroup.nearbyReports ? "Nearby context is available below. It shares a place and time window; it is not evidence of this event’s impact." : "No matching data is available in this investigation. This does not establish that no activity occurred."}</p>{selectedGroup.unavailable.map((item) => <p key={item.id}>{summary(item) || title(item)}</p>)}</div>}
      {selected === "all" && records.length === 0 && <p className="event-connection-empty">No linked evidence records are available yet. Coverage and regional context remain visible below.</p>}
    </div>

    {(detail.context_signals?.length || detail.regional_reporting || assessments.length > 0) ? <section className="event-regional-context" aria-labelledby="regional-context-heading">
      <span className="event-section-kicker">3 · Explore the surrounding context</span><h3 id="regional-context-heading">Around this event</h3><p className="event-context-boundary">These records share a region and time window. They are useful background and do not establish a connection to the event or prove disruption.</p>
      {(detail.context_signals ?? []).map((item) => <article key={item.id} className="event-regional-data"><div className="event-record-meta"><span>{sourceFamilyLabel(item.domain)}</span><span>{item.scope_label} · context only</span></div><h4>{item.title}</h4><p>{item.summary}</p>{item.metrics.length > 0 && <dl className="event-regional-metrics">{item.metrics.map((metric) => <div key={`${metric.label}-${metric.unit}`}><dt>{metric.label}</dt><dd>{metric.value.toLocaleString()} <small>{metric.unit}</small></dd></div>)}</dl>}<p className="event-coverage-notice">{item.coverage_notice}</p>{item.observed_at && <time dateTime={item.observed_at}>Source time {dateLabel(item.observed_at)}</time>}{item.native_route && <a href={item.native_route}>Explore regional data <ArrowUpRight size={13} /></a>}</article>)}
      {detail.regional_reporting && <div className="regional-reporting"><h4>Nearby reporting</h4><p>{detail.regional_reporting.notice}</p><p className="event-reader-status">{dateLabel(detail.regional_reporting.window_start)} – {dateLabel(detail.regional_reporting.window_end)} · publication or discovery time</p><div className="event-regional-news">{detail.regional_reporting.items.map((item) => <article key={item.id}><span className="regional-context-chip">{item.scope_label} · context only</span><a href={item.url} target="_blank" rel="noreferrer">{item.title}<ArrowUpRight size={13} /></a><span>{item.publisher} · {dateLabel(item.observed_at)}</span></article>)}</div>{!detail.regional_reporting.items.length && <p className="event-coverage-notice">No additional reporting in this place and time window.</p>}</div>}
      {assessments.length > 0 && <details className="event-coverage-details"><summary>Data coverage and comparison limits · {assessments.length}</summary>{assessments.map((item) => <article key={item.id}><h4>{title(item)}</h4><p>{summary(item) || "This assessment describes available data, not a positive linked signal."}</p></article>)}</details>}
    </section> : null}
  </section>;
}

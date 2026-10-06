import type { ImageAnalysis } from "../lib/api";
export default function ImageAnalysisSummary({ analysis }: { analysis?: ImageAnalysis | null }) {
  if (!analysis?.object_counts?.length) return null;
  return <div className="image-analysis-summary" aria-label="Visible object estimates">
    <strong>Visible object estimates</strong>
    {analysis.object_counts.map((count) => <div key={`${count.object_type}:${count.area}`}>
      <span>{count.object_type === "truck" ? "Trucks" : "Vessels"} · {count.area.replace(/_/g, " ")}: </span>
      <strong>{count.status === "not_resolvable" ? "Not resolvable" : count.count_min === count.count_max ? `≈${count.count_min}` : `${count.count_min}–${count.count_max}`}</strong>
      {count.status === "estimated" && <span> · {Math.round(count.confidence * 100)}% model confidence</span>}
      <small>{count.reason}</small>
    </div>)}
    {analysis.count_changes?.map((change) => <p key={`${change.object_type}:${change.area}`}>
      {change.object_type === "truck" ? "Truck" : "Vessel"} count change: {change.direction === "overlapping_estimates" ? "Ranges overlap; change unresolved" : `${change.delta_min > 0 ? "+" : ""}${change.delta_min} to ${change.delta_max > 0 ? "+" : ""}${change.delta_max}`}.
      <small>Compared with {new Date(change.baseline_captured_at).toLocaleString()} · same scene footprint and sensor.</small>
    </p>)}
    {!!analysis.visual_signal_score && <small>Signal relevance contribution: +{Math.round(analysis.visual_signal_score * 1000) / 10} points.</small>}
    <small>Model estimates of visible objects. A snapshot does not establish whether vessels are stationary or a port is congested.</small>
  </div>;
}

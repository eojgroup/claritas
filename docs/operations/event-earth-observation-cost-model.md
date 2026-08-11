# Incremental event and Earth Observation cost model

These are planning ranges, not quotes. Actual GCP and provider prices vary by region, free allowance and contract. Recalculate against the billing calculator before changing tiers.

| Scale | Pub/Sub | GCS + image egress | Cloud SQL/GKE increment | EO processing | Expected incremental/month |
|---|---:|---:|---:|---:|---:|
| Current/small | free allowance to low single digits | 1–10 GB; low single digits before client egress | absorbed by current DB/node requests in normal load | free/provider allowance under 100 PU/day cap | roughly $0–$25 plus image egress |
| 10× events/users | low single to tens | 10–100 GB plus user egress | $25–$150 if a DB/node step-up becomes necessary | provider-plan dependent; cap before upgrade | roughly $50–$350 plus provider plan |
| 100× events/users | tens to low hundreds | 0.1–1 TB plus material egress | $250–$1,500 for HA/replicas/worker capacity | negotiated/provider-plan dependent | capacity plan required; $500+ likely |

LLM/vision is zero for EO by default because `EO_VISION_ENRICHMENT_ENABLED=false`. Existing briefing LLM cost grows with briefing volume and now receives a bounded event set. Image bandwidth can dominate storage; serve thumbnails in lists and previews only on investigation views.

Implemented controls: relevance-gated EO, monitoring tiers, rotating FIRMS AOIs, deterministic AOI crop, maximum pixels, daily processing-unit counter, cache-first assets, 60-day object lifecycle, leased single-job worker, capped retries/dead letters, scene/cloud thresholds, provider circuits and disabled-by-default feature flags. Raising any one of those limits requires checking queue latency, Cloud SQL load, provider quota and image egress together.

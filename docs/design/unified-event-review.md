# Unified investigations review — 24 September 2026

The implementation replaces the separate top-news UI with one priority event queue on web, iPhone and iPad. The shared flow is overview → source families → individual records and connection reasons → regional context. News remains available chronologically.

## Data and source coverage

- News, earth observations, imagery, transport anomalies, qualifying podcast findings, qualifying social claims and weather alerts can originate investigations. Market movements also participate. Eligibility is source-specific; image availability and unverified claims are not confirmed incidents.
- Matching considers event family, time, specific location/proximity, shared entities and explicit financial instruments. Country and time alone do not merge events. Distinct topics can remain separate, related investigations.
- Ranking uses source significance, news assessments, urgency, materiality, freshness and evidence diversity. A bounded repetition adjustment exposes different developments; critical events are exempt. Interpretation-only and unverified social leads retain attention limits.
- A bounded, idempotent seven-day replay brings stored sources through the new eligibility rules. This is not a full historical backfill.
- Related evidence, model interpretation, social claims and regional discovery retain separate labels. Country-level transport samples and weather alerts never establish event impact or national traffic totals.

## Examples traced

1. **Colombia acquisition:** the supplied DHL headline is an acquisition, not evidence of transport disruption. Classification and news tags require disruption language rather than the words “supply chain” alone. The web regression follows a stored news reference into an investigation, a related podcast record, regional aircraft/vessel metrics and separate nearby reporting. Its counts are test fixtures, not production observations.
2. **Bristol Airport:** location resolution and flight-context attachment use shared airport rules, with no Bristol-specific production branch. Whole-name matching prevents “CAN” matching “cancelled”; tests also cover Heathrow, Dubai and Singapore. Nearby aircraft samples do not confirm delays or cancellations.
3. **Stock-related signals:** explicit `$AAPL` / `NASDAQ: AAPL` anchors connect news and market signals across locations while retaining separate event topics. Ordinary uppercase words are not treated as tickers.
4. **Podcasts and socials:** transcript evidence/eligibility and social retention remain enforced. Podcast interpretations stay under Podcasts with an interpretation label. Repeated social records are deduplicated.

## Review corrections and validation

The follow-up review removed an obsolete news-sort setter that broke the web build, preserved the originating source when additional evidence arrives, and allowed canonical-source replay to correct a stale event classification. A PostGIS integration regression covers classification, origin preservation, the unified feed, source coverage and regional-context response.

Local web build/lint and 126 tests passed; API build and 362 unit tests passed. The Apple CI workflow for the main redesign commit passed. PostGIS integration and deployment validation run in the release workflow.

Live production examples have not been inspected in this session because Google Cloud reauthentication still fails. The Colombia UI flow uses fixtures. Full visual inspection across physical devices remains unverified; responsive code, component tests and Apple compilation are not a substitute for that inspection.

# Data-source governance

Claritas only activates a production connector after its governing terms permit
the intended commercial product use and its expected spend has an explicit
bound. “Free” describes the approved access path, not a permanent promise from a
provider. Every item keeps the provider, original publisher, source URL,
attribution and reuse notice. An RSS endpoint being publicly reachable is not,
by itself, permission to use it in a commercial aggregation, correlated event or
derived briefing product.

## Active news sources

| Provider | Coverage | Commercial basis | Credential |
|---|---|---|---|
| GDELT | Global multilingual news discovery, events, geography, themes and tone | GDELT reuse terms; original publisher remains visible | None |
| GOV.UK Search API | Current UK Government news stories, press releases and world news stories | Crown copyright / Open Government Licence v3.0, with source organisation and OGL attribution retained | None |
| European Commission Press Corner | EU institutional releases | Commission reuse policy / CC BY 4.0 unless stated otherwise | None |
| Federal Reserve Board | All press releases, including monetary policy and banking regulation | U.S. government public domain unless stated otherwise; cite the Board | None |
| U.S. Bureau of Labor Statistics | Employment Situation, CPI, PPI and JOLTS releases | BLS public domain; cite BLS | None |
| U.S. SEC | Securities regulation and enforcement press releases | U.S. government public domain unless stated otherwise | Identifying user agent only |
| European Central Bank | Press releases and statistical press releases | Free use with accurate reproduction and ECB attribution; paid users must be told the information is freely available from the ECB | None |

Institutional feeds are normalized through one connector and source record, but
the publishing institution is retained on every item. Repeated polls do not write
unchanged items, which avoids PostgreSQL churn while preserving idempotency.

News categories and priority are derived navigation metadata, not new source
facts or content rights. Their evidence order, fallback behavior and
corroboration boundary are documented in
[News categories and priority](./news-priority.md).

GOV.UK ingestion is restricted to the Search API document types `news_story`,
`press_release` and `world_news_story`; external search results and other GOV.UK
document types are rejected. The connector stores the publishing organisation,
source URL, public timestamp, subject-country inference and OGL notice. GOV.UK's
`public_timestamp` is labelled as the publisher's public timestamp rather than
silently claiming that every value is the first publication time.

GDELT DOC remains the preferred global publisher-discovery path. If DOC is rate
limited or unavailable, Claritas records that provider step as degraded and may
ingest at most 25 relevance-filtered links from GDELT's official rolling Article
List RSS feed. This fallback is deliberately a bounded sample, not complete
global coverage. Because GAL RSS does not declare article language, the fallback
admits only headlines with defensible English-language signals; ambiguous or
non-English headlines are rejected instead of bypassing translation policy. The
feed and raw archives are retrieved from GDELT's TLS-backed Google Cloud Storage
origin. GAL `pubDate` is an exact publisher time for only a minority of records
and otherwise represents GDELT discovery, so fallback items carry the
explicit `publisher_published_or_provider_discovered` time basis. Normal GDELT
DOC items carry `provider_first_seen` with 15-minute precision. Neither value is
presented as an exact publisher publication timestamp.

## Reviewed but not enabled

| Provider | Decision |
|---|---|
| Nasdaq Trader alerts | Not enabled. Nasdaq's site copyright terms limit reuse to personal/non-commercial use unless Nasdaq gives written consent. |
| CEPR / VoxEU | Not enabled. Titles and first sentences have a narrow reuse allowance, but adaptation and derivative commercial use require permission, which conflicts with automated briefing synthesis. |
| African Development Bank | Not enabled. AfDB limits copying to personal/non-commercial use and requires written consent for commercial redistribution or derivatives. |
| UNECA | Not enabled. UNECA repository and site terms require prior consent for commercial use. |
| Asian Development Bank RSS | Not enabled. ADB's RSS page expressly describes personal or non-commercial website use; broader commercial redistribution requires permission. |

Re-evaluate an exclusion only after a new provider licence or written permission
is archived and reviewed. Do not add a connector based only on a free tier or an
undocumented assumption about public-sector copyright.

## Disaster and Earth Observation sources

| Provider | Coverage | Commercial-use review | Credential | Deployment gate/readiness | Required attribution |
|---|---|---|---|---|---|
| Copernicus Data Space / Sentinel Hub | Sentinel-1/2 discovery and bounded processing | Copernicus data terms reviewed; administrator must reconfirm account/quota terms before production use | OAuth client ID/secret | Flags default active; reports `not_configured` without both credentials | “Contains modified Copernicus Sentinel data” and provider scene URL |
| NASA FIRMS | VIIRS near-real-time active-fire hotspots | NASA Earth Science open-data policy reviewed; underlying product citation retained | Free MAP_KEY | Flag defaults active; reports `not_configured` without key | NASA FIRMS, satellite/instrument and source version |
| NASA EOSDIS GIBS | Four reviewed, date-specific EPSG:4326 WMTS layers with bounded WMS previews | NASA ESDIS guidance reviewed; underlying non-NASA products remain subject to their source terms | None | EO umbrella and GIBS flag default active | NASA EOSDIS GIBS, exact layer and observation date, acknowledgement and source URL |
| USGS Earthquakes | Real-time GeoJSON earthquake observations | U.S. government/public-domain policy reviewed | None | Flag defaults active | U.S. Geological Survey and event URL |

FIRMS hotspots are thermal anomalies, not proof of wildfire cause or damage.
USGS records are physical observations, not impact assessments. Optical and SAR
scene differences remain contextual evidence; acquisition, cloud, season and
sensor conditions are disclosed. GIBS currently supplies allowlisted WMTS tile
templates and bounded WMS preview URLs. The web client can display a preview
directly from NASA, but the Claritas API does not download, persist, proxy or
analyse it, and it does not become an observation. New EO layers or providers require a
reviewed allowlist entry, licence/attribution storage, a cost bound and an
initially disabled rollout even though the already-reviewed connectors above are
active in the committed deployment configuration.

## Model-derived interpretation

OpenRouter is an optional processor of a bounded Copernicus preview, not an
independent Earth Observation source. The approved production route is
`openrouter/free`; there is no paid fallback. Exact model overrides must be
catalogued as image-input and structured-output capable with all relevant prices
at zero. The stored evidence records requested/actual model, prompt version,
underlying observation and scene provenance, generation time, limitations and a
confidence capped below physical evidence. It is labelled
`model_interpretation` and cannot establish cause, intent, casualties, ownership
or pixel-unsupported damage.

The image sent to OpenRouter is a resized rendition of a private provider asset,
with bounded event and sensor context. Do not add personal data, unrestricted
source text or arbitrary upstream URLs to that request. Provider retention and
processing terms must be re-reviewed before changing the route or payload.

## Delivery processor

APNs is an alert transport, not an intelligence source. It receives a device
token and a bounded alert payload containing title/body, event ID/type, severity
and optional country. Device registration is authenticated, topic-bound and
environment-specific. An active token cannot move between accounts; explicit
unregister clears the token and suppresses outstanding work. Delivery rechecks
ownership, topic, recency, eligibility and acknowledgement immediately before
sending. Invalid tokens deactivate only the matching unchanged registration.
An APNs HTTP 200 is stored as provider acceptance, never as proof that a user saw
or acknowledged an alert.

## Country linkage

`country_iso2` describes the country the story is about. `source_country_iso2`
describes a publisher's jurisdiction when that is meaningful. Supranational ECB
and EU releases do not default to Germany or Belgium: they remain global until
content evidence identifies a country. This avoids creating false country-map
signals merely to fill a field. Country and time can identify correlation
candidates, but cannot by themselves merge generic reports into one canonical
event; a specific location, bounded spatial proximity or shared entity is also
required.

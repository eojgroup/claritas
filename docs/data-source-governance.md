# Data-source governance

Claritas only enables a production connector when the provider is free to access
and its governing terms permit the intended commercial product use. Every item
keeps the provider, original publisher, source URL, attribution and reuse notice.
An RSS endpoint being publicly reachable is not, by itself, permission to use it
in a commercial aggregation or derived briefing product.

## Active news sources

| Provider | Coverage | Commercial basis | Credential |
|---|---|---|---|
| GDELT | Global multilingual news discovery, events, geography, themes and tone | GDELT reuse terms; original publisher remains visible | None |
| European Commission Press Corner | EU institutional releases | Commission reuse policy / CC BY 4.0 unless stated otherwise | None |
| Federal Reserve Board | All press releases, including monetary policy and banking regulation | U.S. government public domain unless stated otherwise; cite the Board | None |
| U.S. Bureau of Labor Statistics | Employment Situation, CPI, PPI and JOLTS releases | BLS public domain; cite BLS | None |
| U.S. SEC | Securities regulation and enforcement press releases | U.S. government public domain unless stated otherwise | Identifying user agent only |
| European Central Bank | Press releases and statistical press releases | Free use with accurate reproduction and ECB attribution; paid users must be told the information is freely available from the ECB | None |

Institutional feeds are normalized through one connector and source record, but
the publishing institution is retained on every item. Repeated polls do not write
unchanged items, which avoids PostgreSQL churn while preserving idempotency.

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

| Provider | Coverage | Commercial-use review | Credential | Default | Required attribution |
|---|---|---|---|---|---|
| Copernicus Data Space / Sentinel Hub | Sentinel-1/2 discovery and bounded processing | Copernicus data terms reviewed; administrator must reconfirm account/quota terms before enabling | OAuth client ID/secret | Disabled | “Contains modified Copernicus Sentinel data” and provider scene URL |
| NASA FIRMS | VIIRS near-real-time active-fire hotspots | NASA Earth Science open-data policy reviewed; underlying product citation retained | Free MAP_KEY | Disabled | NASA FIRMS, satellite/instrument and source version |
| NASA EOSDIS GIBS | Reviewed WMTS visualization layers | NASA open-data guidance reviewed per allowlisted layer | None | Disabled | NASA EOSDIS GIBS and layer/time |
| USGS Earthquakes | Real-time GeoJSON earthquake observations | U.S. government/public-domain policy reviewed | None | Disabled | U.S. Geological Survey and event URL |

FIRMS hotspots are thermal anomalies, not proof of wildfire cause or damage.
USGS records are physical observations, not impact assessments. Optical and SAR
scene differences remain contextual evidence; acquisition, cloud, season and
sensor conditions are disclosed. New EO layers or providers require a reviewed
allowlist entry, licence/attribution storage and disabled-by-default rollout.

## Country linkage

`country_iso2` describes the country the story is about. `source_country_iso2`
describes a publisher's jurisdiction when that is meaningful. Supranational ECB
and EU releases do not default to Germany or Belgium: they remain global until
content evidence identifies a country. This avoids creating false country-map
signals merely to fill a field.

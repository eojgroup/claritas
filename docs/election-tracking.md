# Country election calendars

Country leadership now includes a calendar sourced from Wikidata (CC0). The
leadership ingestion schedule refreshes elections with country links (P17),
election types (P31/P279), and dates (P585). See the [Wikidata election definition](https://www.wikidata.org/wiki/Q40231)
and [date property](https://www.wikidata.org/wiki/Property:P585).

Coverage spans the previous calendar year through two upcoming calendar years.
The feed can include national and subnational elections; titles and types are
retained. It is not an official or exhaustive list. Year/month precision is
preserved, and a scheduled date passing never implies that voting occurred or
that results were certified. Each entry links to its source. Missing dates are
reported as missing coverage, never as evidence a country holds no elections.

Calendars are persisted with the leadership snapshot. Empty, truncated, invalid,
or failed provider responses retain the previous calendar and its retrieval
stamp. The first calendar appears after the next successful leadership ingestion.

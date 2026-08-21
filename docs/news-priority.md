# News categories and priority

Claritas treats news priority as an explainable triage aid, not as a measured
market impact or investment recommendation. The same server assessment powers
the Dashboard, News workspace, iPhone, iPad and Watch so that a story does not
change meaning when it moves between devices.

## Taxonomy

Every assessed story has one primary category and may have additional
categories:

- Markets
- Economy
- Companies
- Geopolitics
- Policy
- Energy
- Technology
- Climate & disasters
- Health
- Transport
- Other

`Other` is intentional. Claritas does not relabel an uncertain story as policy
merely to avoid an empty classification.

Classification prefers governed, structured evidence in this order:

1. a linked canonical event and its event type;
2. connector metadata, including institutional-feed topics, GDELT themes and
   GOV.UK document type or publishing organisation;
3. bounded terms in the publisher headline and available excerpt.

The original publisher category is never silently presented as a Claritas
conclusion. Categories and topic tags are automated navigation metadata.

## Priority

The priority assessment is versioned and stored separately from the immutable
publisher record. It considers verified publication freshness, structured
market-relevant topics and the strongest eligible linked event, including its
severity, confidence and relevance. A linked event contributes once; its
component scores are not counted again under new labels.

Priority tiers are `Top`, `High`, `Notable` and `Routine`. Clients show a short,
plain-language reason alongside the tier. They do not call GDELT tone “impact,”
infer authority from a publisher name, or describe multiple evidence domains as
multiple publishers.

When an assessment is temporarily unavailable, the API returns an explicit
wire fallback (`Other`, `Routine`, `is_fallback: true`) and clients label it
`Unranked — assessment pending`; they do not present missing assessment as a
low-importance conclusion. “Latest” remains
available as a separate, strictly chronological sort for readers who want an
unranked chronology. The normal attention queue covers verified publication
times from the last eight days; older reporting is available only through the
explicit archive mode. Missing or materially future-dated publication times do
not enter the reader queue.

## Corroboration and clustering

Evidence from weather, markets, transport or Earth observation can strengthen
a canonical event, but it is not independent news corroboration. Claritas may
describe a story as supported by multiple publishers only when the correlated
event has distinct original publisher identities. Ingestion providers and
aggregators do not count as original publishers. Publisher identity is
canonicalized from the original article host or publisher domain, so the same
release discovered directly and through an aggregator cannot masquerade as two
independent publishers.

The overview is designed to avoid a burst from one publisher displacing the
whole attention queue. Full reporting remains available in the News workspace,
with the publisher URL, attribution, time basis and translation disclosure.

## Coverage and rights

Priority is calculated only over reporting Claritas has lawfully discovered and
quality-checked. It does not imply complete global coverage. Claritas stores and
shows publisher headlines, available excerpts, provenance and links under the
source policy in [data-source governance](./data-source-governance.md); it does
not claim a licence to republish Bloomberg, Reuters, Apple News or another
publisher's full article body.

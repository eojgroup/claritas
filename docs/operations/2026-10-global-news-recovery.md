# Global news freshness and translation recovery, 27 October 2026

The supplied three-hour news run stopped inside GDELT before the earlier socket
and recovery fixes were deployed. Production inspection confirmed image
`19b9b6c` and migration V62 running afterward, with no restarts and subsequent
news acquisitions completing in roughly 109–184 seconds. Those newer runs still
showed DOC HTTP 429 responses and a rolling RSS fallback repeatedly updating
the same 25 links. Accepted reporting was overwhelmingly English: four accepted
non-English stories in the inspected 48-hour window. This was an acquisition
coverage problem, rather than a large existing translation backlog.

## Acquisition

The primary GDELT path now reads its
[documented minute Article List metadata](https://blog.gdeltproject.org/announcing-the-gdelt-article-list-rss-feed/),
which includes original headlines, short publisher descriptions and language
codes. Live checks confirmed current minute objects; absent minute objects are
normal because publication occurs in bursts. The reader scans a bounded recent
window instead of assuming only quarter-hour filenames exist.

The default stored legacy 25-headline budget moves to 120, with a hard maximum
of 250 per run. Publisher/language balancing, URL deduplication and durable
interval cursors provide a broader current sample. This is deliberately not a
complete global mirror. Counts expose selected and omitted candidates, missing
minutes, retry intervals and skipped old backlog. Failed selected writes leave
the interval eligible for replay; canonical URL history prevents rediscovery
from making an old article appear newly published.

GAL's timestamp can mean publication or discovery. It remains qualified provider
metadata; the immutable file interval supplies first-seen context. Verified URL
publication evidence and stale-source exclusions still apply. Original language
and publisher jurisdiction do not establish the story's subject country.
Independent geography and publisher-diversity release gates remain required.
DOC is a paced supplement/fallback, and provider 429 responses suppress query
storms. Event/GKG enrichment follows acquisition and has separate diagnostics.

Two provider slots let institutional RSS and GOV.UK persist reporting while
GDELT works. Progress snapshots and phase logs survive a later failure. Requested
translations wake a separate durable worker rather than holding acquisition
open behind a model request. A source pipeline can therefore finish while
optional translations are queued or temporarily unavailable.

## Assessment

The assessment publisher lookup joined evidence to `item.id::text`, forcing
repeated scans of the article table. It now validates a canonical positive
bigint identity and uses the item primary-key index. Read-only production
validation preserved publisher counts and malformed-ID rejection; a tested
lookup took 0.202 ms and the overall query estimate fell from approximately
1.21 million to 33,825 cost units. These estimates are not end-to-end latency
measurements. The existing empty-queue candidate scan still took roughly
7.3 seconds and remains a separate optimization opportunity.

## Free-only translations

Translations remain on the explicitly free route with zero-cost response
validation and no paid fallback. Existing local daily ceilings remain 30 total
requests and 24 automatic requests, with batches up to 25 headlines. Actual
capacity can be lower because the provider allowance is shared with other app
features. The account inspected had a 50-request free daily limit; the
[provider limit endpoint](https://openrouter.ai/docs/api-reference/limits)
supplies the current remaining allowance rather than assuming local counters
cover the whole account.

V63 adds source-hash-aware retry state and durable dispatch pacing. A one-minute
worker check respects backoff and reserves capacity for reader requests. Quota
checks happen only when there is work and are cached. Reader requests use local
usage/dispatch state and cached provider capacity, without making a provider
request. Malformed or unusable model output is retried without overwriting the
original source text or blocking unrelated candidates.

The API attaches `translation_availability` to untranslated non-matching-language
stories. Web, iPhone, iPad and Watch preserve the original headline and disclose
pending, disabled, unavailable or free-quota states. Availability is separate
from AI translation provenance: a queued original never claims to be translated.

Validation passes: API build and 417 tests, web production build and 145 tests,
web lint with no errors, migration ordering and Apple project validation.
Eight native loading/availability checks pass against compiled shared models;
changed Swift sources pass parsing. Full native build verification runs in the
Apple CI workflow because Xcode is unavailable on the local workstation.

## Rollout and checks

V63 and V64 must run before the new API. V64 only changes the old default sample
budget; it preserves provider opt-outs and custom schedules/budgets. After
rollout, inspect a fresh exact-release news run, current GAL interval diagnostics,
accepted article counts separately from machine records, assessment completion,
language/publisher spread and translation backlog/availability. Known no-change
polls and another replica's ownership are reported accurately rather than as a
new provider failure. Existing historical failed runs remain historical records.

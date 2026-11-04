# Lightweight news translation

Claritas keeps publisher content as immutable source evidence and stores AI
presentation text separately. The current interface language is English, but
translations are keyed by a normalized BCP 47 target language so another
interface language can be added without rewriting source records.

## Data flow

1. News ingestion stores the publisher headline, available source excerpt and
   `language_code` on `item` without modification.
2. Acquisition completes independently of translation. A nonblocking wake-up
   and a one-minute recovery worker select canonical reporting from the last
   48 hours whose language differs from the target language. Unknown source
   language remains `und`; the model may infer it from the supplied text but
   cannot rewrite the source language metadata. Exact publisher headlines for
   up to 200 recently updated current investigations lead the queue, followed
   by other reporting. Source languages are interleaved within each tier so
   a high-volume publisher language does not occupy the whole batch. Headlines are sent in bounded chunks
   to the dedicated free-only OpenRouter client.
3. `item_translation` stores the translated headline, source hashes and model
   provenance. A source change invalidates the cached presentation text.
4. The news API returns both the original fields and separate
   `translated_title`, `ai_summary` and `translation` fields. Reader availability
   distinguishes queued work, temporary unavailability, disabled translation
   and free-quota limits; original reporting remains available in every case.
5. When a user expands a non-English story, the web client may call
   `POST /api/news/:id/translation`. Claritas then supplies the model with the
   headline and at most 1,200 characters of the already-ingested source excerpt.
   The result is capped at 55 words by default. If that evidence is insufficient,
   the stored status is `insufficient` and no summary is fabricated.

Claritas never fetches an article body for translation, never translates or
stores an AI copy of the whole article, and never overwrites `item.title` or
`item.summary`.

## Presentation and provenance

Clients prefer `translated_title` for the configured interface language while
retaining the original headline for search and inspection. AI text is labelled
as either `AI translation` or `AI-generated English summary`. The response also
identifies the provider, model, source and target languages, generation time,
and confirms that no article body was used.

Daily and personalised briefings prefer the valid cached English translation
and still receive the original publisher headline as auditable evidence. Their
prompts remain able to translate uncached evidence so briefing generation does
not depend on complete cache coverage.

The investigation feed, overview timeline, linked reporting and source links
also use valid cached headlines. They retain the original headline behind an
explicit disclosure and distinguish pending translation, an exhausted allowance
and temporary unavailability. A translated headline does not imply its source
excerpt has also been translated; original-language excerpts are labelled.

## Free-only and budget guarantees

Translation does not use the general briefing model or its fallback chain. It
accepts only OpenRouter's `openrouter/free` router or an explicit model slug
ending in `:free`. It fails closed when the OpenRouter key is absent or the
configured model is not explicitly free. There is no paid fallback.

Before every provider attempt, Claritas atomically reserves capacity in
`news_translation_usage` for the current UTC date. The durable limits cover
requests, automatic requests, source characters, and a conservative token-unit
upper bound. Reservations are not refunded after transport, parsing, or storage
errors because the provider may already have handled the request. The automatic
sub-cap preserves some of the daily request allowance for reader-initiated
translation.

Each provider response must include OpenRouter's usage accounting with a finite
numeric `usage.cost` of exactly zero. Missing, malformed, or non-zero cost makes
the response unusable. Each request also sets provider `max_price` ceilings of
zero for prompt, completion, request, and image charges, so OpenRouter must
reject the request before inference when a zero-priced route is unavailable.
OpenRouter now includes usage accounting automatically; Claritas does not
depend on its deprecated `usage.include` request option.

Candidates are split by both item count and source characters. Each successful
subset is persisted immediately, and a retry contains only omitted candidates
or records whose persistence failed. The provider client makes one HTTP attempt
per reservation; the bounded orchestration loop owns all retries. HTTP 401,
402, 403 and 429 stop the batch instead of immediately repeating requests.

The shared OpenRouter account also serves other app features. When translation
work actually exists, the worker checks the account-wide free allowance using
`GET /api/v1/key`, caching the result for at most five minutes and never across
a UTC-day reset. It reserves the on-demand portion of that allowance and pauses
when the counter cannot be checked. Reader requests consult only local durable
state and the cached counter; they do not make provider quota requests.
An exhausted shared allowance is rechecked after at most five minutes when
pending work exists, so newly available free capacity can recover a pause
within the day. Local daily processing caps remain in force until their UTC
reset; a provider quota recheck never resets usage or raises those caps.
OpenRouter currently documents 50 daily free-model requests for accounts below
its credit-purchase threshold. The limit is shared, so 24 automatic requests
with up to 25 headlines is a theoretical ceiling, not guaranteed throughput.
See [OpenRouter limits](https://openrouter.ai/docs/api-reference/limits).

V63 adds source-hash-aware retry and dispatch records. Missing or unusable
outputs back off from five minutes to a maximum of six hours; changed source
text immediately becomes eligible again. The dispatch timestamp spaces
automatic work across the day, survives restarts and applies to both ingestion
wake-ups and the recovery timer. Failed stories therefore cannot continuously
consume the front of the free queue. Basic output checks reject malformed
responses, refusal text, clearly wrong target scripts and lost numeric evidence.
These checks do not constitute a claim that model output is semantically verified.
Retry records keep a bounded failure category (transport, HTTP status, empty
content, invalid JSON or cost-policy rejection) instead of raw provider payloads,
which may contain source text or account details.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEWS_TRANSLATION_ENABLED` | `true` | Enables the independent automatic headline worker. |
| `NEWS_TRANSLATION_TARGET_LANGUAGES` | `en` | Comma-separated normalized BCP 47 target languages. |
| `NEWS_TRANSLATION_BATCH_SIZE` | `100` | Maximum candidate window; recovery dispatch uses one bounded chunk per target. |
| `NEWS_TRANSLATION_MODEL` | `openrouter/free` | Dedicated model route. Only this value or an explicit `:free` model is accepted. |
| `NEWS_TRANSLATION_CHUNK_SIZE` | `25` | Maximum items in one independently budgeted provider request, constrained to 1–25. |
| `NEWS_TRANSLATION_MAX_CHUNK_SOURCE_CHARACTERS` | `8000` | Maximum bounded source characters in one chunk. |
| `NEWS_TRANSLATION_MAX_RETRIES` | `1` | Retry rounds for only omitted/failed candidates; each round requires a new reservation. |
| `NEWS_TRANSLATION_MAX_OUTPUT_TOKENS` | `4096` | Hard output ceiling per headline chunk; on-demand summaries use a lower internal ceiling. |
| `NEWS_TRANSLATION_MAX_DAILY_REQUESTS` | `30` | Total automatic and on-demand requests reserved per UTC day. |
| `NEWS_TRANSLATION_MAX_AUTOMATIC_DAILY_REQUESTS` | `24` | Automatic subset of the total request allowance. |
| `NEWS_TRANSLATION_MAX_DAILY_CHARACTERS` | `250000` | Total prompt-character reservation ceiling per UTC day. |
| `NEWS_TRANSLATION_MAX_DAILY_TOKEN_UNITS` | `350000` | Conservative prompt-byte plus maximum-output reservation ceiling per UTC day. |
| `NEWS_TRANSLATION_SUMMARY_MAX_WORDS` | `55` | Maximum generated summary length, constrained to 20–100. |
| `NEWS_TRANSLATION_POLL_SECONDS` | `60` | Recovery checks only; durable pacing and budgets determine when a model request is permitted. |

Translation requires the existing `OPENROUTER_API_KEY`, but does not reuse the
general briefing provider/model selection. When the key or free route is
unavailable, source ingestion and original story access continue: automatic
translation reports `disabled`, and on-demand translation returns a temporary
unavailable response rather than calling another model.

## API example

`GET /api/news?display_language=en` returns the original source fields plus the
matching cached presentation fields. A summary is generated only on demand:

```http
POST /api/news/123/translation
Content-Type: application/json

{"target_language":"en"}
```

Both endpoints require an authenticated Claritas session.

### Recovery and observability

Headline translation runs on a one-minute recovery timer independently of
news acquisition. Both paths share a worker lease and process one bounded chunk
per target, preserving the existing daily free-only budget and on-demand reserve.
Automatic work is limited to accepted canonical reporting from the last 48 hours;
opening a historical story can still request its translation. Availability is
reported without exposing credentials, raw provider responses or account details.
Failed acquisition
and release runs that skip translation no longer suppress the recovery path.
The read-only runtime diagnostic workflow reports key presence (never the key),
model, targets, cache freshness and UTC-day usage. A configured worker still
requires an available free provider and an unexhausted budget.

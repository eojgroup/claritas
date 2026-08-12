# Lightweight news translation

Claritas keeps publisher content as immutable source evidence and stores AI
presentation text separately. The current interface language is English, but
translations are keyed by a normalized BCP 47 target language so another
interface language can be added without rewriting source records.

## Data flow

1. News ingestion stores the publisher headline, available source excerpt and
   `language_code` on `item` without modification.
2. At the end of a successful news run, Claritas selects headlines whose source
   language differs from each configured target language. It sends only bounded
   headline chunks to a dedicated, free-only OpenRouter client.
3. `item_translation` stores the translated headline, source hashes and model
   provenance. A source change invalidates the cached presentation text.
4. The news API returns both the original fields and separate
   `translated_title`, `ai_summary` and `translation` fields.
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
per reservation; the bounded orchestration loop owns all retries.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEWS_TRANSLATION_ENABLED` | `true` | Enables automatic headline batches after news ingestion. |
| `NEWS_TRANSLATION_TARGET_LANGUAGES` | `en` | Comma-separated normalized BCP 47 target languages. |
| `NEWS_TRANSLATION_BATCH_SIZE` | `100` | Candidate window per ingestion run, capped at 100. This is split into the smaller chunks below. |
| `NEWS_TRANSLATION_MODEL` | `openrouter/free` | Dedicated model route. Only this value or an explicit `:free` model is accepted. |
| `NEWS_TRANSLATION_CHUNK_SIZE` | `12` | Maximum items in one independently budgeted provider request, constrained to 1–25. |
| `NEWS_TRANSLATION_MAX_CHUNK_SOURCE_CHARACTERS` | `4500` | Maximum bounded source characters in one chunk. |
| `NEWS_TRANSLATION_MAX_RETRIES` | `1` | Retry rounds for only omitted/failed candidates; each round requires a new reservation. |
| `NEWS_TRANSLATION_MAX_OUTPUT_TOKENS` | `2048` | Hard output ceiling per headline chunk; on-demand summaries use a lower internal ceiling. |
| `NEWS_TRANSLATION_MAX_DAILY_REQUESTS` | `30` | Total automatic and on-demand requests reserved per UTC day. |
| `NEWS_TRANSLATION_MAX_AUTOMATIC_DAILY_REQUESTS` | `24` | Automatic subset of the total request allowance. |
| `NEWS_TRANSLATION_MAX_DAILY_CHARACTERS` | `250000` | Total prompt-character reservation ceiling per UTC day. |
| `NEWS_TRANSLATION_MAX_DAILY_TOKEN_UNITS` | `350000` | Conservative prompt-byte plus maximum-output reservation ceiling per UTC day. |
| `NEWS_TRANSLATION_SUMMARY_MAX_WORDS` | `55` | Maximum generated summary length, constrained to 20–100. |

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

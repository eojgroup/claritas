# Lightweight news translation

Claritas keeps publisher content as immutable source evidence and stores AI
presentation text separately. The current interface language is English, but
translations are keyed by a normalized BCP 47 target language so another
interface language can be added without rewriting source records.

## Data flow

1. News ingestion stores the publisher headline, available source excerpt and
   `language_code` on `item` without modification.
2. At the end of a successful news run, Claritas batches headlines whose source
   language differs from each configured target language. Only the headline is
   sent to the configured briefing LLM.
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

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEWS_TRANSLATION_ENABLED` | `true` | Enables automatic headline batches after news ingestion. |
| `NEWS_TRANSLATION_TARGET_LANGUAGES` | `en` | Comma-separated normalized BCP 47 target languages. |
| `NEWS_TRANSLATION_BATCH_SIZE` | `48` | Headlines processed per ingestion run, capped at 100. |
| `NEWS_TRANSLATION_SUMMARY_MAX_WORDS` | `55` | Maximum generated summary length, constrained to 20–100. |

No new API key is required. Translation reuses the internal LLM configuration
documented in [daily-briefing-opencode.md](daily-briefing-opencode.md). When that
optional enrichment is unavailable, source ingestion and original story access
continue to work and the translation step is visible as failed in ingestion
run diagnostics.

## API example

`GET /api/news?display_language=en` returns the original source fields plus the
matching cached presentation fields. A summary is generated only on demand:

```http
POST /api/news/123/translation
Content-Type: application/json

{"target_language":"en"}
```

Both endpoints require an authenticated Claritas session.

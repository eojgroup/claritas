# Daily Briefing Generation with OpenCode

Claritas generates daily briefings by collecting News, Markets, and Weather evidence from its own database, sending that bounded context to an LLM backend, validating structured JSON, and saving the result in `daily_signal_briefing`.

The API is provider-neutral internally, with an OpenCode adapter as the first runtime backend.

## Runtime Flow

```text
POST /api/ingest/briefings/daily/:date/generate
  -> collect item, market_snapshot, weather_snapshot context
  -> call opencode server
  -> parse structured JSON
  -> upsert daily_signal_briefing
  -> dashboard reads /api/briefings/daily/latest
```

## Claritas API Configuration

Set these environment variables on `apps/api`:

```bash
BRIEFING_LLM_PROVIDER=opencode
OPENCODE_SERVER_URL=http://127.0.0.1:4096
OPENCODE_MODEL=ollama/qwen2.5:7b-instruct
OPENCODE_SERVER_USERNAME=opencode
OPENCODE_SERVER_PASSWORD=replace-with-a-local-secret
```

You can also split the model into separate fields:

```bash
OPENCODE_PROVIDER_ID=ollama
OPENCODE_MODEL_ID=qwen2.5:7b-instruct
```

`OPENCODE_MODEL` takes the form `provider-id/model-id`. Use the provider/model IDs shown by OpenCode's `/models` command.

## Local OpenCode Setup

Install OpenCode:

```bash
npm install -g opencode-ai
```

Configure a provider:

```text
/connect
/models
```

For a local-first setup, run a local model provider such as Ollama or LM Studio, configure it in OpenCode, and select the model with `/models`.

Start the OpenCode HTTP server:

```bash
OPENCODE_SERVER_PASSWORD=replace-with-a-local-secret \
  opencode serve --hostname 127.0.0.1 --port 4096
```

Start the Claritas API with matching env vars. Then trigger generation:

```bash
curl -X POST "http://localhost:8080/api/ingest/briefings/daily/$(date -u +%F)/generate" \
  -H "content-type: application/json" \
  -H "x-ingest-token: $INGEST_API_TOKEN" \
  -d '{
    "publish": true,
    "lookback_hours": 24,
    "instructions": "Prioritize globally material changes and be explicit when source data is thin."
  }'
```

Admin users can also trigger:

```text
POST /api/admin/briefings/daily/:date/generate
```

The latest published result remains available at:

```text
GET /api/briefings/daily/latest
```

## Kubernetes Setup

The API deployment reads optional config from `claritas-config` and `claritas-opencode`.

The main GKE deploy workflow maps these GitHub repository secrets into those Kubernetes objects when present:

```text
BRIEFING_LLM_PROVIDER
OPENCODE_SERVER_URL
OPENCODE_MODEL
OPENCODE_PROVIDER_ID
OPENCODE_MODEL_ID
OPENCODE_SERVER_USERNAME
OPENCODE_SERVER_PASSWORD
```

Create or patch config:

```bash
kubectl -n claritas create configmap claritas-config \
  --from-literal=BRIEFING_LLM_PROVIDER=opencode \
  --from-literal=OPENCODE_SERVER_URL=http://opencode:4096 \
  --from-literal=OPENCODE_MODEL=ollama/qwen2.5:7b-instruct \
  --dry-run=client -o yaml | kubectl apply -f -
```

Create the OpenCode server auth secret:

```bash
kubectl -n claritas create secret generic claritas-opencode \
  --from-literal=OPENCODE_SERVER_USERNAME=opencode \
  --from-literal=OPENCODE_SERVER_PASSWORD=replace-with-a-cluster-secret \
  --dry-run=client -o yaml | kubectl apply -f -
```

Run OpenCode as an internal service or sidecar and point `OPENCODE_SERVER_URL` at it. Keep it off the public ingress; Claritas should be the only service calling it.

## Request Body

```json
{
  "publish": true,
  "status": "published",
  "lookback_hours": 24,
  "max_news_items": 36,
  "max_market_items": 24,
  "max_weather_items": 24,
  "instructions": "Optional admin-only editorial direction."
}
```

`publish` is a convenience boolean. `status` can be `draft` or `published`. If both are supplied, `publish` wins.

## Safety Boundaries

- The browser never calls OpenCode directly.
- The model only receives bounded Claritas source data, not direct DB credentials.
- The prompt instructs the model not to invent facts and not to provide investment advice.
- The API validates the generated JSON before saving it.
- OpenCode should be protected with `OPENCODE_SERVER_PASSWORD` and should not be exposed publicly.

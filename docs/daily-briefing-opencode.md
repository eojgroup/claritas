# Daily Briefing Generation with OpenCode

Claritas generates daily briefings by collecting news, markets, weather, podcast, leadership-reference, and transport evidence from its own data layer, sending that bounded context to an LLM backend, validating structured JSON, and saving the result in `daily_signal_briefing`.

The API is provider-neutral internally, with an OpenCode adapter as the first runtime backend.

## Runtime Flow

```text
POST /api/ingest/briefings/daily/:date/generate
  -> collect bounded cross-domain context
  -> add country-linked transport activity and 24h movement comparisons
  -> call opencode server
  -> parse structured JSON
  -> upsert daily_signal_briefing
  -> dashboard reads /api/briefings/daily/latest
```

Transport context includes current and previous 24-hour values, country aggregates, leading
routes, monitored-port transitions, and generated takeaways. The prompt requires the model to
describe AIS cargo/tanker departures as a vessel-movement proxy—not cargo tonnage, load, or trade
value—and to qualify flight totals by the configured ADS-B polling coverage.

Leadership records are reference context, not a briefing category or standalone signal. The prompt permits a leadership change only when a supplied news item directly reports it, and requires that change to remain within the news update. A current officeholder, government type, or changed Wikidata record is not itself evidence that a leadership transition occurred.

## Claritas API Configuration

Set these environment variables on `apps/api`:

```bash
BRIEFING_LLM_PROVIDER=opencode
OPENCODE_SERVER_URL=http://127.0.0.1:4096
OPENCODE_MODEL=ollama/qwen2.5:7b-instruct
OPENCODE_SERVER_USERNAME=opencode
OPENCODE_SERVER_PASSWORD=replace-with-a-local-secret
OPENCODE_DISABLE_TOOLS=true
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

Daily briefing generation supplies all evidence in the prompt and does not need
OpenCode's coding-agent tools. Disable them so non-tool-capable models and
OpenRouter's free router can serve the request:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": "deny",
  "tools": {
    "*": false,
    "bash": false,
    "edit": false,
    "read": false,
    "write": false
  }
}
```

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
OPENCODE_AUTH_JSON
OPENCODE_CONFIG_JSON
OPENROUTER_API_KEY
OPENAI_API_KEY
ANTHROPIC_API_KEY
GOOGLE_GENERATIVE_AI_API_KEY
GROQ_API_KEY
XAI_API_KEY
DEEPSEEK_API_KEY
```

The workflow also builds and deploys an internal `opencode` Deployment and Service:

```text
opencode.claritas.svc.cluster.local:4096
```

The bundled OpenCode container defaults `OPENCODE_DISABLE_TOOLS=true` and
enforces a dedicated one-step, text-only briefing agent at startup, including
when `OPENCODE_CONFIG_JSON` is supplied. The Claritas API also sends an explicit
disabled-tool map and requests JSON as plain text, because OpenCode's
`json_schema` mode itself requires a tool call. This is intentional: the
service is a briefing summarizer, not a coding agent.

For this default service-based deployment, set:

```bash
OPENCODE_SERVER_URL=http://opencode:4096
```

`127.0.0.1` only works if OpenCode is running as a sidecar in the same pod as `claritas-api`.

OpenCode still needs access to an LLM provider. The most flexible path is `OPENCODE_AUTH_JSON`, for example:

```json
{
  "openrouter": {
    "type": "api",
    "key": "sk-or-your-key"
  }
}
```

For common API-key providers, the deployment can also build `auth.json` from individual provider secrets such as `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY`.

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

## Troubleshooting

`Cannot reach OpenCode at http://opencode:4096/session: fetch failed` means the API pod could not open a network connection to the internal OpenCode service. Check the OpenCode workload first:

```bash
kubectl -n claritas get deploy opencode
kubectl -n claritas get svc opencode
kubectl -n claritas rollout status deploy/opencode
kubectl -n claritas logs deploy/opencode --tail=100
```

If the workload exists and is ready, confirm the API config:

```bash
kubectl -n claritas get configmap claritas-config -o jsonpath='{.data.OPENCODE_SERVER_URL}{"\n"}'
kubectl -n claritas get configmap claritas-config -o jsonpath='{.data.OPENCODE_MODEL}{"\n"}'
kubectl -n claritas get secret claritas-opencode
```

`OPENCODE_SERVER_URL` should be `http://opencode:4096` for the default GKE deployment. `OPENCODE_MODEL` must be a real OpenCode model id, not `provider-id/model-id`, and `claritas-opencode` must include either `OPENCODE_AUTH_JSON` or a provider API key such as `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY`.

An OpenCode response like this usually means the model id is not known to OpenCode:

```json
{"name":"UnknownError","data":{"message":"Unexpected server error. Check server logs for details.","ref":"err_..."}}
```

The matching OpenCode pod log will contain `ProviderModelNotFoundError`. Replace the placeholder model secret with a real provider/model value and redeploy:

```bash
OPENCODE_MODEL=openrouter/openai/gpt-4o-mini
```

To inspect available models from inside the cluster, port-forward the internal service and call OpenCode's provider config endpoint:

```bash
kubectl -n claritas port-forward svc/opencode 4096:4096
curl -u opencode:$OPENCODE_SERVER_PASSWORD http://127.0.0.1:4096/config/providers
```

`OpenCode generation failed: APIError` means OpenCode reached the selected provider, but the provider rejected or failed the generation request. Inspect the OpenCode log first:

```bash
kubectl -n claritas logs deploy/opencode --tail=300 | grep -C 8 -E 'APIError|ERROR|statusCode'
```

`No endpoints found that support tool use. Try disabling "bash"` means OpenCode
offered tools to a model route that only supports text generation. The bundled
deployment fixes this with `OPENCODE_DISABLE_TOOLS=true`, a dedicated briefing
agent, and tool-free JSON-text requests from the Claritas API. Redeploy both
the API and OpenCode service, then verify the effective generated config:

```bash
kubectl -n claritas rollout restart deploy/opencode
kubectl -n claritas rollout status deploy/opencode
kubectl -n claritas exec deploy/opencode -- \
  node -e 'const c=require("/home/opencode/.config/opencode/opencode.json"); console.log({model:c.model, default_agent:c.default_agent, permission:c.permission, tools:c.tools})'
```

The output should show `default_agent: "briefing"`,
`permission: {"*":"deny"}`, and each tool, including `bash`, set to `false`.

Confirm that the OpenRouter key exists in the Kubernetes secret without printing it:

```bash
kubectl -n claritas get secret claritas-opencode -o jsonpath='{.data.OPENROUTER_API_KEY}' | grep -q . \
  && echo "OPENROUTER_API_KEY exists" \
  || echo "OPENROUTER_API_KEY is missing"
```

After adding or changing GitHub secrets, rerun the GKE deployment. Kubernetes does not update environment variables in already-running pods until they restart.

To test the configured OpenRouter key and free router directly from the OpenCode pod, bypassing OpenCode:

```bash
kubectl -n claritas exec deploy/opencode -- node -e '
fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    model: "openrouter/free",
    messages: [{ role: "user", content: "Reply with OK" }],
    max_tokens: 5
  })
}).then(async response => console.log(response.status, await response.text()))
'
```

A `200` response confirms the key and free router work, leaving the OpenCode request as the failing layer. A `401`, `402`, `429`, or other provider response identifies the credential, credit-limit, or rate-limit issue directly.

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

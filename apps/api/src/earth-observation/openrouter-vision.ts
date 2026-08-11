import type { EarthProviderStatus } from "./types";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
export const DEFAULT_EO_VISION_MODEL = "openrouter/free";
export const EO_VISION_PROMPT_VERSION = "eo-vision-v1";

type FetchLike = typeof fetch;

export type VisionInterpretation = {
  summary: string;
  observed_features: string[];
  possible_changes: string[];
  limitations: string[];
  confidence: number;
};

export type VisionInterpretationResponse = {
  interpretation: VisionInterpretation;
  requestedModel: string;
  actualModel: string;
};

export class OpenRouterVisionError extends Error {
  constructor(message: string, public readonly status = 502, public readonly retryable = true) {
    super(message);
    this.name = "OpenRouterVisionError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function finiteZero(value: unknown) {
  if (value === null || typeof value === "undefined" || value === "") return false;
  const number = Number(value);
  return Number.isFinite(number) && number === 0;
}

export function isZeroPricedImageModel(entry: unknown, expectedId: string): boolean {
  const model = asRecord(entry);
  const architecture = asRecord(model?.architecture);
  const pricing = asRecord(model?.pricing);
  const modalities = Array.isArray(architecture?.input_modalities) ? architecture.input_modalities : [];
  const supportedParameters = Array.isArray(model?.supported_parameters) ? model.supported_parameters : [];
  return model?.id === expectedId
    && modalities.includes("image")
    && Boolean(pricing)
    && finiteZero(pricing?.prompt)
    && finiteZero(pricing?.completion)
    && ["request", "image"].every((key) => pricing?.[key] == null || finiteZero(pricing[key]))
    && (supportedParameters.includes("structured_outputs") || supportedParameters.includes("response_format"));
}

export function normalizeVisionDailyLimit(value: string | number | null | undefined) {
  if (value === null || typeof value === "undefined" || value === "") return 10;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 10;
  return Math.min(50, Math.max(0, Math.trunc(parsed)));
}

function boundedString(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string" || !value.trim()) throw new OpenRouterVisionError(`Vision output ${field} is missing or invalid.`, 502, true);
  return value.trim().slice(0, maxLength);
}

function boundedStringArray(value: unknown, field: string) {
  if (!Array.isArray(value)) throw new OpenRouterVisionError(`Vision output ${field} must be an array.`, 502, true);
  return value.slice(0, 8).map((entry) => boundedString(entry, field, 280));
}

export function validateVisionInterpretation(value: unknown): VisionInterpretation {
  const record = asRecord(value);
  if (!record) throw new OpenRouterVisionError("Vision output must be a JSON object.", 502, true);
  const confidence = Number(record.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new OpenRouterVisionError("Vision output confidence must be between zero and one.", 502, true);
  }
  return {
    summary: boundedString(record.summary, "summary", 1_200),
    observed_features: boundedStringArray(record.observed_features, "observed_features"),
    possible_changes: boundedStringArray(record.possible_changes, "possible_changes"),
    limitations: boundedStringArray(record.limitations, "limitations"),
    confidence,
  };
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* try a fenced response */ }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try { return JSON.parse(fenced[1].trim()); } catch { /* handled below */ }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* handled below */ }
  }
  throw new OpenRouterVisionError("Vision provider did not return parseable JSON.", 502, true);
}

function messageText(payload: Record<string, unknown>) {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  for (const choice of choices) {
    const message = asRecord(asRecord(choice)?.message);
    if (typeof message?.content === "string" && message.content.trim()) return message.content;
    if (Array.isArray(message?.content)) {
      const text = message.content.map((part) => asRecord(part)?.text).filter((part): part is string => typeof part === "string").join("\n");
      if (text.trim()) return text;
    }
  }
  throw new OpenRouterVisionError("Vision provider returned no message content.", 502, true);
}

function requestPrompt(context: Record<string, unknown>) {
  return [
    "Interpret this Earth-observation image as contextual evidence for an intelligence event.",
    "Describe only visible physical features. Do not infer cause, intent, casualties, ownership, or damage that the pixels cannot establish.",
    "Treat apparent differences as possibilities unless a comparable before image is supplied. State cloud, resolution, acquisition, and sensor limitations.",
    `Context: ${JSON.stringify(context)}`,
    `Return one JSON object matching: ${JSON.stringify({
      summary: "string",
      observed_features: ["string"],
      possible_changes: ["string"],
      limitations: ["string"],
      confidence: "number from 0 to 1",
    })}`,
  ].join("\n");
}

async function fetchWithTimeout(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs: number) {
  return fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

export class OpenRouterVisionClient {
  private modelValidatedAt = 0;

  constructor(
    private readonly apiKey = process.env.OPENROUTER_API_KEY?.trim() ?? "",
    readonly model = process.env.EO_VISION_MODEL?.trim() || DEFAULT_EO_VISION_MODEL,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  status(): EarthProviderStatus {
    const enabled = process.env.EARTH_OBSERVATION_ENABLED?.toLowerCase() === "true"
      && process.env.EO_VISION_ENRICHMENT_ENABLED?.toLowerCase() === "true";
    const configured = Boolean(this.apiKey);
    return {
      provider: "openrouter_vision",
      enabled,
      configured,
      state: !enabled ? "disabled" : !configured ? "not_configured" : "ready",
      reason: !enabled ? "Feature flag disabled." : !configured ? "OPENROUTER_API_KEY is not configured." : undefined,
      attribution: `Model interpretation via OpenRouter (${this.model}); satellite pixels retain their underlying provider attribution.`,
    };
  }

  private async assertFreeImageModel() {
    if (this.modelValidatedAt > Date.now() - 3_600_000) return;
    if (this.model === DEFAULT_EO_VISION_MODEL) {
      this.modelValidatedAt = Date.now();
      return;
    }
    if (!this.apiKey) throw new OpenRouterVisionError("OPENROUTER_API_KEY is not configured.", 503, false);
    const response = await fetchWithTimeout(this.fetchImpl, OPENROUTER_MODELS_URL, {
      headers: { authorization: `Bearer ${this.apiKey}`, accept: "application/json" },
    }, 15_000);
    if (!response.ok) throw new OpenRouterVisionError(`OpenRouter model catalog returned HTTP ${response.status}.`, response.status, response.status >= 500 || response.status === 429);
    const payload = asRecord(await response.json());
    const models = Array.isArray(payload?.data) ? payload.data : [];
    const model = models.find((entry) => asRecord(entry)?.id === this.model);
    if (!isZeroPricedImageModel(model, this.model)) {
      throw new OpenRouterVisionError(`EO vision model ${this.model} is not an exact zero-priced image-input model.`, 400, false);
    }
    this.modelValidatedAt = Date.now();
  }

  async interpret(input: {
    image: Buffer;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
    context: Record<string, unknown>;
  }): Promise<VisionInterpretationResponse> {
    if (!this.apiKey) throw new OpenRouterVisionError("OPENROUTER_API_KEY is not configured.", 503, false);
    if (!input.image.length) throw new OpenRouterVisionError("EO vision image is empty.", 400, false);
    await this.assertFreeImageModel();
    const response = await fetchWithTimeout(this.fetchImpl, OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        "http-referer": "https://app.claritas.info",
        "x-title": "Claritas Earth Observation",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: requestPrompt(input.context) },
            { type: "image_url", image_url: { url: `data:${input.mimeType};base64,${input.image.toString("base64")}` } },
          ],
        }],
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "earth_observation_interpretation",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["summary", "observed_features", "possible_changes", "limitations", "confidence"],
              properties: {
                summary: { type: "string" },
                observed_features: { type: "array", items: { type: "string" } },
                possible_changes: { type: "array", items: { type: "string" } },
                limitations: { type: "array", items: { type: "string" } },
                confidence: { type: "number", minimum: 0, maximum: 1 },
              },
            },
          },
        },
        usage: { include: true },
      }),
    }, 45_000);
    const body = await response.text();
    if (!response.ok) {
      throw new OpenRouterVisionError(`OpenRouter vision returned HTTP ${response.status}: ${body.slice(0, 300)}`, response.status, response.status >= 500 || response.status === 429);
    }
    let payload: Record<string, unknown> | null = null;
    try { payload = asRecord(JSON.parse(body)); } catch { /* handled below */ }
    if (!payload) throw new OpenRouterVisionError("OpenRouter vision returned a non-JSON response.", 502, true);
    const usage = asRecord(payload.usage);
    if (!usage || !finiteZero(usage.cost)) {
      throw new OpenRouterVisionError("OpenRouter did not prove a zero charge for the free-only EO vision request.", 502, false);
    }
    const actualModel = typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : "";
    if (!actualModel) throw new OpenRouterVisionError("OpenRouter vision response omitted the routed model.", 502, true);
    if (this.model !== DEFAULT_EO_VISION_MODEL && actualModel !== this.model) {
      throw new OpenRouterVisionError(`OpenRouter routed exact EO vision request to unexpected model ${actualModel}.`, 502, false);
    }
    return {
      interpretation: validateVisionInterpretation(parseJsonObject(messageText(payload))),
      requestedModel: this.model,
      actualModel,
    };
  }
}

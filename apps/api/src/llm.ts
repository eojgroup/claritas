export type LlmStructuredRequest = {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  title?: string;
  retryCount?: number;
  maxOutputTokens?: number;
};

export type LlmStructuredResponse<T> = {
  output: T;
  provider: string;
  model: string | null;
  metadata: Record<string, unknown>;
};

export interface LlmClient {
  generateStructured<T>(request: LlmStructuredRequest): Promise<LlmStructuredResponse<T>>;
}

export type LlmConnectionCheck = {
  provider: string;
  reachable: boolean;
  model: string | null;
  latency_ms: number;
  metadata: Record<string, unknown>;
};

export class LlmConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmConfigurationError";
  }
}

export class LlmProviderError extends Error {
  status: number;
  responseBody: string | null;

  constructor(message: string, status = 502, responseBody: string | null = null) {
    super(message);
    this.name = "LlmProviderError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

type OpenCodeModelConfig = {
  providerID: string | null;
  modelID: string | null;
  label: string | null;
};

type OpenCodeClientConfig = OpenCodeModelConfig & {
  baseUrl: string;
  username: string;
  password: string | null;
  toolsDisabled: boolean;
  openRouterApiKey: string | null;
  sessionTimeoutMs: number;
  messageTimeoutMs: number;
  openRouterTimeoutMs: number;
};

const OPENCODE_TOOL_NAMES = [
  "*",
  "StructuredOutput",
  "apply_patch",
  "bash",
  "edit",
  "glob",
  "grep",
  "invalid",
  "list",
  "lsp",
  "plan_enter",
  "plan_exit",
  "question",
  "read",
  "skill",
  "task",
  "todowrite",
  "webfetch",
  "websearch",
  "write",
] as const;

const OPENCODE_GENERATION_TRANSPORT_ATTEMPTS = 2;
const DEFAULT_OPENCODE_SESSION_TIMEOUT_MS = 8_000;
const DEFAULT_OPENCODE_MESSAGE_TIMEOUT_MS = 12_000;
const DEFAULT_OPENROUTER_TIMEOUT_MS = 45_000;

type FreeOpenRouterClientConfig = {
  apiKey: string;
  model: string;
  timeoutMs: number;
  applicationTitle: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function joinUrl(baseUrl: string, path: string): string {
  return `${normalizeBaseUrl(baseUrl)}${path.startsWith("/") ? path : `/${path}`}`;
}

function getOptionalEnv(name: string): string | null {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getBooleanEnv(name: string, fallback: boolean): boolean {
  const value = getOptionalEnv(name);
  if (!value) return fallback;
  return !["0", "false", "no", "off"].includes(value.toLowerCase());
}

function getIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const value = getOptionalEnv(name);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

/**
 * OpenRouter guarantees zero-cost routing only for its free router or an
 * explicitly suffixed free model variant. Keep this intentionally narrow: an
 * ordinary model slug must never become eligible because its current price
 * happens to be zero or because a shared LLM configuration uses it.
 */
export function isFreeOpenRouterModel(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const model = value.trim().toLowerCase();
  if (model === "openrouter/free") return true;
  return /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._\-/:]*:free$/.test(model);
}

/**
 * A free-labelled route is necessary but not sufficient: OpenRouter's response
 * must also account for the request with an explicit zero cost. Missing,
 * malformed, negative, or non-zero cost is treated as a policy failure so an
 * optional enrichment can never silently cross into paid inference.
 */
export function assertFreeOpenRouterResponseCost(usage: unknown): 0 {
  const cost = asRecord(usage)?.cost;
  if (typeof cost !== "number" || !Number.isFinite(cost)) {
    throw new LlmProviderError(
      "Free OpenRouter response did not include an unambiguous numeric usage.cost; output was rejected.",
      402,
    );
  }
  if (cost !== 0) {
    throw new LlmProviderError(
      `Free OpenRouter response reported non-zero usage.cost (${cost}); output was rejected.`,
      402,
    );
  }
  return 0;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function parseOpenCodeModel(): OpenCodeModelConfig {
  const combined = getOptionalEnv("OPENCODE_MODEL") || getOptionalEnv("LLM_MODEL");
  const explicitProvider = getOptionalEnv("OPENCODE_PROVIDER_ID");
  const explicitModel = getOptionalEnv("OPENCODE_MODEL_ID");

  if (explicitProvider || explicitModel) {
    return {
      providerID: explicitProvider,
      modelID: explicitModel,
      label: explicitProvider && explicitModel ? `${explicitProvider}/${explicitModel}` : explicitModel || explicitProvider,
    };
  }

  if (!combined) {
    return { providerID: null, modelID: null, label: null };
  }

  const slashIndex = combined.indexOf("/");
  if (slashIndex > 0 && slashIndex < combined.length - 1) {
    return {
      providerID: combined.slice(0, slashIndex),
      modelID: combined.slice(slashIndex + 1),
      label: combined,
    };
  }

  return { providerID: null, modelID: combined, label: combined };
}

function buildOpenCodeConfig(): OpenCodeClientConfig {
  const baseUrl = getOptionalEnv("OPENCODE_SERVER_URL");
  if (!baseUrl) {
    throw new LlmConfigurationError(
      "BRIEFING_LLM_PROVIDER=opencode requires OPENCODE_SERVER_URL, for example http://127.0.0.1:4096."
    );
  }
  const model = parseOpenCodeModel();
  if (model.providerID === "provider-id" || model.modelID === "model-id" || model.label === "provider-id/model-id") {
    throw new LlmConfigurationError(
      "OPENCODE_MODEL is still set to the placeholder provider-id/model-id. Replace it with a real OpenCode provider/model id."
    );
  }
  return {
    baseUrl,
    username: getOptionalEnv("OPENCODE_SERVER_USERNAME") || "opencode",
    password: getOptionalEnv("OPENCODE_SERVER_PASSWORD"),
    toolsDisabled: getBooleanEnv("OPENCODE_DISABLE_TOOLS", true),
    openRouterApiKey: getOptionalEnv("OPENROUTER_API_KEY"),
    sessionTimeoutMs: getIntegerEnv("OPENCODE_SESSION_TIMEOUT_MS", DEFAULT_OPENCODE_SESSION_TIMEOUT_MS, 1_000, 60_000),
    messageTimeoutMs: getIntegerEnv("OPENCODE_MESSAGE_TIMEOUT_MS", DEFAULT_OPENCODE_MESSAGE_TIMEOUT_MS, 3_000, 120_000),
    openRouterTimeoutMs: getIntegerEnv("OPENROUTER_TIMEOUT_MS", DEFAULT_OPENROUTER_TIMEOUT_MS, 5_000, 180_000),
    ...model,
  };
}

function buildJsonTextPrompt(request: LlmStructuredRequest, retry = false): string {
  return [
    request.prompt,
    "",
    retry ? "The previous response was not valid JSON. Correct it and return a complete replacement." : "",
    "Return one valid JSON object only. Do not wrap it in Markdown or call tools.",
    `The JSON object must match this JSON Schema: ${JSON.stringify(request.schema)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildDisabledToolMap(): Record<string, false> {
  return Object.fromEntries(OPENCODE_TOOL_NAMES.map((name) => [name, false]));
}

async function readResponseBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseJsonObjectFromText(text: string): unknown {
  const direct = tryParseJson(text);
  if (direct !== undefined) return direct;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const parsed = tryParseJson(fenced[1].trim());
    if (parsed !== undefined) return parsed;
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const parsed = tryParseJson(text.slice(firstBrace, lastBrace + 1));
    if (parsed !== undefined) return parsed;
  }

  throw new LlmProviderError("OpenCode response did not contain parseable JSON output.");
}

function collectText(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") return output;
  const record = asRecord(value);
  if (record) {
    if (typeof record.text === "string") output.push(record.text);
    if (typeof record.content === "string") output.push(record.content);
    for (const child of Object.values(record)) collectText(child, output);
  } else if (Array.isArray(value)) {
    for (const child of value) collectText(child, output);
  }
  return output;
}

function findStructuredOutput(value: unknown): unknown {
  const record = asRecord(value);
  if (record) {
    if (Object.prototype.hasOwnProperty.call(record, "structured_output")) {
      return record.structured_output;
    }
    if (Object.prototype.hasOwnProperty.call(record, "structuredOutput")) {
      return record.structuredOutput;
    }
    for (const child of Object.values(record)) {
      const found = findStructuredOutput(child);
      if (typeof found !== "undefined") return found;
    }
  } else if (Array.isArray(value)) {
    for (const child of value) {
      const found = findStructuredOutput(child);
      if (typeof found !== "undefined") return found;
    }
  }
  return undefined;
}

function findSessionId(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return null;
  for (const key of ["id", "sessionID", "sessionId", "session_id"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  for (const child of Object.values(record)) {
    const candidate = findSessionId(child);
    if (candidate) return candidate;
  }
  return null;
}

function findMessage(value: unknown): string | null {
  const record = asRecord(value);
  if (record) {
    if (typeof record.message === "string" && record.message.trim()) return record.message.trim();
    for (const child of Object.values(record)) {
      const message = findMessage(child);
      if (message) return message;
    }
  } else if (Array.isArray(value)) {
    for (const child of value) {
      const message = findMessage(child);
      if (message) return message;
    }
  }
  return null;
}

function describeProviderError(error: Record<string, unknown>): string {
  const data = asRecord(error.data);
  const name = typeof error.name === "string" && error.name.trim() ? error.name.trim() : "provider error";
  const statusValue = data?.statusCode ?? data?.status ?? error.statusCode ?? error.status;
  const status =
    typeof statusValue === "number" || (typeof statusValue === "string" && statusValue.trim())
      ? ` (${String(statusValue).trim()})`
      : "";
  let message = findMessage(error);

  if (data && typeof data.responseBody === "string") {
    const responseBody = data.responseBody.trim();
    const responseMessage = findMessage(tryParseJson(responseBody));
    if (responseMessage && responseMessage !== message) {
      message = message ? `${message}; provider response: ${responseMessage}` : responseMessage;
    }
  }

  return message ? `${name}${status}: ${message}` : `${name}${status}`;
}

function findProviderError(value: unknown): string | null {
  const record = asRecord(value);
  if (record) {
    const error = asRecord(record.error);
    if (error) return describeProviderError(error);
    for (const child of Object.values(record)) {
      const providerError = findProviderError(child);
      if (providerError) return providerError;
    }
  } else if (Array.isArray(value)) {
    for (const child of value) {
      const providerError = findProviderError(child);
      if (providerError) return providerError;
    }
  }
  return null;
}

function collectOpenRouterMessageContent(value: unknown): string {
  const record = asRecord(value);
  const choices = Array.isArray(record?.choices) ? record.choices : [];
  const content = choices
    .map((choice) => {
      const choiceRecord = asRecord(choice);
      const message = asRecord(choiceRecord?.message);
      const contentValue = message?.content;
      if (typeof contentValue === "string") return contentValue;
      if (Array.isArray(contentValue)) {
        return contentValue
          .map((part) => {
            const partRecord = asRecord(part);
            return typeof partRecord?.text === "string" ? partRecord.text : "";
          })
          .filter(Boolean)
          .join("\n");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");

  if (!content.trim()) {
    throw new LlmProviderError("OpenRouter fallback returned no message content.", 502, JSON.stringify(value) || null);
  }
  return content.trim();
}

function addOpenCodeErrorGuidance(providerError: string): string {
  if (/no endpoints found that support tool use/i.test(providerError)) {
    return [
      providerError,
      "Claritas daily briefings do not require tools.",
      "Redeploy both claritas-api and the bundled OpenCode service with OPENCODE_DISABLE_TOOLS=true.",
      "The current API uses tool-free JSON-text generation for models that do not support tool calling.",
    ].join(" ");
  }
  return providerError;
}

function isOpenCodeTransportError(error: unknown): error is LlmProviderError {
  return (
    error instanceof LlmProviderError &&
    error.status === 502 &&
    error.responseBody === null &&
    /^Cannot reach OpenCode at /.test(error.message)
  );
}

function getOpenRouterFallbackModel(config: OpenCodeClientConfig): string | null {
  if (config.providerID !== "openrouter") return null;
  if (!config.modelID) return config.label;
  if (config.modelID === "free") return "openrouter/free";
  return config.modelID;
}

function describeOpenRouterFallbackAvailability(config: OpenCodeClientConfig): string {
  if (config.providerID !== "openrouter") {
    return `OpenRouter fallback is unavailable because OPENCODE_MODEL uses provider ${config.providerID || "unknown"}.`;
  }
  if (!getOpenRouterFallbackModel(config)) {
    return "OpenRouter fallback is unavailable because OPENCODE_MODEL does not include a model id.";
  }
  if (!config.openRouterApiKey) {
    return "OpenRouter fallback is unavailable because OPENROUTER_API_KEY is not configured in the API deployment.";
  }
  return "OpenRouter fallback is available.";
}

export class OpenCodeLlmClient implements LlmClient {
  private readonly config: OpenCodeClientConfig;

  constructor(config = buildOpenCodeConfig()) {
    this.config = config;
  }

  async generateStructured<T>(request: LlmStructuredRequest): Promise<LlmStructuredResponse<T>> {
    const body: Record<string, unknown> = { system: request.system };

    if (this.config.toolsDisabled) {
      // OpenCode's json_schema format is implemented as a required
      // StructuredOutput tool. Tool-free models must receive plain text JSON
      // instructions and an explicit disabled-tool map instead.
      body.tools = buildDisabledToolMap();
    } else {
      body.format = {
        type: "json_schema",
        schema: request.schema,
        retryCount: request.retryCount ?? 2,
      };
    }

    if (this.config.providerID && this.config.modelID) {
      body.model = {
        providerID: this.config.providerID,
        modelID: this.config.modelID,
      };
    }

    const maxAttempts = this.config.toolsDisabled ? Math.min(Math.max((request.retryCount ?? 2) + 1, 1), 3) : 1;
    let lastParseError: LlmProviderError | null = null;
    let lastTransportError: LlmProviderError | null = null;

    generationAttempts: for (
      let generationAttempt = 1;
      generationAttempt <= OPENCODE_GENERATION_TRANSPORT_ATTEMPTS;
      generationAttempt += 1
    ) {
      let sessionId: string;
      try {
        sessionId = await this.createSession(request.title || "Claritas daily briefing generation");
      } catch (error) {
        if (isOpenCodeTransportError(error)) {
          lastTransportError = error;
          if (generationAttempt < OPENCODE_GENERATION_TRANSPORT_ATTEMPTS) continue generationAttempts;
          break generationAttempts;
        }
        throw error;
      }

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        body.parts = [
          {
            type: "text",
            text: this.config.toolsDisabled ? buildJsonTextPrompt(request, attempt > 1) : request.prompt,
          },
        ];

        let message: unknown;
        try {
          message = await this.requestJson(`/session/${encodeURIComponent(sessionId)}/message`, {
            method: "POST",
            body: JSON.stringify(body),
          });
        } catch (error) {
          if (isOpenCodeTransportError(error)) {
            lastTransportError = error;
            if (generationAttempt < OPENCODE_GENERATION_TRANSPORT_ATTEMPTS) continue generationAttempts;
            break generationAttempts;
          }
          throw error;
        }

        const providerError = findProviderError(message);
        if (providerError) {
          throw new LlmProviderError(`OpenCode generation failed: ${addOpenCodeErrorGuidance(providerError)}`);
        }

        try {
          const structured = findStructuredOutput(message);
          const output =
            typeof structured === "undefined"
              ? parseJsonObjectFromText(collectText(message).join("\n").trim())
              : structured;

          return {
            output: output as T,
            provider: "opencode",
            model: this.config.label,
            metadata: {
              session_id: sessionId,
              server_url: this.config.baseUrl,
              provider_id: this.config.providerID,
              model_id: this.config.modelID,
              tools_disabled: this.config.toolsDisabled,
              structured_output_mode: this.config.toolsDisabled ? "json_text" : "json_schema_tool",
              attempts: attempt,
              transport_attempts: generationAttempt,
            },
          };
        } catch (error) {
          if (!(error instanceof LlmProviderError) || attempt === maxAttempts) throw error;
          lastParseError = error;
        }
      }
    }

    if (lastTransportError) {
      return await this.generateViaOpenRouterFallback<T>(request, lastTransportError);
    }

    throw lastParseError || new LlmProviderError("OpenCode did not return parseable JSON output.");
  }

  async checkConnection(): Promise<LlmConnectionCheck> {
    const startedAt = Date.now();
    const sessionId = await this.createSession("Claritas OpenCode service check");

    return {
      provider: "opencode",
      reachable: true,
      model: this.config.label,
      latency_ms: Date.now() - startedAt,
      metadata: {
        session_id: sessionId,
        server_url: this.config.baseUrl,
        provider_id: this.config.providerID,
        model_id: this.config.modelID,
        tools_disabled: this.config.toolsDisabled,
        check_mode: "opencode_session",
        provider_generation_tested: false,
      },
    };
  }

  private async createSession(title: string): Promise<string> {
    const session = await this.requestJson(
      "/session",
      {
        method: "POST",
        body: JSON.stringify({ title }),
      },
      this.config.sessionTimeoutMs
    );
    const sessionId = findSessionId(session);
    if (!sessionId) {
      throw new LlmProviderError("OpenCode did not return a session id.");
    }
    return sessionId;
  }

  private async generateViaOpenRouterFallback<T>(
    request: LlmStructuredRequest,
    openCodeError: LlmProviderError
  ): Promise<LlmStructuredResponse<T>> {
    const model = getOpenRouterFallbackModel(this.config);
    if (!model || !this.config.openRouterApiKey) {
      throw new LlmProviderError(
        `${openCodeError.message}. ${describeOpenRouterFallbackAvailability(this.config)}`,
        openCodeError.status,
        openCodeError.responseBody
      );
    }

    const maxAttempts = Math.min(Math.max((request.retryCount ?? 2) + 1, 1), 3);
    let lastParseError: LlmProviderError | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetchWithTimeout(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${this.config.openRouterApiKey}`,
              "content-type": "application/json",
              "http-referer": "https://app.claritas.info",
              "x-title": "Claritas Daily Briefing",
            },
            body: JSON.stringify({
              model,
              messages: [
                { role: "system", content: request.system },
                { role: "user", content: buildJsonTextPrompt(request, attempt > 1) },
              ],
              temperature: 0.2,
            }),
          },
          this.config.openRouterTimeoutMs
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new LlmProviderError(`OpenCode transport failed, and OpenRouter fallback was unreachable: ${message}`, 502);
      }

      const body = await readResponseBody(response);
      if (!response.ok) {
        const message = findMessage(tryParseJson(body)) || body || response.statusText;
        throw new LlmProviderError(
          `OpenCode transport failed, and OpenRouter fallback failed with HTTP ${response.status}: ${message}`,
          502,
          body || null
        );
      }

      try {
        const parsed = tryParseJson(body);
        if (typeof parsed === "undefined") {
          throw new LlmProviderError("OpenRouter fallback returned a non-JSON response.", 502, body || null);
        }
        const content = collectOpenRouterMessageContent(parsed);
        return {
          output: parseJsonObjectFromText(content) as T,
          provider: "openrouter",
          model,
          metadata: {
            fallback_from_provider: "opencode",
            fallback_reason: openCodeError.message,
            structured_output_mode: "json_text",
            attempts: attempt,
            opencode_model: this.config.label,
          },
        };
      } catch (error) {
        if (!(error instanceof LlmProviderError) || attempt === maxAttempts) throw error;
        lastParseError = error;
      }
    }

    throw lastParseError || new LlmProviderError("OpenRouter fallback did not return parseable JSON output.");
  }

  private async requestJson(path: string, init: RequestInit, timeoutMs: number = this.config.messageTimeoutMs): Promise<unknown> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.config.password) {
      headers.authorization = `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64")}`;
    }

    const url = joinUrl(this.config.baseUrl, path);
    let response: Response;
    try {
      response = await fetchWithTimeout(url, {
        ...init,
        headers: {
          ...headers,
          ...(init.headers || {}),
        },
      }, timeoutMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new LlmProviderError(`Cannot reach OpenCode at ${url}: ${message}`, 502);
    }

    const body = await readResponseBody(response);
    if (!response.ok) {
      throw new LlmProviderError(`OpenCode HTTP ${response.status}: ${body || response.statusText}`, 502, body || null);
    }
    if (!body) return {};

    const parsed = tryParseJson(body);
    if (typeof parsed === "undefined") {
      throw new LlmProviderError("OpenCode returned a non-JSON response.", 502, body);
    }
    return parsed;
  }
}

/**
 * A deliberately small OpenRouter client used by optional features whose cost
 * policy is stricter than the application's general briefing LLM. It can only
 * be constructed with OpenRouter's free router or an explicit `:free` model.
 */
export class FreeOpenRouterLlmClient implements LlmClient {
  private readonly config: FreeOpenRouterClientConfig;

  constructor(config: FreeOpenRouterClientConfig) {
    if (!isFreeOpenRouterModel(config.model)) {
      throw new LlmConfigurationError(
        "Free OpenRouter client requires model openrouter/free or an explicit :free variant.",
      );
    }
    this.config = {
      ...config,
      model: config.model.trim().toLowerCase(),
    };
  }

  async generateStructured<T>(request: LlmStructuredRequest): Promise<LlmStructuredResponse<T>> {
    const maxAttempts = Math.min(Math.max((request.retryCount ?? 1) + 1, 1), 3);
    const maxOutputTokens = Math.min(Math.max(request.maxOutputTokens ?? 2_048, 128), 8_192);
    let lastParseError: LlmProviderError | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetchWithTimeout(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${this.config.apiKey}`,
              "content-type": "application/json",
              "http-referer": "https://app.claritas.info",
              "x-title": this.config.applicationTitle,
            },
            body: JSON.stringify({
              model: this.config.model,
              messages: [
                { role: "system", content: request.system },
                { role: "user", content: buildJsonTextPrompt(request, attempt > 1) },
              ],
              max_tokens: maxOutputTokens,
              temperature: 0.1,
              // Enforce the policy before routing as well as validating the
              // returned usage ledger. OpenRouter rejects the request when no
              // provider can satisfy these zero-price ceilings.
              provider: {
                max_price: {
                  prompt: 0,
                  completion: 0,
                  request: 0,
                  image: 0,
                },
              },
            }),
          },
          this.config.timeoutMs,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new LlmProviderError(`Free OpenRouter request was unreachable: ${message}`, 502);
      }

      const body = await readResponseBody(response);
      if (!response.ok) {
        const message = findMessage(tryParseJson(body)) || body || response.statusText;
        throw new LlmProviderError(
          `Free OpenRouter request failed with HTTP ${response.status}: ${message}`,
          response.status,
          body || null,
        );
      }

      try {
        const parsed = tryParseJson(body);
        if (typeof parsed === "undefined") {
          throw new LlmProviderError("Free OpenRouter returned a non-JSON response.", 502, body || null);
        }
        const record = asRecord(parsed);
        const usage = asRecord(record?.usage);
        assertFreeOpenRouterResponseCost(usage);
        const content = collectOpenRouterMessageContent(parsed);
        const actualModel = typeof record?.model === "string" && record.model.trim()
          ? record.model.trim()
          : this.config.model;
        return {
          output: parseJsonObjectFromText(content) as T,
          provider: "openrouter",
          model: actualModel,
          metadata: {
            requested_model: this.config.model,
            free_only: true,
            structured_output_mode: "json_text",
            attempts: attempt,
            max_output_tokens: maxOutputTokens,
            usage,
          },
        };
      } catch (error) {
        if (
          !(error instanceof LlmProviderError)
          || error.status === 402
          || attempt === maxAttempts
        ) throw error;
        lastParseError = error;
      }
    }

    throw lastParseError || new LlmProviderError("Free OpenRouter did not return parseable JSON output.");
  }
}

export function createFreeOpenRouterLlmClientFromEnv(options: {
  modelEnv?: string;
  defaultModel?: string;
  applicationTitle?: string;
} = {}): LlmClient {
  const modelEnv = options.modelEnv || "OPENROUTER_FREE_MODEL";
  const model = getOptionalEnv(modelEnv) || options.defaultModel || "openrouter/free";
  if (!isFreeOpenRouterModel(model)) {
    throw new LlmConfigurationError(
      `${modelEnv} must be openrouter/free or an explicit OpenRouter :free model variant.`,
    );
  }
  const apiKey = getOptionalEnv("OPENROUTER_API_KEY");
  if (!apiKey) {
    throw new LlmConfigurationError(
      `${modelEnv} is configured for free inference, but OPENROUTER_API_KEY is unavailable.`,
    );
  }
  return new FreeOpenRouterLlmClient({
    apiKey,
    model,
    timeoutMs: getIntegerEnv(
      "OPENROUTER_TIMEOUT_MS",
      DEFAULT_OPENROUTER_TIMEOUT_MS,
      5_000,
      180_000,
    ),
    applicationTitle: options.applicationTitle || "Claritas",
  });
}

export function createLlmClientFromEnv(): LlmClient {
  const provider = (getOptionalEnv("BRIEFING_LLM_PROVIDER") || getOptionalEnv("LLM_PROVIDER") || "opencode").toLowerCase();
  if (provider === "opencode") return new OpenCodeLlmClient();
  throw new LlmConfigurationError(`Unsupported BRIEFING_LLM_PROVIDER: ${provider}. Currently supported: opencode.`);
}

export async function checkLlmConnectionFromEnv(): Promise<LlmConnectionCheck> {
  const provider = (getOptionalEnv("BRIEFING_LLM_PROVIDER") || getOptionalEnv("LLM_PROVIDER") || "opencode").toLowerCase();
  if (provider === "opencode") return await new OpenCodeLlmClient().checkConnection();
  throw new LlmConfigurationError(`Unsupported BRIEFING_LLM_PROVIDER: ${provider}. Currently supported: opencode.`);
}

export function getLlmRuntimeConfig() {
  const provider = (getOptionalEnv("BRIEFING_LLM_PROVIDER") || getOptionalEnv("LLM_PROVIDER") || "opencode").toLowerCase();
  const model = parseOpenCodeModel();
  return {
    provider,
    opencode: {
      server_url_configured: Boolean(getOptionalEnv("OPENCODE_SERVER_URL")),
      auth_configured: Boolean(getOptionalEnv("OPENCODE_SERVER_PASSWORD")),
      provider_id: model.providerID,
      model_id: model.modelID,
      model: model.label,
      tools_disabled: getBooleanEnv("OPENCODE_DISABLE_TOOLS", true),
    },
  };
}

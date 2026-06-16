export type LlmStructuredRequest = {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  title?: string;
  retryCount?: number;
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

const OPENCODE_GENERATION_TRANSPORT_ATTEMPTS = 3;

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
  if (model.providerID === "openrouter" && model.modelID === "free") {
    throw new LlmConfigurationError(
      "OPENCODE_MODEL=openrouter/free is not a real OpenRouter model. Use a concrete free model id from OpenRouter, for example openrouter/<model-id>:free."
    );
  }

  return {
    baseUrl,
    username: getOptionalEnv("OPENCODE_SERVER_USERNAME") || "opencode",
    password: getOptionalEnv("OPENCODE_SERVER_PASSWORD"),
    toolsDisabled: getBooleanEnv("OPENCODE_DISABLE_TOOLS", true),
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
        if (isOpenCodeTransportError(error) && generationAttempt < OPENCODE_GENERATION_TRANSPORT_ATTEMPTS) {
          lastTransportError = error;
          continue generationAttempts;
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
          if (isOpenCodeTransportError(error) && generationAttempt < OPENCODE_GENERATION_TRANSPORT_ATTEMPTS) {
            lastTransportError = error;
            continue generationAttempts;
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

    throw lastParseError || lastTransportError || new LlmProviderError("OpenCode did not return parseable JSON output.");
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
    const session = await this.requestJson("/session", {
      method: "POST",
      body: JSON.stringify({ title }),
    });
    const sessionId = findSessionId(session);
    if (!sessionId) {
      throw new LlmProviderError("OpenCode did not return a session id.");
    }
    return sessionId;
  }

  private async requestJson(path: string, init: RequestInit): Promise<unknown> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.config.password) {
      headers.authorization = `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64")}`;
    }

    const url = joinUrl(this.config.baseUrl, path);
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          ...headers,
          ...(init.headers || {}),
        },
      });
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

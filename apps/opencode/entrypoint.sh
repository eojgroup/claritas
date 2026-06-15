#!/bin/sh
set -eu

mkdir -p "$HOME/.local/share/opencode" "$HOME/.config/opencode"

if [ -n "${OPENCODE_AUTH_JSON:-}" ]; then
  printf '%s' "$OPENCODE_AUTH_JSON" > "$HOME/.local/share/opencode/auth.json"
else
  node <<'NODE'
const fs = require("fs");
const os = require("os");
const path = require("path");

const providers = {};
const mappings = [
  ["openrouter", "OPENROUTER_API_KEY"],
  ["openai", "OPENAI_API_KEY"],
  ["anthropic", "ANTHROPIC_API_KEY"],
  ["google", "GOOGLE_GENERATIVE_AI_API_KEY"],
  ["groq", "GROQ_API_KEY"],
  ["xai", "XAI_API_KEY"],
  ["deepseek", "DEEPSEEK_API_KEY"],
];

for (const [provider, envName] of mappings) {
  const key = process.env[envName];
  if (key && key.trim()) providers[provider] = { type: "api", key: key.trim() };
}

if (Object.keys(providers).length > 0) {
  const target = path.join(os.homedir(), ".local", "share", "opencode", "auth.json");
  fs.writeFileSync(target, JSON.stringify(providers));
}
NODE
fi

node <<'NODE'
const fs = require("fs");
const os = require("os");
const path = require("path");

const model = process.env.OPENCODE_MODEL;
const customConfig = process.env.OPENCODE_CONFIG_JSON;
const disableTools = (process.env.OPENCODE_DISABLE_TOOLS || "true").trim().toLowerCase() !== "false";
const providerApiKeyEnv = {
  openrouter: "OPENROUTER_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  groq: "GROQ_API_KEY",
  xai: "XAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
};

const normalizedModel = model && model.trim();
let config = {};

if (customConfig && customConfig.trim()) {
  try {
    config = JSON.parse(customConfig);
  } catch (error) {
    console.error(`OPENCODE_CONFIG_JSON is not valid JSON: ${error.message}`);
    process.exit(1);
  }
}

config.$schema = "https://opencode.ai/config.json";

if (normalizedModel && !config.model) {
  config.model = normalizedModel;
}

if (normalizedModel && !config.provider) {
  const slashIndex = normalizedModel.indexOf("/");
  if (slashIndex > 0 && slashIndex < normalizedModel.length - 1) {
    const providerID = normalizedModel.slice(0, slashIndex);
    const modelID = normalizedModel.slice(slashIndex + 1);
    const provider = {
      models: {
        [modelID]: {},
      },
    };
    const apiKeyEnv = providerApiKeyEnv[providerID];
    if (apiKeyEnv && process.env[apiKeyEnv]) {
      provider.options = {
        apiKey: `{env:${apiKeyEnv}}`,
      };
    }
    config.provider = {
      [providerID]: provider,
    };
  }
}

if (disableTools) {
  const toolNames = [
    "*",
    "apply_patch",
    "bash",
    "edit",
    "glob",
    "grep",
    "list",
    "lsp",
    "question",
    "read",
    "skill",
    "task",
    "todowrite",
    "webfetch",
    "websearch",
    "write",
  ];
  config.tools = {
    ...(config.tools && typeof config.tools === "object" && !Array.isArray(config.tools) ? config.tools : {}),
    ...Object.fromEntries(toolNames.map((name) => [name, false])),
  };
  // This server only summarizes evidence supplied by Claritas. Denying all
  // tool permissions also prevents newly introduced OpenCode tools from being
  // offered to provider endpoints that do not support tool calling.
  config.permission = "deny";
  config.snapshot = false;
  config.share = "disabled";
}

const target = path.join(os.homedir(), ".config", "opencode", "opencode.json");
fs.writeFileSync(target, JSON.stringify(config));
console.log(
  `OpenCode configuration ready: model=${config.model || "provider default"} tools=${disableTools ? "disabled" : "enabled"}`
);
NODE

exec opencode serve --hostname 0.0.0.0 --port 4096

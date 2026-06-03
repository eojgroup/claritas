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

if [ -n "${OPENCODE_CONFIG_JSON:-}" ]; then
  printf '%s' "$OPENCODE_CONFIG_JSON" > "$HOME/.config/opencode/opencode.json"
elif [ -n "${OPENCODE_MODEL:-}" ]; then
  node <<'NODE'
const fs = require("fs");
const os = require("os");
const path = require("path");

const model = process.env.OPENCODE_MODEL;
const config = model && model.trim()
  ? {
      $schema: "https://opencode.ai/config.json",
      model: model.trim(),
    }
  : {};

if (Object.keys(config).length > 0) {
  const target = path.join(os.homedir(), ".config", "opencode", "opencode.json");
  fs.writeFileSync(target, JSON.stringify(config));
}
NODE
fi

exec opencode serve --hostname 0.0.0.0 --port 4096

export interface ClassifiedTiers {
  fast: string;
  balanced: string;
  powerful: string;
}

export function getClaudeTemplate(models: ClassifiedTiers): string {
  return `# Modlane configuration pre-optimized for Claude Code
server:
  host: 127.0.0.1
  port: 4700

tiers:
  fast:     { provider: anthropic, model: "${models.fast}" }
  balanced: { provider: anthropic, model: "${models.balanced}" }
  powerful: { provider: anthropic, model: "${models.powerful}" }

providers:
  anthropic:
    kind: anthropic
    base_url: https://api.anthropic.com
    api_key_env: null # Uses Claude Code's native browser authentication (no key needed in .env)
`;
}

export function getAgyTemplate(models: ClassifiedTiers): string {
  return `# Modlane configuration pre-optimized for Antigravity (agy)
server:
  host: 127.0.0.1
  port: 4700

tiers:
  fast:     { provider: google, model: "${models.fast}" }
  balanced: { provider: google, model: "${models.balanced}" }
  powerful: { provider: google, model: "${models.powerful}" } # Served natively via Google Vertex/AI Studio

providers:
  google:
    kind: openai-compatible
    base_url: https://generativelabs.googleapis.com/v1beta/openai
    api_key_env: null # Uses Antigravity's native Google session authentication (no key needed in .env)
`;
}

export function getCodexTemplate(models: ClassifiedTiers): string {
  return `# Modlane configuration pre-optimized for Codex
server:
  host: 127.0.0.1
  port: 4700

tiers:
  fast:     { provider: openai, model: "${models.fast}" }
  balanced: { provider: openai, model: "${models.balanced}" }
  powerful: { provider: openai, model: "${models.powerful}" }

providers:
  openai:
    kind: openai
    base_url: https://api.openai.com/v1
    api_key_env: null # Uses Codex's native session authentication (no key needed in .env)
`;
}

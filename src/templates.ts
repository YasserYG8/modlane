export interface AgentTemplate {
  yaml: string;
  env: string;
}

export const TEMPLATES: Record<string, AgentTemplate> = {
  "--claude": {
    yaml: `# Modlane configuration pre-optimized for Claude Code (2026 Lineup)
server:
  host: 127.0.0.1
  port: 4700

tiers:
  fast:     { provider: anthropic, model: claude-haiku-4.5 } # Easy tasks
  balanced: { provider: anthropic, model: claude-sonnet-5 }    # Balanced tasks
  powerful: { provider: anthropic, model: claude-fable-5 }     # Complex tasks

providers:
  anthropic:
    kind: anthropic
    base_url: https://api.anthropic.com
    api_key_env: null # Uses Claude Code's native browser authentication (no key needed in .env)
`,
    env: `# No keys needed for Claude Code session passthrough
`
  },
  "--agy": {
    yaml: `# Modlane configuration pre-optimized for Antigravity (agy)
server:
  host: 127.0.0.1
  port: 4700

tiers:
  fast:     { provider: openrouter, model: google/gemini-2.5-flash }
  balanced: { provider: openrouter, model: google/gemini-2.5-pro }
  powerful: { provider: openrouter, model: anthropic/claude-sonnet-5 }

providers:
  openrouter:
    kind: openai-compatible
    base_url: https://openrouter.ai/api/v1
    api_key_env: OPENROUTER_API_KEY
`,
    env: `# Add your OpenRouter API key here to power Antigravity (agy)
OPENROUTER_API_KEY=""
`
  }
};

# 10 — Validate Codex integration

## Why

Codex is a reference agent for 0.1. Codex CLI speaks OpenAI and supports custom providers, so it reuses the existing `openai-chat` inbound protocol (change 4) — no new surface. Codex defaults to the OpenAI Responses API, but its config allows selecting the chat-completions wire protocol, which Modlane already serves.

## What changes

- Document the Codex config recipe (`config.toml`):
  ```toml
  [model_providers.modlane]
  name = "Modlane"
  base_url = "http://127.0.0.1:<port>/v1"
  wire_api = "chat"        # reuse the openai-chat protocol; avoids Responses API
  env_key = "MODLANE_API_KEY"   # placeholder; gateway is local, no-auth in 0.1
  ```
  Select the Modlane provider and set the model to `modlane-fast|balanced|powerful`.
- End-to-end test: Codex drives a real coding task through Modlane via `wire_api = "chat"`, exercising non-streaming, streaming, and tool calls.
- Record any chat-completions behavior Codex depends on that the `openai-chat` spec misses; feed gaps back to that protocol spec.

## Impact

- No new capability. Validation + integration recipe. Reuses `protocol/openai-chat`.
- Depends on: gateway, routing, provider-adapters (change 4).

## Open item

- If Codex features degrade under `wire_api = "chat"` (e.g. reasoning-item handling only present in the Responses API), raise a deferred `responses` inbound protocol change. Out of scope for 0.1.

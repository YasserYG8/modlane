# 8 — Add Anthropic Messages inbound protocol

## Why

Claude Code speaks the Anthropic Messages API, not OpenAI. It redirects to a gateway via `ANTHROPIC_BASE_URL`. To route Claude Code through Modlane, the gateway needs a second inbound protocol adapter — `anthropic-messages` — that drops into the protocol seam built in change 4. No core, routing, or provider-adapter changes required.

## What changes

- **anthropic-messages protocol adapter:** `POST /v1/messages`.
  - Request shape: top-level `system`, `messages`, `max_tokens`, `tools`.
  - Streaming: Anthropic event stream (`message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`).
  - Tools: `tool_use` / `tool_result` content blocks, passed through unchanged.
  - Errors: Anthropic error shape.
- Virtual models `modlane-fast|balanced|powerful` accepted as the `model` field, mapped to tiers by the same routing core.

## Impact

- Extends capability: `protocol` (adds anthropic-messages).
- Depends on: gateway core, routing, provider-adapters (change 4).
- Consumed by: Claude Code (validated in change 9).

## Notes

Provider adapters already normalize Anthropic upstream responses; this change is purely the **inbound** Anthropic surface. Inbound protocol and outbound provider are independent — Claude Code can be routed to an OpenAI or local model, and OpenCode can be routed to Anthropic.

# 4 — Add gateway + OpenAI inbound protocol

## Why

The gateway is the only surface an agent talks to. Its core is **protocol-agnostic**: it accepts an inbound request, hands it to the matching inbound protocol adapter for normalization, routes it, executes it, and shapes the response back in the same protocol. This change ships the core plus the first inbound protocol — **openai-chat** — which makes OpenCode and other OpenAI-compatible agents work unmodified. The second protocol (anthropic-messages, for Claude Code) is change 8 and drops into the same seam.

## What changes

- HTTP server on `127.0.0.1`, no auth (0.1).
- Protocol dispatch: match an inbound request to a registered protocol adapter.
- Execution path: normalized request → `routing` → `provider-adapters` → response, re-shaped by the inbound protocol.
- **openai-chat protocol adapter:** `POST /v1/chat/completions`, `GET /v1/models` (advertises `modlane-fast|balanced|powerful`), SSE streaming in OpenAI delta format, tool-call passthrough, OpenAI-shaped errors.

## Impact

- Adds capabilities: `gateway` (protocol-agnostic core), `protocol` (openai-chat adapter).
- Depends on: routing, provider-adapters, configuration, telemetry.
- Consumed by: OpenCode. Extended by: change 8 (anthropic-messages).

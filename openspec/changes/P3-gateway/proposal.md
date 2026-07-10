# P3 — Gateway inbound (non-streaming)

## Why

First point an agent can actually use Modlane. The thin inbound layer accepts both protocols, normalizes to the neutral `ChatRequest`, routes, and renders the result back in the caller's dialect. Cross-dialect works (inbound protocol ⊥ outbound provider).

## What changes

- `src/protocols/` — `parseOpenAIRequest`/`renderOpenAIResponse` and `parseAnthropicRequest`/`renderAnthropicResponse`, plus dialect error renderers; shared `contentToString`.
- Neutral `StopReason` (`stop`/`length`/`tool_use`): adapters emit it; renderers map it to each dialect's `finish_reason`/`stop_reason`.
- `src/router.ts` — `pickTier` (P3 stub → `balanced`) + `route(config, req)` resolving tier → provider/model and executing with same-tier fallback.
- `src/server.ts` — `createGateway(config)` handling `GET /health`, `POST /v1/chat/completions`, `POST /v1/messages`; JSON body read; errors mapped to the inbound dialect. `startGateway(config, opts)`.
- Per the gateway spec: binds loopback, ignores inbound auth headers, no rate/size limits.

## Impact

- Completes the `gateway` + `protocol` capabilities (non-streaming). Consumes `providers` + `routing`.
- Streaming deferred to **P3b** (SSE for both dialects, built + tested against a streaming mock).

## Status

Done — `src/protocols/*`, `src/router.ts`, rewritten `src/server.ts`; 3 gateway e2e tests (OpenAI inbound, cross-dialect Anthropic inbound, invalid-JSON 400). 16 tests total green.

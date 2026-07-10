# P3 — Tasks

- [x] `protocols/content.ts` — `contentToString` (string | block-array → text)
- [x] `protocols/openai.ts` — parse `/v1/chat/completions` → ChatRequest; render chat.completion + error
- [x] `protocols/anthropic.ts` — parse `/v1/messages` → ChatRequest; render message + error
- [x] Neutral `StopReason` in providers; adapters emit it; renderers map to dialect
- [x] `router.ts` — `pickTier` stub (balanced) + `route` (tier → provider/model, same-tier fallback)
- [x] `server.ts` — `createGateway(config)`: /health, POST /v1/chat/completions, POST /v1/messages; body read; dialect error mapping; `startGateway(config, opts)`
- [x] wire `cli.ts` start to pass config; update `server.test.ts` signature
- [x] `gateway.test.ts` — OpenAI inbound, cross-dialect Anthropic inbound, invalid-JSON 400
- [x] Verify: typecheck + 16 tests green

## P3b — streaming (done)
- [x] `providers/sse.ts` — parse SSE response body into {event, data} frames
- [x] adapter `stream()` for OpenAI (delta + include_usage) and Anthropic (event stream)
- [x] `protocols/stream.ts` — re-emit neutral chunks as OpenAI `chat.completion.chunk` + `[DONE]` and Anthropic `message_start`…`message_stop`
- [x] `router.routeStream` (no mid-stream fallback); gateway primes first chunk so pre-stream errors are clean HTTP errors, mid-stream errors drop the connection
- [x] `gateway.test.ts` — OpenAI + cross-dialect Anthropic streaming (mock SSE provider); 18 tests total green

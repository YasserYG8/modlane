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

## Next (P3b — streaming)
- [ ] SSE for OpenAI (`chat.completion.chunk` + `[DONE]`) and Anthropic (`message_start`…`message_stop`)
- [ ] adapter `stream()` for both providers; tier chosen before first byte; no mid-stream fallback

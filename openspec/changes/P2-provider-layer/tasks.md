# P2 — Tasks

- [x] `types.ts` — `ChatRequest`/`ChatResult`/`Usage`, `ProviderAdapter`, `ProviderError`, `isRetryableStatus`
- [x] `http.ts` — shared `postJson` (network/non-2xx → `ProviderError`), `trimSlash`
- [x] `openai.ts` — OpenAI-compat adapter (Bearer, system→message, usage)
- [x] `anthropic.ts` — Anthropic adapter (x-api-key, system top-level, max_tokens default, text-block join)
- [x] `index.ts` — `makeAdapter` factory (secret from env), `sendWithFallback`
- [x] `providers.test.ts` — mock-server tests: parse, system/max_tokens, estimated usage, retryable 5xx, fallback, no-fallback-on-4xx (6)
- [x] Verify: typecheck + 13 tests green

## Deferred within P2
- [ ] Streaming (`stream()`) — added in P3 where the gateway exercises SSE end-to-end

## Next (P3)
- [ ] Gateway inbound: OpenAI `/v1/chat/completions` + Anthropic `/v1/messages`, parse → ChatRequest, stub route → provider, return in inbound shape

# P2 — Provider layer

## Why

Modlane must call model backends behind a provider-independent interface (the routing core never references a concrete provider). Only two provider shapes are needed: OpenAI-compat (covers OpenAI, OpenRouter, local) and Anthropic. Fallback lives here (provider-level), distinct from routing-level escalation.

## What changes

- `ProviderAdapter` interface: `send(ChatRequest) → ChatResult`; neutral `ChatRequest`/`ChatResult`/`Usage` types; `ProviderError` with a `retryable` flag.
- `OpenAICompatAdapter`: POST `{baseUrl}/chat/completions`, Bearer auth, system folded into messages, usage from `prompt_tokens`/`completion_tokens`.
- `AnthropicAdapter`: POST `{baseUrl}/v1/messages`, `x-api-key` + `anthropic-version`, system top-level, `max_tokens` injected from config default, usage from `input_tokens`/`output_tokens`.
- Shared `postJson` HTTP helper → maps network/non-2xx to `ProviderError` (retryable on 5xx/429/network).
- `makeAdapter(config, provider)` factory (resolves secret from env); `sendWithFallback(primary, alt)` retries the alternate only on retryable errors.
- Usage never faked: absent → `estimated: true`, tokens `null`.

## Impact

- Adds `provider-adapters` + `fallback`. Consumed by routing (P6) and gateway (P3).
- Streaming deferred to P3 (wired + tested end-to-end with the gateway).

## Status

Done — `src/providers/*`, 6 tests (parse, system/max_tokens handling, estimated usage, retryable 5xx, fallback, no-fallback-on-4xx). 13 tests total green.

# 2 — Add provider adapters + fallback

## Why

The routing core must never depend on a concrete provider (provider independence). This change defines the adapter interface every backend implements, plus deterministic fallback when a provider fails. Fallback ships here because it is provider-level behavior, distinct from routing-level escalation.

## What changes

- Define the provider-adapter contract: `send`, `stream`, usage normalization, error mapping.
- Implement 0.1 adapters: OpenAI, Anthropic, OpenRouter, generic OpenAI-compatible (covers local models). Others deferred.
- One shared adapter-conformance test suite all adapters pass.
- Fallback: on provider error/timeout, try the configured alternate provider for the same tier; flag `fallback=true` on the decision record.

## Impact

- Adds capabilities: `provider-adapters`, `fallback`.
- Depends on: configuration.
- Consumed by: routing, gateway.

## Notes

Fallback = same difficulty, different provider. Escalation (harder problem, stronger model) is 0.3 and separate.

# P1 — Configuration

## Why

Every capability reads config: tiers, providers, classifier thresholds, telemetry. First module after bootstrap; no upstream deps.

## What changes

- YAML config: `server`, `router.strategy`, `tiers` (fast/balanced/powerful → provider+model), `providers` (kind, base_url, api_key_env), optional `fallback`, `anthropic_defaults`, `telemetry`, `prices`.
- Load order: `./modlane.yaml` → `~/.modlane/config.yaml`. Missing → clear error naming both paths.
- Validation: fail-fast with field-specific messages (missing tier, undefined provider, wrong type, bad kind).
- Secrets resolved from env (`api_key_env`), never stored in file; missing required secret errors naming the var.
- `modlane start` loads config and binds `server.host:port`.

## Impact

- Adds `configuration`. Consumed by gateway, providers, routing, telemetry, cli.

## Status

Done — `src/config.ts` + tests (5). typecheck/build/tests green. `modlane start` binds from config; missing config fails fast.

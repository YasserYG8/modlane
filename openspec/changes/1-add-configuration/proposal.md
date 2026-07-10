# 1 — Add configuration

## Why

Every capability reads configuration: providers, tier→model mapping, router strategy. Config is the first buildable capability and has no upstream dependencies.

## What changes

- Define the YAML config schema: `providers`, `tiers` (fast/balanced/powerful → provider + model), `router.strategy` (0.1: `rules`).
- Load order: `modlane.yaml` (CWD) → `~/.modlane/config.yaml`. Env-var overrides for secrets.
- Validate on load; fail fast with a clear message; refuse to start on invalid config.
- Secrets (API keys) resolved from env vars, never required in the file.

## Impact

- Adds capability: `configuration`.
- Consumed by: provider-adapters, routing, gateway, cli.

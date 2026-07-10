# 6 — Add CLI

## Why

The CLI is the operator surface for a local-first tool. It starts the gateway and exposes config, model, status, and stats without a dashboard.

## What changes

- `modlane start` — run the gateway.
- `modlane status` — is the gateway running, on what address.
- `modlane models` — list virtual models and their resolved tier → provider/model.
- `modlane stats` — usage summary from telemetry (requests, tokens, estimated cost, latency, fallbacks) per model/tier.
- `modlane config` — show/validate the active config and its source path.

## Impact

- Adds capability: `cli`.
- Depends on: configuration, gateway, telemetry.

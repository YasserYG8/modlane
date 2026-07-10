# 5 — Add telemetry, persistence, privacy

## Why

Observability by default is a core principle: every routing decision must be explainable. This change captures decision/metric records, stores them locally, and enforces the privacy default (metadata, not content). Grouped because they share one data path and one privacy contract.

## What changes

- **telemetry** — for each request record: chosen model, tier, triggering rule, latency, prompt/completion tokens, estimated cost, correlation key, fallback/escalation flags.
- **persistence** — SQLite single-file store behind a persistence interface; holds telemetry and usage history.
- **privacy** — default stores metadata only; source code / prompts / responses are not persisted unless explicitly enabled; redaction on any opted-in content capture.
- Cost is an estimate derived from tokens × configured price; labeled as estimated.

## Impact

- Adds capabilities: `telemetry`, `persistence`, `privacy`.
- Depends on: routing (decision records), provider-adapters (usage).
- Consumed by: gateway, cli `stats`. Foundation for performance-history (0.5).

## Notes

Correlation key recorded from day one so escalation (0.3) and history (0.5) need no backfill.

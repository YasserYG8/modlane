# 3 — Add routing + tiers

## Why

The routing capability decides which tier and concrete model serve a request. In 0.1, with tier-as-virtual-model, this is a deterministic lookup — but it must emit a full decision record now so the observability contract is stable before smarter rules land in 0.2+.

## What changes

- Define the three tiers and the routing decision: virtual model name → tier → provider/model (from config).
- Deterministic rule evaluation with an explicit, ordered strategy (`rules` strategy in 0.1).
- Emit a decision record for every request: chosen model, tier, triggering rule, correlation key, fallback/escalation flags (escalation always false in 0.1).
- No request-content inspection. Classification is 0.2.

## Impact

- Adds capability: `routing`.
- Depends on: configuration, provider-adapters.
- Consumed by: gateway. Extended by: task-classification (0.2), escalation (0.3), agent-step-routing (0.4).

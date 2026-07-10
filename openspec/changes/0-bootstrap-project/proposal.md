# 0 — Bootstrap project

## Why

Modlane is greenfield. Before any capability, the repo needs a runtime, module boundaries, and test harness that enforce the architectural principles (provider independence, clear boundaries, local-first). Foundational decisions (TypeScript/Node, tier-as-virtual-model) are recorded in `project.md`.

## What changes

- Establish TypeScript/Node project: strict tsconfig, package with `modlane` bin, test runner, lint/format.
- Define top-level module boundaries as directories with no cross-imports that violate the dependency graph: `gateway/`, `routing/`, `providers/`, `telemetry/`, `persistence/`, `config/`, `cli/`.
- Set up the three test pillars' scaffolding (contract, adapter-conformance, decision-table) as empty suites.
- No product behavior yet — no capability spec deltas.

## Impact

- Affected: repository scaffolding only.
- No capability specs added. Unblocks changes 1–7.

## Notes

Tasks intentionally not generated yet (planning foundation stage).

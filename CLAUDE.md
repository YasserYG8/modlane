# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Modlane is

An adaptive AI model router for coding agents: sits between a coding agent (OpenCode, Claude Code, Codex) and model providers, and picks the right model per request instead of sending everything to the most expensive one. Ships as `npx modlane` (TS/Node). Product vision, principles, and roadmap live in `openspec/project.md` — read it first.

## Read this before designing anything: the pivot

The original 0.1 plan (from-scratch gateway + manual "tier-as-virtual-model" routing) was **superseded** after a pre-build validation experiment. Do not resurrect it.

- `experiments/escalation-hypothesis.md` records the result: naive "start cheap, escalate on failure" (Haiku→Sonnet) **cost 31% more** than always-powerful on hard tasks (the cheap model failed 86% and became pure overhead). Do **not** re-propose blind failure-escalation as the core.
- The pivot (`project.md` → "Pivot — post-validation") reframes Modlane around three attacks:
  1. **Classification-first** — predict difficulty/type on the way in; route trivial→cheap and hard→powerful directly; escalate only the uncertain middle band.
  2. **Routing brain is the product, not the plumbing** — build only two provider shapes (OpenAI-compat + Anthropic), keep the gateway thin.
  3. **Mine execution signals the gateway can see** — tool-call history, test-failure `tool_result`s, files touched, repeated edits, context size.
- Telemetry **self-measures per-tier outcome** so the "how much real work is trivial enough for a cheap model" question gets answered by usage, not assumption.
- **LiteLLM was considered and rejected** (would force Python; `npx` single-ecosystem adoption won). Don't re-suggest it.

The active plan is **P0–P8** in `project.md` (supersedes old changes 1–10, which remain in `openspec/changes/` only as the pre-pivot record). **Current progress: P0–P3b done** — bootstrap, config, provider layer, gateway inbound (both protocols) + streaming — and **verified end-to-end against a real Anthropic provider** (18 tests + a real integration pass; see README "What works today"). **Next: P4 (execution-signals) + P5 (task-classification) — the routing brain**, then P6 (routing) and P7 (self-measuring telemetry). Routing today is a stub in `router.ts` (`pickTier` → balanced).

## Commands

```bash
pnpm install
pnpm run build        # tsc → dist/
pnpm run typecheck    # tsc --noEmit
pnpm test             # vitest run (scoped to src/ only)
pnpm test -- src/providers          # run one file / name pattern
pnpm run dev          # tsx src/cli.ts (run CLI from source)
node dist/cli.js start             # run the built gateway (needs modlane.yaml)
```

`modlane start` requires a config: copy `modlane.example.yaml` → `modlane.yaml` (gitignored). Default port **4700** (chosen to avoid framework defaults). Secrets are read from env vars named by each provider's `api_key_env`; never put keys in the config file.

**Running the real gateway:** `node dist/cli.js …` needs a fresh `pnpm run build` first — tests run against `src/` and won't rebuild `dist/`, so a stale `dist/` silently serves old routes (404s). Prefer `pnpm run dev start` (tsx, runs from source, no build step) for manual/integration runs.

## Architecture (big picture)

Request path once P3 lands:
```
Agent → gateway (inbound: /v1/chat/completions | /v1/messages)
      → execution-signals → classifier → routing → provider adapter → Model Provider
```

- `src/config.ts` — YAML config (`./modlane.yaml` → `~/.modlane/config.yaml`), fail-fast validation, `resolveApiKey` from env. `ConfigError` messages are user-facing.
- `src/providers/` — provider-independent layer. `ProviderAdapter.send(ChatRequest) → ChatResult`; `OpenAICompatAdapter` (OpenAI/OpenRouter/local) and `AnthropicAdapter`. `makeAdapter(config, name)` is the factory. Usage is **never faked** — absent → `estimated: true`, tokens `null`.
  - **Fallback ≠ escalation.** `sendWithFallback` (provider-level, retryable errors only, same tier) lives here. Escalation (harder problem → stronger model) is a routing concern, separate.
- `src/server.ts` / `src/cli.ts` — thin `node:http` gateway + CLI. No web framework by design.

## OpenSpec workflow (spec-first)

Work is planned in `openspec/` before coding. Each change is `openspec/changes/<id>/` with `proposal.md` + `tasks.md` (and `spec.md` deltas for capabilities). `openspec/project.md` is the source of truth for decisions; `openspec/design.md` holds the 0.1 system design. When you finish a change, tick its `tasks.md` and note "Done" in its `proposal.md`.

## Repo conventions

- **`aider/` and `tmp.benchmarks/` are gitignored** — a local Aider clone used only to run the validation experiment (`experiments/`). Vitest excludes them; don't touch or commit them. Running that benchmark spends real API money — only with explicit user approval.
- `main` is protected (ruleset: PR + 1 review + CI `build` check, no force-push/delete). The owner has admin bypass for direct pushes.
- Commit messages: Conventional Commits, **no AI attribution / no Co-Authored-By** lines.

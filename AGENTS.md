# AGENTS.md — Modlane

Guidance for OpenCode (and similar agents) working in this repo.

## What this repo is

`modlane` is an adaptive AI model router for coding agents (TypeScript/Node, shipped as `npx modlane`). It exposes a small local gateway that agents point at unmodified, then routes requests across model tiers based on task signals. Read `openspec/project.md` before any design work — it contains the validated pivot decisions.

## Everyday commands

Use **pnpm** (`packageManager: pnpm@11.10.0`). Node >=20 required.

```bash
pnpm install
pnpm run typecheck    # tsc --noEmit
pnpm test             # vitest run, src/**/*.test.ts only
pnpm test -- src/providers/providers.test.ts   # single file / pattern
pnpm run build        # tsc → dist/
pnpm run dev start    # tsx src/cli.ts start (preferred for manual runs)
```

CI order: `pnpm install --frozen-lockfile` → `typecheck` → `test` → `build`. Match that order locally.

## Running the gateway

Requires a config. Copy the example and fill in providers:

```bash
cp modlane.example.yaml modlane.yaml
```

- Config search order: `./modlane.yaml` → `~/.modlane/config.yaml`.
- Default bind: `127.0.0.1:4700`.
- Secrets are read from env vars named by each provider's `api_key_env`; never commit keys in `modlane.yaml`.

Prefer `pnpm run dev start` for manual/integration runs. `node dist/cli.js start` works only after `pnpm run build`, and a stale `dist/` silently serves old routes. Tests run against `src/` and do not rebuild `dist/`.

## Testing quirks

- Tests are scoped to `src/**/*.test.ts`; `vitest.config.ts` excludes `dist`, `aider`, `tmp.benchmarks`, and `experiments`.
- Running the full suite once can exhaust the Node heap on Windows (`pnpm test`). If that happens, run files individually with `pnpm test -- <path>`.

## Architecture (the 30-second version)

- Thin `node:http` gateway by design — no web framework.
- Inbound protocols: OpenAI `/v1/chat/completions` and Anthropic `/v1/messages`.
- Protocol renderers in `src/protocols/` normalize to a neutral `ChatRequest` and render responses back in the inbound dialect.
- Provider adapters in `src/providers/` implement the `ProviderAdapter` contract: `send()` and `stream()`.
- Supported provider kinds: `openai`, `anthropic`, `openai-compatible` (covers OpenRouter and local/Ollama).
- Routing brain is intentionally a stub right now (`pickTier` returns `"balanced"` in `src/router.ts`). The next work is classification + execution signals.
- `src/signals.ts` extracts execution signals from the raw request stream for downstream routing.

## Planning workflow

This repo is spec-first:

- Source of truth: `openspec/project.md` — read it before designing anything.
- Each change lives in `openspec/changes/<id>/` with `proposal.md` + `tasks.md`.
- When finishing a change, tick the tasks in `tasks.md` and mark "Done" in `proposal.md`.
- The P0–P8 plan in `openspec/project.md` supersedes the older pre-pivot changes 1–10 in `openspec/changes/`.

## Decisions to preserve

These are non-obvious and should not be re-litigated without new evidence:

- **Do not re-propose naive "start cheap, escalate on failure" routing.** The experiment in `experiments/escalation-hypothesis.md` showed it cost 31% more than always-powerful on hard tasks. The pivot is classification-first.
- **LiteLLM was considered and rejected.** The project stays TypeScript/Node for `npx` adoption.
- **Two provider shapes only:** OpenAI-compatible and Anthropic. Do not build a 100-provider matrix.
- **Fallback ≠ escalation.** Provider-level fallback (`sendWithFallback`) handles retryable transport errors for the same tier. Escalation across tiers is a routing concern.
- **Never fake usage.** If the provider does not report tokens, record `estimated: true` with `null` counts.

## Repo conventions

- `aider/` and `tmp.benchmarks/` are gitignored and excluded from tests. Do not touch or commit them.
- `main` is protected: PR + 1 review + CI `build` check, no force-push/delete.
- Commit messages: Conventional Commits. No AI attribution / no `Co-Authored-By` lines.
- `.env` is loaded at startup by `src/env.ts` if present (not required).

## Key reference files

- `openspec/project.md` — product vision, pivot rationale, P0–P8 plan.
- `CLAUDE.md` — parallel guidance for Claude Code; mostly overlaps with this file.
- `modlane.example.yaml` — living config schema and defaults.
- `src/config.ts` — config loading, validation, and `resolveApiKey()`.
- `src/providers/types.ts` — neutral `ChatRequest` / `ChatResult` / `ProviderAdapter` contract.
- `src/router.ts` — current routing stub; the intentional place for the brain to land.

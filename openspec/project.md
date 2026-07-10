# Modlane

An adaptive AI model router for coding agents.

> Do not use the most powerful model for every task. Use the right model for every step.

Modlane sits between a coding agent and model providers, deciding which model tier handles each request. Goal: make coding agents cheaper, faster, more efficient, more reliable, and adaptive to each repository and task.

## Vision

```
Coding Agent → Modlane → Model Provider
```

Long-term, Modlane learns: for *this* repository, framework, task type, and user, which model gives the best quality, speed, and cost — and routes accordingly, per agent step.

## Differentiation

Modlane is **not** a generic AI gateway. It does not compete on unified access to hundreds of models, provider failover alone, key management, or generic load balancing. Its value is:

- coding-agent-specific routing
- repository-aware decisions
- task-aware decisions
- execution-aware routing (failure-aware escalation)
- routing by individual agent step
- performance history by repository and task type

If a feature does not serve *coding-agent routing*, it does not belong in Modlane.

## Model tiers

| Tier | For |
|---|---|
| **FAST** | file reads, repo search, summaries, commit messages, trivial edits |
| **BALANCED** | small features, CRUD, tests, normal bug fixes, limited refactors |
| **POWERFUL** | architecture, hard debugging, repo-wide changes, migrations, repeated failures, planning |

## Architectural principles

- **Provider independence** — the routing core depends on an adapter interface, never a concrete provider.
- **Agent independence** — internal boundaries allow supporting more coding agents later.
- **Clear boundaries** — gateway · protocol normalization · provider adapters · routing · classification · telemetry · persistence · configuration are separate.
- **Local first** — works locally, no cloud account required.
- **Observability by default** — every routing decision is explainable (what model, why, which rule, latency, tokens, cost, fallback/escalation).
- **Privacy** — store metadata, not source code / prompts / responses, unless explicitly enabled.

## Decided (foundational)

- **Runtime:** TypeScript / Node. (OpenAI-compat surface is the main risk; TS de-risks it with the richest provider-SDK ecosystem and largest contributor pool.)
- **Tier selection in 0.1:** *tier-as-virtual-model*. The gateway advertises `modlane-fast`, `modlane-balanced`, `modlane-powerful`. The agent (or its config) picks the tier; Modlane maps tier → provider/model. **No request-content inspection in 0.1.** Content-based classification enters in 0.2. Virtual-model names work identically across inbound protocols.
- **Inbound protocols:** the gateway core is protocol-agnostic. Two inbound protocol adapters normalize to one internal request: **openai-chat** (`/v1/chat/completions`, for OpenCode) and **anthropic-messages** (`/v1/messages`, for Claude Code). Each owns its own request/stream/tool/error shaping. Adding an agent that speaks either protocol needs no core changes.
- **Reference agents (0.1):** OpenCode (OpenAI protocol), Claude Code (Anthropic protocol, via `ANTHROPIC_BASE_URL`), and Codex (OpenAI protocol, via `config.toml` custom provider with `wire_api = "chat"`). Claude Code's `ANTHROPIC_MODEL` / `ANTHROPIC_SMALL_FAST_MODEL` map to Modlane tiers. Codex reuses the `openai-chat` protocol — no new inbound surface.
- **Deferred optional protocol:** OpenAI **Responses API** (`/v1/responses`) — Codex's native default. Only built if pinning Codex to `wire_api = "chat"` proves limiting. Not in 0.1.
- **Persistence:** SQLite, single local file. Behind a persistence interface.
- **Config:** YAML — `modlane.yaml` (CWD) → `~/.modlane/config.yaml`. Env-var overrides for secrets; secrets never stored in the file by default.
- **Gateway binding:** `127.0.0.1`, no auth in 0.1 (local-first, single user). Auth is an explicit non-goal.
- **Distribution:** published for `npx modlane` (single `modlane` bin); managed with **pnpm**. Compiled standalone binary deferred, non-blocking.
- **Error handling** is cross-cutting: each capability owns its own error scenarios; the gateway maps errors to the **inbound protocol's** error shape (OpenAI or Anthropic). It is not a standalone capability.

## Pivot — post-validation (2026-07-10)

A pre-build experiment (`experiments/escalation-hypothesis.md`) tested the one defensible claim — failure-aware escalation — on real coding tasks. **Result: naive escalation lost money** (Haiku→Sonnet cost 31% *more* than always-Sonnet, because Haiku failed 86% of hard tasks and became pure overhead). The experiment also exposed that the original 0.1 (from-scratch gateway + manual tier-as-virtual-model) is mostly commodity work LiteLLM and the agents already do.

**Decision: keep building, but redesign to attack the three weaknesses the evidence exposed.** This section supersedes the original capability map, roadmap, and change plan below where they conflict.

### The three attacks

1. **Escalation from a too-weak model loses.** → **Classification-first, escalation-second.** Predict task difficulty/type on the way in; route trivial→cheap and hard→powerful *directly*; escalate only the uncertain **middle band**. Never feed hard tasks to a model that fails them.
2. **Static routing is commodity (the agents already do it).** → **Make the routing BRAIN the product, not the plumbing.** The differentiator is classification + execution signals + per-repo/task learning — not the gateway. Build the plumbing minimally in TS/Node: Modlane needs only two provider shapes (OpenAI-compat, covering OpenAI/OpenRouter/local, plus Anthropic), so the gateway and adapters stay small. Distribution: `npx modlane`, single ecosystem, zero prerequisites — chosen for adoption over a Python/LiteLLM base.
3. **The proxy can't see the agent's "step".** → **Mine the signals it CAN see** in the request stream: tool-call history, test-failure `tool_result`s, files touched, repeated edits, context size. That IS the execution-aware signal — no need to know the abstract step.

### Self-measuring — validate while building

Telemetry records **outcome/cost per tier** (test-pass signals appear in later messages of the same conversation, grouped by correlation key). This embeds the missing "what fraction of real work is trivial enough for a cheap model" experiment into normal usage: use Modlane, read the telemetry, see if cheap actually works. Build and validate at once.

### Revised architecture

```
Coding Agent → Modlane (TS/Node): inbound → signals → classify → route → provider adapter → Model Provider
```

Modlane owns a thin inbound layer (OpenAI `/v1/chat/completions` for OpenCode/Codex; Anthropic `/v1/messages` for Claude Code) and two minimal provider adapters (OpenAI-compat + Anthropic). The value is the middle: extract execution signals → classify difficulty/type → route (direct for trivial/hard, escalate only the middle band) → record per-tier outcome. Shipped for `npx modlane`.

### Revised 0.1 change list (supersedes the map below)

| # | Change | Note |
|---|---|---|
| P0 | bootstrap (TS/Node, `modlane` npx bin) | revises old change 0 |
| P1 | configuration (tiers, providers, classifier thresholds) | adapts old change 1 |
| P2 | provider-layer (OpenAI-compat + Anthropic adapters) + fallback | trims old change 2 to two provider shapes |
| P3 | gateway (thin inbound: OpenAI `/v1/chat/completions` + Anthropic `/v1/messages`) | trims old changes 4 + 8 |
| P4 | execution-signals (extract routing signals from the request stream) | NEW — the PD3 attack |
| P5 | task-classification (heuristic difficulty/type, no ML) | promoted from 0.2 — the PD1 attack |
| P6 | routing (classification + signals → tier; escalate only the middle band) | adapts old change 3 |
| P7 | telemetry-persistence (per-decision + cost + **per-tier outcome** = self-measurement) | adapts old change 5 |
| P8 | cli (start/status/models/stats, stats shows per-tier success) | keeps old change 6 |

The **core value** is P4–P7 (signals, classification, routing brain, self-measuring telemetry). P0–P3 are the minimal plumbing to reach it. Modlane builds only two provider shapes (OpenAI-compat + Anthropic) — no from-scratch reimplementation of a 100-provider matrix. Old changes 1–10 stay in git as the pre-pivot record; new work follows P0–P8.

## Open decisions (deferred, do not block 0.1)

- **OD-3 Request→task correlation.** Escalation, step-routing, and performance-history need to group requests into one coding task. The OpenAI API is stateless. Mechanism (session header vs heuristic) is undecided, but telemetry in 0.1 records a correlation key from day one so later versions need no backfill.
- **OD-4 Streaming vs late routing.** The tier is chosen before a stream opens; no mid-stream model switch. Escalation therefore acts on the *next* request, not the current stream.

## Version roadmap

| Ver | Theme | Adds |
|---|---|---|
| 0.1 | Static routing + observability | gateway, protocol (openai + anthropic), adapters, tiers, fallback, config, telemetry, persistence, privacy, cli |
| 0.2 | Task classification | infer task type from request |
| 0.3 | Failure-aware escalation | upgrade tier on repeated failures/build/test signals |
| 0.4 | Agent-step routing | different models per task phase |
| 0.5 | Repository performance history | score models per repo/lang/framework/task |
| 1.0 | Adaptive routing | routing improves from historical results |

## Capability map

`specs/` is populated as changes archive. Target tree:

```
gateway              [0.1]  HTTP server, protocol-agnostic core, streaming, tool passthrough, error mapping
protocol             [0.1]  inbound protocol adapters: openai-chat + anthropic-messages
provider-adapters    [0.1]  provider-independent adapter contract
routing              [0.1]  tier definitions + deterministic decision (static in 0.1)
fallback             [0.1]  provider-failure handling
configuration        [0.1]  config schema, load, validate, precedence
telemetry            [0.1]  token/cost/latency capture, decision records, explainability
persistence          [0.1]  local SQLite store
privacy              [0.1]  no-content-storage default, redaction
cli                  [0.1]  start/status/models/stats/config
task-classification  [0.2]
escalation           [0.3]
agent-step-routing   [0.4]
performance-history  [0.5→1.0]
```

## Testing strategy

Three pillars:

1. **Protocol contract tests** — request/response/stream/tool-call shapes match each inbound protocol (OpenAI chat-completions and Anthropic messages) so agents work unmodified.
2. **Adapter conformance tests** — every provider adapter passes one shared suite (send, stream, normalize usage, map errors).
3. **Routing decision tables** — deterministic rule inputs → expected tier/model + decision record.

Target 80% coverage. Cost figures are estimates and labeled as such (providers report usage inconsistently, especially when streaming).

## Conventions

- Many small files; feature/domain organization; immutable data.
- Every capability emits a decision/telemetry record even when its logic is trivial, so the observability contract is stable before smarter logic lands.
- Specs assert observable behavior; `design.md` and code hold implementation choices.

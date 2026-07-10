<h1 align="center">Modlane</h1>

<p align="center">
  <strong>An adaptive AI model router for coding agents.</strong><br>
  <em>Don't use the most powerful model for every task. Use the right model for every step.</em>
</p>

<p align="center">
  <a href="#status">Status</a> ·
  <a href="#what-works-today">What works</a> ·
  <a href="#why-build-this">Why build this</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#roadmap">Roadmap</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

Modern coding agents send every request to one model — even trivial ones like reading a file, searching the repo, or writing a commit message. That is slow and expensive.

**Modlane sits between a coding agent and model providers and decides which model handles each request.**

```
Coding Agent  →  Modlane  →  Model Provider
```

The goal is to make coding agents **cheaper, faster, more efficient, more reliable, and adaptive** to each repository and task.

## Status

**Pre-alpha — in active development.** The plumbing is built and **verified end-to-end against a real provider**. The routing *brain* (classification + execution signals) — the actual differentiator — is next.

Built and tested so far (TypeScript/Node, `npx modlane`):

| Piece | State |
|-------|-------|
| Config (YAML, validation, secrets from env) | ✅ |
| Provider adapters (OpenAI-compat + Anthropic) + fallback | ✅ |
| Gateway inbound: OpenAI `/v1/chat/completions` + Anthropic `/v1/messages` | ✅ |
| Streaming (SSE, both dialects, cross-dialect) | ✅ |
| Classification + execution-signal routing (the brain) | ⏳ next |
| Self-measuring telemetry | ⏳ next |

**18 automated tests green** + a real integration pass (below). Build sequence and rationale: [`openspec/project.md`](openspec/project.md).

## What works today

Point any OpenAI- or Anthropic-compatible coding agent at Modlane. Real run against **Anthropic Haiku** through the gateway:

```jsonc
// POST /v1/chat/completions  (OpenAI inbound)  → routed to a real model, OpenAI shape back
{ "object": "chat.completion",
  "choices": [{ "message": { "content": "integration ok" }, "finish_reason": "stop" }],
  "usage": { "prompt_tokens": 13, "completion_tokens": 5, "total_tokens": 18 } }

// POST /v1/messages  (Anthropic inbound)  → same routing core, Anthropic shape back
{ "type": "message", "content": [{ "type": "text", "text": "anthropic ok" }],
  "stop_reason": "end_turn", "usage": { "input_tokens": 14, "output_tokens": 6 } }

// POST /v1/chat/completions  stream:true  → real SSE: chat.completion.chunk … [DONE]
```

Both inbound protocols, non-streaming and streaming, with **real token usage** (never faked). Inbound protocol is independent of the outbound provider — Claude Code can be routed to an OpenAI model, and vice-versa.

```bash
cp modlane.example.yaml modlane.yaml   # set your tiers + providers
npx modlane start                      # gateway on 127.0.0.1:4700
```

## Why build this

We stress-tested the core idea **before** writing the product, on real coding tasks with tests ([`experiments/escalation-hypothesis.md`](experiments/escalation-hypothesis.md)). The honest results shaped the design:

- **The naive version loses — and we proved it.** "Start cheap, escalate on failure" (Haiku→Sonnet) cost **31% more** than always-powerful on hard tasks, because a too-weak model fails most of them and becomes pure overhead. So Modlane does **not** do that.
- **But smart routing beat any single model on quality.** In the same test, routing across models scored **78.6% vs 64.3%** for always-Sonnet — the cheap model solved tasks the expensive one couldn't. Model diversity is a real, measurable edge.
- **The fix is cheap to build.** Classify difficulty first, route trivial→cheap and hard→powerful directly, and escalate only the uncertain middle. Modlane ships as a small `npx` tool over two provider shapes — not a from-scratch reimplementation of a 100-provider gateway.
- **It validates itself.** Telemetry records outcome and cost *per tier* in real sessions, so the open question — *how much real coding work is trivial enough for a cheap model?* — gets answered by usage, not assumption.

The infrastructure above is done and proven. What remains is the part nobody else has: **coding-agent-specific, execution-aware routing.**

## Model tiers

| Tier | For |
|------|-----|
| **FAST** | file reads, repo search, summaries, commit messages, trivial edits |
| **BALANCED** | small features, CRUD, tests, normal bug fixes, limited refactors |
| **POWERFUL** | architecture, hard debugging, repo-wide changes, migrations, planning |

## How it works

```
Coding Agent → Modlane: inbound (OpenAI | Anthropic)
             → execution signals → classify → route → provider adapter → Model Provider
```

Modlane exposes a **local gateway** (loopback, no auth). Agents point at it unmodified. Today routing is a stub (balanced tier); the classifier + signal extraction land next. Every decision is recorded (model, why, tokens, cost, fallback) — observability by default, metadata only (no code/prompts stored unless you opt in).

- **Inbound protocols:** OpenAI chat-completions, Anthropic Messages.
- **Providers:** OpenAI, OpenRouter, local (all OpenAI-compatible), and Anthropic.
- **Reference agents:** OpenCode, Codex (OpenAI), Claude Code (Anthropic).

## What Modlane is *not*

Not a generic AI gateway. The value is coding-agent-specific, repository-aware, execution-aware routing — not unified access to hundreds of models or generic load balancing.

## Roadmap

| Version | Theme |
|---------|-------|
| 0.1 | Router core + gateway + observability (in progress) |
| 0.2 | Task classification |
| 0.3 | Failure-aware escalation (middle-band only) |
| 0.4 | Agent-step routing |
| 0.5 | Repository performance history |
| 1.0 | Adaptive routing |

Build detail follows the P0–P8 plan in [`openspec/project.md`](openspec/project.md).

## Contributing

Modlane is an open-source developer tool built to be approachable, using **pnpm**. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Work is planned spec-first via OpenSpec — read a change proposal in [`openspec/changes/`](openspec/changes/) before implementing.

## License

[MIT](LICENSE) © Modlane contributors

<h1 align="center">Modlane</h1>

<p align="center">
  <strong>An adaptive AI model router for coding agents.</strong><br>
  <em>Don't use the most powerful model for every task. Use the right model for every step.</em>
</p>

<p align="center">
  <a href="#status">Status</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#model-tiers">Tiers</a> ·
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

**Pre-alpha — planning.** This repository currently contains the [OpenSpec](openspec/) planning foundation: product overview, capability specs, and the change proposals that build version 0.1. No runtime code yet. See [`openspec/project.md`](openspec/project.md).

## How it works

Modlane exposes a **local, OpenAI-compatible (and Anthropic-compatible) gateway**. Coding agents point at it and keep working unmodified. For each request Modlane picks a **model tier**, executes it on the configured provider, and records an explainable decision (what model, why, tokens, cost, latency, fallback).

- **Inbound protocols:** OpenAI chat-completions and Anthropic Messages.
- **Providers:** OpenAI, Anthropic, OpenRouter, local / OpenAI-compatible.
- **Reference agents (0.1):** OpenCode, Claude Code, Codex.

Routing in 0.1 is deterministic (tier-as-virtual-model). Task classification, failure-aware escalation, per-step routing, and adaptive learning arrive in later versions.

## Model tiers

| Tier | For |
|------|-----|
| **FAST** | file reads, repo search, summaries, commit messages, trivial edits |
| **BALANCED** | small features, CRUD, tests, normal bug fixes, limited refactors |
| **POWERFUL** | architecture, hard debugging, repo-wide changes, migrations, planning |

## What Modlane is *not*

Not a generic AI gateway. The value is coding-agent-specific, repository-aware, execution-aware routing — not unified access to hundreds of models or generic load balancing.

## Roadmap

| Version | Theme |
|---------|-------|
| 0.1 | Static routing + observability (gateway, tiers, providers, telemetry, CLI) |
| 0.2 | Task classification |
| 0.3 | Failure-aware escalation |
| 0.4 | Agent-step routing |
| 0.5 | Repository performance history |
| 1.0 | Adaptive routing |

Full detail: [`openspec/project.md`](openspec/project.md).

## Contributing

Modlane is an open-source developer tool built to be approachable. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Work is planned spec-first via OpenSpec — read a change proposal in [`openspec/changes/`](openspec/changes/) before implementing.

## License

[MIT](LICENSE) © Modlane contributors

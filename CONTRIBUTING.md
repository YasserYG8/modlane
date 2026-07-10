# Contributing to Modlane

Thanks for your interest. Modlane is an open-source tool built to be approachable for contributors. This guide covers how we work.

## Spec-first workflow

Modlane is developed **spec-first** using [OpenSpec](openspec/). Before writing code:

1. Read [`openspec/project.md`](openspec/project.md) for the product overview, principles, and decided constraints.
2. Find or open a **change proposal** in [`openspec/changes/`](openspec/changes/). Each change describes *why*, *what changes*, and the affected capability specs.
3. Implement against the change's spec deltas. Behavior lives in specs; implementation choices live in code and `design.md`.

New behavior needs a change proposal first. Bug fixes and docs can go straight to a PR.

## Architectural principles

Keep these intact (see `openspec/project.md` for detail):

- **Provider independence** — the routing core depends on the adapter interface, never a concrete provider.
- **Agent independence** — inbound protocols are pluggable.
- **Clear boundaries** — gateway · protocol · routing · providers · telemetry · persistence · configuration are separate.
- **Local first** — works locally, no cloud account.
- **Observability by default** — every routing decision is explainable.
- **Privacy** — store metadata, not source code / prompts / responses, unless explicitly enabled.

## Development

> Runtime: **TypeScript / Node**. Tooling lands with change `0-bootstrap-project`.

```bash
# copy the example config and edit it (modlane.yaml is gitignored)
cp modlane.example.yaml modlane.yaml

pnpm install
pnpm test
pnpm run typecheck
pnpm run build
```

This project uses **pnpm** (see `packageManager` in `package.json`). Don't commit a `package-lock.json`.

## Coding standards

- Small, focused files (aim < 400 lines, 800 hard max). Organize by feature.
- Immutable data; explicit error handling; validate at boundaries.
- No hardcoded secrets — resolve from environment variables.
- Tests required for new behavior; target 80% coverage. Three pillars: protocol contract tests, adapter conformance tests, routing decision tables.

## Commits & pull requests

- **Conventional Commits:** `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`.
- Keep PRs focused. Link the change proposal you are implementing.
- Ensure CI passes, no merge conflicts, branch up to date with `main`.
- Fill in the PR template.

## Reporting bugs & requesting features

Use the issue templates. For security issues, **do not** open a public issue — see [SECURITY.md](SECURITY.md).

## Code of Conduct

Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md).

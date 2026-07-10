# P0 — Bootstrap (post-pivot)

## Why

First buildable slice of the pivoted plan (TS/Node, `npx modlane`, routing-brain-as-product — see `project.md` → "Pivot — post-validation"). Establishes the project so P1–P8 have a foundation, and ships a runnable gateway skeleton with a health endpoint.

## What changes

- TypeScript/Node project: strict `tsconfig`, `modlane` npx bin, build/test/typecheck scripts.
- Thin HTTP gateway (`node:http`, no framework) exposing `GET /health`.
- `modlane` CLI: `start`, `--version`, `--help`.
- Vitest scoped to `src/` (excludes the local `aider/` benchmark clone).

## Impact

- Adds project scaffolding + `gateway` health surface (partial; full inbound in P3).
- No provider calls, no routing yet. Unblocks P1–P8.

## Status

Done — `npm test` green (2/2), `npm run build` OK, `modlane start` serves `/health`.

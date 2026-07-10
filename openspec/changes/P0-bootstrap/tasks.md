# P0 — Tasks

- [x] `package.json` — `modlane` bin, ESM, Node ≥20, build/dev/test/typecheck scripts
- [x] `tsconfig.json` — strict, NodeNext, `noUncheckedIndexedAccess`
- [x] `src/server.ts` — `node:http` gateway, `GET /health`, 404 error shape
- [x] `src/cli.ts` — `start` / `--version` / `--help`
- [x] `src/server.test.ts` — health 200 + 404 shape
- [x] `vitest.config.ts` — scope tests to `src/`, exclude `aider/`
- [x] Verify: typecheck + tests green, `modlane start` serves `/health`

## Next (P1)
- [ ] Config schema (tiers, providers, thresholds), load `modlane.yaml` → `~/.modlane/config.yaml`, validate, resolve secrets from env

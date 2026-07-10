# P1 — Tasks

- [x] `src/config.ts` — types (Config, ProviderConfig, TierConfig), `loadConfig`, `resolveApiKey`
- [x] YAML parse via `yaml` dep; snake_case → camelCase normalization at the boundary
- [x] Search order `./modlane.yaml` → `~/.modlane/config.yaml`; missing → `ConfigError` naming both paths
- [x] Validation: missing tier, undefined provider reference, wrong types, invalid provider kind
- [x] Secrets from env; missing required secret errors naming the var
- [x] Wire `modlane start` to load config + bind `server.host:port`
- [x] `src/config.test.ts` — valid load, missing tier, undefined provider, missing file, secret resolution (5 tests)
- [x] Verify: typecheck + tests (7 total) green; start with/without config behaves

## Next (P2)
- [ ] Provider layer: OpenAI-compat + Anthropic adapters, common send/stream + usage normalization + fallback

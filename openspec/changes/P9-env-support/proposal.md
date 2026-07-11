# P9 — Local .env File Support

## Why
Instead of forcing developers to manually `export` their API keys in their console session before starting Modlane, we want to allow storing them in a local, gitignored `.env` file that loads automatically at startup.

## What changes
- `src/cli.ts`: Injected environment variable loading on startup. Uses `process.loadEnvFile()` natively (Node 20.12+) or a custom line-by-line fallback parser for older Node versions.
- `src/env.test.ts` [NEW]: Unit tests covering the fallback parser logic (quotes, spacing, comments).

## Impact
Improves developer UX significantly, removing the need for console environment setup while keeping keys safely gitignored.

## Status
Done — implemented, fully tested, and compiling.

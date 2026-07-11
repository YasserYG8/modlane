# P4 — Execution Signals Extractor

## Why
To implement intelligent, adaptive routing, the router must understand the status and complexity of the developer session. Modlane does this by mining execution signals (consecutive errors, files touched, repeated edits, context size) from incoming request history.

## What changes
- `src/providers/types.ts`: added `dialect` and `rawBody` properties to neutral `ChatRequest`.
- `src/server.ts`: populated `dialect` and `rawBody` on request parsing.
- `src/signals.ts` [NEW]: implements the `extractSignals` parser, extracting tool usage, results, test failures, files modified, consecutive failures, and repeated edits from the raw dialect messages.
- `src/signals.test.ts` [NEW]: unit tests covering signal extraction for both OpenAI and Anthropic formats.

## Impact
Allows downstream classification (P5) and routing (P6) systems to inspect the current state of a development session and make routing decisions based on actual execution metrics rather than stubs.

## Status
Done — implemented, fully tested, and compiling.

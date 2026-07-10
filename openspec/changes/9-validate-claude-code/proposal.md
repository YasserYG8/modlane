# 9 — Validate Claude Code integration

## Why

Claude Code is a co-primary reference agent for 0.1. Because change 8 adds the Anthropic Messages inbound protocol, integration is configuration + an end-to-end proof, not a bespoke adapter. This closes the Claude Code loop and de-risks the Anthropic protocol against a real agent.

## What changes

- Document the Claude Code config recipe:
  - `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>`
  - `ANTHROPIC_MODEL=modlane-powerful` (or `modlane-balanced`)
  - `ANTHROPIC_SMALL_FAST_MODEL=modlane-fast`
  - auth token handling as required by Claude Code.
- End-to-end test: Claude Code drives a real coding task through Modlane, exercising non-streaming, streaming (event stream), and tool use.
- Record which Anthropic Messages behaviors Claude Code actually depends on; feed any gaps back to the `anthropic-messages` protocol spec.

## Impact

- No new capability. Validation + integration recipe.
- Depends on: change 8 (anthropic-messages), gateway, routing, provider-adapters.
- Completes the Claude Code half of version 0.1.

## Notes

Claude Code's built-in main/small-fast split maps directly to Modlane tiers, so tier selection needs no Modlane-side logic — the env vars do it.

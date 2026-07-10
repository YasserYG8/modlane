# 7 — Validate OpenCode integration

## Why

OpenCode is the reference agent for 0.1. Because the gateway is OpenAI-compatible, integration is configuration + an end-to-end proof, not a bespoke adapter. This change closes the 0.1 loop and de-risks the compatibility contract against a real agent.

## What changes

- Document the OpenCode config recipe: point OpenCode at `http://127.0.0.1:<port>/v1` as an OpenAI-compatible provider, using `modlane-fast|balanced|powerful` as models.
- End-to-end test: OpenCode drives a real coding task through Modlane, exercising non-streaming, streaming, and tool calls.
- Record which OpenAI-compat behaviors OpenCode actually depends on; feed any gaps back to the gateway spec.

## Impact

- No new capability. Validation + integration recipe.
- Depends on: gateway, routing, provider-adapters, configuration.
- Completes version 0.1.

## Notes

If OpenCode requires a behavior not covered by the gateway spec, that is a gateway spec change, not a new capability.

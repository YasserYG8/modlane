# protocol

## ADDED Requirements

### Requirement: Anthropic Messages protocol
The system SHALL provide an `anthropic-messages` inbound protocol adapter exposing `POST /v1/messages`.

#### Scenario: Non-streaming message
- **WHEN** a client posts a valid Messages request naming a Modlane virtual model
- **THEN** the adapter normalizes it (top-level `system`, `messages`, `max_tokens`), routes it, and returns an Anthropic-shaped message response

#### Scenario: Streaming message
- **WHEN** a Messages request sets `stream: true`
- **THEN** the adapter emits the Anthropic event stream (`message_start` … `message_stop`) with content deltas

#### Scenario: Tool use passthrough
- **WHEN** the request includes `tools` and the model emits `tool_use`
- **THEN** `tool_use` and subsequent `tool_result` blocks are passed through unchanged

#### Scenario: Anthropic error shape
- **WHEN** execution fails for a Messages request
- **THEN** the error is returned in the Anthropic error shape

### Requirement: Protocol independent of provider
The inbound protocol SHALL be independent of the outbound provider.

#### Scenario: Cross protocol/provider routing
- **WHEN** a request arrives via the Anthropic protocol and its tier resolves to a non-Anthropic provider
- **THEN** the request is executed on that provider and returned in the Anthropic shape

# protocol

## ADDED Requirements

### Requirement: Inbound protocol adapter contract
An inbound protocol adapter SHALL parse a protocol-specific request into the internal normalized request and re-shape the internal result (including streaming and tool structures) back into that protocol.

#### Scenario: Normalize and de-normalize
- **WHEN** a request arrives in a supported protocol
- **THEN** the adapter produces a normalized request and, after execution, renders the result in the same protocol

### Requirement: OpenAI chat-completions protocol
The system SHALL provide an `openai-chat` inbound protocol adapter exposing `POST /v1/chat/completions` and `GET /v1/models`.

#### Scenario: Non-streaming completion
- **WHEN** an agent posts a valid chat-completions request naming a Modlane virtual model
- **THEN** the adapter returns an OpenAI-shaped completion

#### Scenario: Model listing
- **WHEN** an agent requests `GET /v1/models`
- **THEN** the response includes `modlane-fast`, `modlane-balanced`, and `modlane-powerful`

#### Scenario: Streaming
- **WHEN** a request sets `stream: true`
- **THEN** the adapter emits OpenAI-format SSE chunks terminated by `[DONE]`

#### Scenario: Tool-call passthrough
- **WHEN** a request includes `tools`/`tool_choice`
- **THEN** they are forwarded to the provider and any `tool_calls` are returned unchanged

#### Scenario: Unknown model
- **WHEN** the request names a model not advertised
- **THEN** the adapter returns an OpenAI-shaped error

# provider-adapters

## ADDED Requirements

### Requirement: Provider-independent core
The routing core SHALL depend only on the adapter interface and SHALL NOT reference any concrete provider.

#### Scenario: Adding a provider
- **WHEN** a new provider adapter implementing the interface is registered
- **THEN** it is usable by routing without changes to routing or gateway code

### Requirement: Adapter contract
Each adapter SHALL implement synchronous send, streaming send, usage normalization, and error mapping to a common shape.

#### Scenario: Non-streaming request
- **WHEN** the gateway sends a non-streaming completion request through an adapter
- **THEN** the adapter returns a normalized response including token usage

#### Scenario: Streaming request
- **WHEN** the gateway sends a streaming request through an adapter
- **THEN** the adapter yields incremental chunks in the common streaming shape

### Requirement: Usage normalization
Each adapter SHALL report prompt and completion token counts in a common shape, or mark them unavailable when the provider does not supply them.

#### Scenario: Provider omits usage on stream
- **WHEN** a streaming provider does not return token usage
- **THEN** the adapter marks usage as estimated/unavailable rather than reporting zero

### Requirement: 0.1 provider coverage
The system SHALL ship adapters for OpenAI, Anthropic, OpenRouter, and a generic OpenAI-compatible endpoint.

#### Scenario: Local model via OpenAI-compatible endpoint
- **WHEN** a local model exposes an OpenAI-compatible API and is configured as such
- **THEN** the generic adapter routes to it without a dedicated adapter

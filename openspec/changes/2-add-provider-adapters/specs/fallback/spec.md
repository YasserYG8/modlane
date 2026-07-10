# fallback

## ADDED Requirements

### Requirement: Provider failure fallback
When the primary provider for a tier fails, the system SHALL attempt the configured alternate provider for the same tier before returning an error.

#### Scenario: Primary provider errors
- **WHEN** the primary provider returns a 5xx or connection error
- **AND** an alternate provider is configured for that tier
- **THEN** the system retries the request on the alternate provider

#### Scenario: No alternate configured
- **WHEN** the primary provider fails
- **AND** no alternate is configured for that tier
- **THEN** the system returns an OpenAI-shaped error to the agent

#### Scenario: Fallback recorded
- **WHEN** a request is served by an alternate provider after a primary failure
- **THEN** the decision record flags `fallback=true` and identifies both providers

### Requirement: Fallback is not escalation
Fallback SHALL keep the same tier and only change provider.

#### Scenario: Same tier preserved
- **WHEN** fallback occurs
- **THEN** the tier is unchanged and no stronger model is selected as a result of the fallback

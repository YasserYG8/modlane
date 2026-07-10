# telemetry

## ADDED Requirements

### Requirement: Explainable routing decision
For every request the system SHALL record why a model was selected.

#### Scenario: Decision explained
- **WHEN** a request completes
- **THEN** the telemetry record includes the chosen model, tier, triggering rule, and fallback/escalation flags

### Requirement: Metric capture
The system SHALL record latency, prompt tokens, completion tokens, and estimated cost per request.

#### Scenario: Metrics recorded
- **WHEN** a request completes
- **THEN** its record includes latency and token counts

#### Scenario: Estimated cost labeled
- **WHEN** cost is recorded
- **THEN** it is derived from tokens and configured price and marked as estimated

#### Scenario: Usage unavailable
- **WHEN** the provider did not report token usage
- **THEN** tokens are marked estimated/unavailable rather than recorded as zero

### Requirement: Correlation key
Each telemetry record SHALL include a correlation key for grouping requests into a task.

#### Scenario: Correlation present from 0.1
- **WHEN** any request is recorded in 0.1
- **THEN** a correlation key is stored even though escalation and history do not yet consume it

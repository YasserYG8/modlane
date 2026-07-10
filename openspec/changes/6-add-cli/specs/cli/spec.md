# cli

## ADDED Requirements

### Requirement: Start command
The CLI SHALL provide `modlane start` to run the gateway.

#### Scenario: Start gateway
- **WHEN** the user runs `modlane start` with valid config
- **THEN** the gateway begins listening and reports its address

#### Scenario: Start with invalid config
- **WHEN** the config is invalid
- **THEN** `modlane start` exits non-zero with the validation error

### Requirement: Status command
The CLI SHALL provide `modlane status` reporting whether the gateway is running and its address.

#### Scenario: Report status
- **WHEN** the user runs `modlane status`
- **THEN** it reports running/stopped and the bound address when running

### Requirement: Models command
The CLI SHALL provide `modlane models` listing virtual models and their resolved provider/model.

#### Scenario: List resolved models
- **WHEN** the user runs `modlane models`
- **THEN** each virtual model is shown with its tier and resolved provider/model

### Requirement: Stats command
The CLI SHALL provide `modlane stats` summarizing usage from telemetry.

#### Scenario: Show stats
- **WHEN** the user runs `modlane stats`
- **THEN** it reports requests, tokens, estimated cost, latency, and fallbacks per model/tier

### Requirement: Config command
The CLI SHALL provide `modlane config` to show and validate the active configuration.

#### Scenario: Show config source
- **WHEN** the user runs `modlane config`
- **THEN** it prints the active config, its source path, and validation result

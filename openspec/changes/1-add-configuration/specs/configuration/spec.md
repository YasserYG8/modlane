# configuration

## ADDED Requirements

### Requirement: Declarative configuration
The system SHALL load configuration from a single declarative YAML file describing providers, tier-to-model mapping, and router strategy.

#### Scenario: Config found in working directory
- **WHEN** `modlane.yaml` exists in the current working directory
- **THEN** the system loads it as the active configuration

#### Scenario: Fallback to home config
- **WHEN** no `modlane.yaml` exists in the working directory
- **AND** `~/.modlane/config.yaml` exists
- **THEN** the system loads the home-directory config

#### Scenario: No config present
- **WHEN** no config file is found in either location
- **THEN** the system exits with a clear message naming both searched paths

### Requirement: Tier mapping
The configuration SHALL map each tier (`fast`, `balanced`, `powerful`) to exactly one provider and model.

#### Scenario: All tiers mapped
- **WHEN** the config defines a provider and model for each of the three tiers
- **THEN** validation passes

#### Scenario: Missing tier mapping
- **WHEN** a tier has no provider/model mapping
- **THEN** the system fails to start and names the unmapped tier

### Requirement: Validation and fail-fast
The system SHALL validate configuration on load and refuse to start on invalid configuration.

#### Scenario: Invalid config
- **WHEN** the config references an undefined provider or omits a required field
- **THEN** the system exits non-zero with a message identifying the offending field

### Requirement: Secret resolution
The system SHALL resolve provider secrets from environment variables and SHALL NOT require secrets to be stored in the config file.

#### Scenario: Secret from environment
- **WHEN** a provider's API key is provided via its configured environment variable
- **THEN** the provider is usable without the key appearing in the config file

#### Scenario: Missing required secret
- **WHEN** a configured provider's required secret is absent from the environment
- **THEN** the system reports the missing environment variable at startup

# routing

## ADDED Requirements

### Requirement: Tier definitions
The system SHALL define three routing tiers: `fast`, `balanced`, `powerful`, each resolving to a configured provider and model.

#### Scenario: Tier resolves to model
- **WHEN** the router selects a tier
- **THEN** it resolves the provider and model from configuration for that tier

### Requirement: Virtual-model routing (0.1)
The system SHALL route by mapping the requested virtual model name to a tier.

#### Scenario: Fast virtual model
- **WHEN** a request names the virtual model `modlane-fast`
- **THEN** the router selects the `fast` tier

#### Scenario: Powerful virtual model
- **WHEN** a request names the virtual model `modlane-powerful`
- **THEN** the router selects the `powerful` tier

#### Scenario: Unknown virtual model
- **WHEN** a request names a model not mapped to any tier
- **THEN** the system returns a protocol-shaped error (in the inbound protocol's error shape) identifying the unknown model

### Requirement: Deterministic strategy
The router SHALL evaluate rules in an explicit, ordered strategy and produce the same decision for the same inputs.

#### Scenario: Repeatable decision
- **WHEN** the same request is routed twice with unchanged configuration
- **THEN** the router selects the same tier and model both times

### Requirement: Decision record
For every request the router SHALL emit a decision record containing the chosen model, tier, triggering rule, correlation key, and fallback/escalation flags.

#### Scenario: Record emitted on every route
- **WHEN** any request is routed
- **THEN** a decision record is produced, even when the triggering rule is the trivial virtual-model mapping

#### Scenario: Escalation flag in 0.1
- **WHEN** a request is routed in 0.1
- **THEN** the decision record's escalation flag is `false`

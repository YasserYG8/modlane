# persistence

## ADDED Requirements

### Requirement: Local store
The system SHALL persist telemetry and usage history in a local SQLite file behind a persistence interface.

#### Scenario: Records survive restart
- **WHEN** the gateway is restarted
- **THEN** previously recorded telemetry remains queryable

#### Scenario: Storage swappable
- **WHEN** a different store implements the persistence interface
- **THEN** telemetry and history work without changes to routing or gateway code

### Requirement: History queryable
The store SHALL support querying usage history for reporting.

#### Scenario: Stats query
- **WHEN** the cli requests usage stats
- **THEN** the store returns aggregated per-model/per-tier usage

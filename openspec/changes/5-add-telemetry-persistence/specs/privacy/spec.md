# privacy

## ADDED Requirements

### Requirement: Metadata-only by default
By default the system SHALL persist metadata only and SHALL NOT persist source code, prompts, or model responses.

#### Scenario: Content not stored
- **WHEN** a request is processed with default settings
- **THEN** no prompt, code, or response content is written to persistence

### Requirement: Opt-in content capture
Content capture SHALL be off by default and require explicit opt-in.

#### Scenario: Explicit enable
- **WHEN** content capture is not enabled in config
- **THEN** the system stores no content regardless of request

#### Scenario: Redaction on capture
- **WHEN** content capture is explicitly enabled
- **THEN** captured content passes through redaction before storage

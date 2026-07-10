# gateway

## ADDED Requirements

### Requirement: Local HTTP server
The gateway SHALL run an HTTP server bound to `127.0.0.1` and SHALL NOT require authentication in 0.1.

#### Scenario: Local-only binding
- **WHEN** the gateway starts
- **THEN** it listens on the loopback interface only

### Requirement: Protocol-agnostic core
The gateway core SHALL dispatch each inbound request to the matching inbound protocol adapter and SHALL NOT contain protocol-specific request logic itself.

#### Scenario: Dispatch by protocol
- **WHEN** a request arrives on a protocol's route
- **THEN** the core hands it to that protocol's adapter for normalization

#### Scenario: Adding a protocol
- **WHEN** a new inbound protocol adapter is registered
- **THEN** it works without changes to routing, provider-adapters, or the core execution path

### Requirement: Normalized execution path
The gateway SHALL execute every normalized request through routing then a provider adapter, and re-shape the result via the originating inbound protocol.

#### Scenario: End-to-end execution
- **WHEN** a normalized request is produced by any protocol adapter
- **THEN** it is routed, executed via the selected provider, and returned in the same inbound protocol's shape

### Requirement: Protocol-scoped error mapping
The gateway SHALL map provider and internal errors to the error shape of the inbound protocol that received the request.

#### Scenario: Error in the caller's dialect
- **WHEN** execution fails for a request received via a given protocol
- **THEN** the error is returned in that protocol's error shape

# gateway

## ADDED Requirements

### Requirement: Local HTTP server
The gateway SHALL run an HTTP server bound to `127.0.0.1` and SHALL NOT require authentication in 0.1.

#### Scenario: Local-only binding
- **WHEN** the gateway starts
- **THEN** it listens on the loopback interface only

#### Scenario: Inbound auth header ignored
- **WHEN** an agent (e.g. Claude Code) sends an `Authorization` or `x-api-key` header to the gateway
- **THEN** the gateway ignores it and does not treat it as required

### Requirement: Health endpoint
The gateway SHALL expose `GET /health` returning a success status while running, so `modlane status` can confirm liveness.

#### Scenario: Health check while running
- **WHEN** the gateway is running and receives `GET /health`
- **THEN** it responds with a 2xx status

### Requirement: No rate limiting in 0.1
The gateway SHALL NOT impose rate limiting or request-size limits in 0.1. This is an explicit non-goal for a local, single-user tool.

#### Scenario: No throttling
- **WHEN** many requests arrive in quick succession from the local agent
- **THEN** the gateway does not throttle or reject them on rate grounds

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

# Modlane 0.1 — System Design

Status: **draft for review.** This document gives the end-to-end technical context for version 0.1 so the design can be validated before tasks are generated. It spans changes 0–10. Behavior lives in the capability specs; this doc records *how* the pieces fit and the decisions that need sign-off (see **Open Questions**).

Scope reminder (0.1): deterministic routing (tier-as-virtual-model), two inbound protocols (openai-chat, anthropic-messages), provider adapters (openai, anthropic, openai-compatible), fallback, telemetry, local SQLite, CLI. No content classification, no escalation, no step-routing.

---

## 1. Module map & dependencies

Boundaries as directories; arrows = allowed import direction (never the reverse).

```
cli ──┐
      ├─> gateway ──> protocol ──> routing ──> providers
      │       │                        │           │
      │       └────────> telemetry <───┴───────────┘
      │                     │
config <── (read by all)    └─> persistence
                            privacy ──(constrains)──> telemetry, persistence
```

- **config** — parse/validate YAML, resolve secrets from env. Pure, no I/O beyond file read.
- **providers** — adapter per backend. Depends only on the neutral model + config. Never imported by routing's decision logic except through the adapter interface.
- **routing** — pick tier + provider/model, emit decision record. In 0.1 a pure function.
- **protocol** — inbound adapters: parse protocol → neutral request; render neutral result → protocol. Owns streaming/tool/error shaping per dialect.
- **gateway** — HTTP server, dispatch, orchestrate the request lifecycle, thread telemetry.
- **telemetry / persistence** — record decisions + metrics; SQLite store behind an interface.
- **privacy** — gate on content capture.
- **cli** — operate: start/status/models/stats/config.

---

## 2. The central design decision — hub-and-spoke with a passthrough fast-path

Two inbound protocols × three provider kinds. Two ways to translate:

- **(A) Neutral core (hub-and-spoke):** inbound → `NeutralRequest` → provider renders to its API. `N + M` translators. Clean, but the neutral model risks losing provider-specific fields.
- **(B) Direct pairs:** one translator per inbound×provider pair. `N × M`. Lossless, more code.

**Decision: (A) with a passthrough fast-path.**

- When the **inbound protocol matches the provider's native protocol** (OpenCode/Codex → OpenAI provider; Claude Code → Anthropic provider), skip neutral translation. Pass the body through nearly raw — only swap the virtual model id for the concrete model and capture usage. This is the ~90% case and stays lossless.
- When they **differ** (e.g. Claude Code → an OpenAI model, or OpenCode → Anthropic), go through the neutral model and translate.

Rationale: coding agents almost always route to their own native provider, so the common path is near-identity. The lossy cross-translation only runs when the user deliberately crosses dialects. Minimizes both risk and code.

> This is **Open Question 1** — the load-bearing fork. Everything below assumes (A)+fast-path.

---

## 3. Neutral data model (pseudocode — not final code)

```
type Tier = 'fast' | 'balanced' | 'powerful'
type InboundProtocol = 'openai-chat' | 'anthropic-messages'

interface NeutralRequest {
  correlationId: string          // groups requests into a task (§9)
  tier: Tier                     // resolved from the virtual model name
  inbound: InboundProtocol
  system?: string
  messages: NeutralMessage[]
  tools?: NeutralTool[]
  maxTokens?: number
  temperature?: number
  stream: boolean
  rawBody: unknown               // original request, for the passthrough fast-path
}

interface NeutralMessage {
  role: 'user' | 'assistant' | 'tool'
  content: NeutralPart[]         // text | tool_call | tool_result
}

interface NeutralResult {
  text: string
  toolCalls?: NeutralToolCall[]
  stopReason: 'stop' | 'length' | 'tool_use' | 'error'
  usage: { promptTokens?: number; completionTokens?: number; estimated: boolean }
}

interface RoutingDecision {
  correlationId: string
  tier: Tier
  provider: string
  model: string
  rule: string                   // 0.1: "virtual-model-mapping"
  fallback: boolean
  escalation: boolean            // 0.1: always false
}
```

Rendering `NeutralRequest → provider` and `provider result → NeutralResult` lives in each provider adapter. Rendering `protocol ↔ neutral` lives in each protocol adapter.

---

## 4. Request lifecycle

**Non-streaming:**

```
agent → HTTP → gateway.dispatch(protocol)
  protocol.parse(body) ─────────────> NeutralRequest (tier resolved)
  routing.decide(req) ──────────────> RoutingDecision (provider/model)
  [fast-path?] provider.send(rawBody or neutral) ─> provider result
  protocol.render(result) ──────────> protocol-shaped response → agent
  telemetry.record(decision, metrics)            (after response, async)
```

**Streaming:** tier and provider are chosen **before** the stream opens (no mid-stream switch). Then chunks flow provider → protocol.render(chunk) → agent. Usage is captured from the terminal chunk if present, else estimated (§8). Telemetry is written on stream close.

**Mid-stream failure:** once chunks have been sent, the HTTP status is already committed — no clean error response is possible. Policy: **no fallback and no retry mid-stream.** The gateway closes the stream (emitting the protocol's error/abort event where the dialect supports one) and records the request with `status = error`, `error_kind` set. Fallback only applies before the first byte is sent.

**Fallback:** if `provider.send` throws a retryable error (5xx/timeout/connection) and the tier has a configured alternate, retry once on the alternate, set `decision.fallback = true`. Not retryable (4xx from provider) → map to inbound error shape, no retry.

---

## 5. Inbound protocol mapping (the hard part)

Identity when inbound == provider dialect. The table below is the **cross-dialect** translation the neutral model must carry losslessly enough for coding agents.

| Concept | OpenAI chat | Anthropic messages | Neutral |
|---|---|---|---|
| System prompt | `messages[role=system]` | top-level `system` | `system?: string` |
| User/assistant turns | `messages[]` | `messages[]` | `messages[]` |
| Text content | `content: string` | `content: [{type:text}]` | `NeutralPart.text` |
| Tool definition | `tools[].function{name,parameters}` | `tools[]{name,input_schema}` | `NeutralTool{name, schema}` |
| Model asks to call tool | `tool_calls[]{id,function{name,arguments}}` | `content[]{type:tool_use,id,name,input}` | `NeutralToolCall{id,name,args}` |
| Tool result back to model | `messages[role=tool,tool_call_id]` | `content[]{type:tool_result,tool_use_id}` | `NeutralPart.tool_result` |
| Stop reason | `finish_reason: stop\|length\|tool_calls` | `stop_reason: end_turn\|max_tokens\|tool_use` | `stopReason` |
| Token usage | `usage{prompt_tokens,completion_tokens}` | `usage{input_tokens,output_tokens}` | `usage{promptTokens,completionTokens}` |
| Max tokens | optional `max_tokens` | **required** `max_tokens` | `maxTokens?` (default injected when rendering to Anthropic) |

**Streaming events** (cross-dialect re-emit):

| OpenAI SSE | Anthropic event stream |
|---|---|
| `chat.completion.chunk` deltas | `message_start` → `content_block_start` → `content_block_delta` → `content_block_stop` → `message_delta` → `message_stop` |
| `[DONE]` sentinel | `message_stop` |

Tool-call arguments stream as partial JSON in both; the neutral streamer buffers per tool-call id and re-emits in the target shape.

> Edge: Anthropic requires `max_tokens`. When an OpenAI-inbound request omits it and routes to an Anthropic provider, the adapter injects a configured default. Documented, not silent — logged in the decision record.

---

## 6. Provider adapters

```
interface ProviderAdapter {
  kind: 'openai' | 'anthropic' | 'openai-compatible'
  send(model, req: NeutralRequest | RawPassthrough): Promise<NeutralResult>
  stream(model, req): AsyncIterable<NeutralChunk>
  // normalization + error mapping are internal
}
```

- `openai` and `openai-compatible` share one implementation (same wire API, different base_url/auth). Covers OpenRouter and local models (Ollama, LM Studio, vLLM).
- `anthropic` is its own.
- All pass one **conformance suite**: send, stream, usage normalization, error mapping, tool round-trip.

---

## 7. Routing (0.1)

Pure function. `virtualModel → tier → (provider, model)` from config. Emits a `RoutingDecision` every time even though the rule is trivial, so the observability contract is stable before 0.2 adds real rules behind the same interface. Unknown virtual model → protocol-shaped error.

---

## 8. Cost, tokens, latency

- **Latency** — wall clock around `provider.send`/stream lifetime.
- **Tokens** — from provider `usage`. If absent (some streaming providers), mark `estimated: true`; optional local tokenizer estimate is a nice-to-have, not required for 0.1.
- **Cost** — `tokens × price`. Prices come from an **optional** per-model price map in config. If a model has no price entry, cost is `null` (not zero). Cost is always labeled an estimate.

> **Open Question 3** — ship the optional price map in 0.1, or defer cost entirely to a later version and only track tokens in 0.1?

---

## 9. Correlation key (recorded now, consumed later)

Escalation (0.3) and performance-history (0.5) need to group requests into one coding task. The OpenAI/Anthropic APIs are stateless. 0.1 does not *use* the key but **must record one** to avoid backfill.

Candidate mechanisms (**Open Question 2**):
- **(a)** Per-TCP-connection id — cheap, but an agent may reuse/close connections arbitrarily.
- **(b)** Hash of the first N messages / conversation prefix — stable across reconnects, fuzzy.
- **(c)** A Modlane header the agent sets — precise, but requires agent cooperation.

Recommendation for 0.1: **(a) per-connection id**, cheapest and good enough to store; revisit when escalation actually consumes it.

---

## 10. Persistence schema (SQLite, indicative)

```
requests(
  id, ts, correlation_id, inbound_protocol,
  tier, provider, model, rule,
  fallback, escalation,
  latency_ms, prompt_tokens, completion_tokens, tokens_estimated,
  cost_estimate, cost_currency,
  status, error_kind
)
```

Content columns intentionally absent (privacy default). One table is enough for 0.1; `modlane stats` aggregates from it. Store behind a `TelemetryStore` interface so SQLite is swappable.

---

## 11. Configuration (concrete shape for review)

```yaml
server:
  host: 127.0.0.1
  port: 4700

router:
  strategy: rules            # 0.1: only 'rules'

tiers:
  fast:     { provider: openrouter, model: <model-id> }
  balanced: { provider: anthropic,  model: <model-id> }
  powerful: { provider: openai,     model: <model-id> }

providers:
  openai:      { kind: openai,            base_url: https://api.openai.com/v1,  api_key_env: OPENAI_API_KEY }
  anthropic:   { kind: anthropic,         base_url: https://api.anthropic.com,  api_key_env: ANTHROPIC_API_KEY }
  openrouter:  { kind: openai-compatible, base_url: https://openrouter.ai/api/v1, api_key_env: OPENROUTER_API_KEY }
  local:       { kind: openai-compatible, base_url: http://127.0.0.1:11434/v1,  api_key_env: null }

fallback:                    # optional per-tier alternate
  fast: { provider: local, model: <model-id> }

anthropic_defaults:
  max_tokens: 4096           # injected when an OpenAI-inbound request lacks it

telemetry:
  store: ./modlane.sqlite
  capture_content: false     # privacy default; opt-in only

prices:                      # optional; omit → cost = null (OQ3)
  <model-id>: { input_per_mtok: 0.0, output_per_mtok: 0.0 }
```

---

## 12. Error taxonomy

Internal error kinds → mapped to the **inbound** protocol's error shape:

| Internal | Meaning | HTTP |
|---|---|---|
| `unknown_model` | virtual model not mapped | 404/400 |
| `provider_unavailable` | 5xx/timeout, no fallback left | 502 |
| `provider_rejected` | provider 4xx (bad request, auth) | passthrough status |
| `config_invalid` | caught at startup, never at request time | n/a (fails to start) |
| `internal` | Modlane bug | 500 |

OpenAI shape: `{error:{message,type,code}}`. Anthropic shape: `{type:"error",error:{type,message}}`.

---

## 13. CLI ↔ running gateway

- `modlane start` — runs the gateway **foreground** (daemonization deferred). Writes a pidfile + bound address.
- `modlane status` — reads pidfile, pings the health endpoint.
- `modlane stats` — reads the SQLite store **directly** (no IPC needed).
- `modlane models` / `config` — read config, no running server required.

Lazy + local-first: no IPC layer, no control socket. stats/status work off the pidfile + SQLite the server already writes.

> **Open Question 4** — confirm foreground-only start for 0.1 (daemon/`--detach` later).

---

## 14. Cross-cutting

- **Concurrency** — Node async; each request independent. SQLite writes serialized (WAL mode) or queued.
- **Privacy** — content never touches persistence unless `capture_content: true`; even then, redaction first.
- **Security** — binds loopback, no auth in 0.1 (explicit non-goal). Secrets only from env.

---

## Open Questions (need your call before tasks)

1. ~~**Hub-and-spoke + passthrough fast-path** (§2) — approve this as the translation architecture?~~ ✅ **RESOLVED: approved.** Neutral core with a passthrough fast-path when inbound dialect == provider dialect.
2. ~~**Correlation key mechanism** (§9)~~ ✅ **RESOLVED: per-connection id** for 0.1 (recorded, not yet consumed).
3. ~~**Cost in 0.1** (§8)~~ ✅ **RESOLVED: ship the optional price map.** Cost = tokens × price, or `null` when no price entry.
4. ~~**Foreground-only `start`** (§13)~~ ✅ **RESOLVED: foreground only** for 0.1. Daemon/`--detach` deferred.
5. ~~**Default port** — `4000`?~~ ✅ **RESOLVED: `4700`.** Chosen to avoid framework defaults (3000/4000/4200/5000/5173/8000/8080/9000/11434). Overridable in config.

Deferred to tasks (implementation, not design): HTTP framework, tokenizer library, SQLite driver, test runner.

## Risks

- **R1** Dual-dialect lossiness — mitigated by the fast-path (only cross-dialect translates) + the protocol conformance suite.
- **R2** Streaming tool-call re-emission across dialects — buffer-per-id; covered by contract tests.
- **R3** Provider usage gaps on streaming — degrade to estimated/unavailable, never fake zero.
- **R4** `max_tokens` requirement mismatch — configured default, logged.

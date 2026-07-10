import type { ProviderKind } from "../config.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** OpenAI tool-result correlation; carried through, unused until tool support lands. */
  toolCallId?: string;
}

export interface ChatRequest {
  /** Concrete provider model id (already resolved from a tier). */
  model: string;
  messages: ChatMessage[];
  system?: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  /** Provider-native tool definitions, passed through unchanged. */
  tools?: unknown;
}

export interface Usage {
  promptTokens: number | null;
  completionTokens: number | null;
  /** true when the provider did not report usage (never fake a zero). */
  estimated: boolean;
}

/** Provider-neutral stop reason; protocol renderers map it back to each dialect. */
export type StopReason = "stop" | "length" | "tool_use";

export interface ChatResult {
  text: string;
  stopReason: StopReason;
  usage: Usage;
  model: string;
  raw: unknown;
}

/** One incremental piece of a streamed response. `usage`/`stopReason` usually arrive last. */
export interface StreamChunk {
  textDelta?: string;
  stopReason?: StopReason;
  usage?: Usage;
}

export interface ProviderAdapter {
  readonly kind: ProviderKind;
  send(req: ChatRequest): Promise<ChatResult>;
  stream(req: ChatRequest): AsyncIterable<StreamChunk>;
}

/** Provider or transport failure. `retryable` gates fallback (5xx / 429 / network). */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

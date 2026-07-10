import type { ChatRequest, ChatResult, ProviderAdapter, StopReason, StreamChunk } from "./types.js";
import { postJson, trimSlash } from "./http.js";
import { parseSSE } from "./sse.js";

const ANTHROPIC_VERSION = "2023-06-01";

function neutralStop(stopReason: string | undefined | null): StopReason {
  if (stopReason === "max_tokens") return "length";
  if (stopReason === "tool_use") return "tool_use";
  return "stop";
}

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface AnthropicStreamEvent {
  message?: { usage?: { input_tokens?: number } };
  delta?: { text?: string; stop_reason?: string };
  usage?: { output_tokens?: number };
}

/** Adapter for the Anthropic Messages API (/v1/messages). */
export class AnthropicAdapter implements ProviderAdapter {
  readonly kind = "anthropic" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | null,
    /** Injected when a request omits max_tokens (Anthropic requires it). */
    private readonly defaultMaxTokens: number,
  ) {}

  private request(req: ChatRequest, stream: boolean): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
    const messages = req.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));
    const body: Record<string, unknown> = { model: req.model, messages, max_tokens: req.maxTokens ?? this.defaultMaxTokens, stream };
    if (req.system) body.system = req.system;
    if (req.temperature != null) body.temperature = req.temperature;
    if (req.tools != null) body.tools = req.tools;
    const headers: Record<string, string> = { "anthropic-version": ANTHROPIC_VERSION };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;
    return { url: `${trimSlash(this.baseUrl)}/v1/messages`, headers, body };
  }

  async send(req: ChatRequest): Promise<ChatResult> {
    const { url, headers, body } = this.request(req, false);
    const res = await postJson(url, headers, body);
    const json = (await res.json()) as AnthropicResponse;
    const text = (json.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    return {
      text,
      stopReason: neutralStop(json.stop_reason),
      usage: {
        promptTokens: json.usage?.input_tokens ?? null,
        completionTokens: json.usage?.output_tokens ?? null,
        estimated: json.usage == null,
      },
      model: req.model,
      raw: json,
    };
  }

  async *stream(req: ChatRequest): AsyncGenerator<StreamChunk> {
    const { url, headers, body } = this.request(req, true);
    const res = await postJson(url, headers, body);
    let promptTokens: number | null = null;
    for await (const frame of parseSSE(res)) {
      const json = JSON.parse(frame.data) as AnthropicStreamEvent;
      if (frame.event === "message_start") {
        promptTokens = json.message?.usage?.input_tokens ?? null;
      } else if (frame.event === "content_block_delta") {
        const t = json.delta?.text;
        if (t) yield { textDelta: t };
      } else if (frame.event === "message_delta") {
        yield {
          stopReason: neutralStop(json.delta?.stop_reason),
          usage: { promptTokens, completionTokens: json.usage?.output_tokens ?? null, estimated: false },
        };
      }
    }
  }
}

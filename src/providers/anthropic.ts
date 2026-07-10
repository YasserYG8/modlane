import type { ChatRequest, ChatResult, ProviderAdapter, StopReason } from "./types.js";
import { postJson, trimSlash } from "./http.js";

function neutralStop(stopReason: string | undefined): StopReason {
  if (stopReason === "max_tokens") return "length";
  if (stopReason === "tool_use") return "tool_use";
  return "stop";
}

const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
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

  async send(req: ChatRequest): Promise<ChatResult> {
    // Anthropic messages carry only user/assistant turns; system is top-level.
    const messages = req.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      max_tokens: req.maxTokens ?? this.defaultMaxTokens,
    };
    if (req.system) body.system = req.system;
    if (req.temperature != null) body.temperature = req.temperature;
    if (req.tools != null) body.tools = req.tools;

    const headers: Record<string, string> = { "anthropic-version": ANTHROPIC_VERSION };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;

    const res = await postJson(`${trimSlash(this.baseUrl)}/v1/messages`, headers, body);
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
}

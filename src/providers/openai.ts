import type { ChatRequest, ChatResult, ProviderAdapter } from "./types.js";
import type { ProviderKind } from "../config.js";
import { postJson, trimSlash } from "./http.js";

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Adapter for OpenAI and any OpenAI-compatible endpoint (OpenRouter, local, …). */
export class OpenAICompatAdapter implements ProviderAdapter {
  constructor(
    readonly kind: ProviderKind,
    private readonly baseUrl: string,
    private readonly apiKey: string | null,
  ) {}

  async send(req: ChatRequest): Promise<ChatResult> {
    const messages = req.system
      ? [{ role: "system", content: req.system }, ...req.messages]
      : req.messages;

    const body: Record<string, unknown> = { model: req.model, messages };
    if (req.maxTokens != null) body.max_tokens = req.maxTokens;
    if (req.temperature != null) body.temperature = req.temperature;
    if (req.tools != null) body.tools = req.tools;

    const headers: Record<string, string> = {};
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const res = await postJson(`${trimSlash(this.baseUrl)}/chat/completions`, headers, body);
    const json = (await res.json()) as OpenAIResponse;
    const choice = json.choices?.[0];
    return {
      text: choice?.message?.content ?? "",
      stopReason: choice?.finish_reason ?? "stop",
      usage: {
        promptTokens: json.usage?.prompt_tokens ?? null,
        completionTokens: json.usage?.completion_tokens ?? null,
        estimated: json.usage == null,
      },
      model: req.model,
      raw: json,
    };
  }
}

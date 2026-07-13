import type { ChatRequest, ChatResult, ProviderAdapter, StopReason, StreamChunk } from "./types.js";
import type { ProviderKind } from "../config.js";
import { postJson, trimSlash } from "./http.js";
import { parseSSE } from "./sse.js";

function neutralStop(finishReason: string | undefined): StopReason {
  if (finishReason === "length") return "length";
  if (finishReason === "tool_calls") return "tool_use";
  return "stop";
}

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface OpenAIChunk {
  choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

/** Adapter for OpenAI and any OpenAI-compatible endpoint (OpenRouter, local, …). */
export class OpenAICompatAdapter implements ProviderAdapter {
  constructor(
    readonly kind: ProviderKind,
    private readonly baseUrl: string,
    private readonly apiKey: string | null,
  ) {}

  private request(req: ChatRequest, stream: boolean): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
    const messages = req.system ? [{ role: "system", content: req.system }, ...req.messages] : req.messages;
    const body: Record<string, unknown> = { model: req.model, messages, stream };
    if (req.maxTokens != null) body.max_tokens = req.maxTokens;
    if (req.temperature != null) body.temperature = req.temperature;
    if (req.tools != null) body.tools = req.tools;
    if (stream) body.stream_options = { include_usage: true };
    const headers: Record<string, string> = {};
    if (req.headers?.["authorization"]) {
      headers.authorization = req.headers["authorization"];
    } else if (this.apiKey) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }
    return { url: `${trimSlash(this.baseUrl)}/chat/completions`, headers, body };
  }

  async send(req: ChatRequest): Promise<ChatResult> {
    const { url, headers, body } = this.request(req, false);
    const res = await postJson(url, headers, body);
    const json = (await res.json()) as OpenAIResponse;
    const choice = json.choices?.[0];
    return {
      text: choice?.message?.content ?? "",
      stopReason: neutralStop(choice?.finish_reason),
      usage: {
        promptTokens: json.usage?.prompt_tokens ?? null,
        completionTokens: json.usage?.completion_tokens ?? null,
        estimated: json.usage == null,
      },
      model: req.model,
      raw: json,
    };
  }

  async *stream(req: ChatRequest): AsyncGenerator<StreamChunk> {
    const { url, headers, body } = this.request(req, true);
    const res = await postJson(url, headers, body);
    for await (const frame of parseSSE(res)) {
      if (frame.data === "[DONE]") return;
      const json = JSON.parse(frame.data) as OpenAIChunk;
      const choice = json.choices?.[0];
      const chunk: StreamChunk = {};
      if (choice?.delta?.content) chunk.textDelta = choice.delta.content;
      if (choice?.finish_reason) chunk.stopReason = neutralStop(choice.finish_reason);
      if (json.usage) {
        chunk.usage = {
          promptTokens: json.usage.prompt_tokens ?? null,
          completionTokens: json.usage.completion_tokens ?? null,
          estimated: false,
        };
      }
      if (chunk.textDelta || chunk.stopReason || chunk.usage) yield chunk;
    }
  }
}

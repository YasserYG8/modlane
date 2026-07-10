import { randomUUID } from "node:crypto";
import type { ChatMessage, ChatRequest, ChatResult, StopReason } from "../providers/types.js";
import { contentToString } from "./content.js";

interface AnthropicMessage {
  role?: string;
  content?: unknown;
}
interface AnthropicBody {
  model?: string;
  system?: unknown;
  messages?: AnthropicMessage[];
  max_tokens?: number;
  temperature?: number;
  tools?: unknown;
  stream?: boolean;
}

export function parseAnthropicRequest(body: AnthropicBody): ChatRequest {
  const messages: ChatMessage[] = (body.messages ?? []).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: contentToString(m.content),
  }));
  return {
    model: body.model ?? "",
    messages,
    system: body.system != null ? contentToString(body.system) : undefined,
    maxTokens: body.max_tokens,
    temperature: body.temperature,
    tools: body.tools,
    stream: body.stream ?? false,
  };
}

const STOP: Record<StopReason, string> = { stop: "end_turn", length: "max_tokens", tool_use: "tool_use" };

export function renderAnthropicResponse(result: ChatResult, requestedModel: string): unknown {
  return {
    id: `msg_${randomUUID().replace(/-/g, "")}`,
    type: "message",
    role: "assistant",
    model: requestedModel,
    content: [{ type: "text", text: result.text }],
    stop_reason: STOP[result.stopReason],
    stop_sequence: null,
    usage: {
      input_tokens: result.usage.promptTokens ?? 0,
      output_tokens: result.usage.completionTokens ?? 0,
    },
  };
}

export function renderAnthropicError(message: string): unknown {
  return { type: "error", error: { type: "modlane_error", message } };
}

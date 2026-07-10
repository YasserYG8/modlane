import { randomUUID } from "node:crypto";
import type { ChatMessage, ChatRequest, ChatResult, StopReason } from "../providers/types.js";
import { contentToString } from "./content.js";

interface OpenAIMessage {
  role?: string;
  content?: unknown;
}
interface OpenAIBody {
  model?: string;
  messages?: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
  tools?: unknown;
  stream?: boolean;
}

export function parseOpenAIRequest(body: OpenAIBody): ChatRequest {
  const raw = body.messages ?? [];
  const system =
    raw
      .filter((m) => m.role === "system")
      .map((m) => contentToString(m.content))
      .join("\n") || undefined;
  const messages: ChatMessage[] = raw
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : m.role === "tool" ? "tool" : "user",
      content: contentToString(m.content),
    }));
  return {
    model: body.model ?? "",
    messages,
    system,
    maxTokens: body.max_tokens,
    temperature: body.temperature,
    tools: body.tools,
    stream: body.stream ?? false,
  };
}

const FINISH: Record<StopReason, string> = { stop: "stop", length: "length", tool_use: "tool_calls" };

export function renderOpenAIResponse(result: ChatResult, requestedModel: string): unknown {
  const prompt = result.usage.promptTokens ?? 0;
  const completion = result.usage.completionTokens ?? 0;
  return {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: requestedModel,
    choices: [
      { index: 0, message: { role: "assistant", content: result.text }, finish_reason: FINISH[result.stopReason] },
    ],
    usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion },
  };
}

export function renderOpenAIError(message: string): unknown {
  return { error: { message, type: "modlane_error", code: null } };
}

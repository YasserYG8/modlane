import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { StopReason, StreamChunk } from "../providers/types.js";

const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache",
  connection: "keep-alive",
} as const;

const FINISH: Record<StopReason, string> = { stop: "stop", length: "length", tool_use: "tool_calls" };
const STOP: Record<StopReason, string> = { stop: "end_turn", length: "max_tokens", tool_use: "tool_use" };

function writeData(res: ServerResponse, obj: unknown): void {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

function writeEvent(res: ServerResponse, event: string, obj: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(obj)}\n\n`);
}

/** Re-emit a neutral chunk stream as OpenAI chat.completion.chunk SSE + [DONE]. */
export async function streamOpenAIResponse(
  res: ServerResponse,
  chunks: AsyncIterable<StreamChunk>,
  model: string,
): Promise<void> {
  res.writeHead(200, SSE_HEADERS);
  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const frame = (delta: unknown, finish: string | null): unknown => ({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  });

  writeData(res, frame({ role: "assistant" }, null));
  let finish = "stop";
  for await (const c of chunks) {
    if (c.textDelta) writeData(res, frame({ content: c.textDelta }, null));
    if (c.stopReason) finish = FINISH[c.stopReason];
  }
  writeData(res, frame({}, finish));
  res.write("data: [DONE]\n\n");
  res.end();
}

/** Re-emit a neutral chunk stream as the Anthropic message event stream. */
export async function streamAnthropicResponse(
  res: ServerResponse,
  chunks: AsyncIterable<StreamChunk>,
  model: string,
): Promise<void> {
  res.writeHead(200, SSE_HEADERS);
  const id = `msg_${randomUUID().replace(/-/g, "")}`;
  writeEvent(res, "message_start", {
    type: "message_start",
    message: { id, type: "message", role: "assistant", model, content: [], stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } },
  });
  writeEvent(res, "content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });

  let stop = "end_turn";
  let outputTokens = 0;
  for await (const c of chunks) {
    if (c.textDelta) {
      writeEvent(res, "content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: c.textDelta } });
    }
    if (c.stopReason) stop = STOP[c.stopReason];
    if (c.usage?.completionTokens != null) outputTokens = c.usage.completionTokens;
  }

  writeEvent(res, "content_block_stop", { type: "content_block_stop", index: 0 });
  writeEvent(res, "message_delta", { type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: outputTokens } });
  writeEvent(res, "message_stop", { type: "message_stop" });
  res.end();
}

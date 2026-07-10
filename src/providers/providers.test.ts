import { afterEach, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AnthropicAdapter } from "./anthropic.js";
import { OpenAICompatAdapter } from "./openai.js";
import { ProviderError } from "./types.js";
import { sendWithFallback } from "./index.js";

interface Mock {
  url: string;
  server: Server;
  lastBody: () => unknown;
}

const servers: Server[] = [];
afterEach(() => {
  while (servers.length) servers.pop()!.close();
});

/** Spin a mock provider that returns `status`/`json` and records the last request body. */
async function mock(status: number, json: unknown): Promise<Mock> {
  let body: unknown;
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      body = raw ? JSON.parse(raw) : undefined;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, server, lastBody: () => body };
}

test("OpenAI adapter parses text and usage", async () => {
  const m = await mock(200, {
    choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });
  const a = new OpenAICompatAdapter("openai", `${m.url}/v1`, "sk-x");
  const r = await a.send({ model: "m", messages: [{ role: "user", content: "yo" }], system: "sys" });
  expect(r.text).toBe("hi");
  expect(r.usage).toEqual({ promptTokens: 10, completionTokens: 5, estimated: false });
  const body = m.lastBody() as { messages: Array<{ role: string }> };
  expect(body.messages[0]?.role).toBe("system"); // system folded into messages
});

test("Anthropic adapter: system top-level, max_tokens injected, text joined", async () => {
  const m = await mock(200, {
    content: [{ type: "text", text: "a" }, { type: "text", text: "b" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 3, output_tokens: 4 },
  });
  const a = new AnthropicAdapter(m.url, "key", 4096);
  const r = await a.send({ model: "m", messages: [{ role: "user", content: "yo" }], system: "sys" });
  expect(r.text).toBe("ab");
  expect(r.usage).toEqual({ promptTokens: 3, completionTokens: 4, estimated: false });
  const body = m.lastBody() as { system: string; max_tokens: number };
  expect(body.system).toBe("sys");
  expect(body.max_tokens).toBe(4096); // default injected
});

test("missing usage is marked estimated, not zero", async () => {
  const m = await mock(200, { choices: [{ message: { content: "x" } }] });
  const a = new OpenAICompatAdapter("openai", `${m.url}/v1`, null);
  const r = await a.send({ model: "m", messages: [{ role: "user", content: "y" }] });
  expect(r.usage).toEqual({ promptTokens: null, completionTokens: null, estimated: true });
});

test("5xx throws a retryable ProviderError", async () => {
  const m = await mock(503, { error: "down" });
  const a = new OpenAICompatAdapter("openai", `${m.url}/v1`, "k");
  await expect(a.send({ model: "m", messages: [] })).rejects.toMatchObject({
    constructor: ProviderError,
    status: 503,
    retryable: true,
  });
});

test("fallback: retryable primary → alternate provider serves", async () => {
  const down = await mock(500, { error: "x" });
  const up = await mock(200, { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] });
  const primary = new OpenAICompatAdapter("openai", `${down.url}/v1`, "k");
  const alt = new OpenAICompatAdapter("openai-compatible", `${up.url}/v1`, "k");
  const out = await sendWithFallback(
    { provider: "p", adapter: primary, req: { model: "m", messages: [] } },
    { provider: "alt", adapter: alt, req: { model: "m2", messages: [] } },
  );
  expect(out.usedFallback).toBe(true);
  expect(out.provider).toBe("alt");
  expect(out.result.text).toBe("ok");
});

test("non-retryable primary (4xx) does not fall back", async () => {
  const bad = await mock(400, { error: "bad" });
  const alt = await mock(200, { choices: [{ message: { content: "nope" } }] });
  const primary = new OpenAICompatAdapter("openai", `${bad.url}/v1`, "k");
  const altA = new OpenAICompatAdapter("openai", `${alt.url}/v1`, "k");
  await expect(
    sendWithFallback(
      { provider: "p", adapter: primary, req: { model: "m", messages: [] } },
      { provider: "alt", adapter: altA, req: { model: "m2", messages: [] } },
    ),
  ).rejects.toMatchObject({ status: 400, retryable: false });
});

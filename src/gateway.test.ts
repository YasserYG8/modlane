import { afterEach, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Config, TierConfig } from "./config.js";
import { startGateway } from "./server.js";

const servers: Server[] = [];
afterEach(() => {
  while (servers.length) servers.pop()!.close();
});

/** Mock upstream provider returning an OpenAI-shaped completion. */
async function mockProvider(text: string): Promise<string> {
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: text }, finish_reason: "stop" }],
          usage: { prompt_tokens: 7, completion_tokens: 3 },
        }),
      );
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function gatewayWith(providerUrl: string): Promise<string> {
  const tier: TierConfig = { provider: "mock", model: "concrete-model" };
  const config: Config = {
    server: { host: "127.0.0.1", port: 0 },
    router: { strategy: "rules" },
    tiers: { fast: tier, balanced: tier, powerful: tier },
    providers: { mock: { kind: "openai-compatible", baseUrl: `${providerUrl}/v1`, apiKeyEnv: null } },
    fallback: {},
    anthropicDefaults: { maxTokens: 4096 },
    telemetry: { store: ":memory:", captureContent: false },
    prices: {},
  };
  const server = await startGateway(config, { host: "127.0.0.1", port: 0 });
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

test("OpenAI inbound routes through provider and returns chat.completion", async () => {
  const base = await gatewayWith(await mockProvider("hello"));
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "modlane-balanced", messages: [{ role: "user", content: "hi" }] }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { object: string; choices: Array<{ message: { content: string } }> };
  expect(body.object).toBe("chat.completion");
  expect(body.choices[0]?.message.content).toBe("hello");
});

test("Anthropic inbound (cross-dialect) returns a messages response", async () => {
  const base = await gatewayWith(await mockProvider("world"));
  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "modlane-balanced", max_tokens: 100, messages: [{ role: "user", content: "hi" }] }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { type: string; content: Array<{ text: string }>; stop_reason: string };
  expect(body.type).toBe("message");
  expect(body.content[0]?.text).toBe("world");
  expect(body.stop_reason).toBe("end_turn"); // neutral "stop" → anthropic dialect
});

test("invalid JSON body returns a dialect-shaped 400", async () => {
  const base = await gatewayWith(await mockProvider("x"));
  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { type: string; error: { message: string } };
  expect(body.type).toBe("error"); // anthropic error shape
});

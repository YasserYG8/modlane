import { afterEach, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Config, TierConfig } from "./config.js";
import { startGateway } from "./server.js";

const servers: Server[] = [];
afterEach(() => {
  while (servers.length) servers.pop()!.close();
});

async function mockProviderWithHeaders(onReq: (headers: Record<string, string>, body: any) => void): Promise<string> {
  const server = createServer((req, res) => {
    let bodyStr = "";
    req.on("data", chunk => bodyStr += chunk);
    req.on("end", () => {
      onReq(req.headers as Record<string, string>, JSON.parse(bodyStr));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: "mock-response" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 5, completion_tokens: 5 },
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

test("Concrete Model Routing bypasses tier mappings and forwards model name", async () => {
  let interceptedModel = "";
  const providerUrl = await mockProviderWithHeaders((headers, body) => {
    interceptedModel = body.model;
  });
  const base = await gatewayWith(providerUrl);

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "my-custom-model-123", messages: [{ role: "user", content: "hi" }] }),
  });

  expect(res.status).toBe(200);
  expect(interceptedModel).toBe("my-custom-model-123");
});

test("Header Passthrough forwards client authorization and x-api-key headers", async () => {
  let interceptedHeaders: Record<string, string> = {};
  const providerUrl = await mockProviderWithHeaders((headers) => {
    interceptedHeaders = headers;
  });
  const base = await gatewayWith(providerUrl);

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": "Bearer my-custom-session-token-123",
      "x-api-key": "my-custom-api-key-456"
    },
    body: JSON.stringify({ model: "my-custom-model-123", messages: [{ role: "user", content: "hi" }] }),
  });

  expect(res.status).toBe(200);
  expect(interceptedHeaders.authorization).toBe("Bearer my-custom-session-token-123");
});

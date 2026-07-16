import { afterAll, beforeAll, expect, test, vi } from "vitest";

vi.mock("node:child_process", async () => {
  const original = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...original,
    execSync: vi.fn().mockImplementation((cmd, options) => {
      if (cmd === "codex debug models") {
        return JSON.stringify({
          models: [
            { slug: "mocked-codex-model-1" },
            { slug: "mocked-codex-model-2" }
          ]
        });
      }
      if (cmd === "agy models") {
        return "mocked-agy-model-1\nmocked-agy-model-2\n";
      }
      return original.execSync(cmd, options);
    })
  };
});
import type { Server } from "node:http";
import { AddressInfo } from "node:net";
import type { Config } from "./config.js";
import { startGateway } from "./server.js";

// /health and 404 never read config; a bare cast is enough for this file.
const EMPTY = {} as Config;

let server: Server;
let base: string;

beforeAll(async () => {
  server = await startGateway(EMPTY, { host: "127.0.0.1", port: 0 }); // 0 = ephemeral port
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

test("GET /health returns 200 ok", async () => {
  const res = await fetch(`${base}/health`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
});

test("unknown route returns 404 error shape", async () => {
  const res = await fetch(`${base}/nope`);
  expect(res.status).toBe(404);
  const body = (await res.json()) as { error: { type: string } };
  expect(body.error.type).toBe("not_found");
});

test("GET /v1/models returns the list of agy and codex models", async () => {
  const res = await fetch(`${base}/v1/models`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: Array<{ id: string; object: string }> };
  expect(body.data).toBeInstanceOf(Array);
  expect(body.data.some(m => m.id === "gemini-3.5-flash")).toBe(true);
  expect(body.data.some(m => m.id === "gpt-5.5")).toBe(true);
});

test("GET /models returns the same list of models", async () => {
  const res = await fetch(`${base}/models`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: Array<{ id: string; object: string }> };
  expect(body.data).toBeInstanceOf(Array);
  expect(body.data.some(m => m.id === "gemini-3.5-flash")).toBe(true);
});

test("GET /v1/models includes models from agent when requested by Codex", async () => {
  const res = await fetch(`${base}/v1/models`, {
    headers: {
      "user-agent": "Codex client/1.0"
    }
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as any;
  const modelIds = body.data.map((m: any) => m.id);
  expect(modelIds).toContain("mocked-codex-model-1");
  expect(modelIds).toContain("mocked-codex-model-2");
});

test("GET /v1/models includes models from agent when requested by Agy", async () => {
  const res = await fetch(`${base}/v1/models`, {
    headers: {
      "user-agent": "agy client/1.0"
    }
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as any;
  const modelIds = body.data.map((m: any) => m.id);
  expect(modelIds).toContain("mocked-agy-model-1");
  expect(modelIds).toContain("mocked-agy-model-2");
});

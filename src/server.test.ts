import { afterAll, beforeAll, expect, test } from "vitest";
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

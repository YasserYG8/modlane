import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { Server } from "node:http";
import http from "node:http";
import { AddressInfo, createServer as createTcpServer, type Server as TcpServer } from "node:net";
import type { Config } from "./config.js";
import { startGateway } from "./server.js";
import * as router from "./router.js";

// Mock variables must be prefixed with `mock` to be accessible in vi.mock()
let mockUpstreamPort = 0;

vi.mock("node:net", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:net")>();
  return {
    ...original,
    connect: (...args: any[]) => {
      let port = args[0];
      let host = args[1];
      let listener = args[2];
      if (typeof port === "object") {
        host = port.host;
        port = port.port;
        listener = args[1];
      }
      if (host === "daily-cloudcode-pa.googleapis.com") {
        return original.connect(mockUpstreamPort, "127.0.0.1", listener);
      }
      return (original.connect as any)(...args);
    }
  };
});

const EMPTY = {} as Config;

let server: Server;
let upstreamServer: TcpServer;
let base: string;
let capturedIds: string[] = [];

beforeAll(async () => {
  // Start a mock upstream TCP server
  upstreamServer = createTcpServer((socket) => {
    socket.on("data", (data) => {
      if (data.toString() === "ping") {
        socket.write("pong");
      }
    });
  });
  await new Promise<void>((resolve) => upstreamServer.listen(0, "127.0.0.1", resolve));
  mockUpstreamPort = (upstreamServer.address() as AddressInfo).port;

  server = await startGateway(EMPTY, { host: "127.0.0.1", port: 0 }); // 0 = ephemeral port
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
  upstreamServer.close();
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

test("CONNECT tunnel allows connection to daily-cloudcode-pa.googleapis.com and tunnels data", async () => {
  const { port } = server.address() as AddressInfo;
  const { connect: rawConnect } = await vi.importActual<typeof import("node:net")>("node:net");
  const clientSocket = rawConnect(port, "127.0.0.1");

  await new Promise<void>((resolve, reject) => {
    clientSocket.once("connect", resolve);
    clientSocket.once("error", reject);
  });

  clientSocket.write("CONNECT daily-cloudcode-pa.googleapis.com:443 HTTP/1.1\r\nHost: daily-cloudcode-pa.googleapis.com\r\n\r\n");

  const response = await new Promise<string>((resolve) => {
    clientSocket.once("data", (data) => {
      resolve(data.toString());
    });
  });

  expect(response).toContain("HTTP/1.1 200 Connection Established");

  // Test data tunneling: ping -> pong
  clientSocket.write("ping");
  const tunnelResponse = await new Promise<string>((resolve) => {
    clientSocket.once("data", (data) => {
      resolve(data.toString());
    });
  });

  expect(tunnelResponse).toBe("pong");
  clientSocket.end();
});

test("CONNECT tunnel returns 403 Forbidden for disallowed hosts", async () => {
  const { port } = server.address() as AddressInfo;
  const { connect: rawConnect } = await vi.importActual<typeof import("node:net")>("node:net");
  const clientSocket = rawConnect(port, "127.0.0.1");

  await new Promise<void>((resolve, reject) => {
    clientSocket.once("connect", resolve);
    clientSocket.once("error", reject);
  });

  clientSocket.write("CONNECT google.com:443 HTTP/1.1\r\nHost: google.com\r\n\r\n");

  const response = await new Promise<string>((resolve) => {
    clientSocket.once("data", (data) => {
      resolve(data.toString());
    });
  });

  expect(response).toContain("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
  clientSocket.end();
});

test("CONNECT tunnel returns 400 Bad Request for invalid port (e.g., abc)", async () => {
  const { port } = server.address() as AddressInfo;
  const { connect: rawConnect } = await vi.importActual<typeof import("node:net")>("node:net");
  const clientSocket = rawConnect(port, "127.0.0.1");

  await new Promise<void>((resolve, reject) => {
    clientSocket.once("connect", resolve);
    clientSocket.once("error", reject);
  });

  clientSocket.write("CONNECT daily-cloudcode-pa.googleapis.com:abc HTTP/1.1\r\nHost: daily-cloudcode-pa.googleapis.com\r\n\r\n");

  const response = await new Promise<string>((resolve) => {
    clientSocket.once("data", (data) => {
      resolve(data.toString());
    });
  });

  expect(response).toContain("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  clientSocket.end();
});

test("CONNECT tunnel returns 502 Bad Gateway if connection to upstream fails", async () => {
  const originalPort = mockUpstreamPort;
  // Use a port that is highly unlikely to be listening to trigger connection failure
  mockUpstreamPort = 1;

  const { port } = server.address() as AddressInfo;
  const { connect: rawConnect } = await vi.importActual<typeof import("node:net")>("node:net");
  const clientSocket = rawConnect(port, "127.0.0.1");

  await new Promise<void>((resolve, reject) => {
    clientSocket.once("connect", resolve);
    clientSocket.once("error", reject);
  });

  clientSocket.write("CONNECT daily-cloudcode-pa.googleapis.com:443 HTTP/1.1\r\nHost: daily-cloudcode-pa.googleapis.com\r\n\r\n");

  const response = await new Promise<string>((resolve) => {
    clientSocket.once("data", (data) => {
      resolve(data.toString());
    });
  });

  expect(response).toContain("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
  clientSocket.end();

  // Restore the original mock upstream port
  mockUpstreamPort = originalPort;
});

test("Option A: correlationId is assigned per TCP connection", async () => {
  capturedIds = [];
  
  vi.spyOn(router, "route").mockImplementation(async (config, chatReq) => {
    capturedIds.push(chatReq.correlationId || "");
    return {
      tier: "balanced",
      provider: "mock",
      model: "mock-model",
      usedFallback: false,
      result: { text: "hello", stopReason: "stop", usage: { promptTokens: 1, completionTokens: 1, estimated: false } }
    };
  });

  const { port } = server.address() as AddressInfo;
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });

  const postData = JSON.stringify({
    model: "modlane-balanced",
    messages: [{ role: "user", content: "hello" }]
  });

  const sendReq = () => new Promise<void>((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: "/v1/chat/completions",
      method: "POST",
      agent,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(postData)
      }
    }, (res) => {
      res.resume();
      res.on("end", resolve);
    });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });

  // Send two requests on the same connection
  await sendReq();
  await sendReq();

  // Send one request on a different connection
  const agent2 = new http.Agent({ keepAlive: false });
  await new Promise<void>((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: "/v1/chat/completions",
      method: "POST",
      agent: agent2,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(postData)
      }
    }, (res) => {
      res.resume();
      res.on("end", resolve);
    });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });

  agent.destroy();
  agent2.destroy();

  expect(capturedIds).toHaveLength(3);
  expect(capturedIds[0]).toBeDefined();
  expect(capturedIds[0]).toMatch(/^conn_[a-f0-9]+$/);
  expect(capturedIds[1]).toBe(capturedIds[0]); // same connection
  expect(capturedIds[2]).not.toBe(capturedIds[0]); // new connection
});

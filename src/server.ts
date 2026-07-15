import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect as netConnect, type Socket } from "node:net";
import { request as httpsRequest } from "node:https";
import type { Config } from "./config.js";
import { ProviderError, type StreamChunk } from "./providers/index.js";
import { parseAnthropicRequest, renderAnthropicError, renderAnthropicResponse } from "./protocols/anthropic.js";
import { parseOpenAIRequest, renderOpenAIError, renderOpenAIResponse } from "./protocols/openai.js";
import { streamAnthropicResponse, streamOpenAIResponse } from "./protocols/stream.js";
import { route, routeStream } from "./router.js";

type Dialect = "openai" | "anthropic";

export interface ServerOptions {
  host: string;
  port: number;
}

const JSON_HEADERS = { "content-type": "application/json" } as const;

/**
 * Inbound gateway. Accepts OpenAI /v1/chat/completions and Anthropic /v1/messages,
 * parses to a neutral ChatRequest, routes, and renders back in the inbound dialect.
 * Also acts as an HTTPS CONNECT proxy so closed CLI binaries (like agy) can tunnel
 * through Modlane when HTTPS_PROXY is set.
 */
export function createGateway(config: Config): Server {
  const server = createServer((req, res) => {
    handle(config, req, res).catch(() => {
      if (!res.headersSent) send(res, 500, { error: { message: "internal error" } });
    });
  });

  // HTTPS CONNECT proxy: handles tunneled TLS connections from CLI tools
  // that respect HTTPS_PROXY (e.g. agy, curl, Go programs, etc.)
  server.on("connect", (req: IncomingMessage, clientSocket: Socket, head: Buffer) => {
    const target = req.url || "";
    const [hostname, portStr] = target.split(":");
    const port = parseInt(portStr || "443", 10);

    console.log(`[CONNECT] Tunnel requested -> ${hostname}:${port}`);

    const targetSocket = netConnect(port, hostname, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\nProxy-Agent: modlane\r\n\r\n");
      if (head.length > 0) targetSocket.write(head);
      targetSocket.pipe(clientSocket);
      clientSocket.pipe(targetSocket);
      console.log(`[CONNECT] Tunnel established -> ${hostname}:${port}`);
    });

    targetSocket.on("error", (err) => {
      console.error(`[CONNECT Error] Failed to connect to ${hostname}:${port}:`, err.message);
      clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      clientSocket.end();
    });

    clientSocket.on("error", () => {
      targetSocket.destroy();
    });

    targetSocket.on("close", () => {
      console.log(`[CONNECT] Tunnel closed -> ${hostname}:${port}`);
    });
  });

  return server;
}

export function startGateway(config: Config, opts: ServerOptions): Promise<Server> {
  const server = createGateway(config);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => resolve(server));
  });
}

async function fetchModelsFromProviders(config: Config, reqHeaders: Record<string, string>, env = process.env): Promise<Array<{ id: string; object: string }>> {
  const allModels: Array<{ id: string; object: string }> = [];

  for (const [name, provider] of Object.entries(config.providers || {})) {
    let timeoutId: NodeJS.Timeout | undefined;
    try {
      let url = provider.baseUrl;
      // Normalize url to point to models endpoint
      url = url.replace(/\/chat\/completions\/?$/, "/models");
      url = url.replace(/\/messages\/?$/, "/models");
      if (!url.endsWith("/models")) {
        url = url.endsWith("/") ? `${url}models` : `${url}/models`;
      }
      console.log(`[Models Sync] Fetching models from provider "${name}" at: ${url}`);

      const headers: Record<string, string> = { "content-type": "application/json" };

      // Forward client's session headers
      if (reqHeaders["authorization"]) {
        headers["authorization"] = reqHeaders["authorization"];
      }
      if (reqHeaders["x-api-key"]) {
        headers["x-api-key"] = reqHeaders["x-api-key"];
      }

      // Fallback to local env key if no client header is provided
      if (!headers["authorization"] && !headers["x-api-key"] && provider.apiKeyEnv) {
        const key = env[provider.apiKeyEnv];
        if (key) {
          if (provider.kind === "anthropic") {
            headers["x-api-key"] = key;
            headers["anthropic-version"] = "2023-06-01";
          } else {
            headers["authorization"] = `Bearer ${key}`;
          }
        }
      }

      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 2000);

      const res = await fetch(url, { headers, signal: controller.signal });
      if (res.ok) {
        const body = (await res.json()) as any;
        if (body && Array.isArray(body.data)) {
          for (const m of body.data) {
            if (m && typeof m.id === "string") {
              allModels.push({ id: m.id, object: "model" });
            }
          }
        }
      }
    } catch {
      // Ignore individual provider failures
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  // Fallback to a basic list if all providers fail to respond
  if (allModels.length === 0) {
    return [
      { id: "gemini-3.5-flash", object: "model" },
      { id: "gemini-3.1-pro-preview", object: "model" },
      { id: "claude-3-5-sonnet-latest", object: "model" },
      { id: "gpt-5.5", object: "model" },
      { id: "gpt-5.4-mini", object: "model" }
    ];
  }

  return allModels;
}

process.on("unhandledRejection", (reason, promise) => {
  console.error("[Global Error] Unhandled Rejection at:", promise, "reason:", reason);
});
process.on("uncaughtException", (error) => {
  console.error("[Global Error] Uncaught Exception:", error);
});

async function handle(config: Config, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    console.log(`[Incoming] ${req.method} ${req.url} (User-Agent: ${req.headers["user-agent"] || "none"})`);
    if (req.method === "GET" && req.url === "/health") {
      send(res, 200, { status: "ok" });
      return;
    }
    if (req.method === "GET" && (req.url === "/v1/models" || req.url === "/models")) {
      console.log(`[Request] GET ${req.url}`);
      const authHeaders: Record<string, string> = {};
      if (req.headers["authorization"]) {
        authHeaders["authorization"] = String(req.headers["authorization"]);
      }
      if (req.headers["x-api-key"]) {
        authHeaders["x-api-key"] = String(req.headers["x-api-key"]);
      }

      try {
        const models = await fetchModelsFromProviders(config, authHeaders);
        send(res, 200, { data: models });
      } catch (err) {
        console.error(`[Server Error] Failed to fetch models:`, err);
        send(res, 502, { error: { message: "Failed to fetch models from provider" } });
      }
      return;
    }
    if (req.method === "POST" && (req.url === "/v1/chat/completions" || req.url === "/chat/completions")) {
      await handleChat(config, req, res, "openai");
      return;
    }
    if (req.method === "POST" && req.url === "/v1/messages") {
      await handleChat(config, req, res, "anthropic");
      return;
    }
    if (req.url?.includes("/v1internal")) {
      await handleV1Internal(config, req, res);
      return;
    }
    send(res, 404, { error: { message: "not found", type: "not_found" } });
  } catch (err) {
    console.error(`[Server Error] Exception during request handling for ${req.method} ${req.url}:`, err);
    if (!res.headersSent) {
      send(res, 500, { error: { message: "Internal server error", type: "internal_error" } });
    }
  }
}

async function handleChat(config: Config, req: IncomingMessage, res: ServerResponse, dialect: Dialect): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = (await readJson(req)) as Record<string, unknown>;
  } catch (err) {
    console.error(`[Server Error] Failed to parse JSON body:`, err);
    sendError(res, dialect, 400, "invalid JSON body");
    return;
  }

  const chatReq = dialect === "openai" ? parseOpenAIRequest(body) : parseAnthropicRequest(body);
  chatReq.dialect = dialect;
  chatReq.rawBody = body;

  const authHeaders: Record<string, string> = {};
  if (req.headers["authorization"]) {
    authHeaders["authorization"] = String(req.headers["authorization"]);
  }
  if (req.headers["x-api-key"]) {
    authHeaders["x-api-key"] = String(req.headers["x-api-key"]);
  }
  chatReq.headers = authHeaders;

  const requestedModel = typeof body.model === "string" ? body.model : "";
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const lastMessage = messages[messages.length - 1];
  const lastPrompt = lastMessage && typeof lastMessage.content === "string" ? lastMessage.content : "";

  console.log(`[Request] ${req.method} ${req.url}`);
  console.log(`  - Requested Model: "${requestedModel}"`);
  if (lastPrompt) {
    const trimmed = lastPrompt.length > 120 ? lastPrompt.substring(0, 120) + "..." : lastPrompt;
    console.log(`  - Prompt Preview: "${trimmed.replace(/\s+/g, " ")}"`);
  }

  if (chatReq.stream) {
    await handleStream(config, res, chatReq, dialect, requestedModel);
    return;
  }

  try {
    const routed = await route(config, chatReq);
    console.log(`[Route] -> Provider: "${routed.provider}" - Model: "${routed.model}" (Tier: ${routed.tier}, usedFallback: ${routed.usedFallback})`);
    const payload =
      dialect === "openai"
        ? renderOpenAIResponse(routed.result, requestedModel)
        : renderAnthropicResponse(routed.result, requestedModel);
    send(res, 200, payload);
  } catch (err) {
    sendError(res, dialect, errorStatus(err), err instanceof Error ? err.message : "error");
  }
}

async function handleStream(
  config: Config,
  res: ServerResponse,
  chatReq: ReturnType<typeof parseOpenAIRequest>,
  dialect: Dialect,
  model: string,
): Promise<void> {
  const routed = routeStream(config, chatReq);
  console.log(`[Route Stream] -> Provider: "${routed.provider}" - Model: "${routed.model}" (Tier: ${routed.tier})`);
  const iterator = routed.stream[Symbol.asyncIterator]();

  // Prime the first chunk so a pre-stream provider error becomes a clean HTTP error
  // (nothing written yet). After the head is sent, mid-stream errors just end the stream.
  let first: IteratorResult<StreamChunk>;
  try {
    first = await iterator.next();
  } catch (err) {
    sendError(res, dialect, errorStatus(err), err instanceof Error ? err.message : "error");
    return;
  }

  const chunks = replay(first, iterator);
  try {
    if (dialect === "openai") await streamOpenAIResponse(res, chunks, model);
    else await streamAnthropicResponse(res, chunks, model);
  } catch {
    if (!res.writableEnded) res.end(); // mid-stream failure: drop the connection
  }
}

async function* replay(first: IteratorResult<StreamChunk>, iterator: AsyncIterator<StreamChunk>): AsyncGenerator<StreamChunk> {
  if (!first.done) yield first.value;
  while (true) {
    const next = await iterator.next();
    if (next.done) return;
    yield next.value;
  }
}

function errorStatus(err: unknown): number {
  return err instanceof ProviderError && err.status >= 400 && err.status < 600 ? err.status : 502;
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err as Error);
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, obj: unknown): void {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(obj));
}

function sendError(res: ServerResponse, dialect: Dialect, status: number, message: string): void {
  send(res, status, dialect === "openai" ? renderOpenAIError(message) : renderAnthropicError(message));
}

async function handleV1Internal(config: Config, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const targetHost = "daily-cloudcode-pa.googleapis.com";
  const targetUrl = `https://${targetHost}${req.url}`;

  // Read body
  let rawBody = "";
  try {
    rawBody = await new Promise<string>((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });
  } catch (err) {
    console.error(`[Proxy Error] Failed to read request body:`, err);
  }

  // Attempt to parse and log
  try {
    if (rawBody && (req.headers["content-type"] || "").includes("json")) {
      const parsed = JSON.parse(rawBody);
      console.log(`[Request] ${req.method} ${req.url}`);

      const reqObj = parsed.request || parsed;

      // Log model if found
      const model = reqObj.model || (reqObj.modelConfig && reqObj.modelConfig.model) || parsed.model || "";
      if (model) {
        console.log(`  - Requested Model: "${model}"`);
      }

      // Log prompt preview if found
      let prompt = "";
      if (reqObj.prompt) {
        prompt = reqObj.prompt;
      } else if (reqObj.contents) {
        const parts = reqObj.contents?.[0]?.parts;
        if (Array.isArray(parts)) {
          prompt = parts.map((p: any) => p.text || "").join(" ");
        }
      } else if (reqObj.messages) {
        const lastMsg = reqObj.messages[reqObj.messages.length - 1];
        if (lastMsg && typeof lastMsg.content === "string") {
          prompt = lastMsg.content;
        }
      }

      if (prompt) {
        // Clean up the prompt to extract only the user request content if template tags exist
        let cleanPrompt = prompt;
        const match = prompt.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
        if (match && match[1]) {
          cleanPrompt = match[1].trim();
        }
        const trimmed = cleanPrompt.length > 120 ? cleanPrompt.substring(0, 120) + "..." : cleanPrompt;
        console.log(`  - Prompt Preview: "${trimmed.replace(/\s+/g, " ")}"`);
      }
    }
  } catch (e) {
    // Ignore parsing errors for logging
  }

  // Forward the request
  const headers = { ...req.headers };
  headers["host"] = targetHost;
  delete headers["proxy-connection"];
  delete headers["connection"];

  const options = {
    hostname: targetHost,
    port: 443,
    path: req.url,
    method: req.method,
    headers: headers,
  };

  const proxyReq = httpsRequest(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    console.error(`[Proxy Error] Request to ${targetUrl} failed:`, err);
    if (!res.headersSent) {
      send(res, 502, { error: { message: `Proxy gateway error: ${err.message}` } });
    }
  });

  if (rawBody) {
    proxyReq.write(rawBody);
  }
  proxyReq.end();
}

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { writeFileSync } from "node:fs";
import { connect as netConnect, type Socket } from "node:net";
import { request as httpsRequest } from "node:https";
import { execSync } from "node:child_process";
import type { Config } from "./config.js";
import { ProviderError, type StreamChunk } from "./providers/index.js";
import { parseAnthropicRequest, renderAnthropicError, renderAnthropicResponse } from "./protocols/anthropic.js";
import { parseOpenAIRequest, renderOpenAIError, renderOpenAIResponse } from "./protocols/openai.js";
import { streamAnthropicResponse, streamOpenAIResponse } from "./protocols/stream.js";
import { route, routeStream, translateModel, resolveProviderForModel } from "./router.js";

type Dialect = "openai" | "anthropic";

export interface ServerOptions {
  host: string;
  port: number;
}

const JSON_HEADERS = { "content-type": "application/json" } as const;

// Endpoints that carry actual user prompts — always log these in detail
const PROMPT_ENDPOINTS = [
  "streamGenerateContent",
  "generateContent",
  "chat/completions",
  "messages",
] as const;

// Noisy background/sync endpoints — suppress from logs entirely
const NOISE_ENDPOINTS = [
  "loadCodeAssist",
  "fetchUserInfo",
  "setUserSettings",
  "getUserSettings",
  "initializeServices",
  "logEvent",
  "reportUsage",
  "sendFeedback",
  "healthCheck",
  "getAccountInfo",
  "listModels",
  "registerClient",
  "getSession",
  "refreshToken",
  "retrieveUserQuotaSummary",
  "listExperiments",
  "recordCodeAssistMetrics",
  "recordTrajectoryAnalytics",
  "fetchAdminControls",
  "fetchAvailableModels",
] as const;

function isNoiseEndpoint(url: string): boolean {
  return NOISE_ENDPOINTS.some((ep) => url.includes(ep));
}

function isPromptEndpoint(url: string): boolean {
  return PROMPT_ENDPOINTS.some((ep) => url.includes(ep));
}

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

    const targetSocket = netConnect(port, hostname, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\nProxy-Agent: modlane\r\n\r\n");
      if (head.length > 0) targetSocket.write(head);
      targetSocket.pipe(clientSocket);
      clientSocket.pipe(targetSocket);
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

function isCodexRequest(reqHeaders: Record<string, string | string[] | undefined>): boolean {
  const ua = String(reqHeaders["user-agent"] || "").toLowerCase();
  if (ua.includes("codex") || ua.includes("openai")) return true;

  const auth = String(reqHeaders["authorization"] || "");
  if (auth.startsWith("Bearer sk-") || auth.startsWith("Bearer eyJ")) return true;

  return false;
}

function isAgyRequest(reqHeaders: Record<string, string | string[] | undefined>): boolean {
  const ua = String(reqHeaders["user-agent"] || "").toLowerCase();
  if (ua.includes("agy") || ua.includes("cloudcode") || ua.includes("cloud-code") || ua.includes("google")) return true;

  if (reqHeaders["x-goog-api-key"]) return true;

  return false;
}

export function getAgyModels(): string[] {
  try {
    const out = execSync("agy models", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out
      .split("\n")
      .map((line) => line.trim())
      .filter(
        (line) =>
          line.length > 0 &&
          !line.startsWith("Usage") &&
          !line.includes("List available")
      );
  } catch {
    return [];
  }
}

export function getCodexModels(): string[] {
  try {
    const out = execSync("codex debug models", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const data = JSON.parse(out);
    if (data && Array.isArray(data.models)) {
      return data.models.map((m: any) => m.slug);
    }
    return [];
  } catch {
    return [];
  }
}

async function fetchModelsFromProviders(config: Config, reqHeaders: Record<string, string | string[] | undefined>, env = process.env): Promise<Array<{ id: string; object: string }>> {
  const allModels: Array<{ id: string; object: string }> = [];
  const isCodex = isCodexRequest(reqHeaders);
  const isAgy = isAgyRequest(reqHeaders);

  for (const [name, provider] of Object.entries(config.providers || {})) {
    // Codex client should only query the 'openai' provider.
    // agy client should query all providers EXCEPT 'openai'.
    // If neither is detected, query all.
    if (isCodex && name !== "openai") {
      continue;
    }
    if (isAgy && name === "openai") {
      continue;
    }

    let timeoutId: NodeJS.Timeout | undefined;
    try {
      let url = provider.baseUrl;
      if (provider.kind === "openai" && reqHeaders["authorization"]) {
        const auth = reqHeaders["authorization"] as string;
        const token = auth.replace(/^bearer\s+/i, "").trim();
        if (token.startsWith("eyJ")) {
          url = "https://chatgpt.com/backend-api/codex";
        }
      }
      // Normalize url to point to models endpoint
      url = url.replace(/\/chat\/completions\/?$/, "/models");
      url = url.replace(/\/messages\/?$/, "/models");
      if (!url.endsWith("/models")) {
        url = url.endsWith("/") ? `${url}models` : `${url}/models`;
      }

      const headers: Record<string, string> = { "content-type": "application/json" };

      // Forward client's session headers
      if (reqHeaders["authorization"]) {
        headers["authorization"] = reqHeaders["authorization"] as string;
      }
      if (reqHeaders["x-api-key"]) {
        headers["x-api-key"] = reqHeaders["x-api-key"] as string;
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
    if (isCodex && !isAgy) {
      allModels.push(
        { id: "gpt-5.5", object: "model" },
        { id: "gpt-5.4-mini", object: "model" }
      );
    } else if (isAgy && !isCodex) {
      allModels.push(
        { id: "gemini-3.5-flash", object: "model" },
        { id: "gemini-3.1-pro-preview", object: "model" },
        { id: "claude-3-5-sonnet-latest", object: "model" }
      );
    } else {
      allModels.push(
        { id: "gemini-3.5-flash", object: "model" },
        { id: "gemini-3.1-pro-preview", object: "model" },
        { id: "claude-3-5-sonnet-latest", object: "model" },
        { id: "gpt-5.5", object: "model" },
        { id: "gpt-5.4-mini", object: "model" }
      );
    }
  }

  // Append models configured inside the client agents
  if (isCodex) {
    const codexModels = getCodexModels();
    for (const id of codexModels) {
      if (!allModels.some((m) => m.id === id)) {
        allModels.push({ id, object: "model" });
      }
    }
  }

  if (isAgy) {
    const agyModels = getAgyModels();
    for (const id of agyModels) {
      if (!allModels.some((m) => m.id === id)) {
        allModels.push({ id, object: "model" });
      }
    }
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
    const url = req.url || "";
    const pathname = url.split("?")[0] || "";

    if (req.method === "GET" && pathname === "/health") {
      send(res, 200, { status: "ok" });
      return;
    }
    if (req.method === "GET" && (pathname === "/v1/models" || pathname === "/models")) {
      try {
        const models = await fetchModelsFromProviders(config, req.headers);
        if (isCodexRequest(req.headers) && !models.some((m: any) => m.id === "gpt-5.4")) {
          models.push({ id: "gpt-5.4", object: "model" });
        }
        const mappedModels = models.map((m: any) => ({
          ...m,
          slug: m.id,
          display_name: m.id,
          name: m.id,
          provider: "openai",
          description: "Custom model proxied via Modlane",
          default_reasoning_level: "medium",
          supported_reasoning_levels: [
            { effort: "low", description: "Fast responses with lighter reasoning" },
            { effort: "medium", description: "Balances speed and reasoning depth for everyday tasks" },
            { effort: "high", description: "Greater reasoning depth for complex problems" },
            { effort: "xhigh", description: "Extra high reasoning depth for complex problems" }
          ],
          shell_type: "shell_command",
          visibility: "list",
          supported_in_api: true,
          priority: 10,
          additional_speed_tiers: [],
          service_tiers: [],
          availability_nux: null,
          upgrade: null,
          base_instructions: "You are a helpful coding assistant.",
          model_messages: null,
          supports_reasoning_summaries: true,
          default_reasoning_summary: "none",
          support_verbosity: true,
          default_verbosity: "low",
          apply_patch_tool_type: "freeform",
          web_search_tool_type: "text_and_image",
          truncation_policy: { mode: "tokens", limit: 10000 },
          supports_parallel_tool_calls: true,
          supports_image_detail_original: true,
          context_window: 128000,
          max_context_window: 128000,
          comp_hash: "2911",
          effective_context_window_percent: 95,
          experimental_supported_tools: [],
          input_modalities: ["text", "image"],
          supports_search_tool: true,
          use_responses_lite: false
        }));
        send(res, 200, { data: models, models: mappedModels });
      } catch (err) {
        console.error(`[Server Error] Failed to fetch models:`, err);
        send(res, 502, { error: { message: "Failed to fetch models from provider" } });
      }
      return;
    }
    if (req.method === "GET" && (pathname === "/v1/responses" || pathname === "/responses")) {
      res.writeHead(404, { "Connection": "close", "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "WebSocket not supported. Fallback to HTTP.", type: "websocket_not_supported" } }));
      req.socket.destroy();
      return;
    }
    if (req.method === "POST" && (pathname === "/v1/responses" || pathname === "/responses")) {
      await handleResponsesProxy(config, req, res);
      return;
    }
    if (req.method === "POST" && (pathname === "/v1/chat/completions" || pathname === "/chat/completions")) {
      await handleChat(config, req, res, "openai");
      return;
    }
    if (req.method === "POST" && pathname === "/v1/messages") {
      await handleChat(config, req, res, "anthropic");
      return;
    }
    if (pathname.includes("/v1internal")) {
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

/**
 * Transparent proxy for the OpenAI Responses API (POST /v1/responses).
 * Reads the body, translates the model name, and forwards directly to the upstream provider.
 * The raw SSE response is piped back without parsing — preserving the Responses API format.
 */
async function handleResponsesProxy(config: Config, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = (await readJson(req)) as Record<string, unknown>;
  } catch {
    send(res, 400, { error: { message: "invalid JSON body", type: "invalid_request_error" } });
    return;
  }

  const requestedModel = typeof body.model === "string" ? body.model : "";
  const providerName = "openai";
  const provider = config.providers[providerName];
  if (!provider) {
    send(res, 400, { error: { message: `openai provider not configured in modlane.yaml`, type: "invalid_request_error" } });
    return;
  }

  // Translate model name (e.g. gpt-5.4 → gpt-4o)
  const translatedModel = translateModel(config, providerName, requestedModel);
  body.model = translatedModel;

  // Build upstream URL: provider baseUrl + /responses
  let baseUrl = provider.baseUrl;
  if (provider.kind === "openai" && req.headers["authorization"]) {
    const auth = req.headers["authorization"] as string;
    const token = auth.replace(/^bearer\s+/i, "").trim();
    if (token.startsWith("eyJ")) {
      baseUrl = "https://chatgpt.com/backend-api/codex";
    }
  }
  baseUrl = baseUrl.replace(/\/+$/, "");
  const upstreamUrl = `${baseUrl}/responses`;

  // Build headers — forward the client's auth header
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (req.headers["authorization"]) {
    headers["authorization"] = req.headers["authorization"] as string;
  }
  if (req.headers["openai-organization"]) {
    headers["openai-organization"] = req.headers["openai-organization"] as string;
  }
  if (req.headers["openai-project"]) {
    headers["openai-project"] = req.headers["openai-project"] as string;
  }

  // Log the prompt
  const input = body.input;
  let lastPrompt = "";
  if (Array.isArray(input)) {
    // Search backwards for the first user message
    for (let i = input.length - 1; i >= 0; i--) {
      const msg = input[i];
      if (msg && msg.role === "user" && Array.isArray(msg.content)) {
        const textParts: string[] = [];
        for (const block of msg.content) {
          if (block && typeof block.text === "string") {
            const txt = block.text.trim();
            // Filter out system environment blocks to get the clean user input
            if (!txt.startsWith("<environment_context>") && !txt.startsWith("<recommended_plugins>")) {
              textParts.push(txt);
            }
          }
        }
        if (textParts.length > 0) {
          lastPrompt = textParts.join("\n");
          break;
        }
      }
    }
  } else if (typeof input === "string") {
    lastPrompt = input;
  }

  // Clean up prompt — extract only user request from template tags
  let cleanPrompt = lastPrompt;
  const match = lastPrompt.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
  if (match && match[1]) {
    cleanPrompt = match[1].trim();
  }

  // Deduplicate and log
  const userMsgCount = Array.isArray(input) ? input.filter((m: any) => m && m.role === "user").length : 0;
  if (cleanPrompt && (cleanPrompt !== lastLoggedPrompt || userMsgCount !== lastLoggedUserMessageCount)) {
    lastLoggedPrompt = cleanPrompt;
    lastLoggedUserMessageCount = userMsgCount;
    const trimmed = cleanPrompt.length > 200 ? cleanPrompt.substring(0, 200) + "..." : cleanPrompt;
    console.log(`\x1b[35m○\x1b[0m Prompt: "${trimmed.replace(/\s+/g, " ")}" \x1b[90m(Model: ${requestedModel} → ${translatedModel})\x1b[0m`);
  } else if (!cleanPrompt) {
    console.log(`\x1b[35m○\x1b[0m Request: \x1b[90m(Model: ${requestedModel} → ${translatedModel})\x1b[0m`);
  }

  // Log any tool actions in the messages history
  if (Array.isArray(input)) {
    logActions(input, "openai");
  }

  // Forward request to upstream and pipe response back
  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    // Forward status and headers
    const fwdHeaders: Record<string, string> = {};
    upstream.headers.forEach((value, key) => {
      // Skip hop-by-hop headers
      if (!["transfer-encoding", "connection", "keep-alive"].includes(key.toLowerCase())) {
        fwdHeaders[key] = value;
      }
    });
    res.writeHead(upstream.status, fwdHeaders);

    if (upstream.body) {
      const reader = (upstream.body as any).getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      };
      await pump();
    } else {
      const text = await upstream.text();
      res.end(text);
    }
  } catch (err: any) {
    console.error(`[Server Error] Responses proxy failed:`, err.message);
    if (!res.headersSent) {
      send(res, 502, { error: { message: `upstream error: ${err.message}`, type: "proxy_error" } });
    }
  }
}

async function handleChat(config: Config, req: IncomingMessage, res: ServerResponse, dialect: Dialect): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = (await readJson(req)) as Record<string, unknown>;
  } catch (err) {
    console.error(`[Server Error] Failed to parse JSON body for ${req.method} ${req.url}:`, err);
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

  // Clean up prompt — extract only user request from template tags
  let cleanPrompt = lastPrompt;
  const match = lastPrompt.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
  if (match && match[1]) {
    cleanPrompt = match[1].trim();
  }

  // Deduplicate and log
  const userMsgCount = Array.isArray(chatReq.messages) ? chatReq.messages.filter((m: any) => m && m.role === "user").length : 0;
  if (cleanPrompt && (cleanPrompt !== lastLoggedPrompt || userMsgCount !== lastLoggedUserMessageCount)) {
    lastLoggedPrompt = cleanPrompt;
    lastLoggedUserMessageCount = userMsgCount;
    const trimmed = cleanPrompt.length > 200 ? cleanPrompt.substring(0, 200) + "..." : cleanPrompt;
    console.log(`\x1b[35m○\x1b[0m Prompt: "${trimmed.replace(/\s+/g, " ")}" \x1b[90m(Model: ${requestedModel})\x1b[0m`);
  } else if (!cleanPrompt) {
    console.log(`\x1b[35m○\x1b[0m Request: \x1b[90m(Model: ${requestedModel})\x1b[0m`);
  }

  // Log any tool actions in the messages history
  logActions(chatReq.messages, dialect);

  if (chatReq.stream) {
    await handleStream(config, res, chatReq, dialect, requestedModel);
    return;
  }

  try {
    const routed = await route(config, chatReq);
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
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let buf = Buffer.concat(chunks);
      
      const isZstd = buf.length >= 4 && buf[0] === 0x28 && buf[1] === 0xb5 && buf[2] === 0x2f && buf[3] === 0xfd;
      const hasEncoding = req.headers["content-encoding"] === "zstd";
      
      if (isZstd || hasEncoding) {
        try {
          buf = execSync("zstd -d", { input: buf, stdio: ["pipe", "pipe", "ignore"] });
        } catch (zErr: any) {
          console.error("[Server Error] Failed to decompress zstd payload:", zErr.message);
        }
      }

      const raw = buf.toString("utf8");
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

let lastLoggedPrompt = "";
let lastLoggedUserMessageCount = 0;
const loggedToolCallIds = new Set<string>();
const loggedToolResultIds = new Set<string>();

async function handleV1Internal(config: Config, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const targetHost = "daily-cloudcode-pa.googleapis.com";
  const urlStr = req.url || "";
  const shouldLog = isPromptEndpoint(urlStr);

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

  // Only log details for prompt-bearing endpoints, skip background noise
  if (shouldLog) {
    try {
      if (rawBody && (req.headers["content-type"] || "").includes("json")) {
        const parsed = JSON.parse(rawBody);
        writeFileSync("C:\\Users\\Lenovo\\.gemini\\antigravity-cli\\brain\\80adeee1-8673-4bcc-9446-c5b04b6ae8d0\\scratch\\internal_request.json", JSON.stringify(parsed, null, 2));
        const reqObj = parsed.request || parsed;

        // Extract model
        const model = reqObj.model || (reqObj.modelConfig && reqObj.modelConfig.model) || parsed.model || "";

        // Extract prompt
        let prompt = "";
        if (reqObj.prompt) {
          prompt = reqObj.prompt;
        } else if (Array.isArray(reqObj.contents)) {
          // Search backwards for the most recent message that contains text parts
          for (let i = reqObj.contents.length - 1; i >= 0; i--) {
            const item = reqObj.contents[i];
            const parts = item?.parts;
            if (Array.isArray(parts)) {
              const textParts = parts.filter((p: any) => typeof p.text === "string" && p.text.trim().length > 0);
              if (textParts.length > 0) {
                // Skip tool execution responses
                if (item.role === "tool" || item.role === "function") {
                  continue;
                }
                prompt = textParts.map((p: any) => p.text).join(" ");
                break;
              }
            }
          }
        } else if (reqObj.messages) {
          const lastMsg = reqObj.messages[reqObj.messages.length - 1];
          if (lastMsg && typeof lastMsg.content === "string") {
            prompt = lastMsg.content;
          }
        }

        // Clean up prompt — extract only user request from template tags
        let cleanPrompt = prompt;
        const match = prompt.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
        if (match && match[1]) {
          cleanPrompt = match[1].trim();
        }

        // Deduplicate: only log if this prompt is different from the last logged prompt
        const userMsgCount = Array.isArray(reqObj.messages) ? reqObj.messages.filter((m: any) => m && m.role === "user").length : 0;
        if (cleanPrompt && (cleanPrompt !== lastLoggedPrompt || userMsgCount !== lastLoggedUserMessageCount)) {
          lastLoggedPrompt = cleanPrompt;
          lastLoggedUserMessageCount = userMsgCount;
          // Single clean log line for the prompt
          const trimmed = cleanPrompt.length > 200 ? cleanPrompt.substring(0, 200) + "..." : cleanPrompt;
          console.log(`\x1b[35m○\x1b[0m Prompt: "${trimmed.replace(/\s+/g, " ")}" \x1b[90m(Model: ${model || "unknown"})\x1b[0m`);
        }

        if (reqObj.messages) {
          logActions(reqObj.messages, "openai");
        }
      }
    } catch {
      // Ignore parsing errors for logging
    }
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
    console.error(`[Proxy Error] Request to ${targetHost}${req.url} failed:`, err);
    if (!res.headersSent) {
      send(res, 502, { error: { message: `Proxy gateway error: ${err.message}` } });
    }
  });

  if (rawBody) {
    proxyReq.write(rawBody);
  }
  proxyReq.end();
}

async function handleResponses(config: Config, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = (await readJson(req)) as Record<string, unknown>;
    // Write body to scratch directory for inspection
    writeFileSync("C:\\Users\\Lenovo\\.gemini\\antigravity-cli\\brain\\80adeee1-8673-4bcc-9446-c5b04b6ae8d0\\scratch\\request.json", JSON.stringify(body, null, 2));
  } catch (err) {
    console.error(`[Server Error] Failed to parse/save responses JSON:`, err);
  }

  // Send a simple OpenAI-compatible successful chat response format or dummy so it doesn't fail immediately
  send(res, 200, {
    id: "chatcmpl-mock",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "mock-model",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "Hello from Modlane! We are capturing the request payload.",
        },
        finish_reason: "stop",
      },
    ],
  });
}

function logActions(messages: any[], dialect: "openai" | "anthropic") {
  if (!Array.isArray(messages)) return;

  const toolNamesById = new Map<string, string>();

  // 1. Scan for Tool Calls
  for (const msg of messages) {
    if (!msg) continue;

    // OpenAI Chat Completions
    if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (tc && tc.id && tc.function) {
          toolNamesById.set(tc.id, tc.function.name);
          if (!loggedToolCallIds.has(tc.id)) {
            loggedToolCallIds.add(tc.id);
            logToolCall(tc.function.name, tc.function.arguments);
          }
        }
      }
    }
    // OpenAI Responses API Function Call
    else if (msg.type === "function_call") {
      const id = msg.call_id || msg.id;
      if (id && msg.name) {
        toolNamesById.set(id, msg.name);
        if (!loggedToolCallIds.has(id)) {
          loggedToolCallIds.add(id);
          logToolCall(msg.name, msg.arguments);
        }
      }
    }
    // Anthropic Tool Use
    else if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part && part.type === "tool_use" && part.id) {
          toolNamesById.set(part.id, part.name);
          if (!loggedToolCallIds.has(part.id)) {
            loggedToolCallIds.add(part.id);
            logToolCall(part.name, part.input);
          }
        }
      }
    }
  }

  // 2. Scan for Tool Results
  for (const msg of messages) {
    if (!msg) continue;

    // OpenAI Chat Completions
    if (msg.role === "tool" && msg.tool_call_id) {
      const id = msg.tool_call_id;
      if (!loggedToolResultIds.has(id)) {
        loggedToolResultIds.add(id);
        const name = msg.name || toolNamesById.get(id) || "tool";
        const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "");
        const isError = /\bfail(ed|ing|ure|s)?\b|error:|assertion\s?error|exit status|command failed/i.test(content);
        logToolResult(name, content, isError);
      }
    }
    // OpenAI Responses API Function Call Output
    else if (msg.type === "function_call_output" && msg.call_id) {
      const id = msg.call_id;
      if (!loggedToolResultIds.has(id)) {
        loggedToolResultIds.add(id);
        const name = toolNamesById.get(id) || "tool";
        const content = typeof msg.output === "string" ? msg.output : JSON.stringify(msg.output ?? "");
        const isError = /\bfail(ed|ing|ure|s)?\b|error:|assertion\s?error|exit status|command failed/i.test(content);
        logToolResult(name, content, isError);
      }
    }
    // Anthropic Tool Result
    else if (msg.role === "user" && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part && part.type === "tool_result" && part.tool_use_id) {
          const id = part.tool_use_id;
          if (!loggedToolResultIds.has(id)) {
            loggedToolResultIds.add(id);
            const name = toolNamesById.get(id) || "tool";
            let contentStr = "";
            if (typeof part.content === "string") {
              contentStr = part.content;
            } else if (Array.isArray(part.content)) {
              contentStr = part.content
                .map((c: any) => (c && typeof c === "object" && c.type === "text" ? String(c.text ?? "") : ""))
                .join("");
            }
            const isError = part.is_error === true || /\bfail(ed|ing|ure|s)?\b|error:|assertion\s?error|exit status|command failed/i.test(contentStr);
            logToolResult(name, contentStr, isError);
          }
        }
      }
    }
  }
}

function logToolCall(name: string, args: any) {
  let formattedArgs = typeof args === "string" ? args.trim() : JSON.stringify(args || {});
  if (formattedArgs.startsWith("{") && formattedArgs.endsWith("}")) {
    try {
      const parsed = JSON.parse(formattedArgs);
      const entries = Object.entries(parsed).map(([k, v]) => {
        let valStr = typeof v === "string" ? v : JSON.stringify(v);
        if (valStr.length > 80) {
          valStr = valStr.substring(0, 80) + "...";
        }
        return `${k}: ${JSON.stringify(valStr)}`;
      });
      formattedArgs = `{ ${entries.join(", ")} }`;
    } catch {
      // Keep original
    }
  }
  console.log(`\x1b[36m⚙\x1b[0m Tool Call:   \x1b[36m${name}\x1b[0m \x1b[90m${formattedArgs}\x1b[0m`);
}

function logToolResult(name: string, content: string, isError: boolean) {
  const statusColor = isError ? "\x1b[31m" : "\x1b[32m";
  const statusText = isError ? "Error" : "Success";
  const len = content.length;
  console.log(`\x1b[32m✔\x1b[0m Tool Result: \x1b[36m${name}\x1b[0m -> ${statusColor}${statusText}\x1b[0m \x1b[90m(${len} chars)\x1b[0m`);
}


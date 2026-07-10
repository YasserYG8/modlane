import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
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
 * The routing brain (classification, signals) plugs into `route` (P4–P6).
 */
export function createGateway(config: Config): Server {
  return createServer((req, res) => {
    handle(config, req, res).catch(() => {
      if (!res.headersSent) send(res, 500, { error: { message: "internal error" } });
    });
  });
}

export function startGateway(config: Config, opts: ServerOptions): Promise<Server> {
  const server = createGateway(config);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => resolve(server));
  });
}

async function handle(config: Config, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === "GET" && req.url === "/health") {
    send(res, 200, { status: "ok" });
    return;
  }
  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    await handleChat(config, req, res, "openai");
    return;
  }
  if (req.method === "POST" && req.url === "/v1/messages") {
    await handleChat(config, req, res, "anthropic");
    return;
  }
  send(res, 404, { error: { message: "not found", type: "not_found" } });
}

async function handleChat(config: Config, req: IncomingMessage, res: ServerResponse, dialect: Dialect): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = (await readJson(req)) as Record<string, unknown>;
  } catch {
    sendError(res, dialect, 400, "invalid JSON body");
    return;
  }

  const chatReq = dialect === "openai" ? parseOpenAIRequest(body) : parseAnthropicRequest(body);
  const requestedModel = typeof body.model === "string" ? body.model : "";

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
  const iterator = routeStream(config, chatReq).stream[Symbol.asyncIterator]();

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

import { createServer, type Server } from "node:http";

export interface ServerOptions {
  host: string;
  port: number;
}

/**
 * Thin HTTP server. P0 exposes only /health so `modlane status` can confirm
 * liveness. Inbound protocol routes (OpenAI /v1/chat/completions, Anthropic
 * /v1/messages) land here in P3; the routing brain in P4–P6.
 */
export function createGateway(): Server {
  return createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "not found", type: "not_found" } }));
  });
}

export function startGateway(opts: ServerOptions): Promise<Server> {
  const server = createGateway();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => resolve(server));
  });
}

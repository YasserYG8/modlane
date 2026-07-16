import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

console.log("Starting Modlane gateway server...");
const server = spawn("node", ["dist/cli.js", "start"]);

server.stdout.on("data", (data) => {
  const line = data.toString();
  process.stdout.write("[Server] " + line);

  if (line.includes("gateway listening")) {
    console.log("\n=== Server is ready! Running 'agy --print' through the gateway... ===\n");

    const client = spawn("agy", ["--print", "Translate hello world to French"], {
      env: {
        ...process.env,
        ANTIGRAVITY_BASE_URL: "http://127.0.0.1:4700",
      },
    });

    client.stdout.on("data", (cData) => {
      process.stdout.write("[Client Response] " + cData.toString());
    });

    client.stderr.on("data", (cErr) => {
      process.stderr.write("[Client STDERR] " + cErr.toString());
    });

    client.on("close", () => {
      console.log("\n=== Client finished. Waiting 1s for server logs to flush... ===");
      setTimeout(() => {
        console.log("=== Done. Terminating server. ===");
        server.kill("SIGINT");
        setTimeout(() => process.exit(0), 500);
      }, 1000);
    });
  }
});

server.stderr.on("data", (data) => {
  process.stderr.write("[Server STDERR] " + data.toString());
});

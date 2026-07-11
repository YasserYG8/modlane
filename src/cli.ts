#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

// Load local environment variables from .env if present
if (existsSync(".env")) {
  try {
    if (typeof process.loadEnvFile === "function") {
      process.loadEnvFile(".env");
    } else {
      // Fallback parser for Node.js versions < 20.12
      const content = readFileSync(".env", "utf8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const idx = trimmed.indexOf("=");
        if (idx === -1) continue;
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    }
  } catch (err) {
    console.warn("Warning: Failed to parse .env file:", err);
  }
}

import { ConfigError, loadConfig } from "./config.js";
import { startGateway } from "./server.js";

const VERSION = "0.0.1";

function usage(): void {
  console.log(`modlane ${VERSION}

Usage:
  modlane start        Run the gateway
  modlane --version    Print version
  modlane --help       Show this help
`);
}

async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];

  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return 0;
  }
  if (cmd === undefined || cmd === "--help" || cmd === "-h") {
    usage();
    return 0;
  }
  if (cmd === "start") {
    let loaded;
    try {
      loaded = loadConfig();
    } catch (err) {
      if (err instanceof ConfigError) {
        console.error(err.message);
        return 1;
      }
      throw err;
    }
    const { host, port } = loaded.config.server;
    await startGateway(loaded.config, { host, port });
    console.log(`modlane gateway listening on http://${host}:${port} (config: ${loaded.source})`);
    return 0; // process stays alive on the open server handle
  }

  console.error(`unknown command: ${cmd}`);
  usage();
  return 1;
}

main(process.argv.slice(2)).then((code) => {
  if (code !== 0) process.exit(code);
});

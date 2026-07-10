#!/usr/bin/env node
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

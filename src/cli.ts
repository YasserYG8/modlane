#!/usr/bin/env node
import { startGateway } from "./server.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4700; // chosen to avoid framework defaults; overridable later via config

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
    await startGateway({ host: DEFAULT_HOST, port: DEFAULT_PORT });
    console.log(`modlane gateway listening on http://${DEFAULT_HOST}:${DEFAULT_PORT}`);
    return 0; // process stays alive on the open server handle
  }

  console.error(`unknown command: ${cmd}`);
  usage();
  return 1;
}

main(process.argv.slice(2)).then((code) => {
  if (code !== 0) process.exit(code);
});

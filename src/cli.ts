#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs";
import { ConfigError, loadConfig } from "./config.js";
import { loadDotEnv } from "./env.js";
import { startGateway } from "./server.js";
import { TEMPLATES } from "./templates.js";

// Load local environment variables from .env before anything reads process.env.
loadDotEnv();

const VERSION = "0.0.1";

function usage(): void {
  console.log(`modlane ${VERSION}

Usage:
  modlane start        Run the gateway
  modlane init         Generate config files (--claude, --agy)
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
  if (cmd === "init") {
    const flag = argv.find((arg) => arg in TEMPLATES);
    if (!flag) {
      console.error("Error: Please specify the target agent. Supported: --claude, --agy");
      return 1;
    }

    if (existsSync("modlane.yaml")) {
      console.error("Error: modlane.yaml already exists in this folder.");
      return 1;
    }

    const template = TEMPLATES[flag];
    if (!template) {
      console.error("Error: Template not found.");
      return 1;
    }
    try {
      writeFileSync("modlane.yaml", template.yaml);
      console.log("Created modlane.yaml");
      if (!existsSync(".env")) {
        writeFileSync(".env", template.env);
        console.log("Created .env");
      } else {
        console.log(".env already exists, skipping creation");
      }
      console.log(`\nSuccess! Modlane has been initialized for ${flag.replace("--", "")}.`);
      console.log("To run Modlane, execute: npx modlane start");
      return 0;
    } catch (err) {
      console.error("Error: Failed to write configuration files:", err);
      return 1;
    }
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

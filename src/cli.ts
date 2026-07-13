#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { ConfigError, loadConfig } from "./config.js";
import { loadDotEnv } from "./env.js";
import { startGateway } from "./server.js";
import {
  type ClassifiedTiers,
  getClaudeTemplate,
  getAgyTemplate,
  getCodexTemplate,
} from "./templates.js";

// Load local environment variables from .env before anything reads process.env.
loadDotEnv();

const VERSION = "0.0.1";

function usage(): void {
  console.log(`modlane ${VERSION}

Usage:
  modlane start        Run the gateway
  modlane init         Generate config files (--claude, --agy, --codex)
  modlane --version    Print version
  modlane --help       Show this help
`);
}

function classifyModels(models: string[], defaults: ClassifiedTiers): ClassifiedTiers {
  const cleanModels = models.filter(
    (m) =>
      !m.toLowerCase().includes("review") &&
      !m.toLowerCase().includes("instruct") &&
      m.trim().length > 0
  );

  if (cleanModels.length === 0) {
    return defaults;
  }

  // 1. Identify fast models (look for mini, flash, haiku)
  let fast =
    cleanModels.find(
      (m) =>
        m.toLowerCase().includes("mini") ||
        m.toLowerCase().includes("flash") ||
        m.toLowerCase().includes("haiku")
    ) || "";

  // 2. Identify powerful models (look for opus, fable, o1, o3, pro, ultra)
  let powerful =
    cleanModels.find(
      (m) =>
        m.toLowerCase().includes("opus") ||
        m.toLowerCase().includes("fable") ||
        m.toLowerCase().includes("o1") ||
        m.toLowerCase().includes("o3") ||
        m.toLowerCase().includes("pro") ||
        m.toLowerCase().includes("ultra")
    ) || "";

  // 3. Identify balanced models (look for sonnet, standard pro, or standard gpt-5/claude)
  let balanced =
    cleanModels.find(
      (m) =>
        m.toLowerCase().includes("sonnet") ||
        (m.toLowerCase().includes("pro") && m !== powerful)
    ) || "";

  // Fallbacks if any tier is empty
  if (!fast) fast = defaults.fast;
  if (!powerful) powerful = defaults.powerful;
  if (!balanced) balanced = defaults.balanced;

  return { fast, balanced, powerful };
}

function getAgyModels(): string[] {
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

function getCodexModels(): string[] {
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
    const flag = argv.find((arg) => ["--claude", "--agy", "--codex"].includes(arg));
    if (!flag) {
      console.error("Error: Please specify the target agent. Supported: --claude, --agy, --codex");
      return 1;
    }

    const force = argv.includes("--force") || argv.includes("-f");

    if (existsSync("modlane.yaml") && !force) {
      console.error("Error: modlane.yaml already exists in this folder. Use --force or -f to overwrite.");
      return 1;
    }

    let yamlContent = "";
    const envContent = "# No keys needed for session passthrough\n";

    if (flag === "--claude") {
      const defaults = {
        fast: "claude-3-5-haiku-latest",
        balanced: "claude-3-5-sonnet-latest",
        powerful: "claude-3-opus-latest",
      };
      yamlContent = getClaudeTemplate(defaults);
    } else if (flag === "--agy") {
      const defaults = {
        fast: "gemini-3.5-flash",
        balanced: "gemini-3.1-pro-preview",
        powerful: "claude-3-5-sonnet-latest",
      };
      console.log("Querying installed 'agy' CLI for active models list...");
      const models = getAgyModels();
      const classified = classifyModels(models, defaults);
      yamlContent = getAgyTemplate(classified);
    } else if (flag === "--codex") {
      const defaults = {
        fast: "gpt-5.4-mini",
        balanced: "gpt-5.5",
        powerful: "gpt-5.5",
      };
      console.log("Querying installed 'codex' CLI for active models list...");
      const models = getCodexModels();
      const classified = classifyModels(models, defaults);
      yamlContent = getCodexTemplate(classified);
    }

    try {
      writeFileSync("modlane.yaml", yamlContent);
      console.log("Created modlane.yaml");
      if (!existsSync(".env")) {
        writeFileSync(".env", envContent);
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

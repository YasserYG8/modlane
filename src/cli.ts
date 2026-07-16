#!/usr/bin/env node
import { existsSync, writeFileSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { execSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { ConfigError, loadConfig } from "./config.js";
import { loadDotEnv } from "./env.js";
import { startGateway, getCodexModels, getAgyModels } from "./server.js";
import {
  type ClassifiedTiers,
  getClaudeTemplate,
  getAgyTemplate,
  getCodexTemplate,
} from "./templates.js";

// Load local environment variables from .env before anything reads process.env.
loadDotEnv();

const VERSION = "0.0.1";

let originalBaseUrl: string | undefined = undefined;
let originalBaseUrlSnake: string | undefined = undefined;
let settingsUpdated = false;

function getSettingsPath(): string {
  return join(homedir(), ".gemini", "antigravity-cli", "settings.json");
}

function injectBaseUrl(): void {
  const path = getSettingsPath();
  if (!existsSync(path)) return;

  try {
    const content = readFileSync(path, "utf8");
    const settings = JSON.parse(content);
    originalBaseUrl = settings.baseUrl;
    originalBaseUrlSnake = settings.base_url;
    settings.baseUrl = "http://127.0.0.1:4700/v1";
    settings.base_url = "http://127.0.0.1:4700/v1";
    writeFileSync(path, JSON.stringify(settings, null, 2));
    settingsUpdated = true;
    console.log(`[Lifecycle] Automatically updated agy base_url -> http://127.0.0.1:4700/v1`);
  } catch (err) {
    console.warn(`[Lifecycle] Warning: Failed to inject base_url:`, err);
  }
}

function restoreBaseUrl(): void {
  if (!settingsUpdated) return;

  const path = getSettingsPath();
  if (!existsSync(path)) return;

  try {
    const content = readFileSync(path, "utf8");
    const settings = JSON.parse(content);
    
    if (originalBaseUrl === undefined) {
      delete settings.baseUrl;
    } else {
      settings.baseUrl = originalBaseUrl;
    }
    
    if (originalBaseUrlSnake === undefined) {
      delete settings.base_url;
    } else {
      settings.base_url = originalBaseUrlSnake;
    }
    
    writeFileSync(path, JSON.stringify(settings, null, 2));
    console.log(`[Lifecycle] Automatically restored agy base_url to original state.`);
    settingsUpdated = false;
  } catch (err) {
    console.warn(`[Lifecycle] Warning: Failed to restore base_url:`, err);
  }
}

function usage(): void {
  console.log(`modlane ${VERSION}

Usage:
  modlane start        Run the gateway
  modlane run          Run a command wrapped with Modlane proxy env vars (e.g. modlane run agy)
  modlane setup <cli>  Inject a zero-config proxy wrapper for an installed CLI (e.g. modlane setup agy)
  modlane restore <cli> Restore the original wrapperless state for a CLI (e.g. modlane restore agy)
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

async function isGatewayRunning(host: string, port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://${host}:${port}/health`, { signal: AbortSignal.timeout(500) });
    if (res.ok) {
      const data = (await res.json()) as any;
      return data?.status === "ok";
    }
  } catch {
    // Ignore errors, means gateway is not running
  }
  return false;
}
function getAgyBinPath(): string | null {
  try {
    const out = execSync("where.exe agy", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const path = out.split("\n")[0]?.trim();
    return path && existsSync(path) ? path : null;
  } catch {
    return null;
  }
}
function getCodexBinPaths(): { cmd: string | null; sh: string | null; ps1: string | null } {
  try {
    const out = execSync("where.exe codex", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const paths = out.split("\n").map((p) => p.trim()).filter(Boolean);
    const cmd = paths.find((p) => p.endsWith("codex.cmd")) || null;
    const sh = paths.find((p) => p.endsWith("codex")) || null;
    let ps1: string | null = null;
    if (cmd) {
      const ps1Path = join(dirname(cmd), "codex.ps1");
      if (existsSync(ps1Path)) ps1 = ps1Path;
    } else if (sh) {
      const ps1Path = join(dirname(sh), "codex.ps1");
      if (existsSync(ps1Path)) ps1 = ps1Path;
    }
    return { cmd, sh, ps1 };
  } catch {
    return { cmd: null, sh: null, ps1: null };
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
    let envContent = "";

    if (flag === "--claude") {
      const defaults = {
        fast: "claude-3-5-haiku-latest",
        balanced: "claude-3-5-sonnet-latest",
        powerful: "claude-3-opus-latest",
      };
      yamlContent = getClaudeTemplate(defaults);
      envContent = `# Redirect Claude Code to local Modlane proxy
CLAUDE_BASE_URL="http://127.0.0.1:4700/v1"
`;
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
      envContent = `# Redirect Antigravity (agy) to local Modlane proxy
ANTIGRAVITY_BASE_URL="http://127.0.0.1:4700"
`;
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
      envContent = `# Redirect Codex to local Modlane proxy
CODEX_API_BASE="http://127.0.0.1:4700/v1"
`;
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
  if (cmd === "run") {
    const targetCmd = argv.slice(1);
    if (targetCmd.length === 0) {
      console.error("Error: Please specify the command to run. Example: modlane run agy");
      return 1;
    }

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

    // Intercept config on startup
    injectBaseUrl();

    const { host, port } = loaded.config.server;
    const running = await isGatewayRunning(host, port);
    let server: any = null;

    if (running) {
      console.log(`[Modlane] Connected to existing gateway at http://${host}:${port}`);
    } else {
      server = await startGateway(loaded.config, { host, port });
      console.log(`\n\x1b[36m\x1b[1m▲ Modlane ${VERSION}\x1b[0m`);
      console.log(`  - Local:   \x1b[32mhttp://${host}:${port}\x1b[0m`);
      console.log(`  - Config:  \x1b[90m${loaded.source}\x1b[0m\n`);
    }

    const exe = targetCmd[0]!;
    const env = {
      ...process.env,
      CLOUD_CODE_URL: `http://${host}:${port}`,
      ANTIGRAVITY_BASE_URL: `http://${host}:${port}`,
      CLAUDE_BASE_URL: `http://${host}:${port}/v1`,
      CODEX_API_BASE: `http://${host}:${port}/v1`,
      HTTPS_PROXY: `http://${host}:${port}`,
      HTTP_PROXY: `http://${host}:${port}`,
    };

    return new Promise<number>((resolve) => {
      const child = spawn(exe, targetCmd.slice(1), {
        stdio: "inherit",
        env,
        shell: false,
      });

      const cleanup = () => {
        restoreBaseUrl();
        if (server) {
          server.close();
        }
      };

      child.on("close", (code) => {
        cleanup();
        resolve(code ?? 0);
      });

      child.on("error", (err) => {
        console.error(`[Modlane] Failed to start command:`, err.message);
        cleanup();
        resolve(1);
      });

      process.on("SIGINT", () => child.kill("SIGINT"));
      process.on("SIGTERM", () => child.kill("SIGTERM"));
      process.on("SIGHUP", () => child.kill("SIGHUP"));
      process.on("SIGBREAK", () => child.kill("SIGBREAK"));
    });
  }

  if (cmd === "setup") {
    const targetCli = argv[1];
    if (targetCli !== "agy" && targetCli !== "codex") {
      console.error("Error: Currently only 'agy' and 'codex' are supported for setup.");
      return 1;
    }

    if (targetCli === "codex") {
      const paths = getCodexBinPaths();
      if (!paths.cmd || !paths.sh || !paths.ps1) {
        console.error("Error: Could not locate all 'codex' executable wrapper files on your PATH.");
        return 1;
      }

      const bakCmd = paths.cmd + ".bak";
      const bakSh = paths.sh + ".bak";
      const bakPs1 = paths.ps1 + ".bak";

      try {
        if (!existsSync(bakCmd) && existsSync(paths.cmd)) {
          writeFileSync(bakCmd, readFileSync(paths.cmd));
          console.log(`[Setup] Created backup: ${bakCmd}`);
        }
        if (!existsSync(bakSh) && existsSync(paths.sh)) {
          writeFileSync(bakSh, readFileSync(paths.sh));
          console.log(`[Setup] Created backup: ${bakSh}`);
        }
        if (!existsSync(bakPs1) && existsSync(paths.ps1)) {
          writeFileSync(bakPs1, readFileSync(paths.ps1));
          console.log(`[Setup] Created backup: ${bakPs1}`);
        }

        const cmdContent = `@echo off
node -e "const net = require('net'); const client = net.createConnection({ port: 4700, host: '127.0.0.1' }, () => { process.exit(0); }); client.on('error', () => { process.exit(1); });" >nul 2>&1
if %errorlevel% equ 0 (
  node "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" -c openai_base_url="http://127.0.0.1:4700/v1" %*
) else (
  node "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*
)
`;
        writeFileSync(paths.cmd, cmdContent);
        console.log(`[Setup] Created wrapper: ${paths.cmd}`);

        const shContent = `#!/bin/sh
basedir=$(dirname "$(echo "$0" | sed -e 's,\\\\,/,g')")
case \`uname\` in
    *CYGWIN*|*MINGW*|*MSYS*)
        if command -v cygpath > /dev/null 2>&1; then
            basedir=\`cygpath -w "$basedir"\`
        fi
    ;;
esac

if node -e "const net = require('net'); const client = net.createConnection({ port: 4700, host: '127.0.0.1' }, () => { process.exit(0); }); client.on('error', () => { process.exit(1); });" >/dev/null 2>&1; then
  exec node "$basedir/node_modules/@openai/codex/bin/codex.js" -c openai_base_url="http://127.0.0.1:4700/v1" "$@"
else
  exec node "$basedir/node_modules/@openai/codex/bin/codex.js" "$@"
fi
`;
        writeFileSync(paths.sh, shContent, { mode: 0o755 });
        console.log(`[Setup] Created wrapper: ${paths.sh}`);

        const ps1Content = `#!/usr/bin/env pwsh
$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent

$exe=""
if ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {
  $exe=".exe"
}

# Healthcheck to see if Modlane gateway is running on port 4700
$socket = New-Object System.Net.Sockets.TcpClient
$connect = $socket.BeginConnect("127.0.0.1", 4700, $null, $null)
$wait = $connect.AsyncWaitHandle.WaitOne(100, $false)
$isOnline = $false
if ($wait) {
  if ($socket.Connected) {
    $isOnline = $true
  }
  $socket.EndConnect($connect)
}
$socket.Close()

# Build arguments list
$finalArgs = @()
if ($isOnline) {
  $finalArgs += "-c"
  $finalArgs += 'openai_base_url="http://127.0.0.1:4700/v1"'
}
$finalArgs += $args

$nodePath = "node"
if (Test-Path "$basedir/node$exe") {
  $nodePath = "$basedir/node$exe"
}

$ret=0
if ($MyInvocation.ExpectingInput) {
  $input | & $nodePath "$basedir/node_modules/@openai/codex/bin/codex.js" $finalArgs
} else {
  & $nodePath "$basedir/node_modules/@openai/codex/bin/codex.js" $finalArgs
}
$ret=$LASTEXITCODE
exit $ret
`;
        writeFileSync(paths.ps1, ps1Content);
        console.log(`[Setup] Created wrapper: ${paths.ps1}`);

        console.log("\nSuccess! You can now run 'codex' directly in any terminal, and it will route through Modlane automatically when the server is online.");
        return 0;
      } catch (err: any) {
        console.error("Error: Failed to set up codex wrappers:", err.message);
        return 1;
      }
    }

    const binPath = getAgyBinPath();
    if (!binPath) {
      console.error("Error: Could not locate 'agy' executable on your PATH.");
      return 1;
    }

    const binDir = dirname(binPath);
    const realExe = join(binDir, "agy-real.exe");
    const wrapperCmd = join(binDir, "agy.cmd");
    const wrapperSh = join(binDir, "agy");

    try {
      // If agy-real.exe does not exist, we must rename the original agy.exe
      if (!existsSync(realExe)) {
        const targetExe = join(binDir, "agy.exe");
        if (existsSync(targetExe)) {
          renameSync(targetExe, realExe);
          console.log(`[Setup] Renamed ${targetExe} -> ${realExe}`);
        } else {
          console.error(`Error: Could not find original executable at ${targetExe}`);
          return 1;
        }
      }

      // Write wrappers
      const cmdContent = `@echo off
node -e "const net = require('net'); const client = net.createConnection({ port: 4700, host: '127.0.0.1' }, () => { process.exit(0); }); client.on('error', () => { process.exit(1); });" >nul 2>&1
if %errorlevel% equ 0 (
  set CLOUD_CODE_URL=http://127.0.0.1:4700
  set ANTIGRAVITY_BASE_URL=http://127.0.0.1:4700
  set CLAUDE_BASE_URL=http://127.0.0.1:4700/v1
  set CODEX_API_BASE=http://127.0.0.1:4700/v1
  set HTTPS_PROXY=http://127.0.0.1:4700
  set HTTP_PROXY=http://127.0.0.1:4700
)
"%~dp0agy-real.exe" %*
`;
      writeFileSync(wrapperCmd, cmdContent);
      console.log(`[Setup] Created wrapper: ${wrapperCmd}`);

      const shContent = `#!/bin/sh
if node -e "const net = require('net'); const client = net.createConnection({ port: 4700, host: '127.0.0.1' }, () => { process.exit(0); }); client.on('error', () => { process.exit(1); });" >/dev/null 2>&1; then
  export CLOUD_CODE_URL=http://127.0.0.1:4700
  export ANTIGRAVITY_BASE_URL=http://127.0.0.1:4700
  export CLAUDE_BASE_URL=http://127.0.0.1:4700/v1
  export CODEX_API_BASE=http://127.0.0.1:4700/v1
  export HTTPS_PROXY=http://127.0.0.1:4700
  export HTTP_PROXY=http://127.0.0.1:4700
fi
"$(dirname "$0")/agy-real.exe" "$@"
`;
      writeFileSync(wrapperSh, shContent, { mode: 0o755 });
      console.log(`[Setup] Created wrapper: ${wrapperSh}`);
      console.log("\nSuccess! You can now run 'agy' directly in any terminal, and it will route through Modlane automatically.");
      return 0;
    } catch (err: any) {
      console.error("Error: Failed to set up wrappers:", err.message);
      return 1;
    }
  }

  if (cmd === "restore") {
    const targetCli = argv[1];
    if (targetCli !== "agy" && targetCli !== "codex") {
      console.error("Error: Currently only 'agy' and 'codex' are supported for restore.");
      return 1;
    }

    if (targetCli === "codex") {
      const paths = getCodexBinPaths();
      if (!paths.cmd && !paths.sh && !paths.ps1) {
        console.error("Error: Could not locate 'codex' on your PATH.");
        return 1;
      }

      try {
        if (paths.cmd) {
          const bakCmd = paths.cmd + ".bak";
          if (existsSync(bakCmd)) {
            writeFileSync(paths.cmd, readFileSync(bakCmd));
            unlinkSync(bakCmd);
            console.log(`[Restore] Restored ${paths.cmd} from backup`);
          }
        }
        if (paths.sh) {
          const bakSh = paths.sh + ".bak";
          if (existsSync(bakSh)) {
            writeFileSync(paths.sh, readFileSync(bakSh), { mode: 0o755 });
            unlinkSync(bakSh);
            console.log(`[Restore] Restored ${paths.sh} from backup`);
          }
        }
        if (paths.ps1) {
          const bakPs1 = paths.ps1 + ".bak";
          if (existsSync(bakPs1)) {
            writeFileSync(paths.ps1, readFileSync(bakPs1));
            unlinkSync(bakPs1);
            console.log(`[Restore] Restored ${paths.ps1} from backup`);
          }
        }
        console.log("\nSuccess! Restored original 'codex' wrapper scripts.");
        return 0;
      } catch (err: any) {
        console.error("Error: Failed to restore codex wrappers:", err.message);
        return 1;
      }
    }

    const binPath = getAgyBinPath();
    if (!binPath) {
      console.error("Error: Could not locate 'agy' on your PATH.");
      return 1;
    }

    const binDir = dirname(binPath);
    const realExe = join(binDir, "agy-real.exe");
    const targetExe = join(binDir, "agy.exe");
    const wrapperCmd = join(binDir, "agy.cmd");
    const wrapperSh = join(binDir, "agy");

    try {
      if (existsSync(realExe)) {
        if (existsSync(targetExe)) {
          unlinkSync(targetExe);
        }
        renameSync(realExe, targetExe);
        console.log(`[Restore] Restored ${realExe} -> ${targetExe}`);
      }
      if (existsSync(wrapperCmd)) {
        unlinkSync(wrapperCmd);
        console.log(`[Restore] Removed wrapper: ${wrapperCmd}`);
      }
      if (existsSync(wrapperSh)) {
        unlinkSync(wrapperSh);
        console.log(`[Restore] Removed wrapper: ${wrapperSh}`);
      }
      console.log("\nSuccess! Restored original 'agy' executable configuration.");
      return 0;
    } catch (err: any) {
      console.error("Error: Failed to restore original configuration:", err.message);
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

    // Intercept config on startup
    injectBaseUrl();

    // Register cleanup handlers
    const cleanup = () => {
      restoreBaseUrl();
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
    process.on("SIGHUP", cleanup);
    process.on("SIGBREAK", cleanup);
    process.on("exit", () => {
      restoreBaseUrl();
    });

    const { host, port } = loaded.config.server;
    await startGateway(loaded.config, { host, port });
    console.log(`\n\x1b[36m\x1b[1m▲ Modlane ${VERSION}\x1b[0m`);
    console.log(`  - Local:   \x1b[32mhttp://${host}:${port}\x1b[0m`);
    console.log(`  - Config:  \x1b[90m${loaded.source}\x1b[0m\n`);
    return 0; // process stays alive on the open server handle
  }

  console.error(`unknown command: ${cmd}`);
  usage();
  return 1;
}

main(process.argv.slice(2)).then((code) => {
  if (code !== 0) process.exit(code);
});

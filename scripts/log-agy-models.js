import { spawn, execSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = join(__dirname, "..");

async function run() {
  console.log("Starting Modlane gateway server...");
  const gateway = spawn("node", [join(projectRoot, "dist", "cli.js"), "start"], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let serverReady = false;
  let serverOutput = "";

  gateway.stdout.on("data", (data) => {
    const str = data.toString();
    serverOutput += str;
    if (str.includes("listening on")) {
      serverReady = true;
    }
  });

  gateway.stderr.on("data", (data) => {
    console.error("Gateway Error:", data.toString());
  });

  // Wait up to 5 seconds for the server to listen
  let attempts = 0;
  while (!serverReady && attempts < 50) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    attempts++;
  }

  if (!serverReady) {
    console.error("Failed to start Modlane gateway. Server output:");
    console.error(serverOutput);
    gateway.kill();
    process.exit(1);
  }

  console.log("Modlane gateway is ready! Running 'agy models' through the gateway...");

  try {
    const output = execSync("agy models", {
      env: {
        ...process.env,
        ANTIGRAVITY_BASE_URL: "http://127.0.0.1:4700",
      },
      encoding: "utf8",
    });
    
    console.log("\n--- Models logged from 'agy models' via Modlane ---");
    console.log(output);
    console.log("---------------------------------------------------\n");
  } catch (err) {
    console.error("Error executing 'agy models':", err.message);
    if (err.stdout) console.log("Stdout:", err.stdout);
    if (err.stderr) console.error("Stderr:", err.stderr);
  } finally {
    console.log("Shutting down Modlane gateway server...");
    gateway.kill();
  }
}

run().catch(console.error);

import { existsSync, readFileSync } from "node:fs";

/**
 * Parse .env content into key/value pairs. Zero-dependency fallback for the
 * native `process.loadEnvFile` (Node < 20.12). Supports comments, blank lines,
 * and single/double-quoted values. Kept intentionally small — not a full
 * dotenv (no `export` prefix, no inline comments, no variable expansion).
 */
export function parseEnv(content: string): Record<string, string> {
  const env: Record<string, string> = {};
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
    env[key] = val;
  }
  return env;
}

/** Load a local .env into process.env if present. Native loader first, parser fallback. */
export function loadDotEnv(path = ".env"): void {
  if (!existsSync(path)) return;
  try {
    if (typeof process.loadEnvFile === "function") {
      process.loadEnvFile(path);
    } else {
      const parsed = parseEnv(readFileSync(path, "utf8"));
      for (const [key, val] of Object.entries(parsed)) {
        process.env[key] = val;
      }
    }
  } catch (err) {
    console.warn("Warning: Failed to parse .env file:", err);
  }
}

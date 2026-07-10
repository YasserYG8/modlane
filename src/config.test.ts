import { afterEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, loadConfig, resolveApiKey } from "./config.js";

const dirs: string[] = [];
function tmpConfig(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "modlane-cfg-"));
  dirs.push(dir);
  const path = join(dir, "modlane.yaml");
  writeFileSync(path, yaml);
  return path;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const VALID = `
server: { host: 127.0.0.1, port: 4700 }
tiers:
  fast:     { provider: openrouter, model: m-fast }
  balanced: { provider: anthropic,  model: m-bal }
  powerful: { provider: openai,     model: m-pow }
providers:
  openai:     { kind: openai,            base_url: https://api.openai.com/v1, api_key_env: OPENAI_API_KEY }
  anthropic:  { kind: anthropic,         base_url: https://api.anthropic.com, api_key_env: ANTHROPIC_API_KEY }
  openrouter: { kind: openai-compatible, base_url: https://openrouter.ai/api/v1, api_key_env: OPENROUTER_API_KEY }
`;

test("valid config loads and normalizes", () => {
  const { config } = loadConfig(tmpConfig(VALID));
  expect(config.server.port).toBe(4700);
  expect(config.tiers.powerful).toEqual({ provider: "openai", model: "m-pow" });
  expect(config.providers.openrouter?.baseUrl).toBe("https://openrouter.ai/api/v1");
  expect(config.telemetry.captureContent).toBe(false); // privacy default
});

test("missing tier fails fast naming the tier", () => {
  const bad = VALID.replace(/  powerful:.*\n/, "");
  expect(() => loadConfig(tmpConfig(bad))).toThrow(/tiers\.powerful/);
});

test("tier referencing undefined provider fails", () => {
  const bad = VALID.replace("provider: openai,     model: m-pow", "provider: ghost, model: m-pow");
  expect(() => loadConfig(tmpConfig(bad))).toThrow(/undefined provider "ghost"/);
});

test("missing config file lists searched paths", () => {
  expect(() => loadConfig(join(tmpdir(), "does-not-exist.yaml"))).toThrow(ConfigError);
});

test("resolveApiKey reads from env, errors when unset", () => {
  const { config } = loadConfig(tmpConfig(VALID));
  expect(resolveApiKey(config, "openai", { OPENAI_API_KEY: "sk-x" })).toBe("sk-x");
  expect(() => resolveApiKey(config, "openai", {})).toThrow(/OPENAI_API_KEY/);
});

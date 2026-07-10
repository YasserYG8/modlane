import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export type TierName = "fast" | "balanced" | "powerful";
export type ProviderKind = "openai" | "anthropic" | "openai-compatible";

export interface ProviderConfig {
  kind: ProviderKind;
  baseUrl: string;
  apiKeyEnv: string | null;
}

export interface TierConfig {
  provider: string;
  model: string;
}

export interface Config {
  server: { host: string; port: number };
  router: { strategy: "rules" };
  tiers: Record<TierName, TierConfig>;
  providers: Record<string, ProviderConfig>;
  fallback: Partial<Record<TierName, TierConfig>>;
  anthropicDefaults: { maxTokens: number };
  telemetry: { store: string; captureContent: boolean };
  prices: Record<string, { inputPerMtok: number; outputPerMtok: number }>;
}

export interface LoadedConfig {
  config: Config;
  source: string;
}

const TIERS: readonly TierName[] = ["fast", "balanced", "powerful"];
const KINDS: readonly ProviderKind[] = ["openai", "anthropic", "openai-compatible"];

/** Thrown for any invalid or missing configuration. Message is user-facing. */
export class ConfigError extends Error { }

function fail(msg: string): never {
  throw new ConfigError(msg);
}

/** Search order: given path, else ./modlane.yaml, else ~/.modlane/config.yaml. */
export function configSearchPaths(explicit?: string): string[] {
  if (explicit) return [explicit];
  return [join(process.cwd(), "modlane.yaml"), join(homedir(), ".modlane", "config.yaml")];
}

export function loadConfig(explicit?: string): LoadedConfig {
  const paths = configSearchPaths(explicit);
  for (const path of paths) {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      continue; // not found → try next
    }
    return { config: validate(parseYaml(raw), path), source: path };
  }
  fail(`No config found. Searched:\n  ${paths.join("\n  ")}\nCopy modlane.example.yaml to modlane.yaml.`);
}

function asObject(v: unknown, where: string): Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) fail(`${where}: expected a mapping`);
  return v as Record<string, unknown>;
}

function asString(v: unknown, where: string): string {
  if (typeof v !== "string" || v.length === 0) fail(`${where}: expected a non-empty string`);
  return v;
}

function asNumber(v: unknown, where: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) fail(`${where}: expected a number`);
  return v;
}

function validate(root: unknown, source: string): Config {
  const r = asObject(root, source);

  const server = asObject(r.server ?? {}, "server");
  const providersRaw = asObject(r.providers, "providers");
  const providers: Record<string, ProviderConfig> = {};
  for (const [name, pv] of Object.entries(providersRaw)) {
    const p = asObject(pv, `providers.${name}`);
    const kind = asString(p.kind, `providers.${name}.kind`) as ProviderKind;
    if (!KINDS.includes(kind)) fail(`providers.${name}.kind: must be one of ${KINDS.join(", ")}`);
    providers[name] = {
      kind,
      baseUrl: asString(p.base_url, `providers.${name}.base_url`),
      apiKeyEnv: p.api_key_env == null ? null : asString(p.api_key_env, `providers.${name}.api_key_env`),
    };
  }

  const tiersRaw = asObject(r.tiers, "tiers");
  const tiers = {} as Record<TierName, TierConfig>;
  for (const tier of TIERS) {
    if (!(tier in tiersRaw)) fail(`tiers.${tier}: missing tier mapping`);
    tiers[tier] = readTier(tiersRaw[tier], `tiers.${tier}`, providers);
  }

  const fallback: Partial<Record<TierName, TierConfig>> = {};
  const fbRaw = r.fallback == null ? {} : asObject(r.fallback, "fallback");
  for (const [tier, fv] of Object.entries(fbRaw)) {
    if (!TIERS.includes(tier as TierName)) fail(`fallback.${tier}: unknown tier`);
    fallback[tier as TierName] = readTier(fv, `fallback.${tier}`, providers);
  }

  const tele = asObject(r.telemetry ?? {}, "telemetry");
  const ad = asObject(r.anthropic_defaults ?? {}, "anthropic_defaults");

  return {
    server: {
      host: typeof server.host === "string" ? server.host : "127.0.0.1",
      port: server.port == null ? 4700 : asNumber(server.port, "server.port"),
    },
    router: { strategy: "rules" },
    tiers,
    providers,
    fallback,
    anthropicDefaults: { maxTokens: ad.max_tokens == null ? 4096 : asNumber(ad.max_tokens, "anthropic_defaults.max_tokens") },
    telemetry: {
      store: typeof tele.store === "string" ? tele.store : "./modlane.sqlite",
      captureContent: tele.capture_content === true,
    },
    prices: readPrices(r.prices),
  };
}

function readTier(v: unknown, where: string, providers: Record<string, ProviderConfig>): TierConfig {
  const t = asObject(v, where);
  const provider = asString(t.provider, `${where}.provider`);
  if (!(provider in providers)) fail(`${where}.provider: undefined provider "${provider}"`);
  return { provider, model: asString(t.model, `${where}.model`) };
}

function readPrices(v: unknown): Config["prices"] {
  if (v == null) return {};
  const raw = asObject(v, "prices");
  const out: Config["prices"] = {};
  for (const [model, pv] of Object.entries(raw)) {
    const p = asObject(pv, `prices.${model}`);
    out[model] = {
      inputPerMtok: asNumber(p.input_per_mtok, `prices.${model}.input_per_mtok`),
      outputPerMtok: asNumber(p.output_per_mtok, `prices.${model}.output_per_mtok`),
    };
  }
  return out;
}

export function resolveApiKey(config: Config, providerName: string, env = process.env): string | null {
  const provider = config.providers[providerName];
  if (!provider) fail(`unknown provider "${providerName}"`);
  if (provider.apiKeyEnv == null) return null;
  const key = env[provider.apiKeyEnv];
  if (!key) fail(`provider "${providerName}" needs env var ${provider.apiKeyEnv}, which is not set`);
  return key;
}

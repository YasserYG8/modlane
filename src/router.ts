import type { Config, TierName } from "./config.js";
import {
  type Attempt,
  type ChatRequest,
  type ChatResult,
  type StreamChunk,
  makeAdapter,
  sendWithFallback,
} from "./providers/index.js";

export interface RouteResult {
  tier: TierName;
  provider: string;
  model: string;
  usedFallback: boolean;
  result: ChatResult;
}

/**
 * P3 stub: always route to the balanced tier. The classification + execution-signal
 * brain (P4–P6) replaces this — but the decision-record shape stays the same.
 */
export function pickTier(_req: ChatRequest): TierName {
  return "balanced";
}

function resolveProviderForModel(config: Config, model: string): string {
  const isAnthropic = model.startsWith("claude");
  for (const [name, prov] of Object.entries(config.providers)) {
    if (isAnthropic && prov.kind === "anthropic") {
      return name;
    }
    if (!isAnthropic && (prov.kind === "openai" || prov.kind === "openai-compatible")) {
      return name;
    }
  }
  return Object.keys(config.providers)[0] || "";
}

/** Resolve a tier to a concrete provider/model and execute, with same-tier fallback. */
export async function route(config: Config, req: ChatRequest, env = process.env): Promise<RouteResult> {
  const isVirtual = req.model.startsWith("modlane-");

  if (!isVirtual) {
    // Direct Concrete Model Routing (bypassing virtual tiers)
    const provider = resolveProviderForModel(config, req.model);
    const adapter = makeAdapter(config, provider, env);
    const result = await adapter.send(req);
    return {
      tier: "balanced",
      provider,
      model: req.model,
      usedFallback: false,
      result,
    };
  }

  const tier = pickTier(req);
  const primaryTier = config.tiers[tier];
  const primary: Attempt = {
    provider: primaryTier.provider,
    adapter: makeAdapter(config, primaryTier.provider, env),
    req: { ...req, model: primaryTier.model },
  };

  const fb = config.fallback[tier];
  const alt: Attempt | null = fb
    ? { provider: fb.provider, adapter: makeAdapter(config, fb.provider, env), req: { ...req, model: fb.model } }
    : null;

  const out = await sendWithFallback(primary, alt);
  return {
    tier,
    provider: out.provider,
    model: out.usedFallback && fb ? fb.model : primaryTier.model,
    usedFallback: out.usedFallback,
    result: out.result,
  };
}

export interface StreamRoute {
  tier: TierName;
  provider: string;
  model: string;
  stream: AsyncIterable<StreamChunk>;
}

/** Streaming route. No mid-stream fallback (per design): pick a tier, stream it. */
export function routeStream(config: Config, req: ChatRequest, env = process.env): StreamRoute {
  const isVirtual = req.model.startsWith("modlane-");

  if (!isVirtual) {
    const provider = resolveProviderForModel(config, req.model);
    const adapter = makeAdapter(config, provider, env);
    return {
      tier: "balanced",
      provider,
      model: req.model,
      stream: adapter.stream(req),
    };
  }

  const tier = pickTier(req);
  const t = config.tiers[tier];
  const adapter = makeAdapter(config, t.provider, env);
  return { tier, provider: t.provider, model: t.model, stream: adapter.stream({ ...req, model: t.model }) };
}

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

export function translateModel(config: Config, providerName: string, model: string): string {
  const provider = config.providers[providerName];
  if (provider && provider.models && model in provider.models) {
    return provider.models[model]!;
  }
  // Fallback: Try mapping globally across any provider's model map
  for (const prov of Object.values(config.providers)) {
    if (prov.models && model in prov.models) {
      return prov.models[model]!;
    }
  }
  return model;
}

export function resolveProviderForModel(config: Config, model: string): string {
  // If a provider explicitly maps this model name, route to that provider
  for (const [name, prov] of Object.entries(config.providers)) {
    if (prov.models && model in prov.models) {
      return name;
    }
  }

  const isAnthropic = model.startsWith("claude");
  const isOpenAI = model.startsWith("gpt-");
  const isGoogle = model.startsWith("gemini-");

  // Try to match by explicit prefix preference
  for (const [name, prov] of Object.entries(config.providers)) {
    if (isAnthropic && prov.kind === "anthropic") {
      return name;
    }
    if (isOpenAI && name === "openai") {
      return name;
    }
    if (isGoogle && name === "google") {
      return name;
    }
  }

  // Fallback to first matching provider kind
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
    req.model = translateModel(config, provider, req.model);
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
  const primaryModel = translateModel(config, primaryTier.provider, primaryTier.model);
  const primary: Attempt = {
    provider: primaryTier.provider,
    adapter: makeAdapter(config, primaryTier.provider, env),
    req: { ...req, model: primaryModel },
  };

  const fb = config.fallback[tier];
  const alt: Attempt | null = fb
    ? {
        provider: fb.provider,
        adapter: makeAdapter(config, fb.provider, env),
        req: { ...req, model: translateModel(config, fb.provider, fb.model) },
      }
    : null;

  const out = await sendWithFallback(primary, alt);
  return {
    tier,
    provider: out.provider,
    model: out.usedFallback && fb ? translateModel(config, fb.provider, fb.model) : primaryModel,
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
    req.model = translateModel(config, provider, req.model);
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
  const mappedModel = translateModel(config, t.provider, t.model);
  const adapter = makeAdapter(config, t.provider, env);
  return {
    tier,
    provider: t.provider,
    model: mappedModel,
    stream: adapter.stream({ ...req, model: mappedModel }),
  };
}

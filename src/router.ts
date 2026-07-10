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

/** Resolve a tier to a concrete provider/model and execute, with same-tier fallback. */
export async function route(config: Config, req: ChatRequest, env = process.env): Promise<RouteResult> {
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
  const tier = pickTier(req);
  const t = config.tiers[tier];
  const adapter = makeAdapter(config, t.provider, env);
  return { tier, provider: t.provider, model: t.model, stream: adapter.stream({ ...req, model: t.model }) };
}

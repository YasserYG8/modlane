import { type Config, resolveApiKey } from "../config.js";
import { AnthropicAdapter } from "./anthropic.js";
import { OpenAICompatAdapter } from "./openai.js";
import { type ChatResult, type ProviderAdapter, ProviderError } from "./types.js";

export * from "./types.js";

/** Build the adapter for a configured provider, resolving its secret from env. */
export function makeAdapter(config: Config, providerName: string, env = process.env): ProviderAdapter {
  const pc = config.providers[providerName];
  if (!pc) throw new Error(`unknown provider "${providerName}"`);
  const key = resolveApiKey(config, providerName, env);
  switch (pc.kind) {
    case "openai":
    case "openai-compatible":
      return new OpenAICompatAdapter(pc.kind, pc.baseUrl, key);
    case "anthropic":
      return new AnthropicAdapter(pc.baseUrl, key, config.anthropicDefaults.maxTokens);
  }
}

export interface Attempt {
  provider: string;
  adapter: ProviderAdapter;
  req: import("./types.js").ChatRequest;
}

export interface FallbackOutcome {
  result: ChatResult;
  provider: string;
  usedFallback: boolean;
}

/** Try the primary; on a retryable ProviderError, try the alternate (same tier, different provider). */
export async function sendWithFallback(primary: Attempt, alt: Attempt | null): Promise<FallbackOutcome> {
  try {
    return { result: await primary.adapter.send(primary.req), provider: primary.provider, usedFallback: false };
  } catch (err) {
    if (alt && err instanceof ProviderError && err.retryable) {
      return { result: await alt.adapter.send(alt.req), provider: alt.provider, usedFallback: true };
    }
    throw err;
  }
}

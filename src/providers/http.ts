import { ProviderError, isRetryableStatus } from "./types.js";

const UPSTREAM_TIMEOUT_MS = 120_000;

export function trimSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/** POST JSON, throwing a ProviderError on network failure or non-2xx. */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ProviderError(`network error: ${(err as Error).message}`, 0, true);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ProviderError(
      `provider ${res.status}: ${detail.slice(0, 200)}`,
      res.status,
      isRetryableStatus(res.status),
    );
  }
  return res;
}

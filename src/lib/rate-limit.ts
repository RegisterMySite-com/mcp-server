import type { Env } from "./types";
import { rateLimitKey } from "./utils";
import { textResult } from "./types";

const DEFAULT_LIMITS: Record<string, { limit: number; windowSec: number }> = {
  default: { limit: 90, windowSec: 60 },
  email_send: { limit: 20, windowSec: 60 },
  email_send_batch: { limit: 5, windowSec: 60 },
  ai_generate: { limit: 30, windowSec: 60 },
  ai_summarize: { limit: 30, windowSec: 60 },
  vector_semantic_search: { limit: 40, windowSec: 60 },
  kb_ask: { limit: 20, windowSec: 60 },
  deploy_run: { limit: 10, windowSec: 60 },
};

export async function enforceRateLimit(
  env: Env,
  userId: string,
  tool: string
): Promise<ReturnType<typeof textResult> | null> {
  const spec = DEFAULT_LIMITS[tool] ?? DEFAULT_LIMITS.default;
  const bucket = Math.floor(Date.now() / 1000 / spec.windowSec);
  const key = `${rateLimitKey(userId, tool)}:${bucket}`;
  const current = Number((await env.KV.get(key)) ?? "0");
  if (current >= spec.limit) {
    return textResult(
      `Rate limit exceeded for ${tool}: ${spec.limit} requests per ${spec.windowSec}s. Retry shortly.`,
      true
    );
  }
  await env.KV.put(key, String(current + 1), { expirationTtl: spec.windowSec + 5 });
  return null;
}

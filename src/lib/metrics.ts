import type { Env } from "./types";

export function recordToolMetric(
  env: Env,
  tool: string,
  userId: string,
  ok: boolean,
  durationMs: number
): void {
  try {
    env.METRICS?.writeDataPoint({
      blobs: [tool, userId, ok ? "ok" : "error"],
      doubles: [durationMs],
      indexes: [tool],
    });
  } catch {
    // Observability must never break a tool call.
  }
}

export async function withToolMetrics<T>(
  env: Env,
  tool: string,
  userId: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  let ok = true;
  try {
    const result = await fn();
    const maybe = result as { isError?: boolean };
    if (maybe?.isError) ok = false;
    return result;
  } catch (err) {
    ok = false;
    throw err;
  } finally {
    recordToolMetric(env, tool, userId, ok, Date.now() - start);
  }
}

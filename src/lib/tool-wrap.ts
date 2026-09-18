import type { Env } from "./types";
import { currentAuth } from "./authz";
import { enforceRateLimit } from "./rate-limit";
import { withToolMetrics } from "./metrics";
import { textResult } from "./types";

export function wrapTool<TArgs, TResult>(
  env: Env,
  tool: string,
  handler: (args: TArgs) => Promise<TResult>
) {
  return async (args: TArgs): Promise<TResult> => {
    const auth = currentAuth();
    const limited = await enforceRateLimit(env, auth.userId, tool);
    if (limited) return limited as TResult;
    try {
      return await withToolMetrics(env, tool, auth.userId, () => handler(args));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return textResult(`${tool} failed: ${message}`, true) as TResult;
    }
  };
}

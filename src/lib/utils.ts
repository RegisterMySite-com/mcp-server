/**
 * Small utilities used across tools.
 */

/** Generate a simple UUID v4-ish id (Workers crypto) */
export function uuid(): string {
  return crypto.randomUUID();
}

/** Safe JSON parse with fallback */
export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Truncate long strings for logging / previews */
export function truncate(str: string, max = 200): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + "…";
}

/** Simple rate-limit key builder */
export function rateLimitKey(userId: string | undefined, tool: string): string {
  return `rl:${userId ?? "anon"}:${tool}`;
}

/**
 * Basic input sanitization for SQL-ish contexts.
 * Prefer parameterized queries; this is a last-resort guard.
 */
export function sanitizeIdentifier(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "");
}

/** Format bytes for human display */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

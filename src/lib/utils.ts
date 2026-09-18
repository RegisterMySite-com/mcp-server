export function uuid(): string {
  return crypto.randomUUID();
}

export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function truncate(str: string, max = 200): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + "…";
}

export function rateLimitKey(userId: string | undefined, tool: string): string {
  return `rl:${userId ?? "anon"}:${tool}`;
}

export function sanitizeIdentifier(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function asStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return [String(value)].filter(Boolean);
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+=(?:"[^"]*"|'[^']*')/gi, "")
    .replace(/javascript:/gi, "");
}

export function mergeTemplate(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key: string) => {
    const value = variables[key];
    return value == null ? "" : String(value);
  });
}

export function isSelectOnly(sql: string): boolean {
  const trimmed = sql.trim().replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
  const first = trimmed.split(/\s+/)[0]?.toUpperCase();
  if (first !== "SELECT" && first !== "WITH") return false;
  if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|ATTACH|DETACH|PRAGMA|REPLACE|CREATE|VACUUM)\b/i.test(trimmed)) {
    return false;
  }
  return true;
}

export function ftsQuery(raw: string): string {
  const tokens = raw
    .replace(/['"^:(){}[\]\\]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1)
    .slice(0, 12);
  if (tokens.length === 0) return `"${raw.slice(0, 80).replace(/"/g, "")}"`;
  return tokens.map((t) => `${t}*`).join(" AND ");
}

export function chunkText(text: string, size = 800, overlap = 120): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    chunks.push(clean.slice(i, i + size));
    i += size - overlap;
  }
  return chunks.slice(0, 24);
}

export function kvUserPrefix(userId: string): string {
  return `user:${userId}:`;
}

export function namespacedKey(userId: string, key: string): string {
  const trimmed = key.replace(/^\/+/, "");
  const prefix = kvUserPrefix(userId);
  if (trimmed.startsWith(prefix) || trimmed.startsWith("rl:") || trimmed.startsWith("oauth:")) {
    return trimmed;
  }
  return `${prefix}${trimmed}`;
}

export function parseOrigins(raw: string | undefined): string[] | "*" {
  if (!raw || raw.trim() === "*") return "*";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function corsHeaders(request: Request, origins: string[] | "*"): HeadersInit {
  const requestOrigin = request.headers.get("Origin") ?? "";
  const allow =
    origins === "*"
      ? "*"
      : origins.includes(requestOrigin)
        ? requestOrigin
        : origins[0] ?? "null";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, mcp-session-id, mcp-protocol-version",
    "Access-Control-Expose-Headers": "mcp-session-id, mcp-protocol-version",
    Vary: "Origin",
  };
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

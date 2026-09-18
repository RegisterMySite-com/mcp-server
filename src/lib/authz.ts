import { getMcpAuthContext } from "agents/mcp/server";
import type { AuthProps } from "./types";
import { textResult } from "./types";

export function currentAuth(): AuthProps {
  const ctx = getMcpAuthContext();
  const props = (ctx?.props ?? {}) as Partial<AuthProps>;
  if (props.userId) {
    return {
      userId: String(props.userId),
      username: props.username,
      displayName: props.displayName,
      email: props.email,
      avatarUrl: props.avatarUrl,
      provider: props.provider ?? "demo",
      scopes: props.scopes ?? ["mcp:tools", "mcp:read", "mcp:write"],
    };
  }
  return {
    userId: "anon",
    username: "anonymous",
    provider: "demo",
    scopes: ["mcp:tools", "mcp:read"],
  };
}

export function hasScope(auth: AuthProps, scope: string): boolean {
  return (auth.scopes ?? []).includes(scope) || (auth.scopes ?? []).includes("mcp:tools");
}

export function requireWrite(auth: AuthProps) {
  if (auth.userId === "anon") {
    return textResult("Write tools require an authenticated user. Complete OAuth at /authorize.", true);
  }
  return null;
}

export function canAccessRow(auth: AuthProps, ownerId: string | null | undefined): boolean {
  if (!ownerId || ownerId === "system") return true;
  if (auth.userId === "anon") return ownerId === "anon";
  return ownerId === auth.userId;
}

export function ownerFilterSql(alias = ""): { sql: string; params: string[] } {
  const col = alias ? `${alias}.user_id` : "user_id";
  const auth = currentAuth();
  if (auth.userId === "anon") {
    return { sql: `(${col} IS NULL OR ${col} = ?)`, params: ["anon"] };
  }
  return { sql: `(${col} IS NULL OR ${col} = ?)`, params: [auth.userId] };
}

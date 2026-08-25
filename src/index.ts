/**
 * Cloudflare MCP Workspace — Worker entry point
 *
 * Architecture (2026+ best practice):
 *   - Stateless MCP server via createMcpHandler (Agents SDK)
 *   - Official @modelcontextprotocol/server (MCP 2026-07-28)
 *   - Streamable HTTP transport on /mcp
 *   - OAuth 2.1 via @cloudflare/workers-oauth-provider
 *
 * Toggle AUTH_ENABLED:
 *   false → public MCP (no login)
 *   true  → OAuth-protected /mcp (browser consent → token → tools)
 */
import { createMcpHandler } from "agents/mcp/server";
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createServer } from "./server";
import { AuthHandler } from "./auth/handler";
import type { Env } from "./lib/types";

/**
 * true  = require OAuth for /mcp (needs OAUTH_KV + COOKIE_ENCRYPTION_KEY)
 * false = public tools (no login)
 */
const AUTH_ENABLED = true;

// ── Stateless MCP handler ───────────────────────────────────────────────────
function buildMcpHandler(env: Env) {
  return createMcpHandler(() => createServer(env), {
    route: "/mcp",
    corsOptions: { origin: "*" },
  });
}

// ── Public Worker ───────────────────────────────────────────────────────────
const publicWorker: ExportedHandler<Env> = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        server: env.MCP_SERVER_NAME,
        version: env.MCP_SERVER_VERSION,
        auth: false,
      });
    }

    if (url.pathname === "/" || url.pathname === "") {
      return Response.json({
        name: env.MCP_SERVER_NAME,
        version: env.MCP_SERVER_VERSION,
        mcp: "/mcp",
        health: "/health",
        auth: false,
        docs: "Connect MCP clients to /mcp (Streamable HTTP). Auth is disabled.",
      });
    }

    return buildMcpHandler(env)(request, env, ctx);
  },
};

// ── OAuth-protected Worker ──────────────────────────────────────────────────
function buildOAuthWorker() {
  return new OAuthProvider({
    apiRoute: "/mcp",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apiHandler: {
      async fetch(request: Request, env: Env, ctx: ExecutionContext) {
        return buildMcpHandler(env)(request, env, ctx);
      },
    } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    defaultHandler: AuthHandler as any,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    scopesSupported: ["mcp:tools", "mcp:read", "mcp:write"],
    accessTokenTTL: 3600,
    refreshTokenTTL: 2592000,
  });
}

export default AUTH_ENABLED ? buildOAuthWorker() : publicWorker;

/**
 * Cloudflare MCP Workspace — Worker entry point
 *
 * Architecture:
 *   - Stateless MCP server via createMcpHandler (Agents SDK)
 *   - Official @modelcontextprotocol/server
 *   - Streamable HTTP transport on /mcp
 *   - OAuth 2.1 via @cloudflare/workers-oauth-provider
 *   - Queue consumer for Vectorize indexing
 */
import { createMcpHandler } from "agents/mcp/server";
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createServer } from "./server";
import { AuthHandler } from "./auth/handler";
import type { Env, IndexJob } from "./lib/types";
import { corsHeaders, parseOrigins } from "./lib/utils";
import { indexNow } from "./lib/embed";

function authEnabled(env: Env): boolean {
  return String(env.AUTH_ENABLED ?? "true").toLowerCase() !== "false";
}

function buildMcpHandler(env: Env) {
  const origins = parseOrigins(env.CORS_ORIGINS);
  const origin: string = origins === "*" ? "*" : origins[0] ?? "*";
  return createMcpHandler(() => createServer(env), {
    route: "/mcp",
    corsOptions: { origin },
  });
}

const publicWorker: ExportedHandler<Env> = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const extra = corsHeaders(request, parseOrigins(env.CORS_ORIGINS));

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: extra });
    }

    if (url.pathname === "/health") {
      return Response.json(
        {
          status: "ok",
          server: env.MCP_SERVER_NAME,
          version: env.MCP_SERVER_VERSION,
          auth: false,
        },
        { headers: extra }
      );
    }

    if (url.pathname === "/" || url.pathname === "") {
      return Response.json(
        {
          name: env.MCP_SERVER_NAME,
          version: env.MCP_SERVER_VERSION,
          mcp: "/mcp",
          health: "/health",
          auth: false,
          docs: "Connect MCP clients to /mcp (Streamable HTTP). Auth is disabled.",
        },
        { headers: extra }
      );
    }

    return buildMcpHandler(env)(request, env, ctx);
  },
};

function buildOAuthWorker() {
  return new OAuthProvider({
    apiRoute: "/mcp",
    apiHandler: {
      async fetch(request: Request, env: Env, ctx: ExecutionContext) {
        return buildMcpHandler(env)(request, env, ctx);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    defaultHandler: AuthHandler as any,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    scopesSupported: ["mcp:tools", "mcp:read", "mcp:write"],
    accessTokenTTL: 3600,
    // refreshTokenTTL is supported on workers-oauth-provider >= 0.0.8.
    // Keep the constructor compatible with ^0.0.5 used in package.json.
  });
}

const oauthWorker = buildOAuthWorker();

const worker: ExportedHandler<Env> = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (!authEnabled(env)) return publicWorker.fetch!(request, env, ctx);
    return oauthWorker.fetch(request, env, ctx);
  },

  async queue(batch: MessageBatch<IndexJob>, env: Env) {
    for (const msg of batch.messages) {
      try {
        const job = msg.body as IndexJob;
        await indexNow(env, job);
        msg.ack();
      } catch (err) {
        console.error("index job failed", err);
        msg.retry();
      }
    }
  },
};

export default worker;

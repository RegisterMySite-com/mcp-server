import { McpServer } from "@modelcontextprotocol/server";
import type { Env } from "../lib/types";
import { structuredResult } from "../lib/types";
import { currentAuth } from "../lib/authz";
import { wrapTool } from "../lib/tool-wrap";

export function registerUtilityTools(server: McpServer, env: Env) {
  server.registerTool(
    "health_check",
    {
      description:
        "Check that the MCP server and its Cloudflare bindings are reachable. Returns status of DB, KV, R2, AI, Vectorize, and queue.",
      inputSchema: {},
    },
    wrapTool(env, "health_check", async () => {
      const checks: Record<string, string> = {};
      try {
        await env.DB.prepare("SELECT 1").first();
        checks.d1 = "ok";
      } catch (e) {
        checks.d1 = e instanceof Error ? e.message : "error";
      }
      try {
        await env.KV.get("__health__");
        checks.kv = "ok";
      } catch {
        checks.kv = "error";
      }
      try {
        await env.R2.list({ limit: 1 });
        checks.r2 = "ok";
      } catch {
        checks.r2 = "error";
      }
      checks.ai = env.AI ? "bound" : "missing";
      checks.vectorize = env.VECTORIZE ? "bound" : "missing";
      checks.queue = env.INDEX_QUEUE ? "bound" : "missing";
      const healthy = checks.d1 === "ok" && checks.kv === "ok" && checks.r2 === "ok";
      return structuredResult({
        status: healthy ? "healthy" : "degraded",
        server: env.MCP_SERVER_NAME,
        version: env.MCP_SERVER_VERSION,
        environment: "production",
        checks,
        timestamp: new Date().toISOString(),
      });
    })
  );

  server.registerTool(
    "list_services",
    {
      description:
        "List the Cloudflare services bound to this MCP server and the high-level capabilities they power.",
      inputSchema: {},
    },
    wrapTool(env, "list_services", async () =>
      structuredResult({
        services: [
          { binding: "DB", product: "D1", purpose: "Notes, documents metadata, activity, email history" },
          { binding: "KV", product: "Workers KV", purpose: "Preferences, cache, rate limits" },
          { binding: "R2", product: "R2 Object Storage", purpose: "Document blobs and site assets" },
          { binding: "AI", product: "Workers AI", purpose: "Generation, summarization, embeddings" },
          { binding: "VECTORIZE", product: "Vectorize", purpose: "Semantic search over notes and documents" },
          { binding: "INDEX_QUEUE", product: "Queues", purpose: "Async embedding / reindex jobs" },
          { binding: "OAUTH_KV", product: "Workers KV", purpose: "OAuth token and client state" },
          { binding: "METRICS", product: "Analytics Engine", purpose: "Tool latency and error counts" },
        ],
      })
    )
  );

  server.registerTool(
    "whoami",
    {
      description: "Return the authenticated identity attached to this MCP session.",
      inputSchema: {},
    },
    wrapTool(env, "whoami", async () => structuredResult(currentAuth()))
  );
}

/**
 * MCP Server factory.
 *
 * Creates a fresh McpServer instance per request (stateless pattern).
 * All tools / resources / prompts close over the Worker `env` bindings.
 */
import { McpServer } from "@modelcontextprotocol/server";
import type { Env } from "./lib/types";

import { registerUtilityTools } from "./tools/utility";
import { registerD1Tools } from "./tools/d1";
import { registerKvTools } from "./tools/kv";
import { registerR2Tools } from "./tools/r2";
import { registerAiTools } from "./tools/ai";
import { registerVectorizeTools } from "./tools/vectorize";
import { registerResources } from "./resources/index";
import { registerPrompts } from "./prompts/index";

export function createServer(env: Env): McpServer {
  const server = new McpServer({
    name: env.MCP_SERVER_NAME || "Cloudflare Knowledge Workspace",
    version: env.MCP_SERVER_VERSION || "1.0.0",
  });

  // Public utility tools
  registerUtilityTools(server, env);

  // Knowledge store (D1)
  registerD1Tools(server, env);

  // Fast KV storage
  registerKvTools(server, env);

  // Object storage
  registerR2Tools(server, env);

  // Workers AI
  registerAiTools(server, env);

  // Semantic search
  registerVectorizeTools(server, env);

  // Readable resources
  registerResources(server, env);

  // Prompt templates
  registerPrompts(server);

  return server;
}

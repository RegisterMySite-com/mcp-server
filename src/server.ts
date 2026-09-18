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
import { registerEmailTools } from "./tools/email";
import { registerDeployTools } from "./tools/deploy";
import { registerResources } from "./resources/index";
import { registerPrompts } from "./prompts/index";

export function createServer(env: Env): McpServer {
  const server = new McpServer({
    name: env.MCP_SERVER_NAME || "Cloudflare Knowledge Workspace",
    version: env.MCP_SERVER_VERSION || "1.1.0",
  });

  registerUtilityTools(server, env);
  registerD1Tools(server, env);
  registerKvTools(server, env);
  registerR2Tools(server, env);
  registerAiTools(server, env);
  registerVectorizeTools(server, env);
  registerEmailTools(server, env);
  registerDeployTools(server, env);
  registerResources(server, env);
  registerPrompts(server);

  return server;
}

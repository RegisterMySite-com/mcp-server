import { McpServer } from "@modelcontextprotocol/server";
import { tools } from "./catalog.ts";
import { envFromProcess, RmsClient, type PlatformEnv } from "./client.ts";

/**
 * Register one MCP tool per platform REST call.
 * Tools are not mounted on the knowledge-workspace server in this change.
 */
export function registerPlatformTools(server: McpServer, env: PlatformEnv = envFromProcess()): void {
  const client = new RmsClient(env);
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: `${tool.description} Calls ${tool.method} ${tool.path}. Billing: ${tool.billing}. Phase ${tool.phase}.`,
        inputSchema: tool.schema,
      },
      async (args) => {
        const result = await client.invoke(tool, args as Record<string, unknown>);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
          isError: true,
        };
      },
    );
  }
}

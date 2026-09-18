/**
 * Workers KV tools — namespaced per authenticated user.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env } from "../lib/types";
import { textResult, structuredResult } from "../lib/types";
import { currentAuth, requireWrite } from "../lib/authz";
import { namespacedKey, kvUserPrefix } from "../lib/utils";
import { wrapTool } from "../lib/tool-wrap";
import { logActivity } from "../lib/activity";

const MAX_VALUE = 512 * 1024;

export function registerKvTools(server: McpServer, env: Env) {
  server.registerTool(
    "kv_get",
    {
      description:
        "Read a value from Workers KV by key. Keys are automatically namespaced to the authenticated user.",
      inputSchema: z.object({
        key: z.string().min(1).max(512),
      }),
    },
    wrapTool(env, "kv_get", async ({ key }) => {
      const auth = currentAuth();
      const nsKey = namespacedKey(auth.userId, key);
      const value = await env.KV.get(nsKey);
      return structuredResult({ key: nsKey, value, found: value !== null });
    })
  );

  server.registerTool(
    "kv_put",
    {
      description:
        "Write a string value to Workers KV under the current user prefix. Optionally set an expiration TTL in seconds.",
      inputSchema: z.object({
        key: z.string().min(1).max(512),
        value: z.string().max(MAX_VALUE),
        expirationTtl: z
          .number()
          .int()
          .min(60)
          .optional()
          .describe("Seconds until the key expires (min 60)"),
      }),
    },
    wrapTool(env, "kv_put", async ({ key, value, expirationTtl }) => {
      const auth = currentAuth();
      const denied = requireWrite(auth);
      if (denied) return denied;
      const nsKey = namespacedKey(auth.userId, key);
      await env.KV.put(nsKey, value, expirationTtl ? { expirationTtl } : undefined);
      await logActivity(env, "kv.put", "kv", nsKey, auth.userId);
      return textResult(`Stored key "${nsKey}"${expirationTtl ? ` (TTL ${expirationTtl}s)` : ""}`);
    })
  );

  server.registerTool(
    "kv_delete",
    {
      description: "Delete a namespaced key from Workers KV.",
      inputSchema: z.object({
        key: z.string().min(1).max(512),
      }),
    },
    wrapTool(env, "kv_delete", async ({ key }) => {
      const auth = currentAuth();
      const denied = requireWrite(auth);
      if (denied) return denied;
      const nsKey = namespacedKey(auth.userId, key);
      await env.KV.delete(nsKey);
      await logActivity(env, "kv.delete", "kv", nsKey, auth.userId);
      return textResult(`Deleted key "${nsKey}"`);
    })
  );

  server.registerTool(
    "kv_list",
    {
      description:
        "List keys in the current user's KV prefix. Optionally filter by additional prefix and page with a cursor.",
      inputSchema: z.object({
        prefix: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional().default(100),
        cursor: z.string().optional(),
      }),
    },
    wrapTool(env, "kv_list", async ({ prefix, limit = 100, cursor }) => {
      const auth = currentAuth();
      const fullPrefix = `${kvUserPrefix(auth.userId)}${prefix ?? ""}`;
      const list = await env.KV.list({ prefix: fullPrefix, limit, cursor });
      return structuredResult({
        keys: list.keys.map((k) => ({
          name: k.name,
          expiration: k.expiration,
        })),
        list_complete: list.list_complete,
        cursor: "cursor" in list ? list.cursor : undefined,
      });
    })
  );
}

/**
 * Workers KV tools — fast key-value storage for preferences, cache, and notes.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env } from "../lib/types";
import { textResult, structuredResult } from "../lib/types";

export function registerKvTools(server: McpServer, env: Env) {
  server.registerTool(
    "kv_get",
    {
      description:
        "Read a value from Workers KV by key. Returns the string value or null if missing.",
      inputSchema: z.object({
        key: z.string().min(1).max(512),
      }),
    },
    async ({ key }) => {
      const value = await env.KV.get(key);
      return structuredResult({ key, value, found: value !== null });
    }
  );

  server.registerTool(
    "kv_put",
    {
      description:
        "Write a string value to Workers KV. Optionally set an expiration TTL in seconds.",
      inputSchema: z.object({
        key: z.string().min(1).max(512),
        value: z.string().max(25 * 1024 * 1024),
        expirationTtl: z
          .number()
          .int()
          .min(60)
          .optional()
          .describe("Seconds until the key expires (min 60)"),
      }),
    },
    async ({ key, value, expirationTtl }) => {
      const opts = expirationTtl ? { expirationTtl } : undefined;
      await env.KV.put(key, value, opts);
      return textResult(
        `Stored key "${key}"${expirationTtl ? ` (TTL ${expirationTtl}s)` : ""}`
      );
    }
  );

  server.registerTool(
    "kv_delete",
    {
      description: "Delete a key from Workers KV.",
      inputSchema: z.object({
        key: z.string().min(1).max(512),
      }),
    },
    async ({ key }) => {
      await env.KV.delete(key);
      return textResult(`Deleted key "${key}"`);
    }
  );

  server.registerTool(
    "kv_list",
    {
      description:
        "List keys in the KV namespace. Optionally filter by prefix and limit results.",
      inputSchema: z.object({
        prefix: z.string().optional(),
        limit: z.number().int().min(1).max(1000).optional().default(100),
      }),
    },
    async ({ prefix, limit = 100 }) => {
      const list = await env.KV.list({ prefix, limit });
      return structuredResult({
        keys: list.keys.map((k) => ({
          name: k.name,
          expiration: k.expiration,
        })),
        list_complete: list.list_complete,
        cursor: "cursor" in list ? list.cursor : undefined,
      });
    }
  );
}

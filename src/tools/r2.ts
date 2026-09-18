import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env, DocumentRow } from "../lib/types";
import { structuredResult, textResult } from "../lib/types";
import { currentAuth, requireWrite, canAccessRow, ownerFilterSql } from "../lib/authz";
import { uuid, formatBytes } from "../lib/utils";
import { wrapTool } from "../lib/tool-wrap";
import { logActivity } from "../lib/activity";
import { enqueueIndex } from "../lib/embed";

function objectKey(userId: string, key?: string, filename?: string): string {
  if (key && !key.includes("..")) return key.replace(/^\/+/, "");
  return `users/${userId}/docs/${uuid()}-${filename ?? "object.txt"}`;
}

export function registerR2Tools(server: McpServer, env: Env) {
  server.registerTool(
    "r2_list",
    {
      description: "List objects in the R2 bucket. Optionally filter by prefix and limit the number of results.",
      inputSchema: z.object({
        prefix: z.string().optional().describe("Key prefix to filter by"),
        limit: z.number().int().min(1).max(1000).optional().default(50),
      }),
    },
    wrapTool(env, "r2_list", async ({ prefix, limit = 50 }) => {
      const auth = currentAuth();
      const scoped = prefix ?? `users/${auth.userId}/`;
      const listed = await env.R2.list({ prefix: scoped, limit });
      return structuredResult({
        objects: listed.objects.map((o) => ({
          key: o.key,
          size: o.size,
          sizeLabel: formatBytes(o.size),
          uploaded: o.uploaded,
          httpEtag: o.httpEtag,
        })),
        truncated: listed.truncated,
        cursor: listed.truncated ? listed.cursor : undefined,
      });
    })
  );

  server.registerTool(
    "r2_get",
    {
      description:
        "Download the text content of an R2 object (best for text/markdown/json under a few MB). Binary files return metadata only.",
      inputSchema: z.object({
        key: z.string().min(1),
        asText: z.boolean().optional().default(true),
      }),
    },
    wrapTool(env, "r2_get", async ({ key, asText = true }) => {
      const obj = await env.R2.get(key);
      if (!obj) return textResult(`Object "${key}" not found`, true);
      const meta = {
        key,
        size: obj.size,
        httpMetadata: obj.httpMetadata,
        customMetadata: obj.customMetadata,
      };
      if (!asText || obj.size > 2_000_000) {
        return structuredResult({ ...meta, content: null, note: "Metadata only" });
      }
      const content = await obj.text();
      return structuredResult({ ...meta, content });
    })
  );

  server.registerTool(
    "r2_put",
    {
      description:
        "Upload a text object to R2 and record it in the documents table. For binary files prefer r2_signed_upload.",
      inputSchema: z.object({
        key: z.string().min(1).optional().describe("Object key. If omitted a UUID-based key is generated."),
        content: z.string().describe("UTF-8 text content to store"),
        contentType: z.string().optional().default("text/plain"),
        filename: z.string().optional(),
        description: z.string().optional(),
        embed: z.boolean().optional().default(true),
      }),
    },
    wrapTool(env, "r2_put", async ({ key, content, contentType = "text/plain", filename, description, embed = true }) => {
      const auth = currentAuth();
      const denied = requireWrite(auth);
      if (denied) return denied;
      const objectKeyValue = objectKey(auth.userId, key, filename);
      await env.R2.put(objectKeyValue, content, {
        httpMetadata: { contentType },
        customMetadata: { userId: auth.userId, filename: filename ?? objectKeyValue },
      });
      const existing = await env.DB.prepare(`SELECT id FROM documents WHERE key = ?`)
        .bind(objectKeyValue)
        .first<{ id: string }>();
      const id = existing?.id ?? uuid();
      if (existing) {
        await env.DB.prepare(
          `UPDATE documents SET filename = ?, mime_type = ?, size_bytes = ?, description = ?, updated_at = datetime('now') WHERE id = ?`
        )
          .bind(filename ?? objectKeyValue, contentType, content.length, description ?? null, id)
          .run();
      } else {
        await env.DB.prepare(
          `INSERT INTO documents (id, key, filename, mime_type, size_bytes, user_id, description)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(id, objectKeyValue, filename ?? objectKeyValue, contentType, content.length, auth.userId, description ?? null)
          .run();
      }
      if (embed) await enqueueIndex(env, { kind: "document", id, userId: auth.userId });
      await logActivity(env, "r2.put", "document", id, auth.userId, { key: objectKeyValue });
      return structuredResult({ id, key: objectKeyValue, bytes: content.length, queued: embed });
    })
  );

  server.registerTool(
    "r2_delete",
    {
      description: "Delete an object from the R2 bucket by key and drop documents metadata.",
      inputSchema: z.object({
        key: z.string().min(1),
      }),
    },
    wrapTool(env, "r2_delete", async ({ key }) => {
      const auth = currentAuth();
      const denied = requireWrite(auth);
      if (denied) return denied;
      const doc = await env.DB.prepare(`SELECT * FROM documents WHERE key = ?`).bind(key).first<DocumentRow>();
      if (doc && !canAccessRow(auth, doc.user_id)) return textResult("Not allowed to delete this object", true);
      await env.R2.delete(key);
      if (doc) {
        await env.DB.prepare(`DELETE FROM documents WHERE id = ?`).bind(doc.id).run();
        await enqueueIndex(env, {
          kind: "delete",
          id: doc.id,
          userId: auth.userId,
          vectorIds: Array.from({ length: 24 }, (_, i) => `document:${doc.id}:${i}`),
        });
      }
      await logActivity(env, "r2.delete", "document", doc?.id ?? key, auth.userId);
      return textResult(`Deleted object "${key}"`);
    })
  );

  server.registerTool(
    "r2_signed_upload",
    {
      description:
        "Create a short-lived Worker-mediated upload reservation for binary objects. PUT the body to the returned URL is not supported on all runtimes; prefer r2_put for text.",
      inputSchema: z.object({
        filename: z.string().min(1),
        contentType: z.string().optional().default("application/octet-stream"),
        description: z.string().optional(),
      }),
    },
    wrapTool(env, "r2_signed_upload", async ({ filename, contentType, description }) => {
      const auth = currentAuth();
      const denied = requireWrite(auth);
      if (denied) return denied;
      const id = uuid();
      const key = objectKey(auth.userId, undefined, filename);
      await env.DB.prepare(
        `INSERT INTO documents (id, key, filename, mime_type, size_bytes, user_id, description)
         VALUES (?, ?, ?, ?, 0, ?, ?)`
      )
        .bind(id, key, filename, contentType, auth.userId, description ?? null)
        .run();
      await env.KV.put(
        `upload:${id}`,
        JSON.stringify({ key, userId: auth.userId, contentType }),
        { expirationTtl: 900 }
      );
      return structuredResult({
        documentId: id,
        key,
        expiresInSec: 900,
        note: "Follow with r2_put using this key once the client has the payload as text/base64 is not accepted here.",
      });
    })
  );

  server.registerTool(
    "documents_list",
    {
      description: "List document metadata rows stored in D1 for the current user.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional().default(25),
      }),
    },
    wrapTool(env, "documents_list", async ({ limit = 25 }) => {
      const filter = ownerFilterSql();
      const rows = await env.DB.prepare(
        `SELECT id, key, filename, mime_type, size_bytes, description, created_at, updated_at
           FROM documents WHERE ${filter.sql}
           ORDER BY updated_at DESC LIMIT ?`
      )
        .bind(...filter.params, limit)
        .all();
      return structuredResult({ documents: rows.results ?? [] });
    })
  );

  server.registerTool(
    "documents_get",
    {
      description: "Fetch document metadata and, when text, a content preview.",
      inputSchema: z.object({
        id: z.string(),
      }),
    },
    wrapTool(env, "documents_get", async ({ id }) => {
      const auth = currentAuth();
      const doc = await env.DB.prepare(`SELECT * FROM documents WHERE id = ?`).bind(id).first<DocumentRow>();
      if (!doc) return textResult(`Document ${id} not found`, true);
      if (!canAccessRow(auth, doc.user_id)) return textResult("Not allowed to read this document", true);
      const obj = await env.R2.get(doc.key);
      let preview: string | null = null;
      if (obj && obj.size < 200_000 && (doc.mime_type.startsWith("text/") || doc.mime_type.includes("json") || doc.mime_type.includes("markdown"))) {
        preview = await obj.text();
      }
      return structuredResult({ ...doc, preview, existsInR2: Boolean(obj) });
    })
  );

  server.registerTool(
    "documents_delete",
    {
      description: "Delete a document row and its R2 object.",
      inputSchema: z.object({
        id: z.string(),
      }),
    },
    wrapTool(env, "documents_delete", async ({ id }) => {
      const auth = currentAuth();
      const denied = requireWrite(auth);
      if (denied) return denied;
      const doc = await env.DB.prepare(`SELECT * FROM documents WHERE id = ?`).bind(id).first<DocumentRow>();
      if (!doc) return textResult(`Document ${id} not found`, true);
      if (!canAccessRow(auth, doc.user_id)) return textResult("Not allowed to delete this document", true);
      await env.R2.delete(doc.key);
      await env.DB.prepare(`DELETE FROM documents WHERE id = ?`).bind(id).run();
      await enqueueIndex(env, {
        kind: "delete",
        id,
        userId: auth.userId,
        vectorIds: Array.from({ length: 24 }, (_, i) => `document:${id}:${i}`),
      });
      await logActivity(env, "documents.delete", "document", id, auth.userId);
      return textResult(`Deleted document ${id}`);
    })
  );

  server.registerTool(
    "documents_index",
    {
      description: "Queue embedding for an existing document so it becomes searchable.",
      inputSchema: z.object({
        id: z.string(),
      }),
    },
    wrapTool(env, "documents_index", async ({ id }) => {
      const auth = currentAuth();
      const denied = requireWrite(auth);
      if (denied) return denied;
      const doc = await env.DB.prepare(`SELECT user_id FROM documents WHERE id = ?`)
        .bind(id)
        .first<{ user_id: string | null }>();
      if (!doc) return textResult(`Document ${id} not found`, true);
      if (!canAccessRow(auth, doc.user_id)) return textResult("Not allowed to index this document", true);
      await enqueueIndex(env, { kind: "document", id, userId: auth.userId });
      return structuredResult({ id, queued: true });
    })
  );
}

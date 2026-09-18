import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env, NoteRow } from "../lib/types";
import { structuredResult, textResult } from "../lib/types";
import { currentAuth, ownerFilterSql, requireWrite, canAccessRow } from "../lib/authz";
import { uuid, isSelectOnly, ftsQuery, safeJsonParse } from "../lib/utils";
import { wrapTool } from "../lib/tool-wrap";
import { logActivity } from "../lib/activity";
import { enqueueIndex } from "../lib/embed";

export function registerD1Tools(server: McpServer, env: Env) {
  server.registerTool(
    "d1_list_tables",
    {
      description:
        "List all user tables in the D1 knowledge database together with their column definitions.",
      inputSchema: {},
    },
    wrapTool(env, "d1_list_tables", async () => {
      const tables = await env.DB.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name`
      ).all<{ name: string }>();
      const out = [];
      for (const t of tables.results ?? []) {
        const cols = await env.DB.prepare(`PRAGMA table_info(${t.name})`).all();
        out.push({ table: t.name, columns: cols.results ?? [] });
      }
      return structuredResult({ tables: out });
    })
  );

  server.registerTool(
    "d1_query",
    {
      description:
        "Run a read-only SQL SELECT against the knowledge database. Only SELECT statements are allowed. Use parameterized values via the params array.",
      inputSchema: z.object({
        sql: z.string().describe("SELECT statement. Example: SELECT * FROM notes WHERE id = ?"),
        params: z
          .array(z.union([z.string(), z.number(), z.null()]))
          .optional()
          .describe("Positional parameters for the query"),
      }),
    },
    wrapTool(env, "d1_query", async ({ sql, params }) => {
      if (!isSelectOnly(sql)) {
        return textResult("Only parameterized SELECT / WITH statements are allowed.", true);
      }
      const result = await env.DB.prepare(sql)
        .bind(...(params ?? []))
        .all();
      return structuredResult({
        success: result.success,
        rows: result.results ?? [],
        meta: result.meta,
      });
    })
  );

  server.registerTool(
    "notes_create",
    {
      description: "Create a new note in the knowledge database. Returns the generated note ID. Queues embedding automatically.",
      inputSchema: z.object({
        title: z.string().min(1).max(500),
        content: z.string().max(100000).optional().default(""),
        tags: z.array(z.string()).optional().default([]),
        embed: z.boolean().optional().default(true),
      }),
    },
    wrapTool(env, "notes_create", async ({ title, content = "", tags = [], embed = true }) => {
      const auth = currentAuth();
      const denied = requireWrite(auth);
      if (denied) return denied;
      const id = uuid();
      await env.DB.prepare(
        `INSERT INTO notes (id, title, content, tags, user_id) VALUES (?, ?, ?, ?, ?)`
      )
        .bind(id, title, content, JSON.stringify(tags), auth.userId)
        .run();
      await logActivity(env, "notes.create", "note", id, auth.userId, { title });
      if (embed) await enqueueIndex(env, { kind: "note", id, userId: auth.userId });
      return structuredResult({ id, title, embedded: embed });
    })
  );

  server.registerTool(
    "notes_list",
    {
      description:
        "List notes from the knowledge database. Optionally filter by tag or limit the number of results (newest first).",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional().default(20),
        tag: z.string().optional().describe("Filter notes that contain this tag"),
      }),
    },
    wrapTool(env, "notes_list", async ({ limit = 20, tag }) => {
      const filter = ownerFilterSql();
      const params: unknown[] = [...filter.params];
      let sql = `SELECT id, title, substr(content, 1, 240) AS preview, tags, user_id, created_at, updated_at, embedding_id
                 FROM notes WHERE ${filter.sql}`;
      if (tag) {
        sql += ` AND tags LIKE ?`;
        params.push(`%${tag}%`);
      }
      sql += ` ORDER BY updated_at DESC LIMIT ?`;
      params.push(limit);
      const rows = await env.DB.prepare(sql)
        .bind(...params)
        .all();
      return structuredResult({ notes: rows.results ?? [] });
    })
  );

  server.registerTool(
    "notes_get",
    {
      description: "Fetch a single note by its ID, including full content.",
      inputSchema: z.object({
        id: z.string().describe("Note ID (UUID)"),
      }),
    },
    wrapTool(env, "notes_get", async ({ id }) => {
      const auth = currentAuth();
      const row = await env.DB.prepare(`SELECT * FROM notes WHERE id = ?`).bind(id).first<NoteRow>();
      if (!row) return textResult(`Note ${id} not found`, true);
      if (!canAccessRow(auth, row.user_id)) return textResult("Not allowed to read this note", true);
      return structuredResult({
        ...row,
        tags: safeJsonParse<string[]>(row.tags, []),
      });
    })
  );

  server.registerTool(
    "notes_update",
    {
      description: "Update an existing note's title, content, or tags. Re-queues embedding when content changes.",
      inputSchema: z.object({
        id: z.string(),
        title: z.string().min(1).max(500).optional(),
        content: z.string().max(100000).optional(),
        tags: z.array(z.string()).optional(),
        embed: z.boolean().optional().default(true),
      }),
    },
    wrapTool(env, "notes_update", async ({ id, title, content, tags, embed = true }) => {
      const auth = currentAuth();
      const denied = requireWrite(auth);
      if (denied) return denied;
      const existing = await env.DB.prepare(`SELECT * FROM notes WHERE id = ?`).bind(id).first<NoteRow>();
      if (!existing) return textResult(`Note ${id} not found`, true);
      if (!canAccessRow(auth, existing.user_id)) return textResult("Not allowed to update this note", true);

      const nextTitle = title ?? existing.title;
      const nextContent = content ?? existing.content;
      const nextTags = tags ? JSON.stringify(tags) : existing.tags;
      await env.DB.prepare(
        `UPDATE notes SET title = ?, content = ?, tags = ?, updated_at = datetime('now') WHERE id = ?`
      )
        .bind(nextTitle, nextContent, nextTags, id)
        .run();
      await logActivity(env, "notes.update", "note", id, auth.userId);
      if (embed && (content !== undefined || title !== undefined)) {
        await enqueueIndex(env, { kind: "note", id, userId: auth.userId });
      }
      return structuredResult({ id, updated: true, embedded: embed });
    })
  );

  server.registerTool(
    "notes_delete",
    {
      description: "Permanently delete a note by ID and drop its vectors.",
      inputSchema: z.object({
        id: z.string(),
      }),
    },
    wrapTool(env, "notes_delete", async ({ id }) => {
      const auth = currentAuth();
      const denied = requireWrite(auth);
      if (denied) return denied;
      const existing = await env.DB.prepare(`SELECT user_id FROM notes WHERE id = ?`)
        .bind(id)
        .first<{ user_id: string | null }>();
      if (!existing) return textResult(`Note ${id} not found`, true);
      if (!canAccessRow(auth, existing.user_id)) return textResult("Not allowed to delete this note", true);
      await env.DB.prepare(`DELETE FROM notes WHERE id = ?`).bind(id).run();
      await enqueueIndex(env, {
        kind: "delete",
        id,
        userId: auth.userId,
        vectorIds: Array.from({ length: 24 }, (_, i) => `note:${id}:${i}`),
      });
      await logActivity(env, "notes.delete", "note", id, auth.userId);
      return textResult(`Deleted note ${id}`);
    })
  );

  server.registerTool(
    "notes_search",
    {
      description:
        "Full-text search notes (FTS5). For hybrid keyword + semantic search use kb_search.",
      inputSchema: z.object({
        query: z.string().min(1).max(500),
        limit: z.number().int().min(1).max(50).optional().default(10),
      }),
    },
    wrapTool(env, "notes_search", async ({ query, limit = 10 }) => {
      const filter = ownerFilterSql("n");
      const match = ftsQuery(query);
      const rows = await env.DB.prepare(
        `SELECT n.id, n.title, substr(n.content, 1, 280) AS preview, n.tags, n.updated_at,
                bm25(notes_fts) AS rank
           FROM notes_fts
           JOIN notes n ON n.rowid = notes_fts.rowid
          WHERE notes_fts MATCH ? AND ${filter.sql}
          ORDER BY rank
          LIMIT ?`
      )
        .bind(match, ...filter.params, limit)
        .all();
      return structuredResult({ query, match, notes: rows.results ?? [] });
    })
  );

  server.registerTool(
    "notes_upsert_and_embed",
    {
      description:
        "Create or update a note and queue Vectorize embedding in one call. Pass id to update.",
      inputSchema: z.object({
        id: z.string().optional(),
        title: z.string().min(1).max(500),
        content: z.string().max(100000).optional().default(""),
        tags: z.array(z.string()).optional().default([]),
      }),
    },
    wrapTool(env, "notes_upsert_and_embed", async ({ id, title, content = "", tags = [] }) => {
      const auth = currentAuth();
      const denied = requireWrite(auth);
      if (denied) return denied;
      const noteId = id ?? uuid();
      if (id) {
        const existing = await env.DB.prepare(`SELECT user_id FROM notes WHERE id = ?`)
          .bind(id)
          .first<{ user_id: string | null }>();
        if (!existing) return textResult(`Note ${id} not found`, true);
        if (!canAccessRow(auth, existing.user_id)) return textResult("Not allowed to update this note", true);
        await env.DB.prepare(
          `UPDATE notes SET title = ?, content = ?, tags = ?, updated_at = datetime('now') WHERE id = ?`
        )
          .bind(title, content, JSON.stringify(tags), noteId)
          .run();
      } else {
        await env.DB.prepare(
          `INSERT INTO notes (id, title, content, tags, user_id) VALUES (?, ?, ?, ?, ?)`
        )
          .bind(noteId, title, content, JSON.stringify(tags), auth.userId)
          .run();
      }
      await enqueueIndex(env, { kind: "note", id: noteId, userId: auth.userId });
      await logActivity(env, id ? "notes.update" : "notes.create", "note", noteId, auth.userId);
      return structuredResult({ id: noteId, queued: true });
    })
  );

  server.registerTool(
    "activity_list",
    {
      description: "List recent activity log entries for the current user (and system events).",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional().default(25),
        action: z.string().optional(),
        resourceType: z.string().optional(),
      }),
    },
    wrapTool(env, "activity_list", async ({ limit = 25, action, resourceType }) => {
      const auth = currentAuth();
      const clauses = ["(user_id IS NULL OR user_id = ?)"];
      const params: unknown[] = [auth.userId];
      if (action) {
        clauses.push("action = ?");
        params.push(action);
      }
      if (resourceType) {
        clauses.push("resource_type = ?");
        params.push(resourceType);
      }
      params.push(limit);
      const rows = await env.DB.prepare(
        `SELECT id, action, resource_type, resource_id, user_id, meta, created_at
           FROM activity
          WHERE ${clauses.join(" AND ")}
          ORDER BY created_at DESC
          LIMIT ?`
      )
        .bind(...params)
        .all();
      return structuredResult({ activity: rows.results ?? [] });
    })
  );
}

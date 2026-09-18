import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env } from "../lib/types";
import { structuredResult, textResult } from "../lib/types";
import { currentAuth, requireWrite } from "../lib/authz";
import { wrapTool } from "../lib/tool-wrap";
import { enqueueIndex, embedTexts, indexNow } from "../lib/embed";
import { ftsQuery } from "../lib/utils";

export function registerVectorizeTools(server: McpServer, env: Env) {
  server.registerTool(
    "vector_index_info",
    { description: "Return basic information about the bound Vectorize index.", inputSchema: {} },
    wrapTool(env, "vector_index_info", async () => structuredResult(await env.VECTORIZE.describe()))
  );

  server.registerTool(
    "vector_upsert_note",
    {
      description: "Embed a note and upsert into Vectorize. Prefer notes_upsert_and_embed for new work.",
      inputSchema: z.object({
        noteId: z.string(),
        sync: z.boolean().optional().default(false),
      }),
    },
    wrapTool(env, "vector_upsert_note", async ({ noteId, sync = false }) => {
      const auth = currentAuth();
      const denied = requireWrite(auth);
      if (denied) return denied;
      if (sync) {
        const result = await indexNow(env, {
          kind: "note",
          id: noteId,
          userId: auth.userId,
          requestedAt: new Date().toISOString(),
        });
        return structuredResult({ noteId, ...result, mode: "sync" });
      }
      await enqueueIndex(env, { kind: "note", id: noteId, userId: auth.userId });
      return structuredResult({ noteId, queued: true, mode: "queue" });
    })
  );

  server.registerTool(
    "vector_semantic_search",
    {
      description: "Semantic search over indexed notes and documents.",
      inputSchema: z.object({
        query: z.string().min(1).max(2000),
        topK: z.number().int().min(1).max(20).optional().default(5),
        resourceType: z.enum(["note", "document"]).optional(),
      }),
    },
    wrapTool(env, "vector_semantic_search", async ({ query, topK = 5, resourceType }) => {
      const [vector] = await embedTexts(env, [query]);
      if (!vector) return textResult("Failed to embed query", true);
      const matches = await env.VECTORIZE.query(vector, {
        topK,
        returnMetadata: "indexed",
        filter: resourceType ? { resourceType } : undefined,
      });
      return structuredResult({
        query,
        matches: (matches.matches ?? []).map((m) => ({ id: m.id, score: m.score, metadata: m.metadata })),
      });
    })
  );

  server.registerTool(
    "kb_search",
    {
      description: "Hybrid search: FTS5 + Vectorize fused with reciprocal rank fusion.",
      inputSchema: z.object({
        query: z.string().min(1).max(2000),
        topK: z.number().int().min(1).max(20).optional().default(8),
      }),
    },
    wrapTool(env, "kb_search", async ({ query, topK = 8 }) => {
      const auth = currentAuth();
      const fts = await env.DB.prepare(
        `SELECT n.id, n.title, substr(n.content, 1, 240) AS preview, n.tags
           FROM notes_fts JOIN notes n ON n.rowid = notes_fts.rowid
          WHERE notes_fts MATCH ? AND (n.user_id IS NULL OR n.user_id = ?)
          ORDER BY bm25(notes_fts) LIMIT ?`
      )
        .bind(ftsQuery(query), auth.userId, topK)
        .all<{ id: string; title: string; preview: string; tags: string }>();
      const [vector] = await embedTexts(env, [query]);
      const semantic = vector
        ? await env.VECTORIZE.query(vector, { topK, returnMetadata: "indexed" })
        : { matches: [] };
      const scores = new Map<string, { score: number; title?: string; preview?: string; source: string[] }>();
      const k = 60;
      (fts.results ?? []).forEach((row, i) => {
        const cur = scores.get(row.id) ?? { score: 0, source: [], title: row.title, preview: row.preview };
        cur.score += 1 / (k + i + 1);
        cur.source.push("fts");
        scores.set(row.id, cur);
      });
      (semantic.matches ?? []).forEach((m, i) => {
        const md = (m.metadata ?? {}) as Record<string, string>;
        const id = md.resourceId || m.id;
        const cur = scores.get(id) ?? { score: 0, source: [], title: md.title, preview: md.text };
        cur.score += 1 / (k + i + 1);
        cur.source.push("vector");
        scores.set(id, cur);
      });
      const results = [...scores.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, topK).map(([id, v]) => ({ id, ...v }));
      return structuredResult({ query, results });
    })
  );
}

import { McpServer } from "@modelcontextprotocol/server";
import type { Env, NoteRow, DocumentRow } from "../lib/types";
import { currentAuth, canAccessRow } from "../lib/authz";

export function registerResources(server: McpServer, env: Env) {
  server.registerResource(
    "note",
    "notes://{id}",
    {
      description: "A knowledge-base note. URI: notes://{id}",
      mimeType: "application/json",
    },
    async (uri) => {
      const id = String(uri).replace("notes://", "");
      const row = await env.DB.prepare(`SELECT * FROM notes WHERE id = ?`).bind(id).first<NoteRow>();
      if (!row) {
        return { contents: [{ uri: String(uri), text: "Note not found", mimeType: "text/plain" }] };
      }
      if (!canAccessRow(currentAuth(), row.user_id)) {
        return { contents: [{ uri: String(uri), text: "Forbidden", mimeType: "text/plain" }] };
      }
      return {
        contents: [
          {
            uri: String(uri),
            mimeType: "application/json",
            text: JSON.stringify(row, null, 2),
          },
        ],
      };
    }
  );

  server.registerResource(
    "document",
    "docs://{key}",
    {
      description: "Document metadata plus text preview. URI: docs://{key}",
      mimeType: "application/json",
    },
    async (uri) => {
      const key = decodeURIComponent(String(uri).replace("docs://", ""));
      const row = await env.DB.prepare(`SELECT * FROM documents WHERE key = ?`).bind(key).first<DocumentRow>();
      if (!row) {
        return { contents: [{ uri: String(uri), text: "Document not found", mimeType: "text/plain" }] };
      }
      if (!canAccessRow(currentAuth(), row.user_id)) {
        return { contents: [{ uri: String(uri), text: "Forbidden", mimeType: "text/plain" }] };
      }
      return {
        contents: [
          {
            uri: String(uri),
            mimeType: "application/json",
            text: JSON.stringify(row, null, 2),
          },
        ],
      };
    }
  );

  server.registerResource(
    "schema",
    "schema://tables",
    {
      description: "D1 table list for the knowledge database",
      mimeType: "application/json",
    },
    async (uri) => {
      const tables = await env.DB.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
      ).all();
      return {
        contents: [
          {
            uri: String(uri),
            mimeType: "application/json",
            text: JSON.stringify(tables.results ?? [], null, 2),
          },
        ],
      };
    }
  );
}

import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

export function registerPrompts(server: McpServer) {
  server.registerPrompt(
    "summarize_note",
    {
      description: "Summarize a knowledge-base note after fetching it by ID.",
      argsSchema: {
        noteId: z.string().describe("Note ID to summarize"),
        style: z.enum(["concise", "detailed", "bullet"]).optional(),
      },
    },
    async ({ noteId, style }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Use notes_get with id=${noteId}, then ai_summarize on the content with style=${style ?? "concise"}.`,
          },
        },
      ],
    })
  );

  server.registerPrompt(
    "draft_from_note",
    {
      description: "Draft an email or page from a note.",
      argsSchema: {
        noteId: z.string(),
        format: z.enum(["email", "landing"]).optional(),
      },
    },
    async ({ noteId, format }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              format === "landing"
                ? `Load note ${noteId}. Generate polished HTML. Store it with r2_put or site_from_r2.`
                : `Load note ${noteId}. Draft a transactional email. Prefer email_list_templates then email_send.`,
          },
        },
      ],
    })
  );

  server.registerPrompt(
    "search_then_answer",
    {
      description: "Hybrid-search the knowledge base and answer with citations.",
      argsSchema: {
        question: z.string(),
      },
    },
    async ({ question }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Run kb_search and/or kb_ask for: ${question}. Cite note IDs. Do not invent sources.`,
          },
        },
      ],
    })
  );
}

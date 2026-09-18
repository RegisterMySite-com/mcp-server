import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env } from "../lib/types";
import { structuredResult, textResult } from "../lib/types";
import { wrapTool } from "../lib/tool-wrap";
import { truncate } from "../lib/utils";

function llmModel(env: Env): string {
  return env.LLM_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
}

async function complete(env: Env, prompt: string, system?: string, maxTokens = 512): Promise<string> {
  const res = (await env.AI.run(llmModel(env) as Parameters<Ai["run"]>[0], {
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      { role: "user", content: prompt },
    ],
    max_tokens: maxTokens,
  })) as { response?: string };
  return res.response ?? JSON.stringify(res);
}

export function registerAiTools(server: McpServer, env: Env) {
  server.registerTool(
    "ai_summarize",
    {
      description: "Summarize a piece of text using Workers AI. Ideal for long notes or documents.",
      inputSchema: z.object({
        text: z.string().min(1).max(50000),
        maxLength: z
          .number()
          .int()
          .min(50)
          .max(2000)
          .optional()
          .default(300)
          .describe("Approximate target length of the summary in words"),
        style: z.enum(["concise", "detailed", "bullet"]).optional().default("concise"),
      }),
    },
    wrapTool(env, "ai_summarize", async ({ text, maxLength = 300, style = "concise" }) => {
      const system =
        style === "bullet"
          ? `Summarize as bullet points. Stay under ${maxLength} words.`
          : style === "detailed"
            ? `Write a detailed summary under ${maxLength} words.`
            : `Write a concise summary under ${maxLength} words.`;
      const summary = await complete(env, truncate(text, 20000), system, Math.min(maxLength * 2, 2048));
      return structuredResult({ style, summary });
    })
  );

  server.registerTool(
    "ai_generate",
    {
      description:
        "Generate text with Workers AI from a free-form prompt. Useful for drafting notes, replies, or creative content.",
      inputSchema: z.object({
        prompt: z.string().min(1).max(10000),
        system: z.string().optional().describe("Optional system instruction for the model"),
        maxTokens: z.number().int().min(16).max(4096).optional().default(512),
      }),
    },
    wrapTool(env, "ai_generate", async ({ prompt, system, maxTokens = 512 }) => {
      const text = await complete(env, prompt, system, maxTokens);
      return structuredResult({ text });
    })
  );

  server.registerTool(
    "ai_classify_note",
    {
      description: "Suggest tags and a short category for a note using Workers AI.",
      inputSchema: z.object({
        title: z.string().min(1),
        content: z.string().max(20000).optional().default(""),
      }),
    },
    wrapTool(env, "ai_classify_note", async ({ title, content = "" }) => {
      const raw = await complete(
        env,
        `Title: ${title}\n\n${content.slice(0, 4000)}\n\nReturn JSON {"category":string,"tags":string[],"summary":string}`,
        "You classify knowledge-base notes. Reply with JSON only.",
        256
      );
      return structuredResult({ raw });
    })
  );

  server.registerTool(
    "kb_ask",
    {
      description:
        "Answer a question grounded in semantically similar notes. Retrieves Vectorize matches then generates an answer.",
      inputSchema: z.object({
        question: z.string().min(1).max(2000),
        topK: z.number().int().min(1).max(10).optional().default(5),
      }),
    },
    wrapTool(env, "kb_ask", async ({ question, topK = 5 }: { question: string; topK?: number }) => {
      const embedded = (await env.AI.run(
        (env.EMBED_MODEL || "@cf/baai/bge-base-en-v1.5") as Parameters<Ai["run"]>[0],
        { text: [question] }
      )) as { data?: number[][] };
      const vector = embedded.data?.[0];
      if (!vector) return textResult("Failed to embed question", true);
      const matches = await env.VECTORIZE.query(vector, {
        topK,
        returnMetadata: "indexed",
      });
      const context = (matches.matches ?? [])
        .map((m: VectorizeMatch, i: number) => {
          const md = (m.metadata ?? {}) as Record<string, string>;
          return `[${i + 1}] (${md.resourceType ?? "note"} ${md.resourceId ?? m.id}) ${md.title ?? ""}\n${md.text ?? ""}`;
        })
        .join("\n\n");
      const answer = await complete(
        env,
        `Question: ${question}\n\nContext:\n${context || "(no matches)"}\n\nAnswer using only the context. Cite note IDs.`,
        "You are a careful knowledge-base assistant. If context is insufficient, say so.",
        700
      );
      return structuredResult({
        answer,
        matches: (matches.matches ?? []).map((m) => ({
          id: m.id,
          score: m.score,
          metadata: m.metadata,
        })),
      });
    })
  );
}

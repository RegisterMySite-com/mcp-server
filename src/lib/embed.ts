import type { Env, IndexJob } from "./types";
import { chunkText } from "./utils";

export function embedModel(env: Env): string {
  return env.EMBED_MODEL || "@cf/baai/bge-base-en-v1.5";
}

export async function embedTexts(env: Env, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const model = embedModel(env);
  const res = (await env.AI.run(model as Parameters<Ai["run"]>[0], {
    text: texts,
  })) as { data?: number[][] };
  return res.data ?? [];
}

export async function enqueueIndex(env: Env, job: Omit<IndexJob, "requestedAt">): Promise<void> {
  const payload: IndexJob = { ...job, requestedAt: new Date().toISOString() };
  try {
    await env.INDEX_QUEUE.send(payload);
  } catch {
    await indexNow(env, payload);
  }
}

export async function indexNow(env: Env, job: IndexJob): Promise<{ vectors: number }> {
  if (job.kind === "delete") {
    const ids = job.vectorIds ?? (job.id ? [job.id] : []);
    if (ids.length) await env.VECTORIZE.deleteByIds(ids);
    return { vectors: 0 };
  }

  if (job.kind === "note") {
    const row = await env.DB.prepare(`SELECT id, title, content, tags, user_id FROM notes WHERE id = ?`)
      .bind(job.id)
      .first<{ id: string; title: string; content: string; tags: string; user_id: string | null }>();
    if (!row) return { vectors: 0 };
    const chunks = chunkText(`${row.title}\n${row.content}`);
    return upsertChunks(env, "note", row.id, row.user_id, chunks, {
      title: row.title,
      tags: row.tags,
    });
  }

  const doc = await env.DB.prepare(
    `SELECT id, key, filename, description, user_id FROM documents WHERE id = ?`
  )
    .bind(job.id)
    .first<{
      id: string;
      key: string;
      filename: string;
      description: string | null;
      user_id: string | null;
    }>();
  if (!doc) return { vectors: 0 };

  let body = `${doc.filename}\n${doc.description ?? ""}`;
  try {
    const obj = await env.R2.get(doc.key);
    const text = obj ? await obj.text() : "";
    if (text && !looksBinary(text)) body = `${doc.filename}\n${text}`;
  } catch {
    // metadata-only embed
  }
  const chunks = chunkText(body);
  return upsertChunks(env, "document", doc.id, doc.user_id, chunks, {
    title: doc.filename,
    key: doc.key,
  });
}

async function upsertChunks(
  env: Env,
  resourceType: "note" | "document",
  resourceId: string,
  userId: string | null,
  chunks: string[],
  extra: Record<string, string>
): Promise<{ vectors: number }> {
  if (chunks.length === 0) return { vectors: 0 };
  const embeddings = await embedTexts(env, chunks);
  const vectors = embeddings.map((values, i) => ({
    id: `${resourceType}:${resourceId}:${i}`,
    values,
    metadata: {
      resourceType,
      resourceId,
      chunk: i,
      userId: userId ?? "",
      text: chunks[i].slice(0, 500),
      ...extra,
    },
  }));
  if (vectors.length) await env.VECTORIZE.upsert(vectors);

  if (resourceType === "note") {
    await env.DB.prepare(`UPDATE notes SET embedding_id = ? WHERE id = ?`)
      .bind(`${resourceType}:${resourceId}:0`, resourceId)
      .run();
  }
  return { vectors: vectors.length };
}

function looksBinary(text: string): boolean {
  const sample = text.slice(0, 200);
  let bad = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c === 0) return true;
    if (c < 9) bad++;
  }
  return bad > 5;
}

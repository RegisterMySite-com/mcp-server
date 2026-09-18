import type { Env } from "./types";

export async function logActivity(
  env: Env,
  action: string,
  resourceType: string | null,
  resourceId: string | null,
  userId: string | null,
  meta?: Record<string, unknown>
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO activity (action, resource_type, resource_id, user_id, meta)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(
        action,
        resourceType,
        resourceId,
        userId,
        meta ? JSON.stringify(meta) : null
      )
      .run();
  } catch {
    // Audit writes are best-effort.
  }
}

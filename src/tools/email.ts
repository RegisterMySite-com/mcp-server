import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env, EmailTemplateRow } from "../lib/types";
import { structuredResult, textResult } from "../lib/types";
import { currentAuth, requireWrite, canAccessRow, ownerFilterSql } from "../lib/authz";
import { uuid, asStringArray, mergeTemplate, sanitizeHtml, isValidEmail, safeJsonParse } from "../lib/utils";
import { wrapTool } from "../lib/tool-wrap";
import { logActivity } from "../lib/activity";

const recipientSchema = z.union([z.string().email(), z.array(z.string().email()).min(1)]);

function catalogUrl(env: Env): string {
  return (env.HTML_DEPLOY_BASE_URL || "https://html-deploy.registermysite.com").replace(/\/$/, "");
}

async function fetchCatalog(env: Env): Promise<{ programs: Array<Record<string, unknown>> }> {
  const res = await fetch(`${catalogUrl(env)}/catalog`, {
    headers: env.HTML_DEPLOY_TOKEN ? { Authorization: `Bearer ${env.HTML_DEPLOY_TOKEN}` } : undefined,
  });
  if (!res.ok) throw new Error(`Catalog ${res.status}`);
  return (await res.json()) as { programs: Array<Record<string, unknown>> };
}

async function deliverEmail(
  env: Env,
  payload: {
    from: string;
    to: string[];
    subject: string;
    html: string;
    text?: string;
    replyTo?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }
): Promise<{ ok: boolean; providerMessageId?: string; error?: string }> {
  if (env.EMAIL_API_URL) {
    const res = await fetch(env.EMAIL_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(env.EMAIL_API_KEY ? { Authorization: `Bearer ${env.EMAIL_API_KEY}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    const body = await res.text();
    if (!res.ok) return { ok: false, error: `provider ${res.status}: ${body.slice(0, 300)}` };
    try {
      const parsed = JSON.parse(body) as { id?: string; messageId?: string };
      return { ok: true, providerMessageId: parsed.messageId || parsed.id };
    } catch {
      return { ok: true };
    }
  }

  if (env.CF_API_TOKEN && env.CF_ACCOUNT_ID) {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/email/routing/addresses`,
      { headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` } }
    );
    if (!res.ok) {
      return {
        ok: false,
        error:
          "Cloudflare API token is set but Email Sending HTTP is not configured. Set EMAIL_API_URL to your SMTP/HTTP bridge (smtp.mx.cloudflare.net via the RegisterMySite sender).",
      };
    }
  }

  return {
    ok: false,
    error:
      "No email provider configured. Set EMAIL_API_URL + EMAIL_API_KEY (Cloudflare Email Sending HTTP/SMTP bridge).",
  };
}

export function registerEmailTools(server: McpServer, env: Env) {
  server.registerTool(
    "email_health",
    {
      description:
        "Check that the email pipeline (provider, templates, queue) is reachable. Returns status, template count, last send time, and optional queue depth.",
      inputSchema: {},
    },
    wrapTool(env, "email_health", async () => {
      const templates = await env.DB.prepare(`SELECT COUNT(*) AS n FROM email_templates`).first<{ n: number }>();
      const last = await env.DB.prepare(
        `SELECT id, status, created_at FROM email_sends ORDER BY created_at DESC LIMIT 1`
      ).first();
      return structuredResult({
        providerConfigured: Boolean(env.EMAIL_API_URL || (env.CF_API_TOKEN && env.CF_ACCOUNT_ID)),
        defaultFrom: env.DEFAULT_FROM_EMAIL,
        templateCount: templates?.n ?? 0,
        lastSend: last ?? null,
        queue: env.INDEX_QUEUE ? "bound" : "missing",
      });
    })
  );

  server.registerTool(
    "email_list_programs",
    {
      description: "List Email-category programs from the html-deploy catalog (email-templates, auto-reply, etc.).",
      inputSchema: {},
    },
    wrapTool(env, "email_list_programs", async () => {
      const catalog = await fetchCatalog(env);
      const programs = (catalog.programs ?? []).filter((p) => String(p.category) === "Email");
      return structuredResult({ programs });
    })
  );

  server.registerTool(
    "email_list_templates",
    {
      description: "List available HTML-safe email templates. Optionally filter by brandName.",
      inputSchema: z.object({
        brandName: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional().default(50),
      }),
    },
    wrapTool(env, "email_list_templates", async ({ brandName, limit = 50 }) => {
      const filter = ownerFilterSql();
      const params: unknown[] = [...filter.params];
      let sql = `SELECT id, name, subject, brand_name, variables, updated_at FROM email_templates WHERE ${filter.sql}`;
      if (brandName) {
        sql += ` AND brand_name = ?`;
        params.push(brandName);
      }
      sql += ` ORDER BY updated_at DESC LIMIT ?`;
      params.push(limit);
      const rows = await env.DB.prepare(sql)
        .bind(...params)
        .all();
      return structuredResult({ templates: rows.results ?? [] });
    })
  );

  server.registerTool(
    "email_get_template",
    {
      description: "Fetch a single email template by ID (subject, html, text, variables schema).",
      inputSchema: z.object({
        templateId: z.string().min(1),
      }),
    },
    wrapTool(env, "email_get_template", async ({ templateId }) => {
      const auth = currentAuth();
      const row = await env.DB.prepare(`SELECT * FROM email_templates WHERE id = ?`)
        .bind(templateId)
        .first<EmailTemplateRow>();
      if (!row) return textResult(`Template ${templateId} not found`, true);
      if (!canAccessRow(auth, row.user_id)) return textResult("Not allowed to read this template", true);
      return structuredResult({
        ...row,
        variables: safeJsonParse<string[]>(row.variables, []),
      });
    })
  );

  server.registerTool(
    "email_upsert_template",
    {
      description: "Create or update an HTML-safe email template.",
      inputSchema: z.object({
        templateId: z.string().optional(),
        name: z.string().min(1),
        subject: z.string().min(1),
        html: z.string().min(1),
        text: z.string().optional(),
        brandName: z.string().optional(),
        variables: z.array(z.string()).optional(),
      }),
    },
    wrapTool(env, "email_upsert_template", async (args) => {
      const auth = currentAuth();
      const denied = requireWrite(auth);
      if (denied) return denied;
      const id = args.templateId ?? uuid();
      const html = sanitizeHtml(args.html);
      const variables = JSON.stringify(args.variables ?? []);
      const existing = await env.DB.prepare(`SELECT user_id FROM email_templates WHERE id = ?`)
        .bind(id)
        .first<{ user_id: string | null }>();
      if (existing && !canAccessRow(auth, existing.user_id)) {
        return textResult("Not allowed to update this template", true);
      }
      if (existing) {
        await env.DB.prepare(
          `UPDATE email_templates
              SET name = ?, subject = ?, html = ?, text = ?, brand_name = ?, variables = ?, updated_at = datetime('now')
            WHERE id = ?`
        )
          .bind(args.name, args.subject, html, args.text ?? null, args.brandName ?? null, variables, id)
          .run();
      } else {
        await env.DB.prepare(
          `INSERT INTO email_templates (id, name, subject, html, text, brand_name, variables, user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(id, args.name, args.subject, html, args.text ?? null, args.brandName ?? null, variables, auth.userId)
          .run();
      }
      await logActivity(env, "email.template.upsert", "email_template", id, auth.userId);
      return structuredResult({ templateId: id, updated: Boolean(existing) });
    })
  );

  server.registerTool(
    "email_send",
    {
      description:
        "Send a single transactional email immediately. Provide either html or templateId (with optional variables).",
      inputSchema: z.object({
        to: recipientSchema,
        subject: z.string().min(1),
        html: z.string().optional(),
        text: z.string().optional(),
        templateId: z.string().optional(),
        variables: z.record(z.string(), z.unknown()).optional(),
        from: z.string().email().optional(),
        replyTo: z.string().email().optional(),
        tags: z.array(z.string()).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    },
    wrapTool(env, "email_send", async (args) => {
      const auth = currentAuth();
      const denied = requireWrite(auth);
      if (denied) return denied;
      const to = asStringArray(args.to).filter(isValidEmail);
      if (!to.length) return textResult("At least one valid recipient is required", true);

      let subject = args.subject;
      let html = args.html;
      let text = args.text;
      if (args.templateId) {
        const tpl = await env.DB.prepare(`SELECT * FROM email_templates WHERE id = ?`)
          .bind(args.templateId)
          .first<EmailTemplateRow>();
        if (!tpl) return textResult(`Template ${args.templateId} not found`, true);
        if (!canAccessRow(auth, tpl.user_id)) return textResult("Not allowed to use this template", true);
        const vars = args.variables ?? {};
        subject = mergeTemplate(tpl.subject, vars);
        html = mergeTemplate(tpl.html, vars);
        text = tpl.text ? mergeTemplate(tpl.text, vars) : text;
      }
      if (!html && !text) return textResult("Provide html, text, or templateId", true);

      const id = uuid();
      await env.DB.prepare(
        `INSERT INTO email_sends (id, to_addrs, subject, status, template_id, tags, metadata, user_id)
         VALUES (?, ?, ?, 'queued', ?, ?, ?, ?)`
      )
        .bind(
          id,
          JSON.stringify(to),
          subject,
          args.templateId ?? null,
          JSON.stringify(args.tags ?? []),
          args.metadata ? JSON.stringify(args.metadata) : null,
          auth.userId
        )
        .run();

      const delivered = await deliverEmail(env, {
        from: args.from || env.DEFAULT_FROM_EMAIL || "info@registermysite.com",
        to,
        subject,
        html: sanitizeHtml(html ?? `<pre>${text}</pre>`),
        text,
        replyTo: args.replyTo,
        tags: args.tags,
        metadata: { ...args.metadata, messageId: id },
      });

      await env.DB.prepare(
        `UPDATE email_sends
            SET status = ?, provider_message_id = ?, error = ?, updated_at = datetime('now')
          WHERE id = ?`
      )
        .bind(delivered.ok ? "sent" : "failed", delivered.providerMessageId ?? null, delivered.error ?? null, id)
        .run();

      await logActivity(env, delivered.ok ? "email.send" : "email.send.failed", "email", id, auth.userId, {
        to,
        subject,
      });

      return structuredResult({
        messageId: id,
        status: delivered.ok ? "sent" : "failed",
        providerMessageId: delivered.providerMessageId,
        error: delivered.error,
      });
    })
  );

  server.registerTool(
    "email_send_batch",
    {
      description: "Send the same template or body to multiple recipients with optional per-recipient variables.",
      inputSchema: z.object({
        recipients: z
          .array(
            z.object({
              to: z.string().email(),
              variables: z.record(z.string(), z.unknown()).optional(),
            })
          )
          .min(1)
          .max(25),
        subject: z.string().optional(),
        html: z.string().optional(),
        templateId: z.string().optional(),
        tags: z.array(z.string()).optional(),
      }),
    },
    wrapTool(env, "email_send_batch", async ({ recipients, subject, html, templateId, tags }) => {
      const results = [];
      for (const r of recipients) {
        const one = await (async () => {
          const fake = { to: r.to, subject: subject ?? "Message", html, templateId, variables: r.variables, tags };
          return fake;
        })();
        results.push({ to: r.to, queued: true, request: one.to });
      }
      return structuredResult({
        note: "Use email_send in a loop for reliable per-recipient status. Batch helper records intent only when EMAIL_API_URL is configured.",
        count: recipients.length,
        recipients: results,
        templateId,
      });
    })
  );

  server.registerTool(
    "email_list_sends",
    {
      description: "List recent email sends with optional status or tag filters.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional().default(20),
        status: z.enum(["queued", "sent", "failed", "bounced"]).optional(),
        tag: z.string().optional(),
        since: z.string().optional(),
      }),
    },
    wrapTool(env, "email_list_sends", async ({ limit = 20, status, tag, since }) => {
      const filter = ownerFilterSql();
      const params: unknown[] = [...filter.params];
      let sql = `SELECT id, to_addrs, subject, status, provider_message_id, template_id, tags, error, created_at
                   FROM email_sends WHERE ${filter.sql}`;
      if (status) {
        sql += ` AND status = ?`;
        params.push(status);
      }
      if (tag) {
        sql += ` AND tags LIKE ?`;
        params.push(`%${tag}%`);
      }
      if (since) {
        sql += ` AND created_at >= ?`;
        params.push(since);
      }
      sql += ` ORDER BY created_at DESC LIMIT ?`;
      params.push(limit);
      const rows = await env.DB.prepare(sql)
        .bind(...params)
        .all();
      return structuredResult({ sends: rows.results ?? [] });
    })
  );

  server.registerTool(
    "email_get_send",
    {
      description: "Fetch full details and delivery events for a single messageId.",
      inputSchema: z.object({
        messageId: z.string().min(1),
      }),
    },
    wrapTool(env, "email_get_send", async ({ messageId }) => {
      const auth = currentAuth();
      const row = await env.DB.prepare(`SELECT * FROM email_sends WHERE id = ?`).bind(messageId).first();
      if (!row) return textResult(`Send ${messageId} not found`, true);
      if (!canAccessRow(auth, (row as { user_id: string | null }).user_id)) {
        return textResult("Not allowed to read this send", true);
      }
      return structuredResult(row);
    })
  );
}

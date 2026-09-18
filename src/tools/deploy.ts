import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env } from "../lib/types";
import { structuredResult, textResult } from "../lib/types";
import { currentAuth, requireWrite } from "../lib/authz";
import { wrapTool } from "../lib/tool-wrap";
import { logActivity } from "../lib/activity";

function baseUrl(env: Env): string {
  return (env.HTML_DEPLOY_BASE_URL || "https://html-deploy.registermysite.com").replace(/\/$/, "");
}

function authHeaders(env: Env): HeadersInit {
  return {
    "content-type": "application/json",
    ...(env.HTML_DEPLOY_TOKEN ? { Authorization: `Bearer ${env.HTML_DEPLOY_TOKEN}` } : {}),
  };
}

export function registerDeployTools(server: McpServer, env: Env) {
  server.registerTool(
    "deploy_list_programs",
    {
      description: "List html-deploy catalog programs (sites, tools, email, SEO).",
      inputSchema: z.object({ category: z.string().optional() }),
    },
    wrapTool(env, "deploy_list_programs", async ({ category }) => {
      const res = await fetch(`${baseUrl(env)}/catalog`, { headers: authHeaders(env) });
      if (!res.ok) return textResult(`Catalog request failed (${res.status})`, true);
      const data = (await res.json()) as { programs?: Array<Record<string, unknown>> };
      const programs = (data.programs ?? []).filter((p) =>
        category ? String(p.category).toLowerCase() === category.toLowerCase() : true
      );
      return structuredResult({ count: programs.length, programs });
    })
  );

  server.registerTool(
    "deploy_run",
    {
      description: "Deploy a catalog program via POST /deploy on html-deploy.registermysite.com.",
      inputSchema: z.object({
        programId: z.string().min(1),
        subdomain: z.string().optional(),
        config: z.record(z.string(), z.unknown()).optional(),
      }),
    },
    wrapTool(env, "deploy_run", async ({ programId, subdomain, config }) => {
      const auth = currentAuth();
      const denied = requireWrite(auth);
      if (denied) return denied;
      if (!env.HTML_DEPLOY_TOKEN) {
        return textResult("HTML_DEPLOY_TOKEN secret is not set. wrangler secret put HTML_DEPLOY_TOKEN", true);
      }
      const res = await fetch(`${baseUrl(env)}/deploy`, {
        method: "POST",
        headers: authHeaders(env),
        body: JSON.stringify({ programId, subdomain, config: config ?? {} }),
      });
      const body = await res.text();
      let parsed: unknown = body;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = { raw: body.slice(0, 2000) };
      }
      await logActivity(env, "deploy.run", "program", programId, auth.userId, { subdomain, status: res.status });
      return structuredResult({ ok: res.ok, status: res.status, result: parsed });
    })
  );

  server.registerTool(
    "deploy_email_program",
    {
      description: "Deploy email-templates or auto-reply to a subdomain.",
      inputSchema: z.object({
        programId: z.enum(["email-templates", "auto-reply"]),
        subdomain: z.string().optional(),
        config: z.record(z.string(), z.unknown()).optional(),
      }),
    },
    wrapTool(env, "deploy_email_program", async ({ programId, subdomain, config }) => {
      const auth = currentAuth();
      const denied = requireWrite(auth);
      if (denied) return denied;
      if (!env.HTML_DEPLOY_TOKEN) return textResult("HTML_DEPLOY_TOKEN secret is not set.", true);
      const res = await fetch(`${baseUrl(env)}/deploy`, {
        method: "POST",
        headers: authHeaders(env),
        body: JSON.stringify({
          programId,
          subdomain: subdomain ?? (programId === "auto-reply" ? "auto-reply" : "email"),
          config: config ?? {},
        }),
      });
      const text = await res.text();
      let result: unknown = text;
      try {
        result = JSON.parse(text);
      } catch {
        result = { raw: text.slice(0, 2000) };
      }
      await logActivity(env, "deploy.email", "program", programId, auth.userId);
      return structuredResult({ ok: res.ok, status: res.status, result });
    })
  );

  server.registerTool(
    "site_from_r2",
    {
      description: "Write landing HTML to R2 and deploy r2-landing.",
      inputSchema: z.object({
        html: z.string().min(1),
        subdomain: z.string().optional().default("landing"),
        title: z.string().optional(),
      }),
    },
    wrapTool(env, "site_from_r2", async ({ html, subdomain = "landing", title }) => {
      const auth = currentAuth();
      const denied = requireWrite(auth);
      if (denied) return denied;
      const key = "programs/landing/index.html";
      await env.R2.put(key, html, {
        httpMetadata: { contentType: "text/html; charset=utf-8" },
        customMetadata: { userId: auth.userId, title: title ?? "Landing" },
      });
      if (!env.HTML_DEPLOY_TOKEN) {
        return structuredResult({ key, deployed: false, note: "HTML stored in R2. Set HTML_DEPLOY_TOKEN to deploy r2-landing." });
      }
      const res = await fetch(`${baseUrl(env)}/deploy`, {
        method: "POST",
        headers: authHeaders(env),
        body: JSON.stringify({ programId: "r2-landing", subdomain, config: { html } }),
      });
      const body = await res.text();
      await logActivity(env, "deploy.site_from_r2", "program", "r2-landing", auth.userId, { subdomain });
      return structuredResult({ key, status: res.status, body: body.slice(0, 2000) });
    })
  );
}

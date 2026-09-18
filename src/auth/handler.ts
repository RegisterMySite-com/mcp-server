import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Env, AuthProps } from "../lib/types";
import { uuid } from "../lib/utils";

interface AuthEnv extends Env {
  OAUTH_PROVIDER: OAuthHelpers;
}

const STATE_TTL = 600;

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function layout(title: string, inner: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${title}</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #0b1220; color: #e8eef9; }
    main { max-width: 640px; margin: 48px auto; padding: 0 20px; }
    .card { background: #141c2c; border: 1px solid #243049; border-radius: 16px; padding: 28px; }
    h1 { margin: 0 0 12px; font-size: 1.5rem; }
    p, li { color: #c5d0e6; line-height: 1.55; }
    .meta { background: #0b1220; border-radius: 10px; padding: 14px; font-family: ui-monospace, monospace; font-size: 13px; }
    .row { display: flex; gap: 10px; margin-top: 20px; }
    button, .btn { border: 0; border-radius: 10px; padding: 10px 16px; font-size: 15px; cursor: pointer; text-decoration: none; display: inline-block; }
    .ok { background: #3b82f6; color: white; flex: 1; text-align: center; }
    .no { background: #2a3348; color: #dbe4f5; }
    a { color: #93c5fd; }
  </style>
</head>
<body><main><section class="card">${inner}</section></main></body>
</html>`;
}

async function putState(env: AuthEnv, value: unknown): Promise<string> {
  const id = uuid();
  await env.OAUTH_KV.put(`oauth:state:${id}`, JSON.stringify(value), { expirationTtl: STATE_TTL });
  return id;
}

async function takeState<T>(env: AuthEnv, id: string): Promise<T | null> {
  const raw = await env.OAUTH_KV.get(`oauth:state:${id}`);
  if (!raw) return null;
  await env.OAUTH_KV.delete(`oauth:state:${id}`);
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export const AuthHandler: ExportedHandler<AuthEnv> = {
  async fetch(request: Request, env: AuthEnv) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        server: env.MCP_SERVER_NAME,
        version: env.MCP_SERVER_VERSION,
        auth: true,
      });
    }

    if (url.pathname === "/" && request.method === "GET") {
      return html(
        layout(
          env.MCP_SERVER_NAME || "MCP",
          `<h1>${env.MCP_SERVER_NAME || "Cloudflare Knowledge Workspace"}</h1>
           <p>Remote MCP server. Clients connect to <code>/mcp</code> with OAuth 2.1.</p>
           <div class="meta">
             /mcp — Streamable HTTP (Bearer)<br/>
             /authorize — OAuth authorization<br/>
             /oauth/token — token endpoint<br/>
             /oauth/register — dynamic client registration<br/>
             /health — liveness
           </div>`
        )
      );
    }

    if (url.pathname === "/authorize" && request.method === "GET") {
      const oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      const client = await env.OAUTH_PROVIDER.lookupClient(oauthReq.clientId);
      if (!client) return html(layout("Invalid client", "<h1>Invalid client_id</h1>"), 400);

      if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
        const state = await putState(env, oauthReq);
        const redirectUri = `${url.origin}/auth/github/callback`;
        const gh = new URL("https://github.com/login/oauth/authorize");
        gh.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
        gh.searchParams.set("redirect_uri", redirectUri);
        gh.searchParams.set("scope", "read:user user:email");
        gh.searchParams.set("state", state);
        return Response.redirect(gh.toString(), 302);
      }

      const state = await putState(env, oauthReq);
      return html(
        layout(
          "Authorize MCP client",
          `<h1>Authorization request</h1>
           <p><strong>${client.clientName || "An MCP client"}</strong> wants access to your knowledge workspace.</p>
           <div class="meta">client: ${client.clientId}<br/>scopes: ${oauthReq.scope.join(", ") || "none"}</div>
           <p>GitHub OAuth is not configured, so this approval issues a demo identity. Set <code>GITHUB_CLIENT_ID</code> and <code>GITHUB_CLIENT_SECRET</code> for production logins.</p>
           <form method="POST" action="/authorize">
             <input type="hidden" name="state" value="${state}"/>
             <div class="row">
               <button class="no" type="button" onclick="history.back()">Cancel</button>
               <button class="ok" type="submit">Approve</button>
             </div>
           </form>`
        )
      );
    }

    if (url.pathname === "/authorize" && request.method === "POST") {
      const form = await request.formData();
      const state = String(form.get("state") || "");
      const oauthReq = await takeState<AuthRequest>(env, state);
      if (!oauthReq) return html(layout("Expired", "<h1>Authorization state expired</h1>"), 400);
      const props: AuthProps = {
        userId: "demo-user",
        username: "demo",
        displayName: "Demo User",
        email: "demo@registermysite.com",
        provider: "demo",
        scopes: oauthReq.scope,
      };
      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthReq,
        userId: props.userId,
        metadata: { label: "MCP Workspace" },
        scope: oauthReq.scope,
        props,
      });
      return Response.redirect(redirectTo, 302);
    }

    if (url.pathname === "/auth/github/callback" && request.method === "GET") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state") ?? "";
      const oauthReq = await takeState<AuthRequest>(env, state);
      if (!code || !oauthReq) return html(layout("OAuth error", "<h1>Missing code or state</h1>"), 400);
      if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
        return html(layout("OAuth error", "<h1>GitHub OAuth is not configured</h1>"), 500);
      }

      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: `${url.origin}/auth/github/callback`,
        }),
      });
      const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
      if (!tokenJson.access_token) {
        return html(layout("GitHub error", `<h1>Token exchange failed</h1><p>${tokenJson.error ?? "unknown"}</p>`), 401);
      }

      const userRes = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${tokenJson.access_token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "registermysite-mcp",
        },
      });
      const user = (await userRes.json()) as {
        id?: number;
        login?: string;
        name?: string;
        email?: string;
        avatar_url?: string;
      };
      if (!user.id) return html(layout("GitHub error", "<h1>Could not load GitHub profile</h1>"), 401);

      const props: AuthProps = {
        userId: `github:${user.id}`,
        username: user.login,
        displayName: user.name ?? user.login,
        email: user.email ?? undefined,
        avatarUrl: user.avatar_url,
        provider: "github",
        scopes: oauthReq.scope,
      };
      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthReq,
        userId: props.userId,
        metadata: { label: props.username ?? props.userId },
        scope: oauthReq.scope,
        props,
      });
      return Response.redirect(redirectTo, 302);
    }

    return html(layout("Not found", "<h1>Not found</h1>"), 404);
  },
};

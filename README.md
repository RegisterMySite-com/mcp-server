# Cloudflare Knowledge Workspace

Production remote MCP server on Cloudflare Workers.

Bindings: D1, KV, R2, Workers AI, Vectorize, Queues, Analytics Engine, OAuth.

Connect MCP clients to `/mcp` (Streamable HTTP).

## What shipped

- Utility: `health_check`, `list_services`, `whoami`
- Notes / D1: CRUD, `notes_search` (FTS5), `notes_upsert_and_embed`, `d1_query` (SELECT only), `activity_list`
- KV: namespaced `kv_*`
- R2 + documents: `r2_*`, `documents_*`
- AI: `ai_summarize`, `ai_generate`, `ai_classify_note`, `kb_ask`
- Vectorize: `vector_*`, hybrid `kb_search` (FTS + RRF)
- Email: templates + send history against D1; delivery via `EMAIL_API_URL` (Cloudflare Email Sending / SMTP bridge)
- html-deploy: `deploy_list_programs`, `deploy_run`, `deploy_email_program`, `site_from_r2`
- Queue-backed embedding (`INDEX_QUEUE` → `mcp-index`)
- OAuth 2.1 (GitHub when secrets are set, demo consent otherwise)
- Per-user authz, KV rate limits, Analytics Engine metrics
- CI typecheck

## Setup

```bash
npm install
npx wrangler login
npx wrangler d1 create knowledge
npx wrangler kv namespace create KV
npx wrangler kv namespace create OAUTH_KV
npx wrangler r2 bucket create mcp-workspace-docs
npx wrangler vectorize create mcp-knowledge --dimensions=768 --metric=cosine
npx wrangler queues create mcp-index
npx wrangler queues create mcp-index-dlq
```

Paste the returned IDs into `wrangler.jsonc`.

```bash
npx wrangler secret put COOKIE_ENCRYPTION_KEY
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put HTML_DEPLOY_TOKEN
npx wrangler secret put EMAIL_API_URL
npx wrangler secret put EMAIL_API_KEY
```

```bash
npm run db:migrate:remote
npm run deploy
```

Local:

```bash
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

## Email

Transactional mail is not Gmail. Configure `EMAIL_API_URL` / `EMAIL_API_KEY` to the RegisterMySite Cloudflare Email Sending bridge. Every send is written to `email_sends`.

html-deploy catalog: https://html-deploy.registermysite.com/catalog

## Auth

`AUTH_ENABLED=true` (default) wraps `/mcp` with OAuth. Clients register at `/oauth/register` and authorize at `/authorize`.
